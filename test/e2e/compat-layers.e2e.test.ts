/**
 * End-to-end tests for compatibility layers
 *
 * These tests verify the Express and Fastify compatibility layers
 * work correctly in integration scenarios.
 */

import { describe, it, expect } from "vitest";
import {
  createExpressRequest,
  createExpressResponse,
} from "../../src/express-compat";
import {
  createFastifyRequest,
  createFastifyReply,
  FastifyHooksManager,
  FastifyPluginRegistry,
  isFastifyMiddleware,
  markAsFastify,
} from "../../src/fastify-compat";

describe("Express Compatibility E2E", () => {
  describe("Full Request-Response Cycle", () => {
    it("should handle complete request flow", async () => {
      // Create Express-compatible objects from a Bun request
      const bunRequest = new Request("http://localhost:3000/api/users/123?include=profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer token123",
          "X-Request-ID": "req-001",
          "Cookie": "session=abc; user=john",
        },
        body: JSON.stringify({ name: "John Doe", age: 30 }),
      });

      const req = createExpressRequest(bunRequest, { id: "123" });
      const res = createExpressResponse();

      // Verify request properties
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/api/users/123");
      expect(req.params.id).toBe("123");
      expect(req.query.include).toBe("profile");
      expect(req.get("Authorization")).toBe("Bearer token123");
      expect(req.get("X-Request-ID")).toBe("req-001");
      expect(req.cookies.session).toBe("abc");
      expect(req.cookies.user).toBe("john");

      // Set response properties
      res.status(201)
        .set("X-Response-ID", "res-001")
        .json({ success: true, userId: "123" });

      // Build final response
      const response = res._buildResponse();

      // Verify response
      expect(response.status).toBe(201);
      expect(response.headers.get("x-response-id")).toBe("res-001");
      expect(response.headers.get("content-type")).toContain("application/json");

      const body = await response.json();
      expect(body).toEqual({ success: true, userId: "123" });
    });

    it("should simulate middleware chain", async () => {
      const bunRequest = new Request("http://localhost:3000/protected", {
        headers: { "Authorization": "Bearer valid-token" },
      });

      const req = createExpressRequest(bunRequest);
      const res = createExpressResponse();

      // Middleware 1: Logging
      const logMiddleware = (req: typeof createExpressRequest extends (...args: unknown[]) => infer R ? R : never, res: typeof createExpressResponse extends (...args: unknown[]) => infer R ? R : never, next: () => void) => {
        res.set("X-Logged", "true");
        next();
      };

      // Middleware 2: Auth
      const authMiddleware = (req: typeof createExpressRequest extends (...args: unknown[]) => infer R ? R : never, res: typeof createExpressResponse extends (...args: unknown[]) => infer R ? R : never, next: () => void) => {
        if (req.get("Authorization") === "Bearer valid-token") {
          (req as Record<string, unknown>).authenticated = true;
          next();
        } else {
          res.status(401).json({ error: "Unauthorized" });
        }
      };

      // Execute middleware chain
      let nextCalled = false;
      logMiddleware(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(res.get("X-Logged")).toBe("true");

      nextCalled = false;
      authMiddleware(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect((req as Record<string, unknown>).authenticated).toBe(true);

      // Route handler
      res.json({ message: "Protected content" });

      const response = res._buildResponse();
      expect(response.status).toBe(200);
    });

    it("should handle various response types", async () => {
      // JSON response
      const jsonRes = createExpressResponse();
      jsonRes.json({ type: "json" });
      const jsonResponse = jsonRes._buildResponse();
      expect(jsonResponse.headers.get("content-type")).toContain("application/json");
      expect(await jsonResponse.json()).toEqual({ type: "json" });

      // Text response
      const textRes = createExpressResponse();
      textRes.type("text").send("plain text");
      const textResponse = textRes._buildResponse();
      expect(textResponse.headers.get("content-type")).toContain("text/plain");
      expect(await textResponse.text()).toBe("plain text");

      // HTML response
      const htmlRes = createExpressResponse();
      htmlRes.type("html").send("<h1>Hello</h1>");
      const htmlResponse = htmlRes._buildResponse();
      expect(htmlResponse.headers.get("content-type")).toContain("text/html");
      expect(await htmlResponse.text()).toBe("<h1>Hello</h1>");

      // Status only (202 as 204 doesn't allow body)
      const statusRes = createExpressResponse();
      statusRes.sendStatus(202);
      const statusResponse = statusRes._buildResponse();
      expect(statusResponse.status).toBe(202);
    });

    it("should handle cookies in request-response cycle", async () => {
      // Read cookies from request
      const bunRequest = new Request("http://localhost:3000/api", {
        headers: { Cookie: "theme=dark; lang=en" },
      });
      const req = createExpressRequest(bunRequest);
      expect(req.cookies.theme).toBe("dark");
      expect(req.cookies.lang).toBe("en");

      // Set cookies in response
      const res = createExpressResponse();
      res.cookie("newCookie", "value", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        // Express `maxAge` is milliseconds; it is serialized as Max-Age seconds
        maxAge: 3600 * 1000,
      });
      res.json({ ok: true });

      const response = res._buildResponse();
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("newCookie=value");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Max-Age=3600");
    });
  });

  describe("Content Negotiation", () => {
    it("should handle accept header negotiation", () => {
      const bunRequest = new Request("http://localhost:3000/api", {
        headers: {
          Accept: "application/json, text/html;q=0.9, */*;q=0.8",
          "Accept-Language": "en-US, en;q=0.9, fr;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
      });

      const req = createExpressRequest(bunRequest);

      expect(req.accepts("application/json")).toBe("application/json");
      expect(req.accepts("text/html")).toBe("text/html");
      expect(req.acceptsLanguages("en-US")).toBe("en-US");
      expect(req.acceptsEncodings("gzip")).toBe("gzip");
    });

    it("should check content type", () => {
      const jsonRequest = new Request("http://localhost:3000/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const jsonReq = createExpressRequest(jsonRequest);
      expect(jsonReq.is("json")).toBe("json");
      expect(jsonReq.is("html")).toBe(false);

      const htmlRequest = new Request("http://localhost:3000/api", {
        method: "POST",
        headers: { "Content-Type": "text/html" },
      });

      const htmlReq = createExpressRequest(htmlRequest);
      expect(htmlReq.is("html")).toBe("html");
      expect(htmlReq.is("json")).toBe(false);
    });
  });

  describe("Error Scenarios", () => {
    it("should handle error response", () => {
      const res = createExpressResponse();
      res.status(500).json({
        error: "Internal Server Error",
        message: "Something went wrong",
        stack: "Error: Something went wrong\n    at handler (/app/index.js:10:10)",
      });

      const response = res._buildResponse();
      expect(response.status).toBe(500);
    });

    it("should handle redirect response", () => {
      const res = createExpressResponse();
      res.redirect(301, "https://example.com/new-location");

      const response = res._buildResponse();
      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe("https://example.com/new-location");
    });
  });
});

describe("Fastify Compatibility E2E", () => {
  describe("Full Request-Response Cycle", () => {
    it("should handle complete request flow", async () => {
      const bunRequest = new Request("http://localhost:3000/api/posts/456?published=true", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "api-key-123",
        },
        body: JSON.stringify({ title: "Updated Post", content: "New content" }),
      });

      const req = createFastifyRequest(bunRequest, { id: "456" });
      const reply = createFastifyReply();

      // Verify request properties
      expect(req.method).toBe("PUT");
      expect(req.url).toBe("/api/posts/456?published=true");
      expect(req.params.id).toBe("456");
      expect(req.query.published).toBe("true");
      expect(req.headers["x-api-key"]).toBe("api-key-123");
      expect(req.id).toMatch(/^req-/);

      // Set response
      reply.code(200)
        .header("X-Response-Time", "50ms")
        .send({ updated: true, postId: "456" });

      // Build final response
      const response = reply._buildResponse();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-response-time")).toBe("50ms");

      const body = await response.json();
      expect(body).toEqual({ updated: true, postId: "456" });
    });

    it("should track response time", async () => {
      const bunRequest = new Request("http://localhost:3000/api");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      // Simulate some processing time
      await new Promise((r) => setTimeout(r, 100));

      // Allow some tolerance for timing variations
      expect(reply.elapsedTime).toBeGreaterThanOrEqual(95);
      expect(reply.getResponseTime()).toBeGreaterThanOrEqual(95);
    });
  });

  describe("Hooks Integration", () => {
    it("should execute full hook lifecycle", async () => {
      const hookOrder: string[] = [];
      const hooksManager = new FastifyHooksManager();

      // Add hooks
      hooksManager.addHook("onRequest", async (req, reply, done) => {
        hookOrder.push("onRequest");
        done();
      });

      hooksManager.addHook("preHandler", async (req, reply, done) => {
        hookOrder.push("preHandler");
        done();
      });

      hooksManager.addHook("onSend", async (req, reply, payload, done) => {
        hookOrder.push("onSend");
        done(undefined, { ...payload as object, modified: true });
      });

      hooksManager.addHook("onResponse", async (req, reply, done) => {
        hookOrder.push("onResponse");
        done();
      });

      // Create request/reply
      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      // Execute hooks
      await hooksManager.executeOnRequest(req, reply);
      await hooksManager.executePreHandler(req, reply);
      const sendResult = await hooksManager.executeOnSend(req, reply, { data: "test" });
      await hooksManager.executeOnResponse(req, reply);

      expect(hookOrder).toEqual(["onRequest", "preHandler", "onSend", "onResponse"]);
      expect(sendResult.payload).toEqual({ data: "test", modified: true });
    });

    it("should handle hook errors", async () => {
      const hooksManager = new FastifyHooksManager();

      hooksManager.addHook("onRequest", async (req, reply, done) => {
        done(new Error("Hook error"));
      });

      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      const error = await hooksManager.executeOnRequest(req, reply);
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe("Hook error");
    });

    it("should handle onError hook", async () => {
      const hooksManager = new FastifyHooksManager();

      hooksManager.addHook("onError", async (req, reply, error, done) => {
        reply.code(500).send({ error: error.message });
        done();
      });

      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      const handled = await hooksManager.executeOnError(req, reply, new Error("Test error"));
      expect(handled).toBe(true);
      expect(reply.statusCode).toBe(500);
    });
  });

  describe("Plugin Registry Integration", () => {
    it("should register and initialize plugins", async () => {
      const registry = new FastifyPluginRegistry();
      const pluginState = { initialized: false, options: null as unknown };

      registry.register(async (instance, opts, done) => {
        pluginState.initialized = true;
        pluginState.options = opts;

        instance.decorate("myPlugin", { version: "1.0" });
        instance.decorateRequest("userId", null);
        instance.decorateReply("sendError", (msg: string) => msg);

        done();
      }, { configOption: "value" });

      // Create mock instance
      const mockInstance = {
        prefix: "",
        decorate: (name: string, value: unknown) => {
          registry.decorate(name, value);
          return mockInstance;
        },
        decorateRequest: (name: string, value: unknown) => {
          registry.decorateRequest(name, value);
          return mockInstance;
        },
        decorateReply: (name: string, value: unknown) => {
          registry.decorateReply(name, value);
          return mockInstance;
        },
        hasDecorator: (name: string) => registry.hasDecorator(name),
        hasRequestDecorator: (name: string) => registry.hasRequestDecorator(name),
        hasReplyDecorator: (name: string) => registry.hasReplyDecorator(name),
        addHook: () => mockInstance,
        register: () => mockInstance,
        get: () => mockInstance,
        post: () => mockInstance,
        put: () => mockInstance,
        delete: () => mockInstance,
        patch: () => mockInstance,
        options: () => mockInstance,
        head: () => mockInstance,
        all: () => mockInstance,
      };

      await registry.initializePlugins(mockInstance as unknown as Parameters<typeof registry.initializePlugins>[0]);

      expect(pluginState.initialized).toBe(true);
      expect(pluginState.options).toEqual({ configOption: "value" });
      expect(registry.hasDecorator("myPlugin")).toBe(true);
      expect(registry.hasRequestDecorator("userId")).toBe(true);
      expect(registry.hasReplyDecorator("sendError")).toBe(true);
    });

    it("should apply decorators to request and reply", () => {
      const registry = new FastifyPluginRegistry();

      registry.decorateRequest("timestamp", () => Date.now());
      registry.decorateReply("cached", false);

      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      registry.applyRequestDecorators(req);
      registry.applyReplyDecorators(reply);

      expect((req as Record<string, unknown>).timestamp).toBeDefined();
      expect((reply as Record<string, unknown>).cached).toBe(false);
    });
  });

  describe("Response Types", () => {
    it("should handle various response types", async () => {
      // JSON response
      const jsonReply = createFastifyReply();
      jsonReply.send({ type: "json" });
      const jsonResponse = jsonReply._buildResponse();
      expect(jsonResponse.headers.get("content-type")).toContain("application/json");
      expect(await jsonResponse.json()).toEqual({ type: "json" });

      // String response
      const stringReply = createFastifyReply();
      stringReply.send("plain text");
      const stringResponse = stringReply._buildResponse();
      expect(stringResponse.headers.get("content-type")).toContain("text/plain");
      expect(await stringResponse.text()).toBe("plain text");

      // Custom serializer
      const customReply = createFastifyReply();
      customReply.serializer((payload) => `CUSTOM:${JSON.stringify(payload)}`);
      customReply.send({ value: 42 });
      const customResponse = customReply._buildResponse();
      expect(await customResponse.text()).toBe('CUSTOM:{"value":42}');
    });

    it("should handle redirect", () => {
      const reply = createFastifyReply();
      reply.redirect(301, "https://example.com/new");

      const response = reply._buildResponse();
      expect(response.status).toBe(301);
    });

    it("should handle not found", () => {
      const reply = createFastifyReply();
      reply.callNotFound();

      const response = reply._buildResponse();
      expect(response.status).toBe(404);
    });
  });

  describe("Header Management", () => {
    it("should manage headers", () => {
      const reply = createFastifyReply();

      // Set headers
      reply.header("X-Custom", "value1");
      reply.headers({ "X-Multi-1": "m1", "X-Multi-2": "m2" });

      expect(reply.getHeader("X-Custom")).toBe("value1");
      expect(reply.getHeader("X-Multi-1")).toBe("m1");
      expect(reply.hasHeader("X-Custom")).toBe(true);
      expect(reply.hasHeader("X-Missing")).toBe(false);

      // Get all headers
      const allHeaders = reply.getHeaders();
      expect(allHeaders["x-custom"]).toBe("value1");

      // Remove header
      reply.removeHeader("X-Custom");
      expect(reply.hasHeader("X-Custom")).toBe(false);
    });
  });
});

describe("Express Additional Coverage", () => {
  describe("Request methods edge cases", () => {
    it("should handle duplicate headers", () => {
      // Note: Browser Headers API joins duplicate headers with ", "
      const bunRequest = new Request("http://localhost:3000/test", {
        headers: [
          ["x-custom", "value1"],
          ["x-custom", "value2"],
        ],
      });
      const req = createExpressRequest(bunRequest);
      // Headers API joins values with ", "
      expect(req.headers["x-custom"]).toBe("value1, value2");
    });

    it("should return false when acceptsCharsets finds no match", () => {
      const bunRequest = new Request("http://localhost:3000/test", {
        headers: { "Accept-Charset": "utf-8" },
      });
      const req = createExpressRequest(bunRequest);
      expect(req.acceptsCharsets("iso-8859-1")).toBe(false);
    });

    it("should return false when acceptsEncodings finds no match", () => {
      const bunRequest = new Request("http://localhost:3000/test", {
        headers: { "Accept-Encoding": "gzip" },
      });
      const req = createExpressRequest(bunRequest);
      expect(req.acceptsEncodings("br")).toBe(false);
    });

    it("should return false when acceptsLanguages finds no match", () => {
      const bunRequest = new Request("http://localhost:3000/test", {
        headers: { "Accept-Language": "en-US" },
      });
      const req = createExpressRequest(bunRequest);
      expect(req.acceptsLanguages("fr")).toBe(false);
    });

    it("should handle range header", () => {
      const bunRequest = new Request("http://localhost:3000/test", {
        headers: { Range: "bytes=0-100" },
      });
      const req = createExpressRequest(bunRequest);
      expect(req.range(1000)).toBeUndefined(); // Simplified implementation
    });

    it("should return undefined for range when no header", () => {
      const bunRequest = new Request("http://localhost:3000/test");
      const req = createExpressRequest(bunRequest);
      expect(req.range(1000)).toBeUndefined();
    });

    it("should handle header method (alias for get)", () => {
      const bunRequest = new Request("http://localhost:3000/test", {
        headers: { "X-Test": "value" },
      });
      const req = createExpressRequest(bunRequest);
      expect(req.header("X-Test")).toBe("value");
    });
  });

  describe("Response methods edge cases", () => {
    it("should get and set statusMessage", () => {
      const res = createExpressResponse();
      expect(res.statusMessage).toBe("OK");
      res.statusMessage = "Custom Message";
      expect(res.statusMessage).toBe("Custom Message");
    });

    it("should handle send with Buffer", () => {
      const res = createExpressResponse();
      const buffer = Buffer.from("binary data");
      res.send(buffer);
      expect(res._body).toBe(buffer);
      expect(res._headers.get("content-type")).toBe("application/octet-stream");
    });

    it("should handle send with non-string primitive", () => {
      const res = createExpressResponse();
      res.send(12345 as unknown as string);
      expect(res._body).toBe("12345");
    });

    it("should handle end with data", () => {
      const res = createExpressResponse();
      res.end("final data");
      expect(res._body).toBe("final data");
      expect(res._ended).toBe(true);
    });

    it("should handle end without data", () => {
      const res = createExpressResponse();
      res.end();
      expect(res._ended).toBe(true);
    });

    it("should handle set with object", () => {
      const res = createExpressResponse();
      res.set({ "X-One": "1", "X-Two": "2" });
      expect(res.get("X-One")).toBe("1");
      expect(res.get("X-Two")).toBe("2");
    });

    it("should handle header with object", () => {
      const res = createExpressResponse();
      res.header({ "X-Header": "value" });
      expect(res.get("X-Header")).toBe("value");
    });

    it("should handle header with field only (no value)", () => {
      const res = createExpressResponse();
      const result = res.header("X-Test");
      expect(result).toBe(res);
    });

    it("should handle setHeader", () => {
      const res = createExpressResponse();
      res.setHeader("X-Set", "value");
      expect(res.get("X-Set")).toBe("value");
    });

    it("should handle getHeader", () => {
      const res = createExpressResponse();
      res.set("X-Get", "got");
      expect(res.getHeader("X-Get")).toBe("got");
    });

    it("should handle removeHeader", () => {
      const res = createExpressResponse();
      res.set("X-Remove", "value");
      res.removeHeader("X-Remove");
      // Express and Node report an unset header as undefined, not null
      expect(res.get("X-Remove")).toBeUndefined();
    });

    it("should handle append", () => {
      const res = createExpressResponse();
      res.append("X-Multi", "value1");
      res.append("X-Multi", ["value2", "value3"]);
      const header = res.get("X-Multi");
      expect(header).toContain("value1");
      expect(header).toContain("value2");
      expect(header).toContain("value3");
    });

    it("should handle contentType (alias for type)", () => {
      const res = createExpressResponse();
      res.contentType("json");
      expect(res.get("Content-Type")).toBe("application/json");
    });

    it("should handle format with default handler", () => {
      const res = createExpressResponse();
      let defaultCalled = false;
      res.format({
        default: () => { defaultCalled = true; },
      });
      expect(defaultCalled).toBe(true);
    });

    it("should handle format without default handler", () => {
      const res = createExpressResponse();
      res.format({}); // Should not throw
    });

    it("should handle attachment without filename", () => {
      const res = createExpressResponse();
      res.attachment();
      expect(res.get("Content-Disposition")).toBe("attachment");
    });

    it("should handle attachment with filename", () => {
      const res = createExpressResponse();
      res.attachment("document.pdf");
      expect(res.get("Content-Disposition")).toBe('attachment; filename="document.pdf"');
      expect(res.get("Content-Type")).toBe("application/pdf");
    });

    it("should handle cookie with path option", () => {
      const res = createExpressResponse();
      res.cookie("name", "value", { path: "/api" });
      expect(res.get("Set-Cookie")).toContain("Path=/api");
    });

    it("should handle cookie with domain option", () => {
      const res = createExpressResponse();
      res.cookie("name", "value", { domain: "example.com" });
      expect(res.get("Set-Cookie")).toContain("Domain=example.com");
    });

    it("should handle redirect with default 302 status", () => {
      const res = createExpressResponse();
      res.redirect("/new-location");
      expect(res._statusCode).toBe(302);
      expect(res.get("Location")).toBe("/new-location");
    });

    it("should handle location", () => {
      const res = createExpressResponse();
      res.location("/here");
      expect(res.get("Location")).toBe("/here");
    });

    it("should handle links", () => {
      const res = createExpressResponse();
      res.links({ next: "/page/2", prev: "/page/0" });
      const linkHeader = res.get("Link");
      expect(linkHeader).toContain('</page/2>; rel="next"');
      expect(linkHeader).toContain('</page/0>; rel="prev"');
    });

    it("should handle vary with existing header", () => {
      const res = createExpressResponse();
      res.vary("Origin");
      res.vary("Accept");
      expect(res.get("Vary")).toBe("Origin, Accept");
    });

    it("should handle vary without existing header", () => {
      const res = createExpressResponse();
      res.vary("Accept-Encoding");
      expect(res.get("Vary")).toBe("Accept-Encoding");
    });

    it("should build response with ReadableStream body", async () => {
      const res = createExpressResponse();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed"));
          controller.close();
        },
      });
      // Use end() to set raw body without transformation
      res.end(stream);
      const response = res._buildResponse();
      expect(response.body).toBeInstanceOf(ReadableStream);
    });

    it("should build response with Blob body", async () => {
      const res = createExpressResponse();
      const blob = new Blob(["blob data"], { type: "text/plain" });
      // Use end() to set raw body without transformation
      res.end(blob);
      const response = res._buildResponse();
      const text = await response.text();
      expect(text).toBe("blob data");
    });

    it("should pass through MIME types that contain /", () => {
      const res = createExpressResponse();
      res.type("application/vnd.api+json");
      expect(res.get("Content-Type")).toBe("application/vnd.api+json");
    });
  });
});

describe("Fastify Additional Coverage", () => {
  describe("Request validation methods", () => {
    it("should throw from getValidationFunction", () => {
      // Returning undefined made callers fail with "validate is not a function"
      // from a stack pointing at their own code, not at the shim.
      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      expect(() => req.getValidationFunction("body")).toThrow(
        "Schema validation is not implemented; use a NestJS ValidationPipe"
      );
    });

    it("should throw from compileValidationSchema", () => {
      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      expect(() => req.compileValidationSchema({}, "body")).toThrow(
        "Schema validation is not implemented; use a NestJS ValidationPipe"
      );
    });

    it("should throw from validateInput", () => {
      // The shim refuses to fake schema validation: silently returning true
      // would let unvalidated input through.
      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      expect(() => req.validateInput({}, {}, "body")).toThrow(
        "Schema validation is not implemented; use a NestJS ValidationPipe"
      );
    });
  });

  describe("Reply methods edge cases", () => {
    it("should allow setting statusCode directly", () => {
      const reply = createFastifyReply();
      reply.statusCode = 404;
      expect(reply.statusCode).toBe(404);
      expect(reply._statusCode).toBe(404);
    });

    it("should handle status method (alias for code)", () => {
      const reply = createFastifyReply();
      reply.status(201);
      expect(reply.statusCode).toBe(201);
    });

    it("should handle type method", () => {
      const reply = createFastifyReply();
      reply.type("text/xml");
      expect(reply.getHeader("Content-Type")).toBe("text/xml");
    });

    it("should throw when send is called twice", () => {
      const reply = createFastifyReply();

      reply.send("first");

      // Fastify itself throws FST_ERR_REP_ALREADY_SENT rather than warning
      let thrown: unknown;
      try {
        reply.send("second");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { code?: string }).code).toBe("FST_ERR_REP_ALREADY_SENT");
    });

    it("should handle redirect with default 302 status", () => {
      const reply = createFastifyReply();
      reply.redirect("/new");
      expect(reply.statusCode).toBe(302);
      expect(reply.getHeader("Location")).toBe("/new");
    });

    it("should build response with Uint8Array body", async () => {
      const reply = createFastifyReply();
      const data = new Uint8Array([1, 2, 3, 4]);
      reply.send(data);
      const response = reply._buildResponse();
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
    });

    it("should build response with ArrayBuffer body", async () => {
      const reply = createFastifyReply();
      const buffer = new ArrayBuffer(8);
      reply.send(buffer);
      const response = reply._buildResponse();
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
    });

    it("should build response with ReadableStream body", async () => {
      const reply = createFastifyReply();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("stream"));
          controller.close();
        },
      });
      reply.send(stream);
      const response = reply._buildResponse();
      expect(response.body).toBeInstanceOf(ReadableStream);
    });

    it("should build response with Blob body", async () => {
      const reply = createFastifyReply();
      const blob = new Blob(["blob"]);
      reply.send(blob);
      const response = reply._buildResponse();
      const text = await response.text();
      expect(text).toBe("blob");
    });
  });

  describe("Hooks manager edge cases", () => {
    it("should handle onSend hook error", async () => {
      const hooksManager = new FastifyHooksManager();

      hooksManager.addHook("onSend", async (req, reply, payload, done) => {
        done(new Error("onSend error"));
      });

      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      const result = await hooksManager.executeOnSend(req, reply, { data: "test" });
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("onSend error");
    });

    it("should return false when no onError hooks handle the error", async () => {
      const hooksManager = new FastifyHooksManager();

      // Add a hook that doesn't handle the error
      hooksManager.addHook("onError", async (req, reply, error, done) => {
        done(new Error("Not handled"));
      });

      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      const handled = await hooksManager.executeOnError(req, reply, new Error("Test"));
      expect(handled).toBe(false);
    });

    it("should return true when onError hook handles error via done()", async () => {
      const hooksManager = new FastifyHooksManager();

      hooksManager.addHook("onError", async (req, reply, error, done) => {
        reply.code(500).send({ error: error.message });
        done(); // No error passed means handled
      });

      const bunRequest = new Request("http://localhost:3000/test");
      const req = createFastifyRequest(bunRequest);
      const reply = createFastifyReply();

      const handled = await hooksManager.executeOnError(req, reply, new Error("Test"));
      expect(handled).toBe(true);
    });
  });

  describe("Plugin registry edge cases", () => {
    it("should get decorator", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorate("testDecorator", { value: 42 });

      const decorator = registry.getDecorator<{ value: number }>("testDecorator");
      expect(decorator?.value).toBe(42);
    });

    it("should return undefined for missing decorator", () => {
      const registry = new FastifyPluginRegistry();
      expect(registry.getDecorator("missing")).toBeUndefined();
    });
  });
});

describe("Express Branch Coverage", () => {
  it("should handle accepts when no accept header", () => {
    const bunRequest = new Request("http://localhost:3000/test");
    const req = createExpressRequest(bunRequest);
    // Without Accept header, defaults to */* which matches anything
    expect(req.accepts("json")).toBe("json");
  });

  it("should handle statusCode getter and setter", () => {
    const res = createExpressResponse();
    expect(res.statusCode).toBe(200);
    res.statusCode = 201;
    expect(res.statusCode).toBe(201);
  });

  it("should handle send with Buffer when content-type already set", () => {
    const res = createExpressResponse();
    res.set("Content-Type", "application/custom");
    res.send(Buffer.from("data"));
    expect(res.get("Content-Type")).toBe("application/custom");
  });

  it("should handle send with object (JSON stringify)", () => {
    const res = createExpressResponse();
    res.send({ key: "value" });
    expect(res.get("Content-Type")).toBe("application/json");
    expect(res._body).toBe('{"key":"value"}');
  });

  it("should handle header with string field and value", () => {
    const res = createExpressResponse();
    res.header("X-Custom", "value");
    expect(res.get("X-Custom")).toBe("value");
  });

  it("should handle cookie with expires option", () => {
    const res = createExpressResponse();
    const expires = new Date("2026-01-01");
    res.cookie("test", "value", { expires });
    expect(res.get("Set-Cookie")).toContain("Expires=");
  });

  it("should handle clearCookie", () => {
    const res = createExpressResponse();
    res.clearCookie("session");
    const cookie = res.get("Set-Cookie");
    expect(cookie).toContain("session=");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("should handle _buildResponse with non-serializable body", () => {
    const res = createExpressResponse();
    // End with an object that isn't string/Uint8Array/ArrayBuffer/ReadableStream/Blob
    res.end({ complex: "object" });
    const response = res._buildResponse();
    // Should JSON stringify the object
    expect(response).toBeDefined();
  });

  it("should handle send when content-type already set for string", () => {
    const res = createExpressResponse();
    res.set("Content-Type", "text/custom");
    res.send("text data");
    expect(res.get("Content-Type")).toBe("text/custom");
  });
});

describe("Fastify Branch Coverage", () => {
  it("should handle https protocol", () => {
    const bunRequest = new Request("https://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    expect(req.protocol).toBe("https");
  });

  it("should handle send without body argument", () => {
    const reply = createFastifyReply();
    reply.send();
    expect(reply.sent).toBe(true);
    expect(reply._body).toBeNull();
  });

  it("should handle _buildResponse with string body and no content-type", () => {
    const reply = createFastifyReply();
    reply.send("plain text");
    const response = reply._buildResponse();
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("should handle _buildResponse with Uint8Array and no content-type", () => {
    const reply = createFastifyReply();
    reply.send(new Uint8Array([1, 2, 3]));
    const response = reply._buildResponse();
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("should handle _buildResponse with object and no content-type", () => {
    const reply = createFastifyReply();
    reply.send({ test: true });
    const response = reply._buildResponse();
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("should handle preHandler hook early return when reply.sent", async () => {
    const hooksManager = new FastifyHooksManager();

    hooksManager.addHook("preHandler", async (req, reply, done) => {
      reply.send({ early: true });
      done();
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    await hooksManager.executePreHandler(req, reply);
    expect(reply.sent).toBe(true);
  });

  it("should handle onRequest hook early return when reply.sent", async () => {
    const hooksManager = new FastifyHooksManager();

    hooksManager.addHook("onRequest", async (req, reply, done) => {
      reply.send({ early: true });
      done();
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    await hooksManager.executeOnRequest(req, reply);
    expect(reply.sent).toBe(true);
  });

  it("should handle hook returning promise that resolves", async () => {
    const hooksManager = new FastifyHooksManager();
    let called = false;

    hooksManager.addHook("onRequest", async (req, reply) => {
      called = true;
      // Return promise without calling done
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    await hooksManager.executeOnRequest(req, reply);
    expect(called).toBe(true);
  });

  it("should handle hook returning promise that rejects", async () => {
    const hooksManager = new FastifyHooksManager();

    hooksManager.addHook("onRequest", async () => {
      throw new Error("Hook error");
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    const error = await hooksManager.executeOnRequest(req, reply);
    expect(error).toBeInstanceOf(Error);
  });

  it("should handle onSend hook promise resolve", async () => {
    const hooksManager = new FastifyHooksManager();

    hooksManager.addHook("onSend", async (req, reply, payload, done) => {
      // Don't call done, return promise
      await Promise.resolve();
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    const result = await hooksManager.executeOnSend(req, reply, { test: true });
    expect(result.payload).toEqual({ test: true });
  });

  it("should handle onSend hook promise reject", async () => {
    const hooksManager = new FastifyHooksManager();

    hooksManager.addHook("onSend", async () => {
      throw new Error("onSend reject");
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    const result = await hooksManager.executeOnSend(req, reply, { test: true });
    expect(result.error).toBeInstanceOf(Error);
  });

  it("should handle onError hook promise path", async () => {
    const hooksManager = new FastifyHooksManager();

    hooksManager.addHook("onError", async (req, reply, error) => {
      reply.code(500).send({ error: error.message });
      // Return promise without calling done
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    const handled = await hooksManager.executeOnError(req, reply, new Error("Test"));
    expect(handled).toBe(true);
  });

  it("should handle onError hook promise reject", async () => {
    const hooksManager = new FastifyHooksManager();

    hooksManager.addHook("onError", async () => {
      throw new Error("onError reject");
    });

    const bunRequest = new Request("http://localhost:3000/test");
    const req = createFastifyRequest(bunRequest);
    const reply = createFastifyReply();

    const handled = await hooksManager.executeOnError(req, reply, new Error("Test"));
    expect(handled).toBe(false);
  });

  it("should handle plugin promise resolve", async () => {
    const registry = new FastifyPluginRegistry();
    let initialized = false;

    registry.register(async (instance, opts) => {
      initialized = true;
      // Return promise without calling done
    });

    const mockInstance = {
      prefix: "",
      decorate: () => mockInstance,
      decorateRequest: () => mockInstance,
      decorateReply: () => mockInstance,
      hasDecorator: () => false,
      hasRequestDecorator: () => false,
      hasReplyDecorator: () => false,
      addHook: () => mockInstance,
      register: () => mockInstance,
      get: () => mockInstance,
      post: () => mockInstance,
      put: () => mockInstance,
      delete: () => mockInstance,
      patch: () => mockInstance,
      options: () => mockInstance,
      head: () => mockInstance,
      all: () => mockInstance,
    };

    await registry.initializePlugins(mockInstance as unknown as Parameters<typeof registry.initializePlugins>[0]);
    expect(initialized).toBe(true);
  });

  it("should handle plugin promise reject", async () => {
    const registry = new FastifyPluginRegistry();

    registry.register(async () => {
      throw new Error("Plugin init failed");
    });

    const mockInstance = {
      prefix: "",
      decorate: () => mockInstance,
      decorateRequest: () => mockInstance,
      decorateReply: () => mockInstance,
      hasDecorator: () => false,
      hasRequestDecorator: () => false,
      hasReplyDecorator: () => false,
      addHook: () => mockInstance,
      register: () => mockInstance,
      get: () => mockInstance,
      post: () => mockInstance,
      put: () => mockInstance,
      delete: () => mockInstance,
      patch: () => mockInstance,
      options: () => mockInstance,
      head: () => mockInstance,
      all: () => mockInstance,
    };

    await expect(
      registry.initializePlugins(mockInstance as unknown as Parameters<typeof registry.initializePlugins>[0])
    ).rejects.toThrow("Plugin init failed");
  });
});

describe("Fastify Middleware Markers", () => {
  it("should identify unmarked functions as not Fastify", () => {
    const fn = () => {};
    expect(isFastifyMiddleware(fn)).toBe(false);
  });

  it("should mark and identify Fastify middleware", () => {
    const fn = () => {};
    const marked = markAsFastify(fn);
    expect(isFastifyMiddleware(marked)).toBe(true);
  });

  it("should return the same function when marking", () => {
    const fn = () => "test";
    const marked = markAsFastify(fn);
    expect(marked).toBe(fn);
    expect(marked()).toBe("test");
  });
});

describe("Cross-Compatibility Integration", () => {
  it("should convert between Express and Fastify formats", async () => {
    const bunRequest = new Request("http://localhost:3000/api/data?format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "123",
      },
      body: JSON.stringify({ key: "value" }),
    });

    // Create Express request
    const expressReq = createExpressRequest(bunRequest, { id: "abc" });

    // Create Fastify request from same source
    const fastifyReq = createFastifyRequest(bunRequest, { id: "abc" });

    // Both should have same core properties
    expect(expressReq.method).toBe(fastifyReq.method);
    expect(expressReq.path).toBe(fastifyReq.routerPath);
    expect(expressReq.params.id).toBe(fastifyReq.params.id);
    expect(expressReq.query.format).toBe(fastifyReq.query.format);
    expect(expressReq.get("X-Request-ID")).toBe(fastifyReq.headers["x-request-id"]);
  });

  it("should produce equivalent responses", async () => {
    // Express response
    const expressRes = createExpressResponse();
    expressRes.status(201).set("X-Source", "express").json({ created: true });
    const expressResponse = expressRes._buildResponse();

    // Fastify reply
    const fastifyReply = createFastifyReply();
    fastifyReply.code(201).header("X-Source", "fastify").send({ created: true });
    const fastifyResponse = fastifyReply._buildResponse();

    // Both should produce similar responses
    expect(expressResponse.status).toBe(fastifyResponse.status);
    expect(expressResponse.headers.get("content-type")).toContain("application/json");
    expect(fastifyResponse.headers.get("content-type")).toContain("application/json");

    const expressBody = await expressResponse.json();
    const fastifyBody = await fastifyResponse.json();
    expect(expressBody).toEqual(fastifyBody);
  });
});
