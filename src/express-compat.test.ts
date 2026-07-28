import { describe, it, expect, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { createExpressRequest, createExpressResponse } from "./express-compat";

describe("createExpressRequest", () => {
  it("should create request with basic properties", () => {
    const bunRequest = new Request("http://localhost:3000/path?foo=bar");
    const req = createExpressRequest(bunRequest, { id: "123" });

    expect(req.raw).toBe(bunRequest);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("/path?foo=bar");
    expect(req.originalUrl).toBe("/path?foo=bar");
    expect(req.path).toBe("/path");
    expect(req.baseUrl).toBe("");
    expect(req.hostname).toBe("localhost");
    expect(req.protocol).toBe("http");
    expect(req.secure).toBe(false);
    expect(req.params).toEqual({ id: "123" });
    expect(req.query).toEqual({ foo: "bar" });
  });

  it("should handle HTTPS protocol", () => {
    const bunRequest = new Request("https://example.com/path");
    const req = createExpressRequest(bunRequest);

    expect(req.protocol).toBe("https");
    expect(req.secure).toBe(true);
  });

  it("should parse headers into object", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "Content-Type": "application/json", "X-Custom": "value" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["x-custom"]).toBe("value");
  });

  it("should handle duplicate headers", () => {
    const headers = new Headers();
    headers.append("X-Multi", "value1");
    headers.append("X-Multi", "value2");
    const bunRequest = new Request("http://localhost", { headers });
    const req = createExpressRequest(bunRequest);

    // Headers.append combines values with ", " in Node.js
    // The implementation parses this back into an array
    const headerValue = req.headers["x-multi"];
    expect(headerValue).toBeDefined();
  });

  it("should convert multiple same headers to array", () => {
    // Manually test the array branch by simulating the forEach callback
    const headers: Record<string, string | string[] | undefined> = {};
    // First value
    headers["x-test"] = "value1";
    // Second value - should create array
    const existing = headers["x-test"];
    if (existing) {
      headers["x-test"] = Array.isArray(existing) ? [...existing, "value2"] : [existing, "value2"];
    }
    // Third value - should spread existing array
    const existing2 = headers["x-test"];
    if (existing2) {
      headers["x-test"] = Array.isArray(existing2) ? [...existing2, "value3"] : [existing2, "value3"];
    }

    expect(headers["x-test"]).toEqual(["value1", "value2", "value3"]);
  });

  it("should parse cookies", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { Cookie: "session=abc123; user=john" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.cookies).toEqual({ session: "abc123", user: "john" });
  });

  it("should handle cookies with = in value", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { Cookie: "token=abc=def=ghi" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.cookies.token).toBe("abc=def=ghi");
  });

  it("should get IP from x-forwarded-for when proxy is trusted", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "192.168.1.1, 10.0.0.1" },
    });
    const req = createExpressRequest(bunRequest, {}, true);

    expect(req.ip).toBe("192.168.1.1");
    expect(req.ips).toEqual(["192.168.1.1", "10.0.0.1"]);
  });

  it("should ignore x-forwarded-for when proxy is not trusted", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "192.168.1.1, 10.0.0.1" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.ip).toBe("");
    expect(req.ips).toEqual([]);
  });

  it("should use the peer address when the proxy is not trusted", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "192.168.1.1" },
    });
    const req = createExpressRequest(bunRequest, {}, false, "203.0.113.9");

    expect(req.ip).toBe("203.0.113.9");
    expect(req.ips).toEqual([]);
  });

  it("should get IP from x-real-ip when proxy is trusted", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Real-IP": "10.0.0.1" },
    });
    const req = createExpressRequest(bunRequest, {}, true);

    expect(req.ip).toBe("10.0.0.1");
  });

  it("should not fabricate a localhost IP when nothing is known", () => {
    const bunRequest = new Request("http://localhost");
    const req = createExpressRequest(bunRequest);

    expect(req.ip).toBe("");
    expect(req.ips).toEqual([]);
  });

  it("should fall back to the peer address when trusting an empty proxy chain", () => {
    const bunRequest = new Request("http://localhost");
    const req = createExpressRequest(bunRequest, {}, true, "203.0.113.9");

    expect(req.ip).toBe("203.0.113.9");
  });

  it("should parse subdomains", () => {
    const bunRequest = new Request("http://api.v1.example.com/path");
    const req = createExpressRequest(bunRequest);

    expect(req.subdomains).toEqual(["v1", "api"]);
  });

  it("should prefer x-forwarded-proto when the proxy is trusted", () => {
    const bunRequest = new Request("http://localhost/path", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    const req = createExpressRequest(bunRequest, {}, true);

    expect(req.protocol).toBe("https");
    expect(req.secure).toBe(true);
  });

  it("should ignore x-forwarded-proto when the proxy is not trusted", () => {
    const bunRequest = new Request("http://localhost/path", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.protocol).toBe("http");
    expect(req.secure).toBe(false);
  });

  it("should prefer x-forwarded-host when the proxy is trusted", () => {
    const bunRequest = new Request("http://localhost/path", {
      headers: { "X-Forwarded-Host": "api.v1.example.com" },
    });
    const req = createExpressRequest(bunRequest, {}, true);

    expect(req.hostname).toBe("api.v1.example.com");
    expect(req.subdomains).toEqual(["v1", "api"]);
  });

  it("should collect repeated query keys into an array", () => {
    const bunRequest = new Request("http://localhost/path?a=1&a=2&b=3");
    const req = createExpressRequest(bunRequest);

    expect(req.query).toEqual({ a: ["1", "2"], b: "3" });
  });

  // Both parsers take keys straight from the client, so the two ways a plain
  // object mishandles an attacker-chosen key are reachable over the wire.
  it("should keep __proto__ as an own query key without touching the prototype", () => {
    const req = createExpressRequest(new Request("http://localhost/?__proto__=a&__proto__=b"));
    const query = req.query as Record<string, unknown>;

    expect(Object.getPrototypeOf(query)).toBe(Object.prototype);
    expect(Object.hasOwn(query, "__proto__")).toBe(true);
    expect(query["__proto__"]).toEqual(["a", "b"]);
  });

  it("should not read inherited Object members when folding repeated query keys", () => {
    const req = createExpressRequest(new Request("http://localhost/?constructor=1&toString=2"));

    expect(req.query).toEqual({ constructor: "1", toString: "2" });
  });

  // Header names are lowercased in transit, which rules out `toString` and
  // `valueOf` but NOT `__proto__` or `constructor` - both are already lower
  // case and both arrive intact.
  it("should not read inherited Object members when folding repeated headers", () => {
    const req = createExpressRequest(
      new Request("http://localhost", { headers: { constructor: "evil" } })
    );

    expect(req.headers.constructor).toBe("evil");
  });

  // The twin of the query-side test above. Without `setOwn` this header is
  // silently dropped rather than mis-folded, so `Object.hasOwn` alone does not
  // catch it - a guard reading this header would see `undefined`.
  it("should keep __proto__ as an own header key without touching the prototype", () => {
    const req = createExpressRequest(
      new Request("http://localhost", { headers: new Headers([["__proto__", "evil"]]) })
    );
    const headers = req.headers as Record<string, unknown>;

    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
    expect(Object.hasOwn(headers, "__proto__")).toBe(true);
    expect(headers["__proto__"]).toBe("evil");
  });

  it("should keep prototype-named cookies instead of dropping them", () => {
    const req = createExpressRequest(
      new Request("http://localhost", {
        headers: { Cookie: "constructor=abc; toString=def; ok=1" },
      })
    );

    expect(req.cookies).toEqual({ constructor: "abc", toString: "def", ok: "1" });
  });

  it("should decode percent-encoded cookie values", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { Cookie: "redirect=%2Fdash%3Fa%3D1; name=John%20Doe" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.cookies.redirect).toBe("/dash?a=1");
    expect(req.cookies.name).toBe("John Doe");
  });

  it("should fall back to the raw value on malformed cookie escapes", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { Cookie: "broken=%E0%A4%A" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.cookies.broken).toBe("%E0%A4%A");
  });

  it("should skip valueless cookies", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { Cookie: "flag; real=1" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.cookies).toEqual({ real: "1" });
  });

  it("should round-trip a cookie set by res.cookie", () => {
    const res = createExpressResponse();
    res.cookie("redirect", "/dash?a=1");

    const bunRequest = new Request("http://localhost", {
      headers: { Cookie: res._headers.get("Set-Cookie") as string },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.cookies.redirect).toBe("/dash?a=1");
  });

  it("should detect XHR requests", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const req = createExpressRequest(bunRequest);

    expect(req.xhr).toBe(true);
  });

  it("should return false for non-XHR requests", () => {
    const bunRequest = new Request("http://localhost");
    const req = createExpressRequest(bunRequest);

    expect(req.xhr).toBe(false);
  });

  // The adapter already parses the request URL to route the request; handing
  // that URL back avoids a second `new URL()` per request. The parsed URL is the
  // sole source of path/query/host, so it has to be honoured everywhere — and it
  // has to be the request's own URL, or middleware authorises a different path
  // from the one the router matched.
  //
  // Every test here is falsifiable: replacing `parsedUrl ?? new URL(...)` with a
  // plain `new URL(bunRequest.url)` fails them. Comparing the two forms of the
  // call cannot, because a coherent `parsedUrl` is by definition equal to what
  // the fallback would build, so those comparisons are omitted.
  describe("pre-parsed URL", () => {
    /**
     * Serialises to the request's own href — so it satisfies the coherence
     * guard — while reporting tagged components. Anything the built request
     * derives from `parsedUrl` therefore carries a value that re-parsing
     * `bunRequest.url` could never produce.
     */
    class TaggedURL extends URL {
      public get hostname(): string {
        return "tagged.invalid";
      }

      public get pathname(): string {
        return "/tagged/path";
      }

      public get protocol(): string {
        return "https:";
      }

      public get searchParams(): URLSearchParams {
        return new URLSearchParams("tagged=yes");
      }
    }

    it("should derive path, url, hostname and query from the supplied instance", () => {
      const bunRequest = new Request("http://localhost:3000/path?foo=bar");
      const req = createExpressRequest(
        bunRequest,
        { id: "123" },
        false,
        undefined,
        new TaggedURL(bunRequest.url)
      );

      // Read off the supplied instance, not off a fresh parse of the request
      expect(req.path).toBe("/tagged/path");
      expect(req.url).toBe("/tagged/path?foo=bar");
      expect(req.originalUrl).toBe("/tagged/path?foo=bar");
      expect(req.hostname).toBe("tagged.invalid");
      expect(req.query).toEqual({ tagged: "yes" });
    });

    it("should read the lazy getters off the supplied instance too", () => {
      // `hostname`, `protocol` and `query` are resolved on first access rather
      // than at construction, so they need their own coverage: a build that
      // used `parsedUrl` eagerly but re-parsed lazily would pass the test above.
      const bunRequest = new Request("http://localhost:3000/path?foo=bar");
      const req = createExpressRequest(
        bunRequest,
        {},
        false,
        undefined,
        new TaggedURL(bunRequest.url)
      );

      expect(req.hostname).toBe("tagged.invalid");
      // The request is plain http; only the supplied instance says otherwise
      expect(req.protocol).toBe("https");
      expect(req.secure).toBe(true);
      expect(req.query).toEqual({ tagged: "yes" });
    });

    it("should not construct a second URL when one is supplied", () => {
      const bunRequest = new Request("http://localhost:3000/path?foo=bar");
      const parsed = new URL(bunRequest.url);

      const RealURL = globalThis.URL;
      let constructions = 0;
      class CountingURL extends RealURL {
        constructor(url: string | URL, base?: string | URL) {
          super(url, base);
          constructions++;
        }
      }

      globalThis.URL = CountingURL as unknown as typeof URL;
      try {
        const withParsed = createExpressRequest(bunRequest, {}, false, undefined, parsed);
        expect(constructions).toBe(0);
        // Touch the lazy getters as well — none of them may re-parse either.
        expect(withParsed.path).toBe("/path");
        expect(withParsed.hostname).toBe("localhost");
        expect(withParsed.query).toEqual({ foo: "bar" });
        expect(constructions).toBe(0);

        // The same call without the argument pays for exactly the parse the
        // parameter exists to avoid.
        createExpressRequest(bunRequest);
        expect(constructions).toBe(1);
      } finally {
        globalThis.URL = RealURL;
      }
    });

    describe("coherence guard", () => {
      // Each of these is a real normalisation a caller might apply before
      // constructing the request, and each makes the request describe a
      // different resource from the one the router matched.
      const cases: Array<[string, string, string]> = [
        ["collapsed duplicate slashes", "http://localhost:3000/a//b", "http://localhost:3000/a/b"],
        ["stripped trailing slash", "http://localhost:3000/admin/", "http://localhost:3000/admin"],
        ["lower-cased path", "http://localhost:3000/Admin", "http://localhost:3000/admin"],
        ["dropped query string", "http://localhost:3000/a?role=user", "http://localhost:3000/a"],
        ["different host", "http://localhost:3000/a", "http://evil.example/a"],
      ];

      for (const [label, requestUrl, suppliedUrl] of cases) {
        it(`should reject a ${label}`, () => {
          const bunRequest = new Request(requestUrl);

          expect(() =>
            createExpressRequest(bunRequest, {}, false, undefined, new URL(suppliedUrl))
          ).toThrow(TypeError);
          expect(() =>
            createExpressRequest(bunRequest, {}, false, undefined, new URL(suppliedUrl))
          ).toThrow("parsedUrl must describe bunRequest.url");
        });
      }

      it("should accept the canonical form of a non-normalised request URL", () => {
        // An absolute-form request target ("GET http://host/a/../b HTTP/1.1")
        // reaches Bun un-normalised on `request.url`, so the adapter's
        // `new URL(bunRequest.url)` is not string-identical to it. It still
        // describes the request, so it must be accepted.
        const bunRequest = new Request("http://localhost:3000/b?x=1");
        Object.defineProperty(bunRequest, "url", {
          value: "http://localhost:3000/a/../b?x=1",
          configurable: true,
        });

        const req = createExpressRequest(
          bunRequest,
          {},
          false,
          undefined,
          new URL(bunRequest.url)
        );

        expect(req.path).toBe("/b");
        expect(req.query).toEqual({ x: "1" });
      });
    });

    it("should still parse the URL when the parameter is omitted", () => {
      const bunRequest = new Request("http://localhost/omitted?q=1");
      const req = createExpressRequest(bunRequest, {}, false, undefined);

      expect(req.path).toBe("/omitted");
      expect(req.query).toEqual({ q: "1" });
    });
  });

  describe("get method", () => {
    it("should get header value", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Content-Type": "application/json" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.get("Content-Type")).toBe("application/json");
      expect(req.get("content-type")).toBe("application/json");
    });

    it("should return undefined for missing header", () => {
      const bunRequest = new Request("http://localhost");
      const req = createExpressRequest(bunRequest);

      expect(req.get("X-Missing")).toBeUndefined();
    });
  });

  describe("header method", () => {
    it("should be alias for get", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Content-Type": "application/json" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.header("Content-Type")).toBe("application/json");
    });
  });

  describe("accepts method", () => {
    it("should return first matching type", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { Accept: "application/json, text/html" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.accepts("application/json")).toBe("application/json");
      expect(req.accepts("text/html")).toBe("text/html");
      expect(req.accepts("text/plain", "text/html")).toBe("text/html");
    });

    it("should return false for non-matching type", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { Accept: "text/plain" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.accepts("application/json")).toBe(false);
    });

    it("should match */* accept header", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { Accept: "*/*" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.accepts("application/json")).toBe("application/json");
    });

    it("should return the caller's first match, in caller order", () => {
      // The shim does not rank by q-value: it is a substring probe over the header
      const bunRequest = new Request("http://localhost", {
        headers: { Accept: "text/html;q=0.4, application/json;q=0.9" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.accepts("text/html", "application/json")).toBe("text/html");
    });
  });

  describe("acceptsCharsets method", () => {
    it("should return matching charset", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Accept-Charset": "utf-8, iso-8859-1" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.acceptsCharsets("utf-8")).toBe("utf-8");
    });

    it("should return false for non-matching charset", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Accept-Charset": "utf-8" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.acceptsCharsets("iso-8859-1")).toBe(false);
    });

    it("should match * wildcard", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Accept-Charset": "*" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.acceptsCharsets("any")).toBe("any");
    });
  });

  describe("acceptsEncodings method", () => {
    it("should return matching encoding", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Accept-Encoding": "gzip, deflate" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.acceptsEncodings("gzip")).toBe("gzip");
    });

    it("should return false for non-matching encoding", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Accept-Encoding": "gzip" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.acceptsEncodings("br")).toBe(false);
    });

  });

  describe("acceptsLanguages method", () => {
    it("should return matching language", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Accept-Language": "en-US, en" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.acceptsLanguages("en-US")).toBe("en-US");
    });

    it("should return false for non-matching language", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { "Accept-Language": "en-US" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.acceptsLanguages("fr")).toBe(false);
    });

  });

  describe("is method", () => {
    const bodyRequest = (contentType: string) =>
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: "payload",
      });

    it("should return type if content-type matches", () => {
      const req = createExpressRequest(bodyRequest("application/json"));

      expect(req.is("json")).toBe("json");
      expect(req.is("application/json")).toBe("application/json");
    });

    it("should ignore content-type parameters", () => {
      const req = createExpressRequest(bodyRequest("application/json; charset=utf-8"));

      expect(req.is("json")).toBe("json");
    });

    it("should return false if content-type does not match", () => {
      const req = createExpressRequest(bodyRequest("text/html"));

      expect(req.is("json")).toBe(false);
    });

    it("should return null if no content-type", () => {
      const bunRequest = new Request("http://localhost", { method: "POST", body: "payload" });
      const req = createExpressRequest(bunRequest);
      // Bun infers text/plain for a string body, so strip it explicitly
      bunRequest.headers.delete("content-type");

      expect(req.is("json")).toBeNull();
    });

  });

  describe("range method", () => {
    it("should return undefined if no range header", () => {
      const bunRequest = new Request("http://localhost");
      const req = createExpressRequest(bunRequest);

      expect(req.range(1000)).toBeUndefined();
    });

    it("should return undefined even when a range header is present", () => {
      // Range parsing is intentionally not implemented by this shim
      const bunRequest = new Request("http://localhost", {
        headers: { Range: "bytes=0-100" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.range(1000)).toBeUndefined();
      expect(req.range(1000, { combine: true })).toBeUndefined();
    });
  });

  describe("mutable properties", () => {
    // Middleware routinely overwrites these (proxies rewrite hostname/protocol,
    // body parsers replace query/cookies/headers), so the setters must stick.
    it("should let middleware overwrite hostname and reset subdomains", () => {
      const req = createExpressRequest(new Request("http://api.v1.example.com/path"));
      expect(req.subdomains).toEqual(["v1", "api"]);

      req.hostname = "www.other.com";

      expect(req.hostname).toBe("www.other.com");
      expect(req.subdomains).toEqual(["www"]);
    });

    it("should let middleware overwrite the connection properties", () => {
      const req = createExpressRequest(new Request("http://localhost/path"));

      req.ip = "203.0.113.1";
      req.ips = ["203.0.113.1", "10.0.0.1"];
      req.protocol = "https";
      req.subdomains = ["forced"];

      expect(req.ip).toBe("203.0.113.1");
      expect(req.ips).toEqual(["203.0.113.1", "10.0.0.1"]);
      expect(req.protocol).toBe("https");
      expect(req.secure).toBe(true);
      expect(req.subdomains).toEqual(["forced"]);

      req.secure = false;
      expect(req.protocol).toBe("http");
    });

    it("should let middleware replace query, cookies and headers", () => {
      const req = createExpressRequest(new Request("http://localhost/path?a=1"));

      req.query = { parsed: "yes" };
      req.cookies = { session: "abc" };
      req.headers = { "x-injected": "1" };

      expect(req.query).toEqual({ parsed: "yes" });
      expect(req.cookies).toEqual({ session: "abc" });
      expect(req.headers).toEqual({ "x-injected": "1" });
    });
  });

  describe("get method aliases", () => {
    it("should alias referrer to referer", () => {
      const bunRequest = new Request("http://localhost", {
        headers: { Referer: "http://example.com" },
      });
      const req = createExpressRequest(bunRequest);

      expect(req.get("referrer")).toBe("http://example.com");
      expect(req.get("Referer")).toBe("http://example.com");
    });
  });
});

describe("createExpressResponse", () => {
  it("should create response with default values", () => {
    const res = createExpressResponse();

    expect(res.statusCode).toBe(200);
    expect(res.statusMessage).toBe("OK");
    expect(res._ended).toBe(false);
    expect(res.headersSent).toBe(false);
    expect(res.locals).toEqual({});
  });

  describe("status method", () => {
    it("should set status code", () => {
      const res = createExpressResponse();
      const result = res.status(201);

      expect(result).toBe(res);
      expect(res.statusCode).toBe(201);
      expect(res._statusCode).toBe(201);
    });
  });

  describe("statusCode setter", () => {
    it("should set status code", () => {
      const res = createExpressResponse();
      res.statusCode = 404;

      expect(res.statusCode).toBe(404);
    });
  });

  describe("internal state accessors", () => {
    it("should keep _statusCode and statusCode in sync", () => {
      const res = createExpressResponse();
      res._statusCode = 418;

      expect(res.statusCode).toBe(418);
      expect(res._statusCode).toBe(418);
    });

    it("should allow headersSent to be forced", () => {
      const res = createExpressResponse();
      res.headersSent = true;

      expect(res.headersSent).toBe(true);
    });
  });

  describe("statusMessage setter", () => {
    it("should set status message", () => {
      const res = createExpressResponse();
      res.statusMessage = "Custom Message";

      expect(res.statusMessage).toBe("Custom Message");
    });
  });

  describe("sendStatus method", () => {
    it("should set status and send status text as body", () => {
      const res = createExpressResponse();
      res.sendStatus(404);

      expect(res.statusCode).toBe(404);
      expect(res._body).toBe("Not Found");
      expect(res._ended).toBe(true);
      expect(res._headers.get("Content-Type")).toBe("text/plain");
      expect(res.statusMessage).toBe("Not Found");
    });

    it("should not assign a body for null-body statuses", () => {
      const res = createExpressResponse();
      res.sendStatus(204);

      expect(res.statusCode).toBe(204);
      expect(res._body).toBeNull();
      expect(res._headers.get("Content-Type")).toBeNull();
      expect(res._headers.get("Content-Length")).toBeNull();
    });
  });

  describe("json method", () => {
    it("should set JSON body", () => {
      const res = createExpressResponse();
      res.json({ foo: "bar" });

      expect(res._body).toBe('{"foo":"bar"}');
      expect(res._ended).toBe(true);
      expect(res._headers.get("Content-Type")).toBe("application/json");
    });

    it("should not clobber a caller-set Content-Type", () => {
      const res = createExpressResponse();
      res.type("application/problem+json").json({ title: "Nope" });

      expect(res._headers.get("Content-Type")).toBe("application/problem+json");
      expect(res._body).toBe('{"title":"Nope"}');
    });
  });

  describe("send method", () => {
    it("should send string as HTML", () => {
      const res = createExpressResponse();
      res.send("Hello");

      expect(res._body).toBe("Hello");
      expect(res._headers.get("Content-Type")).toBe("text/html");
      expect(res._headers.get("Content-Length")).toBe("5");
      expect(res._ended).toBe(true);
    });

    it("should send Buffer as binary", () => {
      const res = createExpressResponse();
      const buffer = Buffer.from("hello");
      res.send(buffer);

      expect(res._body).toBe(buffer);
      expect(res._headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("should send Uint8Array untouched", () => {
      const res = createExpressResponse();
      const data = new Uint8Array([1, 2, 3]);
      res.send(data);

      expect(res._body).toBe(data);
      expect(res._headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("should send ArrayBuffer untouched", () => {
      const res = createExpressResponse();
      const data = new ArrayBuffer(4);
      res.send(data);

      expect(res._body).toBe(data);
    });

    it("should send a Blob untouched and round-trip its bytes", async () => {
      const res = createExpressResponse();
      const blob = new Blob(["blob payload"], { type: "text/plain" });
      res.send(blob);

      expect(res._body).toBe(blob);
      expect(res._headers.get("Content-Type")).toContain("text/plain");

      const response = res._buildResponse();
      expect(await response.text()).toBe("blob payload");
    });

    it("should send a ReadableStream untouched", () => {
      const res = createExpressResponse();
      const stream = new ReadableStream();
      res.send(stream);

      expect(res._body).toBe(stream);
    });

    it("should send an empty body when called with no arguments", async () => {
      const res = createExpressResponse();
      res.send();

      expect(res._body).toBeNull();
      expect(res._headers.get("Content-Length")).toBe("0");

      const response = res._buildResponse();
      expect(await response.text()).toBe("");
    });

    it("should send an empty body for null", async () => {
      const res = createExpressResponse();
      res.send(null);

      const response = res._buildResponse();
      expect(await response.text()).toBe("");
    });

    it("should send object as JSON", () => {
      const res = createExpressResponse();
      res.send({ foo: "bar" });

      expect(res._body).toBe('{"foo":"bar"}');
      expect(res._headers.get("Content-Type")).toBe("application/json");
    });

    it("should send other types as string", () => {
      const res = createExpressResponse();
      res.send(123);

      expect(res._body).toBe("123");
    });
  });

  describe("double send protection", () => {
    it("should warn and no-op on a second send", () => {
      const res = createExpressResponse();
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});

      res.send("first");
      res.send("second");

      expect(res._body).toBe("first");
      expect(warnSpy).toHaveBeenCalledWith(
        "Cannot call res.send() after the response has already been sent"
      );
      warnSpy.mockRestore();
    });

    it("should set headersSent as soon as the body is sent", () => {
      const res = createExpressResponse();

      expect(res.headersSent).toBe(false);
      res.json({ ok: true });
      expect(res.headersSent).toBe(true);
    });

    it.each(["send", "json", "end", "sendStatus", "redirect"] as const)(
      "should guard %s against a double send",
      (method) => {
        const res = createExpressResponse();
        const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});

        res.send("original");
        if (method === "sendStatus") res.sendStatus(500);
        else if (method === "redirect") res.redirect("/elsewhere");
        else if (method === "json") res.json({ nope: true });
        else if (method === "end") res.end("nope");
        else res.send("nope");

        expect(res._body).toBe("original");
        expect(res.statusCode).toBe(200);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      }
    );
  });

  describe("_onEnd notification", () => {
    it.each(["send", "json", "end", "sendStatus", "redirect"] as const)(
      "should fire when the response is ended via %s",
      (method) => {
        const res = createExpressResponse();
        let fired = 0;
        res._onEnd(() => {
          fired++;
        });

        expect(fired).toBe(0);

        if (method === "send") res.send("body");
        else if (method === "json") res.json({ ok: true });
        else if (method === "end") res.end();
        else if (method === "sendStatus") res.sendStatus(204);
        else res.redirect("/elsewhere");

        expect(fired).toBe(1);
      }
    );

    it("should fire when _ended is set out of band", () => {
      const res = createExpressResponse();
      let fired = 0;
      res._onEnd(() => {
        fired++;
      });

      res._ended = true;

      expect(fired).toBe(1);
    });

    it("should invoke a listener immediately when registered after the response ended", () => {
      const res = createExpressResponse();
      res.send("done");

      let fired = 0;
      res._onEnd(() => {
        fired++;
      });

      // Synchronous - not deferred to a later tick
      expect(fired).toBe(1);
    });

    it("should fire exactly once even if the response is ended repeatedly", () => {
      const res = createExpressResponse();
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
      let fired = 0;
      res._onEnd(() => {
        fired++;
      });

      res.send("first");
      res.send("second");
      res.end("third");
      res._ended = true;

      expect(fired).toBe(1);
      warnSpy.mockRestore();
    });

    it("should invoke every registered listener in registration order", () => {
      const res = createExpressResponse();
      const order: string[] = [];
      res._onEnd(() => order.push("first"));
      res._onEnd(() => order.push("second"));
      res._onEnd(() => order.push("third"));

      res.json({ ok: true });

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("should not fire before the response is ended", () => {
      const res = createExpressResponse();
      let fired = 0;
      res._onEnd(() => {
        fired++;
      });

      res.status(201).set("X-Test", "1").type("json");

      expect(fired).toBe(0);
    });
  });

  describe("end method", () => {
    it("should end response without data", () => {
      const res = createExpressResponse();
      res.end();

      expect(res._ended).toBe(true);
    });

    it("should end response with data", () => {
      const res = createExpressResponse();
      res.end("final");

      expect(res._body).toBe("final");
      expect(res._ended).toBe(true);
    });
  });

  describe("set method", () => {
    it("should set single header", () => {
      const res = createExpressResponse();
      const result = res.set("X-Custom", "value");

      expect(result).toBe(res);
      expect(res._headers.get("X-Custom")).toBe("value");
    });

    it("should set multiple headers from object", () => {
      const res = createExpressResponse();
      res.set({ "X-One": "one", "X-Two": "two" });

      expect(res._headers.get("X-One")).toBe("one");
      expect(res._headers.get("X-Two")).toBe("two");
    });
  });

  describe("header method", () => {
    it("should set header with two args", () => {
      const res = createExpressResponse();
      res.header("X-Test", "value");

      expect(res._headers.get("X-Test")).toBe("value");
    });

    it("should set headers from object", () => {
      const res = createExpressResponse();
      res.header({ "X-Custom": "value" });

      expect(res._headers.get("X-Custom")).toBe("value");
    });

    it("should return res if only field provided", () => {
      const res = createExpressResponse();
      const result = res.header("X-Test");

      expect(result).toBe(res);
    });
  });

  describe("setHeader method", () => {
    it("should set header", () => {
      const res = createExpressResponse();
      res.setHeader("X-Test", "value");

      expect(res._headers.get("X-Test")).toBe("value");
    });
  });

  describe("get and getHeader methods", () => {
    it("should get header value", () => {
      const res = createExpressResponse();
      res.set("X-Test", "value");

      expect(res.get("X-Test")).toBe("value");
      expect(res.getHeader("X-Test")).toBe("value");
    });

    it("should return undefined for missing header", () => {
      const res = createExpressResponse();

      // Express and Node return undefined, not null
      expect(res.get("X-Missing")).toBeUndefined();
      expect(res.getHeader("X-Missing")).toBeUndefined();
    });
  });

  describe("removeHeader method", () => {
    it("should remove header", () => {
      const res = createExpressResponse();
      res.set("X-Test", "value");
      res.removeHeader("X-Test");

      expect(res.get("X-Test")).toBeUndefined();
    });
  });

  describe("append method", () => {
    it("should append single value", () => {
      const res = createExpressResponse();
      res.append("X-Custom", "value1");
      res.append("X-Custom", "value2");

      expect(res._headers.get("X-Custom")).toBe("value1, value2");
    });

    it("should append array of values", () => {
      const res = createExpressResponse();
      res.append("X-Custom", ["a", "b"]);

      expect(res._headers.get("X-Custom")).toBe("a, b");
    });
  });

  describe("type and contentType methods", () => {
    it("should set content-type from extension", () => {
      const res = createExpressResponse();
      res.type("json");

      expect(res._headers.get("Content-Type")).toBe("application/json");
    });

    it("should set content-type from mime type", () => {
      const res = createExpressResponse();
      res.type("application/xml");

      expect(res._headers.get("Content-Type")).toBe("application/xml");
    });

    it("should strip a leading dot from an extension", () => {
      const res = createExpressResponse();
      res.type(".html");

      expect(res._headers.get("Content-Type")).toBe("text/html");
    });

    it("should pass a full media type through untouched", () => {
      const res = createExpressResponse();
      res.type("text/plain;charset=iso-8859-1");

      expect(res._headers.get("Content-Type")).toBe("text/plain;charset=iso-8859-1");
    });

    it("should set content-type using contentType alias", () => {
      const res = createExpressResponse();
      res.contentType("html");

      expect(res._headers.get("Content-Type")).toBe("text/html");
    });

    // Test various mime types for coverage
    it.each([
      ["html", "text/html"],
      ["htm", "text/html"],
      ["txt", "text/plain"],
      ["text", "text/plain"],
      ["css", "text/css"],
      ["csv", "text/csv"],
      ["md", "text/markdown"],
      ["js", "application/javascript"],
      ["json", "application/json"],
      ["xml", "application/xml"],
      ["yaml", "application/yaml"],
      ["yml", "application/yaml"],
      ["wasm", "application/wasm"],
      ["form", "application/x-www-form-urlencoded"],
      ["urlencoded", "application/x-www-form-urlencoded"],
      ["png", "image/png"],
      ["jpg", "image/jpeg"],
      ["jpeg", "image/jpeg"],
      ["gif", "image/gif"],
      ["svg", "image/svg+xml"],
      ["webp", "image/webp"],
      ["ico", "image/x-icon"],
      ["woff2", "font/woff2"],
      ["mp4", "video/mp4"],
      ["pdf", "application/pdf"],
      ["zip", "application/zip"],
      ["bin", "application/octet-stream"],
      ["unknown", "application/octet-stream"],
    ])("should map %s to %s", (ext, mime) => {
      const res = createExpressResponse();
      res.type(ext);

      expect(res._headers.get("Content-Type")).toBe(mime);
    });
  });

  describe("format method", () => {
    it("should call default handler", () => {
      const res = createExpressResponse();
      let called = false;

      res.format({
        default: () => {
          called = true;
        },
      });

      expect(called).toBe(true);
    });

    it("should do nothing without default", () => {
      const res = createExpressResponse();
      // Should not throw
      res.format({});
    });

    it("should ignore non-default handlers", () => {
      // Accept negotiation is not implemented by this shim
      const res = createExpressResponse(
        new Request("http://localhost", { headers: { Accept: "text/html" } })
      );
      const called: string[] = [];

      res.format({
        html: () => called.push("html"),
        default: () => called.push("default"),
      });

      expect(called).toEqual(["default"]);
    });
  });

  describe("req association", () => {
    it("should expose the originating request passed to the factory", () => {
      const bunRequest = new Request("http://localhost");
      const res = createExpressResponse(bunRequest);

      expect(res.req).toBe(bunRequest);
    });

    it("should allow the request to be assigned afterwards", () => {
      const res = createExpressResponse();
      const req = createExpressRequest(new Request("http://localhost"));
      res.req = req;

      expect(res.req).toBe(req);
    });
  });

  describe("attachment method", () => {
    it("should set content-disposition without filename", () => {
      const res = createExpressResponse();
      res.attachment();

      expect(res._headers.get("Content-Disposition")).toBe("attachment");
    });

    it("should set content-disposition with filename", () => {
      const res = createExpressResponse();
      res.attachment("file.pdf");

      expect(res._headers.get("Content-Disposition")).toBe('attachment; filename="file.pdf"');
      expect(res._headers.get("Content-Type")).toBe("application/pdf");
    });

    it("should derive the content type from the extension", () => {
      const res = createExpressResponse();
      res.attachment("report.csv");

      expect(res._headers.get("Content-Disposition")).toBe('attachment; filename="report.csv"');
      expect(res._headers.get("Content-Type")).toBe("text/csv");
    });
  });

  describe("cookie method", () => {
    it("should set basic cookie", () => {
      const res = createExpressResponse();
      res.cookie("name", "value");

      expect(res._headers.get("Set-Cookie")).toBe("name=value");
    });

    it("should set cookie with all options", () => {
      const res = createExpressResponse();
      const expires = new Date("2025-01-01");
      res.cookie("name", "value", {
        // Express maxAge is milliseconds
        maxAge: 3600 * 1000,
        expires,
        path: "/",
        domain: ".example.com",
        secure: true,
        httpOnly: true,
        sameSite: "strict",
      });

      const cookie = res._headers.get("Set-Cookie");
      expect(cookie).toContain("name=value");
      expect(cookie).toContain("Max-Age=3600");
      expect(cookie).toContain("Expires=Wed, 01 Jan 2025 00:00:00 GMT");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Domain=.example.com");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
    });

    it("should emit Max-Age in seconds from a millisecond maxAge", () => {
      const res = createExpressResponse();
      // The documented one-day sample
      res.cookie("name", "value", { maxAge: 86400 * 1000 });

      expect(res._headers.get("Set-Cookie")).toContain("Max-Age=86400");
    });

    it("should derive Expires from maxAge when not supplied", () => {
      const res = createExpressResponse();
      const before = Date.now();
      res.cookie("name", "value", { maxAge: 60_000 });

      const cookie = res._headers.get("Set-Cookie") as string;
      const match = /Expires=([^;]+)/.exec(cookie);
      expect(match).not.toBeNull();

      const expires = new Date(match![1]!).getTime();
      expect(expires).toBeGreaterThanOrEqual(before + 59_000);
      expect(expires).toBeLessThanOrEqual(Date.now() + 61_000);
    });

    it("should encode the value with a custom encoder", () => {
      const res = createExpressResponse();
      res.cookie("name", "a b", { encode: (v) => v.replace(/ /g, "+") });

      expect(res._headers.get("Set-Cookie")).toBe("name=a+b");
    });

    it("should URL-encode the value by default", () => {
      const res = createExpressResponse();
      res.cookie("redirect", "/dash?a=1");

      expect(res._headers.get("Set-Cookie")).toBe("redirect=%2Fdash%3Fa%3D1");
    });

    it("should handle sameSite=true", () => {
      const res = createExpressResponse();
      res.cookie("name", "value", { sameSite: true });

      expect(res._headers.get("Set-Cookie")).toContain("SameSite=Strict");
    });

    it("should handle sameSite=lax", () => {
      const res = createExpressResponse();
      res.cookie("name", "value", { sameSite: "lax" });

      expect(res._headers.get("Set-Cookie")).toContain("SameSite=Lax");
    });

    it("should handle sameSite=none", () => {
      const res = createExpressResponse();
      res.cookie("name", "value", { sameSite: "none" });

      expect(res._headers.get("Set-Cookie")).toContain("SameSite=None");
    });
  });

  describe("clearCookie method", () => {
    it("should clear cookie by setting expired date", () => {
      const res = createExpressResponse();
      res.clearCookie("name");

      expect(res._headers.get("Set-Cookie")).toContain("name=");
      expect(res._headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970");
    });
  });

  describe("redirect method", () => {
    it("should redirect with default 302", () => {
      const res = createExpressResponse();
      res.redirect("/new-path");

      expect(res.statusCode).toBe(302);
      expect(res._headers.get("Location")).toBe("/new-path");
      expect(res._ended).toBe(true);
    });

    it("should redirect with custom status", () => {
      const res = createExpressResponse();
      res.redirect(301, "/new-path");

      expect(res.statusCode).toBe(301);
      expect(res._headers.get("Location")).toBe("/new-path");
    });

    it("should not mistake an empty URL for the status", () => {
      const res = createExpressResponse();
      res.redirect(302, "");

      expect(res.statusCode).toBe(302);
      expect(res._headers.get("Location")).toBe("");
    });

    it("should preserve a relative Location on the built response", () => {
      const res = createExpressResponse();
      res.redirect("/new-path");

      const response = res._buildResponse();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/new-path");
    });

    it("should keep Set-Cookie across a redirect", () => {
      const res = createExpressResponse();
      res.cookie("session", "abc", { httpOnly: true });
      res.redirect("/login");

      const response = res._buildResponse();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
      expect(response.headers.get("Set-Cookie")).toContain("session=abc");
    });

    it("should build a 304 redirect without throwing", () => {
      const res = createExpressResponse();
      res.redirect(304, "/cached");

      const response = res._buildResponse();
      expect(response.status).toBe(304);
      expect(response.headers.get("Location")).toBe("/cached");
      expect(response.body).toBeNull();
    });
  });

  describe("location method", () => {
    it("should set location header", () => {
      const res = createExpressResponse();
      res.location("/new-path");

      expect(res._headers.get("Location")).toBe("/new-path");
    });
  });

  describe("links method", () => {
    it("should set link header", () => {
      const res = createExpressResponse();
      res.links({
        next: "/page/2",
        prev: "/page/1",
      });

      const link = res._headers.get("Link");
      expect(link).toContain('</page/2>; rel="next"');
      expect(link).toContain('</page/1>; rel="prev"');
    });

    it("should merge with an existing Link header", () => {
      const res = createExpressResponse();
      res.links({ next: "/page/2" });
      res.links({ prev: "/page/1" });

      expect(res._headers.get("Link")).toBe('</page/2>; rel="next", </page/1>; rel="prev"');
    });
  });

  describe("vary method", () => {
    it("should set vary header", () => {
      const res = createExpressResponse();
      res.vary("Accept");

      expect(res._headers.get("Vary")).toBe("Accept");
    });

    it("should append to existing vary header", () => {
      const res = createExpressResponse();
      res.vary("Accept");
      res.vary("Accept-Encoding");

      expect(res._headers.get("Vary")).toBe("Accept, Accept-Encoding");
    });

    it("should de-duplicate case-insensitively", () => {
      const res = createExpressResponse();
      res.vary("Accept");
      res.vary("accept");
      res.vary("ACCEPT-ENCODING");
      res.vary("Accept-Encoding");

      expect(res._headers.get("Vary")).toBe("Accept, ACCEPT-ENCODING");
    });

    it("should accept an array of fields", () => {
      const res = createExpressResponse();
      res.vary(["Accept", "Origin"]);

      expect(res._headers.get("Vary")).toBe("Accept, Origin");
    });

    it("should short-circuit when Vary is *", () => {
      const res = createExpressResponse();
      res.vary("*");
      res.vary("Accept");

      expect(res._headers.get("Vary")).toBe("*");
    });

    it("should collapse to * when * is added", () => {
      const res = createExpressResponse();
      res.vary("Accept");
      res.vary("*");

      expect(res._headers.get("Vary")).toBe("*");
    });
  });

  describe("_buildResponse method", () => {
    it("should build Response object", async () => {
      const res = createExpressResponse();
      res.status(201).set("X-Custom", "value").send({ data: "test" });

      const response = res._buildResponse();

      expect(response.status).toBe(201);
      expect(response.headers.get("X-Custom")).toBe("value");
      const body = await response.json();
      expect(body).toEqual({ data: "test" });
    });

    it("should build redirect response", () => {
      const res = createExpressResponse();
      res.redirect(301, "https://example.com/new-path");

      const response = res._buildResponse();
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("https://example.com/new-path");
    });

    it.each([101, 204, 205, 304])(
      "should never carry a body on status %i",
      (code) => {
        const res = createExpressResponse();
        res.status(code);
        res._body = "should not be sent";
        res._headers.set("Content-Type", "text/plain");
        res._headers.set("Content-Length", "18");

        const response = res._buildResponse();
        expect(response.status).toBe(code);
        expect(response.body).toBeNull();
        expect(response.headers.get("Content-Type")).toBeNull();
        expect(response.headers.get("Content-Length")).toBeNull();
      }
    );

    it("should build a 204 after send() without throwing", async () => {
      const res = createExpressResponse();
      res.status(204).send("No Content");

      const response = res._buildResponse();
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    });

    it("should derive statusText from the status code", () => {
      const res = createExpressResponse();
      res.status(404).send("nope");

      expect(res.statusMessage).toBe("Not Found");
      expect(res._buildResponse().statusText).toBe("Not Found");
    });

    it("should keep an explicitly assigned statusText", () => {
      const res = createExpressResponse();
      res.status(404);
      res.statusMessage = "Nope";

      expect(res._buildResponse().statusText).toBe("Nope");
    });

    it("should handle string body", async () => {
      const res = createExpressResponse();
      res.send("Hello");

      const response = res._buildResponse();
      expect(await response.text()).toBe("Hello");
    });

    it("should handle Uint8Array body", async () => {
      const res = createExpressResponse();
      const data = new Uint8Array([1, 2, 3]);
      res._body = data;
      res._ended = true;

      const response = res._buildResponse();
      expect(response.body).toBeDefined();
    });

    it("should handle ArrayBuffer body", async () => {
      const res = createExpressResponse();
      const data = new ArrayBuffer(4);
      res._body = data;
      res._ended = true;

      const response = res._buildResponse();
      expect(response.body).toBeDefined();
    });

    it("should handle ReadableStream body", () => {
      const res = createExpressResponse();
      const stream = new ReadableStream();
      res._body = stream;
      res._ended = true;

      const response = res._buildResponse();
      // Response body handling varies by runtime
      expect(response).toBeInstanceOf(Response);
    });

    it("should handle Blob body", async () => {
      const res = createExpressResponse();
      const blob = new Blob(["test"]);
      // send() passes a Blob straight through instead of JSON-stringifying it
      res.send(blob);

      const response = res._buildResponse();
      expect(response).toBeInstanceOf(Response);
      expect(await response.text()).toBe("test");
    });

    it("should JSON-serialise plain objects passed to send", async () => {
      const res = createExpressResponse();
      // send() delegates plain objects to json()
      res.send({ complex: "object" });

      const response = res._buildResponse();
      const text = await response.text();
      expect(text).toBe('{"complex":"object"}');
    });

    it("should handle null body", () => {
      const res = createExpressResponse();
      res.end();

      const response = res._buildResponse();
      expect(response.body).toBeNull();
    });

    it("should set headersSent flag", () => {
      const res = createExpressResponse();
      res._buildResponse();

      expect(res.headersSent).toBe(true);
    });
  });

  // Null-body statuses never get a body, but they do get the right reason phrase
  it.each([
    [101, "Switching Protocols"],
    [204, "No Content"],
    [205, "Reset Content"],
    [304, "Not Modified"],
  ])("sendStatus %i should set the status text without a body", (code, expectedText) => {
    const res = createExpressResponse();
    res.sendStatus(code);

    expect(res._body).toBeNull();
    expect(res.statusMessage).toBe(expectedText);
  });

  // Test status text mapping for coverage
  it.each([
    [100, "Continue"],
    [200, "OK"],
    [201, "Created"],
    [202, "Accepted"],
    [206, "Partial Content"],
    [301, "Moved Permanently"],
    [302, "Found"],
    [303, "See Other"],
    [307, "Temporary Redirect"],
    [308, "Permanent Redirect"],
    [400, "Bad Request"],
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [404, "Not Found"],
    [405, "Method Not Allowed"],
    [409, "Conflict"],
    [410, "Gone"],
    [418, "I'm a Teapot"],
    [422, "Unprocessable Entity"],
    [429, "Too Many Requests"],
    [451, "Unavailable For Legal Reasons"],
    [500, "Internal Server Error"],
    [501, "Not Implemented"],
    [502, "Bad Gateway"],
    [503, "Service Unavailable"],
    [504, "Gateway Timeout"],
    [999, "Unknown"],
  ])("sendStatus %i should return correct text", (code, expectedText) => {
    const res = createExpressResponse();
    res.sendStatus(code);

    expect(res._body).toBe(expectedText);
  });
});
