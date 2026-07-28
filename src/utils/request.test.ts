import { describe, it, expect } from "vitest";
import {
  parseQueryParams,
  parseBody,
  enhanceRequest,
  getHeader,
  accepts,
  getIp,
  BodyParseError,
  type RequestIpResolver,
} from "./request";

/** Minimal stand-in for `Bun.Server["requestIP"]`. */
function stubServer(address: string | null): RequestIpResolver {
  return { requestIP: () => (address === null ? null : { address }) };
}

describe("parseQueryParams", () => {
  it("should parse query parameters from URL", () => {
    const url = new URL("http://localhost?foo=bar&baz=qux");
    const result = parseQueryParams(url);
    expect(result).toEqual({ foo: "bar", baz: "qux" });
  });

  it("should return empty object for URL without query params", () => {
    const url = new URL("http://localhost/path");
    const result = parseQueryParams(url);
    expect(result).toEqual({});
  });

  it("should handle URL-encoded values", () => {
    const url = new URL("http://localhost?name=John%20Doe&city=New%20York");
    const result = parseQueryParams(url);
    expect(result).toEqual({ name: "John Doe", city: "New York" });
  });

  it("should collect repeated keys into an array", () => {
    const url = new URL("http://localhost?a=1&a=2");
    const result = parseQueryParams(url);
    expect(result).toEqual({ a: ["1", "2"] });
  });

  it("should collect three or more repeats into a single array", () => {
    const url = new URL("http://localhost?tag=a&tag=b&tag=c&other=x");
    const result = parseQueryParams(url);
    expect(result).toEqual({ tag: ["a", "b", "c"], other: "x" });
  });
});

describe("parseBody", () => {
  it("should parse JSON body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    const result = await parseBody(request);
    expect(result).toEqual({ foo: "bar" });
  });

  it("should throw BodyParseError for invalid JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });

    let thrown: unknown;
    try {
      await parseBody(request);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BodyParseError);
    expect((thrown as BodyParseError).message).toBe("Invalid JSON body");
    expect((thrown as BodyParseError).contentType).toBe("application/json");
    expect((thrown as BodyParseError).cause).toBeInstanceOf(Error);
  });

  it("should distinguish a literal null body from a malformed one", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    expect(await parseBody(request)).toBeNull();
  });

  it("should return undefined when there is no body at all", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(request.body).toBeNull();
    expect(await parseBody(request)).toBeUndefined();
  });

  it("should return undefined for an empty JSON payload", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "   ",
    });
    expect(await parseBody(request)).toBeUndefined();
  });

  it("should return undefined when content-length is 0", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "0" },
      body: "{}",
    });
    expect(await parseBody(request)).toBeUndefined();
  });

  it("should ignore content-type parameters such as charset", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: true }),
    });
    expect(await parseBody(request)).toEqual({ ok: true });
  });

  it.each([
    ["application/vnd.api+json"],
    ["application/problem+json"],
    ["application/ld+json"],
  ])("should parse structured JSON suffix %s", async (contentType) => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: JSON.stringify({ foo: "bar" }),
    });
    expect(await parseBody(request)).toEqual({ foo: "bar" });
  });

  it("should return text for structured XML suffixes", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/atom+xml" },
      body: "<feed/>",
    });
    expect(await parseBody(request)).toBe("<feed/>");
  });

  it("should parse URL-encoded form data", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "foo=bar&baz=qux",
    });
    const result = await parseBody(request);
    expect(result).toEqual({ foo: "bar", baz: "qux" });
  });

  it("should collect repeated URL-encoded keys into an array", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "tag=a&tag=b",
    });
    expect(await parseBody(request)).toEqual({ tag: ["a", "b"] });
  });

  it("should parse multipart form data", async () => {
    const formData = new FormData();
    formData.append("name", "John");
    formData.append("age", "30");

    const request = new Request("http://localhost", {
      method: "POST",
      body: formData,
    });
    const result = await parseBody(request);
    expect(result).toEqual({ name: "John", age: "30" });
  });

  it("should parse text body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "Hello, World!",
    });
    const result = await parseBody(request);
    expect(result).toBe("Hello, World!");
  });

  it("should return ArrayBuffer for binary data", async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer,
    });
    const result = await parseBody(request);
    expect(result).toBeInstanceOf(ArrayBuffer);
  });

  it("should return ArrayBuffer when no content-type header is present", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]).buffer,
    });
    expect(request.headers.get("content-type")).toBeNull();
    const result = await parseBody(request);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("should throw BodyParseError when the URL-encoded body cannot be read", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "valid=data",
    });
    Object.defineProperty(request, "text", {
      value: () => Promise.reject(new Error("Parse error")),
    });

    await expect(parseBody(request)).rejects.toThrow(BodyParseError);
  });

  it("should throw BodyParseError for a malformed multipart body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----x" },
      body: "not actually multipart",
    });

    let thrown: unknown;
    try {
      await parseBody(request);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BodyParseError);
    expect((thrown as BodyParseError).contentType).toBe("multipart/form-data");
  });

  it("should throw BodyParseError when the text body cannot be read", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "test",
    });
    Object.defineProperty(request, "text", {
      value: () => Promise.reject(new Error("Parse error")),
    });

    await expect(parseBody(request)).rejects.toThrow("Failed to read request body");
  });

  it("should throw BodyParseError when the binary body cannot be read", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new ArrayBuffer(4),
    });
    Object.defineProperty(request, "arrayBuffer", {
      value: () => Promise.reject(new Error("Parse error")),
    });

    await expect(parseBody(request)).rejects.toThrow(BodyParseError);
  });
});

describe("enhanceRequest", () => {
  it("should enhance request with params, query, and parsed body", async () => {
    const request = new Request("http://localhost/path?foo=bar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "test" }),
    });

    const enhanced = await enhanceRequest(request, { id: "123" });

    expect(enhanced.params).toEqual({ id: "123" });
    expect(enhanced.query).toEqual({ foo: "bar" });
    expect(await enhanced.bodyPromise).toEqual({ data: "test" });
  });

  it("should mutate and return the same request instance", async () => {
    const request = new Request("http://localhost/path");
    const enhanced = await enhanceRequest(request);
    expect(enhanced).toBe(request);
  });

  it("should work without params", async () => {
    const request = new Request("http://localhost?a=1");
    const enhanced = await enhanceRequest(request);

    expect(enhanced.params).toEqual({});
    expect(enhanced.query).toEqual({ a: "1" });
  });

  it("should leave bodyPromise undefined for GET requests with no body", async () => {
    const request = new Request("http://localhost/path?a=1");
    const enhanced = await enhanceRequest(request);

    expect(enhanced.bodyPromise).toBeUndefined();
    expect(await enhanced.bodyPromise).toBeUndefined();
  });

  it("should leave bodyPromise undefined for a POST with no body", async () => {
    const request = new Request("http://localhost/path", { method: "POST" });
    const enhanced = await enhanceRequest(request);
    expect(enhanced.bodyPromise).toBeUndefined();
  });

  it("should not read the body unless bodyPromise is accessed", async () => {
    const request = new Request("http://localhost/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    let reads = 0;
    const originalText = request.text.bind(request);
    Object.defineProperty(request, "text", {
      value: () => {
        reads += 1;
        return originalText();
      },
    });

    const enhanced = await enhanceRequest(request);
    expect(reads).toBe(0);

    expect(await enhanced.bodyPromise).toEqual({ a: 1 });
    expect(reads).toBe(1);

    // Repeated access reuses the cached promise rather than re-reading the stream.
    expect(await enhanced.bodyPromise).toEqual({ a: 1 });
    expect(reads).toBe(1);
  });

  it("should surface body parse errors through bodyPromise", async () => {
    const request = new Request("http://localhost/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });

    const enhanced = await enhanceRequest(request);
    await expect(enhanced.bodyPromise).rejects.toThrow(BodyParseError);
  });

  it("should leave the raw body stream reachable", async () => {
    const request = new Request("http://localhost/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    const enhanced = await enhanceRequest(request);

    // `bodyPromise` must not shadow `Request.body`, or stream consumers break.
    expect(enhanced.body).toBeInstanceOf(ReadableStream);
  });

  it("should no longer define the removed parsedBody property", async () => {
    const request = new Request("http://localhost/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    const enhanced = await enhanceRequest(request);
    expect("parsedBody" in enhanced).toBe(false);
  });

  it("should accept an already-parsed URL instead of re-parsing", async () => {
    const url = new URL("http://localhost/path?foo=bar&foo=baz");
    const request = new Request(url.href);
    const enhanced = await enhanceRequest(request, { id: "1" }, url);

    expect(enhanced.query).toEqual({ foo: ["bar", "baz"] });
  });
});

describe("getHeader", () => {
  it("should get header value case-insensitively", () => {
    const request = new Request("http://localhost", {
      headers: { "Content-Type": "application/json" },
    });
    expect(getHeader(request, "content-type")).toBe("application/json");
    expect(getHeader(request, "Content-Type")).toBe("application/json");
  });

  it("should return null for missing header", () => {
    const request = new Request("http://localhost");
    expect(getHeader(request, "x-missing")).toBeNull();
  });
});

describe("accepts", () => {
  it("should return true when type is accepted", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "application/json, text/html" },
    });
    expect(accepts(request, "application/json")).toBe(true);
    expect(accepts(request, "text/html")).toBe(true);
  });

  it("should return true for */* accept header", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "*/*" },
    });
    expect(accepts(request, "anything")).toBe(true);
  });

  it("should return false when type is not accepted", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "text/plain" },
    });
    expect(accepts(request, "application/json")).toBe(false);
  });

  it("should default to accepting everything when no accept header", () => {
    const request = new Request("http://localhost");
    expect(accepts(request, "application/json")).toBe(true);
  });

  it("should treat q=0 as an explicit rejection", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "application/json;q=0" },
    });
    expect(accepts(request, "application/json")).toBe(false);
  });

  it("should let a specific q=0 override a wildcard", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "*/*, application/json;q=0" },
    });
    expect(accepts(request, "application/json")).toBe(false);
    expect(accepts(request, "text/html")).toBe(true);
  });

  it("should honour non-zero quality values", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "text/html;q=0.9, application/json;q=0.1" },
    });
    expect(accepts(request, "application/json")).toBe(true);
    expect(accepts(request, "text/html")).toBe(true);
  });

  it("should match subtype wildcards", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "text/*" },
    });
    expect(accepts(request, "text/html")).toBe(true);
    expect(accepts(request, "text/plain")).toBe(true);
    expect(accepts(request, "application/json")).toBe(false);
  });

  it("should not substring-match structured suffixes", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "application/vnd.api+json" },
    });
    expect(accepts(request, "application/vnd.api+json")).toBe(true);
    expect(accepts(request, "application/json")).toBe(false);
  });

  it("should not match a bare extension name against a concrete type", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "application/json" },
    });
    expect(accepts(request, "json")).toBe(false);
  });

  it("should ignore parameters on the requested type", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "application/json" },
    });
    expect(accepts(request, "application/json; charset=utf-8")).toBe(true);
  });

  it("should be case-insensitive", () => {
    const request = new Request("http://localhost", {
      headers: { Accept: "Application/JSON" },
    });
    expect(accepts(request, "application/json")).toBe(true);
  });
});

describe("getIp", () => {
  it("should ignore spoofable forwarding headers by default", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "1.2.3.4", "X-Real-IP": "5.6.7.8" },
    });
    expect(getIp(request)).toBeNull();
    expect(getIp(request, { trustProxy: false })).toBeNull();
  });

  it("should resolve a direct connection from the server socket", () => {
    const request = new Request("http://localhost");
    expect(getIp(request, { server: stubServer("203.0.113.7") })).toBe("203.0.113.7");
  });

  it("should prefer the socket address over spoofed headers when not trusting proxies", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(getIp(request, { server: stubServer("203.0.113.7") })).toBe("203.0.113.7");
  });

  it("should return null when the socket address is unavailable", () => {
    const request = new Request("http://localhost");
    expect(getIp(request, { server: stubServer(null) })).toBeNull();
    expect(getIp(request)).toBeNull();
  });

  it("should take the left-most entry when trusting the whole chain", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "192.168.1.1, 10.0.0.1" },
    });
    expect(getIp(request, { trustProxy: true })).toBe("192.168.1.1");
  });

  it("should count hops from the right when trustProxy is a number", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
    });
    expect(getIp(request, { trustProxy: 1 })).toBe("3.3.3.3");
    expect(getIp(request, { trustProxy: 2 })).toBe("2.2.2.2");
    expect(getIp(request, { trustProxy: 3 })).toBe("1.1.1.1");
  });

  it("should clamp the hop count to the left-most entry", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "1.1.1.1, 2.2.2.2" },
    });
    expect(getIp(request, { trustProxy: 10 })).toBe("1.1.1.1");
  });

  it("should treat a zero or negative hop count as untrusted", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "1.1.1.1" },
    });
    expect(getIp(request, { trustProxy: 0, server: stubServer("203.0.113.7") })).toBe(
      "203.0.113.7"
    );
    expect(getIp(request, { trustProxy: -1 })).toBeNull();
  });

  it("should fall back to x-real-ip when trusting proxies", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Real-IP": "10.0.0.1" },
    });
    expect(getIp(request, { trustProxy: true })).toBe("10.0.0.1");
    expect(getIp(request, { trustProxy: 1 })).toBe("10.0.0.1");
  });

  it("should prefer x-forwarded-for over x-real-ip when trusting proxies", () => {
    const request = new Request("http://localhost", {
      headers: {
        "X-Forwarded-For": "192.168.1.1",
        "X-Real-IP": "10.0.0.1",
      },
    });
    expect(getIp(request, { trustProxy: true })).toBe("192.168.1.1");
  });

  it("should fall back to the socket when trusted headers are absent", () => {
    const request = new Request("http://localhost");
    expect(getIp(request, { trustProxy: true, server: stubServer("203.0.113.7") })).toBe(
      "203.0.113.7"
    );
  });

  it("should ignore empty forwarded entries", () => {
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": " , 1.1.1.1 ,  , 2.2.2.2 " },
    });
    expect(getIp(request, { trustProxy: true })).toBe("1.1.1.1");
    expect(getIp(request, { trustProxy: 1 })).toBe("2.2.2.2");
  });
});
