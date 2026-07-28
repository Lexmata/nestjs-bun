import { Logger } from "@nestjs/common";
import { describe, it, expect, vi } from "vitest";
import {
  createFastifyRequest,
  createFastifyReply,
  DEFAULT_HOOK_TIMEOUT_MS,
  FastifyHooksManager,
  FastifyPluginRegistry,
  isFastifyMiddleware,
  markAsFastify,
  SUPPORTED_FASTIFY_HOOKS,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "./fastify-compat";

describe("createFastifyRequest", () => {
  it("should create request with basic properties", () => {
    const bunRequest = new Request("http://localhost:3000/path?foo=bar");
    const req = createFastifyRequest(bunRequest, { id: "123" });

    expect(req.raw).toBe(bunRequest);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("/path?foo=bar");
    expect(req.routerPath).toBe("/path");
    expect(req.routerMethod).toBe("GET");
    expect(req.hostname).toBe("localhost");
    expect(req.protocol).toBe("http");
    expect(req.params).toEqual({ id: "123" });
    expect(req.query).toEqual({ foo: "bar" });
    expect(req.is404).toBe(false);
  });

  it("should generate request ID if not provided", () => {
    const bunRequest = new Request("http://localhost");
    const req = createFastifyRequest(bunRequest);

    expect(req.id).toMatch(/^req-/);
  });

  it("should use provided request ID", () => {
    const bunRequest = new Request("http://localhost");
    const req = createFastifyRequest(bunRequest, {}, "custom-id");

    expect(req.id).toBe("custom-id");
  });

  it("should parse headers into object", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "Content-Type": "application/json", "X-Custom": "value" },
    });
    const req = createFastifyRequest(bunRequest);

    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["x-custom"]).toBe("value");
  });

  it("should ignore x-forwarded-for when trustProxy is not enabled", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "192.168.1.1, 10.0.0.1" },
    });
    const req = createFastifyRequest(bunRequest);

    expect(req.ip).toBe("127.0.0.1");
    expect(req.ips).toEqual([]);
  });

  it("should use the peer address when trustProxy is not enabled", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "192.168.1.1" },
    });
    const req = createFastifyRequest(bunRequest, {}, undefined, {
      remoteAddress: "203.0.113.7",
    });

    expect(req.ip).toBe("203.0.113.7");
    expect(req.ips).toEqual([]);
  });

  it("should get IP from x-forwarded-for when trustProxy is enabled", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "192.168.1.1, 10.0.0.1" },
    });
    const req = createFastifyRequest(bunRequest, {}, undefined, { trustProxy: true });

    expect(req.ip).toBe("192.168.1.1");
    expect(req.ips).toEqual(["192.168.1.1", "10.0.0.1"]);
  });

  it("should get IP from x-real-ip when trustProxy is enabled", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Real-IP": "10.0.0.1" },
    });
    const req = createFastifyRequest(bunRequest, {}, undefined, { trustProxy: true });

    expect(req.ip).toBe("10.0.0.1");
    expect(req.ips).toEqual(["10.0.0.1"]);
  });

  it("should handle HTTPS protocol", () => {
    const bunRequest = new Request("https://example.com");
    const req = createFastifyRequest(bunRequest);

    expect(req.protocol).toBe("https");
  });

  it("should ignore forwarded proto/host without trustProxy", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "public.example.com" },
    });
    const req = createFastifyRequest(bunRequest);

    expect(req.protocol).toBe("http");
    expect(req.hostname).toBe("localhost");
  });

  it("should honour forwarded proto/host with trustProxy", () => {
    const bunRequest = new Request("http://localhost", {
      headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "public.example.com" },
    });
    const req = createFastifyRequest(bunRequest, {}, undefined, { trustProxy: true });

    expect(req.protocol).toBe("https");
    expect(req.hostname).toBe("public.example.com");
  });

  it("should use routePattern for routerPath when supplied", () => {
    const bunRequest = new Request("http://localhost/users/123");
    const req = createFastifyRequest(bunRequest, { id: "123" }, undefined, {
      routePattern: "/users/:id",
    });

    expect(req.routerPath).toBe("/users/:id");
    expect(req.url).toBe("/users/123");
  });

  it("should fall back to the pathname when no routePattern is supplied", () => {
    const bunRequest = new Request("http://localhost/users/123");
    const req = createFastifyRequest(bunRequest, { id: "123" });

    expect(req.routerPath).toBe("/users/123");
  });

  it("should collapse duplicate query keys last-wins", () => {
    const bunRequest = new Request("http://localhost/?a=1&a=2");
    const req = createFastifyRequest(bunRequest);

    expect(req.query).toEqual({ a: "2" });
  });

  describe("validation methods", () => {
    // All three are unimplemented and must fail identically and loudly:
    // returning `undefined` from the compiler pair only defers the failure to a
    // `TypeError: validate is not a function` inside the caller's own code.
    const message = "Schema validation is not implemented; use a NestJS ValidationPipe";

    it("getValidationFunction should throw because validation is not implemented", () => {
      const bunRequest = new Request("http://localhost");
      const req = createFastifyRequest(bunRequest);

      expect(() => req.getValidationFunction("body")).toThrow(message);
    });

    it("compileValidationSchema should throw because validation is not implemented", () => {
      const bunRequest = new Request("http://localhost");
      const req = createFastifyRequest(bunRequest);

      expect(() => req.compileValidationSchema({}, "body")).toThrow(message);
    });

    it("validateInput should throw because validation is not implemented", () => {
      const bunRequest = new Request("http://localhost");
      const req = createFastifyRequest(bunRequest);

      expect(() => req.validateInput({}, {}, "body")).toThrow(message);
    });
  });
});

describe("createFastifyReply", () => {
  it("should create reply with default values", () => {
    const reply = createFastifyReply();

    expect(reply.statusCode).toBe(200);
    expect(reply.sent).toBe(false);
    expect(reply._sent).toBe(false);
    expect(reply.elapsedTime).toBeGreaterThanOrEqual(0);
  });

  describe("code method", () => {
    it("should set status code", () => {
      const reply = createFastifyReply();
      const result = reply.code(201);

      expect(result).toBe(reply);
      expect(reply.statusCode).toBe(201);
      expect(reply._statusCode).toBe(201);
    });
  });

  describe("status method", () => {
    it("should be alias for code", () => {
      const reply = createFastifyReply();
      reply.status(404);

      expect(reply.statusCode).toBe(404);
    });
  });

  describe("statusCode setter", () => {
    it("should set status code", () => {
      const reply = createFastifyReply();
      reply.statusCode = 500;

      expect(reply.statusCode).toBe(500);
      expect(reply._statusCode).toBe(500);
    });
  });

  describe("header method", () => {
    it("should set a single header", () => {
      const reply = createFastifyReply();
      const result = reply.header("X-Custom", "value");

      expect(result).toBe(reply);
      expect(reply._headers.get("X-Custom")).toBe("value");
    });
  });

  describe("headers method", () => {
    it("should set multiple headers", () => {
      const reply = createFastifyReply();
      reply.headers({ "X-One": "one", "X-Two": "two" });

      expect(reply._headers.get("X-One")).toBe("one");
      expect(reply._headers.get("X-Two")).toBe("two");
    });
  });

  describe("getHeader method", () => {
    it("should get header value", () => {
      const reply = createFastifyReply();
      reply.header("X-Test", "value");

      expect(reply.getHeader("X-Test")).toBe("value");
    });

    it("should return null for missing header", () => {
      const reply = createFastifyReply();

      expect(reply.getHeader("X-Missing")).toBeNull();
    });
  });

  describe("getHeaders method", () => {
    it("should get all headers", () => {
      const reply = createFastifyReply();
      reply.headers({ "X-One": "one", "X-Two": "two" });

      const headers = reply.getHeaders();
      expect(headers["x-one"]).toBe("one");
      expect(headers["x-two"]).toBe("two");
    });
  });

  describe("removeHeader method", () => {
    it("should remove header", () => {
      const reply = createFastifyReply();
      reply.header("X-Test", "value");
      reply.removeHeader("X-Test");

      expect(reply.getHeader("X-Test")).toBeNull();
    });
  });

  describe("hasHeader method", () => {
    it("should return true if header exists", () => {
      const reply = createFastifyReply();
      reply.header("X-Test", "value");

      expect(reply.hasHeader("X-Test")).toBe(true);
    });

    it("should return false if header does not exist", () => {
      const reply = createFastifyReply();

      expect(reply.hasHeader("X-Missing")).toBe(false);
    });
  });

  describe("type method", () => {
    it("should set content-type", () => {
      const reply = createFastifyReply();
      reply.type("application/json");

      expect(reply._headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("serializer method", () => {
    it("should set custom serializer", () => {
      const reply = createFastifyReply();
      const customSerializer = (data: unknown) => `custom:${JSON.stringify(data)}`;
      reply.serializer(customSerializer);
      reply.send({ test: true });

      const response = reply._buildResponse();
      // The serializer will be used in _buildResponse
    });
  });

  describe("send method", () => {
    it("should set body and mark as sent", () => {
      const reply = createFastifyReply();
      reply.send({ data: "test" });

      expect(reply._body).toEqual({ data: "test" });
      expect(reply.sent).toBe(true);
      expect(reply._sent).toBe(true);
    });

    it("should throw FST_ERR_REP_ALREADY_SENT if already sent", () => {
      const reply = createFastifyReply();

      reply.send("first");

      expect(() => reply.send("second")).toThrow(/already sent/i);
      try {
        reply.send("third");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("FST_ERR_REP_ALREADY_SENT");
      }
      // The dropped payload must not overwrite the committed body
      expect(reply._body).toBe("first");
    });

    it("should include request context in the already-sent error", () => {
      const request = createFastifyRequest(new Request("http://localhost/ctx"), {}, "req-ctx");
      const reply = createFastifyReply(request);

      reply.send("first");

      expect(() => reply.send("second")).toThrow(/req-ctx: GET \/ctx/);
    });

    it("should handle undefined payload", () => {
      const reply = createFastifyReply();
      reply.send();

      expect(reply.sent).toBe(true);
    });
  });

  describe("redirect method", () => {
    it("should redirect with default 302", () => {
      const reply = createFastifyReply();
      reply.redirect("/new-path");

      expect(reply.statusCode).toBe(302);
      expect(reply._headers.get("Location")).toBe("/new-path");
      expect(reply.sent).toBe(true);
    });

    it("should redirect with custom status", () => {
      const reply = createFastifyReply();
      reply.redirect(301, "/new-path");

      expect(reply.statusCode).toBe(301);
      expect(reply._headers.get("Location")).toBe("/new-path");
    });
  });

  describe("callNotFound method", () => {
    it("should set 404 response", () => {
      const reply = createFastifyReply();
      reply.callNotFound();

      expect(reply.statusCode).toBe(404);
      expect(reply._body).toEqual({
        statusCode: 404,
        error: "Not Found",
        message: "Route not found",
      });
      expect(reply.sent).toBe(true);
    });
  });

  describe("getResponseTime method", () => {
    it("should return elapsed time", async () => {
      const reply = createFastifyReply();
      await new Promise((r) => setTimeout(r, 10));
      const time = reply.getResponseTime();

      expect(time).toBeGreaterThanOrEqual(10);
    });
  });

  describe("elapsedTime getter", () => {
    it("should return elapsed time", async () => {
      const reply = createFastifyReply();
      await new Promise((r) => setTimeout(r, 5));

      expect(reply.elapsedTime).toBeGreaterThanOrEqual(5);
    });

    it("should freeze once the reply is sent", async () => {
      const reply = createFastifyReply();
      reply.send("done");
      const atSend = reply.getResponseTime();

      await new Promise((r) => setTimeout(r, 20));

      expect(reply.getResponseTime()).toBe(atSend);
      expect(reply.elapsedTime).toBe(atSend);
    });

    it("should freeze once the reply redirects", async () => {
      const reply = createFastifyReply();
      reply.redirect("/elsewhere");
      const atSend = reply.getResponseTime();

      await new Promise((r) => setTimeout(r, 20));

      expect(reply.getResponseTime()).toBe(atSend);
    });
  });

  describe("internal state fields", () => {
    it("should reflect closure state through _statusCode/_body/_sent", () => {
      const reply = createFastifyReply();

      reply.code(201).send({ ok: true });

      expect(reply._statusCode).toBe(201);
      expect(reply._body).toEqual({ ok: true });
      expect(reply._sent).toBe(true);
    });

    it("should write through when _sent is assigned", () => {
      const reply = createFastifyReply();
      reply._sent = true;

      expect(reply.sent).toBe(true);
      // send() now sees the reply as committed
      expect(() => reply.send("late")).toThrow(/already sent/i);
    });

    it("should write through when _statusCode is assigned", () => {
      const reply = createFastifyReply();
      reply._statusCode = 418;

      expect(reply.statusCode).toBe(418);
      expect(reply._buildResponse().status).toBe(418);
    });
  });

  describe("_buildResponse method", () => {
    it("should build redirect response", () => {
      const reply = createFastifyReply();
      reply.redirect(301, "https://example.com/new");

      const response = reply._buildResponse();
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("https://example.com/new");
    });

    it("should preserve non-location headers on a redirect", () => {
      const reply = createFastifyReply();
      reply.header("Set-Cookie", "session=abc; Path=/");
      reply.header("X-Trace", "trace-1");
      reply.redirect(302, "/login");

      const response = reply._buildResponse();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
      expect(response.headers.get("Set-Cookie")).toBe("session=abc; Path=/");
      expect(response.headers.get("X-Trace")).toBe("trace-1");
    });

    it("should not throw for non-standard 3xx redirect codes", () => {
      const reply = createFastifyReply();
      reply.redirect(300, "/choices");

      const response = reply._buildResponse();
      expect(response.status).toBe(300);
      expect(response.headers.get("Location")).toBe("/choices");
    });

    it("should null the body for statuses that forbid one", () => {
      for (const status of [204, 205, 304]) {
        const reply = createFastifyReply();
        reply.code(status).send({ ignored: true });

        const response = reply._buildResponse();
        expect(response.status).toBe(status);
        expect(response.body).toBeNull();
      }
    });

    it("should use custom serializer", async () => {
      const reply = createFastifyReply();
      reply.serializer((data) => `custom:${JSON.stringify(data)}`);
      reply.send({ test: true });

      const response = reply._buildResponse();
      const text = await response.text();
      expect(text).toBe('custom:{"test":true}');
    });

    it("should handle string body", async () => {
      const reply = createFastifyReply();
      reply.send("Hello");

      const response = reply._buildResponse();
      expect(await response.text()).toBe("Hello");
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    });

    it("should handle Uint8Array body", async () => {
      const reply = createFastifyReply();
      reply.send(new Uint8Array([1, 2, 3]));

      const response = reply._buildResponse();
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("should handle ArrayBuffer body", async () => {
      const reply = createFastifyReply();
      reply.send(new ArrayBuffer(4));

      const response = reply._buildResponse();
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("should handle ReadableStream body", () => {
      const reply = createFastifyReply();
      const stream = new ReadableStream();
      reply.send(stream);

      const response = reply._buildResponse();
      expect(response.body).toBe(stream);
    });

    it("should handle Blob body", () => {
      const reply = createFastifyReply();
      const blob = new Blob(["test"]);
      reply.send(blob);

      const response = reply._buildResponse();
      expect(response.body).toBeDefined();
    });

    it("should handle object body as JSON", async () => {
      const reply = createFastifyReply();
      reply.send({ foo: "bar" });

      const response = reply._buildResponse();
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      const body = await response.json();
      expect(body).toEqual({ foo: "bar" });
    });

    it("should handle null body", () => {
      const reply = createFastifyReply();
      reply._sent = true;

      const response = reply._buildResponse();
      expect(response.body).toBeNull();
    });

    it("should preserve existing content-type for string", async () => {
      const reply = createFastifyReply();
      reply.type("text/csv");
      reply.send("a,b,c");

      const response = reply._buildResponse();
      expect(response.headers.get("Content-Type")).toBe("text/csv");
    });

    it("should preserve existing content-type for binary", async () => {
      const reply = createFastifyReply();
      reply.type("image/png");
      reply.send(new Uint8Array([1, 2, 3]));

      const response = reply._buildResponse();
      expect(response.headers.get("Content-Type")).toBe("image/png");
    });

    it("should preserve existing content-type for JSON", async () => {
      const reply = createFastifyReply();
      reply.type("application/vnd.api+json");
      reply.send({ foo: "bar" });

      const response = reply._buildResponse();
      expect(response.headers.get("Content-Type")).toBe("application/vnd.api+json");
    });
  });
});

describe("FastifyHooksManager", () => {
  describe("addHook", () => {
    it("should add onRequest hook", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn((req, reply, done) => done());

      manager.addHook("onRequest", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnRequest(request, reply);

      expect(hook).toHaveBeenCalled();
    });

    it("should add preHandler hook", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn((req, reply, done) => done());

      manager.addHook("preHandler", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executePreHandler(request, reply);

      expect(hook).toHaveBeenCalled();
    });

    it("should add onSend hook", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn((req, reply, payload, done) => done());

      manager.addHook("onSend", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnSend(request, reply, "payload");

      expect(hook).toHaveBeenCalled();
    });

    it("should add onError hook", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn((req, reply, error, done) => done());

      manager.addHook("onError", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnError(request, reply, new Error("test"));

      expect(hook).toHaveBeenCalled();
    });

    it("should add onResponse hook", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn((req, reply, done) => done());

      manager.addHook("onResponse", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnResponse(request, reply);

      expect(hook).toHaveBeenCalled();
    });

    it("should add preValidation hook", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn((req, reply, done) => done());

      manager.addHook("preValidation", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executePreValidation(request, reply);

      expect(hook).toHaveBeenCalled();
    });

    it("should add preSerialization hook", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn((req, reply, payload, done) => done());

      manager.addHook("preSerialization", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executePreSerialization(request, reply, "payload");

      expect(hook).toHaveBeenCalled();
    });

    it("should list the supported hook names", () => {
      expect([...SUPPORTED_FASTIFY_HOOKS]).toEqual([
        "onRequest",
        "preValidation",
        "preHandler",
        "preSerialization",
        "onSend",
        "onError",
        "onResponse",
      ]);
    });

    it("should accept every supported hook name", () => {
      const manager = new FastifyHooksManager();

      for (const name of SUPPORTED_FASTIFY_HOOKS) {
        expect(() => manager.addHook(name, () => {})).not.toThrow();
      }
    });

    it("should throw for unsupported hook names instead of dropping them", () => {
      const manager = new FastifyHooksManager();

      for (const name of ["preParsing", "onTimeout", "onClose", "onReady", "onListen"]) {
        expect(() => manager.addHook(name, () => {})).toThrow(
          `Fastify hook "${name}" is not supported by BunAdapter`
        );
      }
    });

    it("should throw for a completely unknown hook name", () => {
      const manager = new FastifyHooksManager();

      expect(() => manager.addHook("notAHook", () => {})).toThrow(
        'Fastify hook "notAHook" is not supported by BunAdapter'
      );
    });
  });

  describe("executePreValidation", () => {
    it("should execute hooks in order and stop on error", async () => {
      const manager = new FastifyHooksManager();
      const order: string[] = [];
      const error = new Error("preValidation error");

      manager.addHook("preValidation", (req, reply, done) => {
        order.push("first");
        done();
      });
      manager.addHook("preValidation", (req, reply, done) => {
        order.push("second");
        done(error);
      });
      manager.addHook("preValidation", (req, reply, done) => {
        order.push("third");
        done();
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreValidation(request, reply);

      expect(result).toBe(error);
      expect(order).toEqual(["first", "second"]);
    });

    it("should stop if reply is sent", async () => {
      const manager = new FastifyHooksManager();
      const secondHook = vi.fn();

      manager.addHook("preValidation", (req, reply, done) => {
        reply.send("early");
        done();
      });
      manager.addHook("preValidation", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executePreValidation(request, reply);

      expect(secondHook).not.toHaveBeenCalled();
    });
  });

  describe("executePreSerialization", () => {
    it("should transform the payload before onSend", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("preSerialization", (req, reply, payload, done) => {
        done(null, { wrapped: payload });
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreSerialization(request, reply, { id: 1 });

      expect(result.payload).toEqual({ wrapped: { id: 1 } });
      expect(result.error).toBeUndefined();
    });

    it("should return errors from preSerialization hooks", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("preSerialization error");

      manager.addHook("preSerialization", (req, reply, payload, done) => done(error));

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreSerialization(request, reply, "original");

      expect(result.error).toBe(error);
      expect(result.payload).toBe("original");
    });

    it("should accept a payload returned from an async hook", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("preSerialization", async (req, reply, payload) => {
        return `${payload as string}!`;
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreSerialization(request, reply, "original");

      expect(result.payload).toBe("original!");
    });
  });

  describe("executeOnRequest", () => {
    it("should stop on error", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("test error");
      manager.addHook("onRequest", (req, reply, done) => done(error));
      manager.addHook("onRequest", vi.fn());

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBe(error);
    });

    it("should stop if reply is sent", async () => {
      const manager = new FastifyHooksManager();
      const secondHook = vi.fn();

      manager.addHook("onRequest", (req, reply, done) => {
        reply.send("done");
        done();
      });
      manager.addHook("onRequest", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnRequest(request, reply);

      expect(secondHook).not.toHaveBeenCalled();
    });

    it("should handle async hooks", async () => {
      const manager = new FastifyHooksManager();
      const hook = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      manager.addHook("onRequest", hook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnRequest(request, reply);

      expect(hook).toHaveBeenCalled();
    });

    it("should handle async hook errors", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("async error");

      manager.addHook("onRequest", async () => {
        throw error;
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBe(error);
    });

    it("should resolve with the error when a hook throws synchronously", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("sync throw");
      const secondHook = vi.fn();

      manager.addHook("onRequest", () => {
        throw error;
      });
      manager.addHook("onRequest", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();

      // Must resolve (routable through onError), not reject.
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBe(error);
      expect(secondHook).not.toHaveBeenCalled();
    });

    it("should wrap non-Error throws", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("onRequest", () => {
        throw "just a string";
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBeInstanceOf(Error);
      expect(result?.message).toBe("just a string");
    });

    it("should not hang on a sync hook that never calls done", async () => {
      const manager = new FastifyHooksManager();
      const secondHook = vi.fn((req, reply, done) => done());

      // Declares no `done` param and returns no promise.
      manager.addHook("onRequest", () => {
        /* fire and forget */
      });
      manager.addHook("onRequest", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBeUndefined();
      expect(secondHook).toHaveBeenCalled();
    });

    it("should ignore a second done() call", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("late error");

      manager.addHook("onRequest", (req, reply, done) => {
        done();
        done(error);
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBeUndefined();
    });
  });

  describe("executePreHandler", () => {
    it("should execute all preHandler hooks", async () => {
      const manager = new FastifyHooksManager();
      const hook1 = vi.fn((req, reply, done) => done());
      const hook2 = vi.fn((req, reply, done) => done());

      manager.addHook("preHandler", hook1);
      manager.addHook("preHandler", hook2);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executePreHandler(request, reply);

      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
    });

    it("should stop on error", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("preHandler error");

      manager.addHook("preHandler", (req, reply, done) => done(error));

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreHandler(request, reply);

      expect(result).toBe(error);
    });

    it("should stop if reply is sent", async () => {
      const manager = new FastifyHooksManager();
      const secondHook = vi.fn();

      manager.addHook("preHandler", (req, reply, done) => {
        reply.send("done");
        done();
      });
      manager.addHook("preHandler", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executePreHandler(request, reply);

      expect(secondHook).not.toHaveBeenCalled();
    });
  });

  describe("executeOnSend", () => {
    it("should execute hooks and pass payload", async () => {
      const manager = new FastifyHooksManager();
      manager.addHook("onSend", (req, reply, payload, done) => {
        done(undefined, "modified");
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.payload).toBe("modified");
    });

    it("should return error if hook fails", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("onSend error");

      manager.addHook("onSend", (req, reply, payload, done) => {
        done(error);
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.error).toBe(error);
    });

    it("should handle async onSend hooks", async () => {
      const manager = new FastifyHooksManager();
      manager.addHook("onSend", async (req, reply, payload, done) => {
        await new Promise((r) => setTimeout(r, 5));
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.payload).toBe("original");
    });

    it("should handle async onSend hook errors", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("async onSend error");

      manager.addHook("onSend", async () => {
        throw error;
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.error).toBe(error);
    });

    it("should chain payload modifications", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("onSend", (req, reply, payload, done) => {
        done(undefined, (payload as string) + " first");
      });
      manager.addHook("onSend", (req, reply, payload, done) => {
        done(undefined, (payload as string) + " second");
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.payload).toBe("original first second");
    });

    it("should keep current payload when hook returns undefined", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("onSend", (req, reply, payload, done) => {
        // Return undefined payload
        done(undefined, undefined);
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.payload).toBe("original");
    });

    it("should use the value returned from an async hook as the payload", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("onSend", async (req, reply, payload) => {
        await new Promise((r) => setTimeout(r, 1));
        return `${payload as string} (async)`;
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.payload).toBe("original (async)");
    });

    it("should chain async-returned payloads", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("onSend", async (req, reply, payload) => `${payload as string} first`);
      manager.addHook("onSend", async (req, reply, payload) => `${payload as string} second`);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.payload).toBe("original first second");
    });

    it("should prefer done() over the async return value", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("onSend", async (req, reply, payload, done) => {
        done(null, "from-done");
        return "from-return";
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.payload).toBe("from-done");
    });

    it("should clear the payload when done(null, null) is called", async () => {
      const manager = new FastifyHooksManager();

      manager.addHook("onSend", (req, reply, payload, done) => {
        done(null, null);
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, { some: "body" });

      expect(result.payload).toBeNull();
      expect(result.error).toBeUndefined();

      // ...and the built response has an empty body
      const outgoing = createFastifyReply();
      outgoing.send(result.payload);
      const response = outgoing._buildResponse();
      expect(response.body).toBeNull();
      expect(await response.text()).toBe("");
    });

    it("should resolve with the error when an onSend hook throws synchronously", async () => {
      const manager = new FastifyHooksManager();
      const error = new Error("sync onSend throw");

      manager.addHook("onSend", () => {
        throw error;
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.error).toBe(error);
      expect(result.payload).toBe("original");
    });

    it("should not hang on a sync hook that never calls done", async () => {
      const manager = new FastifyHooksManager();
      let called = false;

      // Two declared params: never receives `done`, returns no promise.
      manager.addHook("onSend", (req, reply) => {
        called = true;
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(called).toBe(true);
      expect(result.payload).toBe("original");
    });
  });

  describe("executeOnError", () => {
    it("should return false for a logging-only hook that calls done()", async () => {
      const manager = new FastifyHooksManager();
      const logged: Error[] = [];

      // onError is observability-only in Fastify: calling done() must NOT be
      // read as "the error was handled", or the caller would skip its 500.
      manager.addHook("onError", (req, reply, error, done) => {
        logged.push(error);
        done();
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const error = new Error("test");
      const result = await manager.executeOnError(request, reply, error);

      expect(logged).toEqual([error]);
      expect(reply.sent).toBe(false);
      expect(result).toBe(false);
    });

    it("should run every hook when none replies", async () => {
      const manager = new FastifyHooksManager();
      const order: string[] = [];

      manager.addHook("onError", (req, reply, error, done) => {
        order.push("first");
        done();
      });
      manager.addHook("onError", (req, reply, error, done) => {
        order.push("second");
        done();
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(order).toEqual(["first", "second"]);
      expect(result).toBe(false);
    });

    it("should return true when a hook replies via done()", async () => {
      const manager = new FastifyHooksManager();
      manager.addHook("onError", (req, reply, error, done) => {
        reply.code(500).send({ error: error.message });
        done();
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(true);
      expect(reply.statusCode).toBe(500);
    });

    it("should not hang when an onError hook throws synchronously", async () => {
      const manager = new FastifyHooksManager();
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

      manager.addHook("onError", () => {
        throw new Error("hook blew up");
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(false);
      // A broken reporting hook must never be silent: otherwise every error
      // stops being reported and the dashboard reads as healthy.
      expect(errorSpy).toHaveBeenCalledWith(
        'onError hook failed while reporting "test": hook blew up',
        expect.any(String)
      );
      errorSpy.mockRestore();
    });

    it("should log a rejected onError hook and keep running the remaining hooks", async () => {
      const manager = new FastifyHooksManager();
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
      const secondHook = vi.fn((req, reply, error, done) => done());

      manager.addHook("onError", async () => {
        throw new Error("reporter offline");
      });
      manager.addHook("onError", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const original = new Error("test");
      const result = await manager.executeOnError(request, reply, original);

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        'onError hook failed while reporting "test": reporter offline',
        expect.any(String)
      );
      // The original error is untouched and still reported by the caller.
      expect(secondHook).toHaveBeenCalledWith(request, reply, original, expect.any(Function));
      errorSpy.mockRestore();
    });

    it("should log and move on when an onError hook never calls done", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

      manager.addHook("onError", (req, reply, error, done) => {
        /* never calls done */
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        'onError hook failed while reporting "test": onError hook timed out after 50ms without calling done()',
        expect.any(String)
      );
      errorSpy.mockRestore();
    });

    it("should return true if reply is sent", async () => {
      const manager = new FastifyHooksManager();
      manager.addHook("onError", (req, reply, error, done) => {
        reply.send("error handled");
        done(error);
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(true);
    });

    it("should return false if not handled", async () => {
      const manager = new FastifyHooksManager();
      manager.addHook("onError", (req, reply, error, done) => {
        done(error); // error passed means not handled
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(false);
    });

    it("should handle async onError hooks", async () => {
      const manager = new FastifyHooksManager();
      manager.addHook("onError", async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(false);
    });

    it("should handle async onError hook errors", async () => {
      const manager = new FastifyHooksManager();
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
      manager.addHook("onError", async () => {
        throw new Error("handler error");
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(false);
      errorSpy.mockRestore();
    });

    it("should return false when no hooks", async () => {
      const manager = new FastifyHooksManager();

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnError(request, reply, new Error("test"));

      expect(result).toBe(false);
    });
  });

  describe("executeOnResponse", () => {
    it("should execute all onResponse hooks", async () => {
      const manager = new FastifyHooksManager();
      const hook1 = vi.fn((req, reply, done) => done());
      const hook2 = vi.fn((req, reply, done) => done());

      manager.addHook("onResponse", hook1);
      manager.addHook("onResponse", hook2);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnResponse(request, reply);

      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
    });

    it("should log hook errors instead of swallowing them and keep going", async () => {
      const manager = new FastifyHooksManager();
      // Logging goes through the Nest logger, not console.*, so it honours the
      // app's log level and structured formatting.
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
      const error = new Error("onResponse boom");
      const secondHook = vi.fn((req, reply, done) => done());

      manager.addHook("onResponse", (req, reply, done) => done(error));
      manager.addHook("onResponse", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnResponse(request, reply);

      expect(errorSpy).toHaveBeenCalledWith("onResponse hook failed: onResponse boom", error.stack);
      expect(secondHook).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("should log and continue when an onResponse hook never calls done", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
      const secondHook = vi.fn((req, reply, done) => done());

      manager.addHook("onResponse", (req, reply, done) => {
        /* never calls done */
      });
      manager.addHook("onResponse", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      await manager.executeOnResponse(request, reply);

      expect(errorSpy).toHaveBeenCalledWith(
        "onResponse hook failed: onResponse hook timed out after 50ms without calling done()",
        expect.any(String)
      );
      expect(secondHook).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("hook timeouts", () => {
    it("should default to DEFAULT_HOOK_TIMEOUT_MS", () => {
      expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(30_000);
      expect(new FastifyHooksManager().getHookTimeout()).toBe(30_000);
    });

    it("should accept a timeout through the constructor", () => {
      expect(new FastifyHooksManager({ hookTimeout: 50 }).getHookTimeout()).toBe(50);
    });

    it("should accept a timeout set after construction", () => {
      const manager = new FastifyHooksManager();
      manager.setHookTimeout(75);

      expect(manager.getHookTimeout()).toBe(75);
    });

    it("should ignore non-positive or non-finite timeouts", () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });

      manager.setHookTimeout(0);
      manager.setHookTimeout(-1);
      manager.setHookTimeout(Number.NaN);
      manager.setHookTimeout(Number.POSITIVE_INFINITY);

      expect(manager.getHookTimeout()).toBe(50);
    });

    it("should fail a lifecycle hook that declares done and never calls it", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });
      const secondHook = vi.fn((req, reply, done) => done());

      // The dangerous shape: `done` is declared (so the arity guard does not
      // fire) but never called, and no promise is returned.
      manager.addHook("onRequest", (req, reply, done) => {
        /* forgot to call done() */
      });
      manager.addHook("onRequest", secondHook);

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBeInstanceOf(Error);
      expect(result?.message).toBe("onRequest hook timed out after 50ms without calling done()");
      // The stage aborts, so later hooks do not run and the caller emits a 500.
      expect(secondHook).not.toHaveBeenCalled();
    });

    it("should name the stage that timed out", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });

      manager.addHook("preHandler", (req, reply, done) => {
        /* never calls done */
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreHandler(request, reply);

      expect(result?.message).toBe("preHandler hook timed out after 50ms without calling done()");
    });

    it("should fail a hook whose returned promise never settles", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });

      manager.addHook("preValidation", () => new Promise<void>(() => {}));

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreValidation(request, reply);

      expect(result?.message).toBe("preValidation hook timed out after 50ms without calling done()");
    });

    it("should fail a payload hook that declares done and never calls it", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });

      manager.addHook("onSend", (req, reply, payload, done) => {
        /* forgot to call done() */
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnSend(request, reply, "original");

      expect(result.error?.message).toBe("onSend hook timed out after 50ms without calling done()");
      expect(result.payload).toBe("original");
    });

    it("should fail a preSerialization hook that never calls done", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });

      manager.addHook("preSerialization", (req, reply, payload, done) => {
        /* never calls done */
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executePreSerialization(request, reply, "original");

      expect(result.error?.message).toBe(
        "preSerialization hook timed out after 50ms without calling done()"
      );
    });

    it("should not fail a hook that calls done before the timeout", async () => {
      const manager = new FastifyHooksManager({ hookTimeout: 50 });

      manager.addHook("onRequest", (req, reply, done) => {
        setTimeout(() => done(), 5);
      });

      const request = createFastifyRequest(new Request("http://localhost"));
      const reply = createFastifyReply();
      const result = await manager.executeOnRequest(request, reply);

      expect(result).toBeUndefined();
    });
  });
});

describe("FastifyPluginRegistry", () => {
  describe("decorator methods", () => {
    it("should decorate instance", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorate("test", { value: 123 });

      expect(registry.hasDecorator("test")).toBe(true);
      expect(registry.getDecorator("test")).toEqual({ value: 123 });
    });

    it("should decorate request", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorateRequest("user", null);

      expect(registry.hasRequestDecorator("user")).toBe(true);
    });

    it("should decorate reply", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorateReply("timing", null);

      expect(registry.hasReplyDecorator("timing")).toBe(true);
    });

    it("should return undefined for missing decorator", () => {
      const registry = new FastifyPluginRegistry();

      expect(registry.getDecorator("missing")).toBeUndefined();
    });

    it("should return false for missing decorators", () => {
      const registry = new FastifyPluginRegistry();

      expect(registry.hasDecorator("missing")).toBe(false);
      expect(registry.hasRequestDecorator("missing")).toBe(false);
      expect(registry.hasReplyDecorator("missing")).toBe(false);
    });
  });

  describe("register and initializePlugins", () => {
    it("should register and initialize plugins", async () => {
      const registry = new FastifyPluginRegistry();
      const pluginFn = vi.fn((instance, opts, done) => done());

      registry.register(pluginFn, { option: "value" });

      const mockInstance = {} as FastifyInstance;
      await registry.initializePlugins(mockInstance);

      expect(pluginFn).toHaveBeenCalledWith(mockInstance, { option: "value" }, expect.any(Function));
    });

    it("should handle async plugins", async () => {
      const registry = new FastifyPluginRegistry();
      const asyncPlugin = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      registry.register(asyncPlugin);

      const mockInstance = {} as FastifyInstance;
      await registry.initializePlugins(mockInstance);

      expect(asyncPlugin).toHaveBeenCalled();
    });

    it("should handle plugin errors", async () => {
      const registry = new FastifyPluginRegistry();
      const error = new Error("plugin error");

      registry.register((instance, opts, done) => done(error));

      const mockInstance = {} as FastifyInstance;

      await expect(registry.initializePlugins(mockInstance)).rejects.toThrow("plugin error");
    });

    it("should handle async plugin errors", async () => {
      const registry = new FastifyPluginRegistry();

      registry.register(async () => {
        throw new Error("async plugin error");
      });

      const mockInstance = {} as FastifyInstance;

      await expect(registry.initializePlugins(mockInstance)).rejects.toThrow("async plugin error");
    });

    it("should use empty opts if not provided", async () => {
      const registry = new FastifyPluginRegistry();
      const pluginFn = vi.fn((instance, opts, done) => done());

      registry.register(pluginFn);

      const mockInstance = {} as FastifyInstance;
      await registry.initializePlugins(mockInstance);

      expect(pluginFn).toHaveBeenCalledWith(mockInstance, {}, expect.any(Function));
    });

    it("should throw when a prefix option is supplied", () => {
      const registry = new FastifyPluginRegistry();

      expect(() =>
        registry.register((instance, opts, done) => done(), { prefix: "/api" })
      ).toThrow("plugin prefix is not supported");
    });

    it("should allow opts without a prefix", () => {
      const registry = new FastifyPluginRegistry();

      expect(() =>
        registry.register((instance, opts, done) => done(), { other: "value" })
      ).not.toThrow();
    });

    it("should reject when a plugin never calls done", async () => {
      const registry = new FastifyPluginRegistry();

      registry.register((instance, opts, done) => {
        /* forgot to call done() — listen() would otherwise never resolve */
      });

      const mockInstance = {} as FastifyInstance;

      await expect(registry.initializePlugins(mockInstance, 50)).rejects.toThrow(
        "Fastify plugin at index 0 timed out after 50ms without calling done()"
      );
    });

    it("should report the index of the plugin that timed out", async () => {
      const registry = new FastifyPluginRegistry();

      registry.register((instance, opts, done) => done());
      registry.register((instance, opts, done) => {
        /* never calls done */
      });

      const mockInstance = {} as FastifyInstance;

      await expect(registry.initializePlugins(mockInstance, 50)).rejects.toThrow(
        "Fastify plugin at index 1 timed out after 50ms without calling done()"
      );
    });

    it("should reject when a plugin's promise never settles", async () => {
      const registry = new FastifyPluginRegistry();

      registry.register(() => new Promise<void>(() => {}));

      const mockInstance = {} as FastifyInstance;

      await expect(registry.initializePlugins(mockInstance, 50)).rejects.toThrow(
        "Fastify plugin at index 0 timed out after 50ms without calling done()"
      );
    });

    it("should resolve a synchronous plugin that declares no done", async () => {
      const registry = new FastifyPluginRegistry();
      const plugin = vi.fn((instance: FastifyInstance) => {
        /* sync setup, no done, no promise */
      });

      registry.register(plugin);

      const mockInstance = {} as FastifyInstance;
      await registry.initializePlugins(mockInstance, 50);

      expect(plugin).toHaveBeenCalled();
    });

    it("should not re-initialize plugins on a second call", async () => {
      const registry = new FastifyPluginRegistry();
      const first = vi.fn((instance, opts, done) => done());
      const second = vi.fn((instance, opts, done) => done());

      registry.register(first);

      const mockInstance = {} as FastifyInstance;
      await registry.initializePlugins(mockInstance);
      expect(first).toHaveBeenCalledTimes(1);

      registry.register(second);
      await registry.initializePlugins(mockInstance);

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe("applyInstanceDecorators", () => {
    it("should make decorated values readable from the instance", () => {
      const registry = new FastifyPluginRegistry();
      const connection = { query: () => "rows" };
      registry.decorate("db", connection);

      const instance = {} as FastifyInstance;
      registry.applyInstanceDecorators(instance);

      expect((instance as unknown as Record<string, unknown>).db).toBe(connection);
    });

    it("should attach decorators added after the instance is bound", async () => {
      const registry = new FastifyPluginRegistry();
      const instance = {
        decorate(name: string, value: unknown) {
          registry.decorate(name, value);
          return instance;
        },
      } as unknown as FastifyInstance;

      registry.applyInstanceDecorators(instance);

      let seenFromSecondPlugin: unknown;

      registry.register((inst, opts, done) => {
        inst.decorate("db", { connected: true });
        done();
      });
      registry.register((inst, opts, done) => {
        seenFromSecondPlugin = (inst as unknown as Record<string, unknown>).db;
        done();
      });

      await registry.initializePlugins(instance);

      expect(seenFromSecondPlugin).toEqual({ connected: true });
      expect((instance as unknown as Record<string, unknown>).db).toEqual({ connected: true });
    });

    it("should throw rather than clobber an existing instance property", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorate("register", () => undefined);

      const instance = { register: () => instance } as unknown as FastifyInstance;

      expect(() => registry.applyInstanceDecorators(instance)).toThrow(/already been added/);
    });

    it("should be safe to call twice", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorate("db", { id: 1 });

      const instance = {} as FastifyInstance;
      registry.applyInstanceDecorators(instance);

      expect(() => registry.applyInstanceDecorators(instance)).not.toThrow();
      expect((instance as unknown as Record<string, unknown>).db).toEqual({ id: 1 });
    });
  });

  describe("applyRequestDecorators", () => {
    it("should apply request decorators", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorateRequest("user", { id: 1 });

      const request = createFastifyRequest(new Request("http://localhost"));
      registry.applyRequestDecorators(request);

      expect((request as unknown as Record<string, unknown>).user).toEqual({ id: 1 });
    });

    it("should attach function decorators as callable methods", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorateRequest("describe", function (this: FastifyRequest, suffix: string) {
        return `${this.method} ${this.url}${suffix}`;
      });

      const request = createFastifyRequest(new Request("http://localhost/path"));
      registry.applyRequestDecorators(request);

      const decorated = request as unknown as { describe: (suffix: string) => string };
      expect(typeof decorated.describe).toBe("function");
      // `this` must bind to the request at call time, not at decoration time.
      expect(decorated.describe("!")).toBe("GET /path!");
    });

    it("should not invoke function decorators at decoration time", () => {
      const registry = new FastifyPluginRegistry();
      const factory = vi.fn(() => Date.now());
      registry.decorateRequest("timestamp", factory);

      const request = createFastifyRequest(new Request("http://localhost"));
      registry.applyRequestDecorators(request);

      expect(factory).not.toHaveBeenCalled();
      expect((request as unknown as Record<string, unknown>).timestamp).toBe(factory);
    });

    it("should compute lazy request decorators per request", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorateRequestLazy("routeKey", (req) => `${req.method} ${req.routerPath}`);

      const request = createFastifyRequest(new Request("http://localhost/lazy"));
      registry.applyRequestDecorators(request);

      expect((request as unknown as Record<string, unknown>).routeKey).toBe("GET /lazy");
      expect(registry.hasRequestDecorator("routeKey")).toBe(true);
    });
  });

  describe("applyReplyDecorators", () => {
    it("should apply reply decorators", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorateReply("custom", "value");

      const reply = createFastifyReply();
      registry.applyReplyDecorators(reply);

      expect((reply as unknown as Record<string, unknown>).custom).toBe("value");
    });

    it("should attach function decorators as callable methods bound to the reply", () => {
      const registry = new FastifyPluginRegistry();
      // The documented Fastify idiom: `this` is the reply.
      registry.decorateReply("sendError", function (this: FastifyReply, code: number, message: string) {
        this.code(code).send({ statusCode: code, message });
      });

      const reply = createFastifyReply();
      registry.applyReplyDecorators(reply);

      const decorated = reply as unknown as { sendError: (code: number, message: string) => void };
      expect(typeof decorated.sendError).toBe("function");

      decorated.sendError(422, "nope");

      expect(reply.statusCode).toBe(422);
      expect(reply.sent).toBe(true);
      expect(reply._body).toEqual({ statusCode: 422, message: "nope" });
    });

    it("should not invoke function decorators at decoration time", () => {
      const registry = new FastifyPluginRegistry();
      const factory = vi.fn(() => Date.now());
      registry.decorateReply("timestamp", factory);

      const reply = createFastifyReply();
      registry.applyReplyDecorators(reply);

      expect(factory).not.toHaveBeenCalled();
      expect((reply as unknown as Record<string, unknown>).timestamp).toBe(factory);
    });

    it("should compute lazy reply decorators per reply", () => {
      const registry = new FastifyPluginRegistry();
      registry.decorateReplyLazy("startedAt", () => 42);

      const reply = createFastifyReply();
      registry.applyReplyDecorators(reply);

      expect((reply as unknown as Record<string, unknown>).startedAt).toBe(42);
      expect(registry.hasReplyDecorator("startedAt")).toBe(true);
    });
  });
});

describe("isFastifyMiddleware", () => {
  it("should return true for marked functions", () => {
    const fn = () => {};
    markAsFastify(fn);

    expect(isFastifyMiddleware(fn)).toBe(true);
  });

  it("should return false for unmarked functions", () => {
    const fn = () => {};

    expect(isFastifyMiddleware(fn)).toBe(false);
  });
});

describe("markAsFastify", () => {
  it("should mark function and return it", () => {
    const fn = () => {};
    const result = markAsFastify(fn);

    expect(result).toBe(fn);
    expect((fn as unknown as Record<string, unknown>)._fastify).toBe(true);
  });
});
