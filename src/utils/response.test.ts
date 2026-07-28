import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResponseBuilder, response, json, text, html, error } from "./response";

describe("ResponseBuilder", () => {
  describe("status", () => {
    it("should set status code and return this for chaining", () => {
      const builder = new ResponseBuilder();
      const result = builder.status(201);
      expect(result).toBe(builder);
      const response = builder.build();
      expect(response.status).toBe(201);
    });
  });

  describe("header", () => {
    it("should set a single header", () => {
      const builder = new ResponseBuilder();
      builder.header("X-Custom", "value");
      const response = builder.build();
      expect(response.headers.get("X-Custom")).toBe("value");
    });
  });

  describe("headers", () => {
    it("should set multiple headers", () => {
      const builder = new ResponseBuilder();
      builder.headers({
        "X-One": "one",
        "X-Two": "two",
      });
      const response = builder.build();
      expect(response.headers.get("X-One")).toBe("one");
      expect(response.headers.get("X-Two")).toBe("two");
    });
  });

  describe("json", () => {
    it("should set JSON body and content-type", async () => {
      const builder = new ResponseBuilder();
      const response = builder.json({ foo: "bar" });
      expect(response.headers.get("Content-Type")).toBe("application/json");
      const body = await response.json();
      expect(body).toEqual({ foo: "bar" });
    });

    it("should preserve existing content-type", () => {
      const builder = new ResponseBuilder();
      builder.header("Content-Type", "application/problem+json");
      const response = builder.json({ title: "nope" });
      expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    });
  });

  describe("text", () => {
    it("should set text body with default content-type", async () => {
      const builder = new ResponseBuilder();
      const response = builder.text("Hello");
      expect(response.headers.get("Content-Type")).toBe("text/plain");
      const body = await response.text();
      expect(body).toBe("Hello");
    });

    it("should preserve existing content-type", async () => {
      const builder = new ResponseBuilder();
      builder.header("Content-Type", "text/csv");
      const response = builder.text("a,b,c");
      expect(response.headers.get("Content-Type")).toBe("text/csv");
    });
  });

  describe("html", () => {
    it("should set HTML body and content-type", async () => {
      const builder = new ResponseBuilder();
      const response = builder.html("<h1>Hello</h1>");
      expect(response.headers.get("Content-Type")).toBe("text/html");
      const body = await response.text();
      expect(body).toBe("<h1>Hello</h1>");
    });

    it("should preserve existing content-type", () => {
      const builder = new ResponseBuilder();
      builder.header("Content-Type", "application/xhtml+xml");
      const response = builder.html("<h1>Hello</h1>");
      expect(response.headers.get("Content-Type")).toBe("application/xhtml+xml");
    });
  });

  describe("binary", () => {
    it("should set binary body from ArrayBuffer", async () => {
      const builder = new ResponseBuilder();
      const data = new ArrayBuffer(4);
      const response = builder.binary(data);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("should set binary body from Uint8Array", async () => {
      const builder = new ResponseBuilder();
      const data = new Uint8Array([1, 2, 3, 4]);
      const response = builder.binary(data);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("should preserve existing content-type for binary", () => {
      const builder = new ResponseBuilder();
      builder.header("Content-Type", "image/png");
      const response = builder.binary(new Uint8Array([1, 2, 3]));
      expect(response.headers.get("Content-Type")).toBe("image/png");
    });
  });

  describe("stream", () => {
    it("should set stream body", () => {
      const builder = new ResponseBuilder();
      const stream = new ReadableStream();
      const response = builder.stream(stream);
      expect(response.body).toBe(stream);
    });
  });

  describe("file", () => {
    const existingFile = join(tmpdir(), `nestjs-bun-response-${process.pid}-${Date.now()}.txt`);
    const missingFile = join(tmpdir(), `nestjs-bun-response-${process.pid}-missing.txt`);

    beforeAll(async () => {
      await Bun.write(existingFile, "file contents");
    });

    afterAll(async () => {
      await rm(existingFile, { force: true });
    });

    it("should serve an existing file with its mime type", async () => {
      const builder = new ResponseBuilder();
      const response = await builder.file(existingFile);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/plain");
      expect(await response.text()).toBe("file contents");
    });

    it("should keep accumulated status and headers for an existing file", async () => {
      const builder = new ResponseBuilder();
      const response = await builder
        .status(206)
        .header("Cache-Control", "no-store")
        .file(existingFile);

      expect(response.status).toBe(206);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("should not overwrite an explicit content-type", async () => {
      const builder = new ResponseBuilder();
      const response = await builder.header("Content-Type", "text/markdown").file(existingFile);
      expect(response.headers.get("Content-Type")).toBe("text/markdown");
    });

    it("should return 404 when the file does not exist", async () => {
      const builder = new ResponseBuilder();
      const response = await builder.file(missingFile);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    });

    it("should keep accumulated headers on the 404 branch", async () => {
      const builder = new ResponseBuilder();
      const response = await builder.status(200).header("X-Trace", "abc").file(missingFile);

      expect(response.status).toBe(404);
      expect(response.headers.get("X-Trace")).toBe("abc");
    });
  });

  describe("redirect", () => {
    it("should create redirect response with default 302", () => {
      const builder = new ResponseBuilder();
      const response = builder.redirect("https://example.com");
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://example.com");
    });

    it("should create redirect response with custom status", () => {
      const builder = new ResponseBuilder();
      const response = builder.redirect("https://example.com", 301);
      expect(response.status).toBe(301);
    });

    it("should preserve headers accumulated on the builder", () => {
      const builder = new ResponseBuilder();
      const response = builder.header("Set-Cookie", "s=1").redirect("/login");

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
      expect(response.headers.get("Set-Cookie")).toBe("s=1");
    });

    it("should support relative URLs", () => {
      const builder = new ResponseBuilder();
      const response = builder.redirect("../back");
      expect(response.headers.get("Location")).toBe("../back");
    });

    it("should honour a redirect status set earlier on the builder", () => {
      const builder = new ResponseBuilder();
      const response = builder.status(308).redirect("/moved");
      expect(response.status).toBe(308);
    });

    it("should ignore a non-redirect status set earlier on the builder", () => {
      const builder = new ResponseBuilder();
      const response = builder.status(201).redirect("/moved");
      expect(response.status).toBe(302);
    });

    it("should have an empty body", async () => {
      const builder = new ResponseBuilder();
      const response = builder.header("X-Test", "1").redirect("/login");
      expect(await response.text()).toBe("");
    });

    it("should reject a status outside the redirect range", () => {
      const builder = new ResponseBuilder();
      expect(() => builder.redirect("/login", 200)).toThrow(RangeError);
    });
  });

  describe("build", () => {
    it("should create Response with all options", () => {
      const builder = new ResponseBuilder();
      const response = builder.status(201).header("X-Test", "value").text("body");
      expect(response.status).toBe(201);
      expect(response.headers.get("X-Test")).toBe("value");
    });

    it("should drop the body for null-body statuses instead of throwing", async () => {
      const builder = new ResponseBuilder();
      const response = builder.status(204).header("X-Test", "value").text("ignored");
      expect(response.status).toBe(204);
      expect(response.headers.get("X-Test")).toBe("value");
      expect(await response.text()).toBe("");
    });
  });
});

describe("response helper", () => {
  it("should return a new ResponseBuilder", () => {
    const builder = response();
    expect(builder).toBeInstanceOf(ResponseBuilder);
  });
});

describe("json helper", () => {
  it("should create JSON response with default status", async () => {
    const res = json({ foo: "bar" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ foo: "bar" });
  });

  it("should create JSON response with custom status", async () => {
    const res = json({ error: "not found" }, 404);
    expect(res.status).toBe(404);
  });
});

describe("text helper", () => {
  it("should create text response with default status", async () => {
    const res = text("Hello");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    const body = await res.text();
    expect(body).toBe("Hello");
  });

  it("should create text response with custom status", async () => {
    const res = text("Not Found", 404);
    expect(res.status).toBe(404);
  });
});

describe("html helper", () => {
  it("should create HTML response with default status", async () => {
    const res = html("<h1>Hello</h1>");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html");
    const body = await res.text();
    expect(body).toBe("<h1>Hello</h1>");
  });

  it("should create HTML response with custom status", async () => {
    const res = html("<h1>Error</h1>", 500);
    expect(res.status).toBe(500);
  });
});

describe("error helper", () => {
  it("should create error response with default 500 status", async () => {
    const res = error("Something went wrong");
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      statusCode: 500,
      message: "Something went wrong",
      error: "Internal Server Error",
    });
  });

  it("should create error response with custom status", async () => {
    const res = error("Not Found", 404);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      statusCode: 404,
      message: "Not Found",
      error: "Not Found",
    });
  });

  it("should handle unknown status codes", async () => {
    const res = error("Custom error", 418);
    expect(res.status).toBe(418);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Unknown");
  });

  // Test known status codes that allow body for coverage
  it.each([
    [200, "OK"],
    [201, "Created"],
    [301, "Moved Permanently"],
    [302, "Found"],
    [400, "Bad Request"],
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [404, "Not Found"],
    [405, "Method Not Allowed"],
    [409, "Conflict"],
    [422, "Unprocessable Entity"],
    [429, "Too Many Requests"],
    [500, "Internal Server Error"],
    [502, "Bad Gateway"],
    [503, "Service Unavailable"],
  ])("should return correct status text for %i", async (code, expectedText) => {
    const res = error("test", code);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe(expectedText);
  });

  // Statuses 204/205/304 must not carry a body — error() emits an empty response.
  it("should return an empty body for 204", async () => {
    const res = error("gone", 204);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe("");
  });

  it("should return an empty body for 304", async () => {
    const res = error("not modified", 304);
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe("");
  });

  it("should return an empty body for 205", async () => {
    const res = error("reset", 205);
    expect(res.status).toBe(205);
    expect(await res.text()).toBe("");
  });
});
