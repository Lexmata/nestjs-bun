import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RequestMethod,
  VERSION_NEUTRAL,
  VersioningType,
  type VersioningOptions,
} from "@nestjs/common";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunAdapter } from "./bun-adapter";
import {
  createExpressResponse,
  type ExpressRequest,
  type ExpressResponse,
} from "./express-compat";
import { FastifyPluginRegistry, type FastifyInstance } from "./fastify-compat";

/**
 * The handler shape the adapter's route-registration methods accept. Declared
 * here because `RouteHandler` is internal to `bun-adapter.ts`.
 */
type TestRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: (err?: unknown) => void
) => unknown;

describe("BunAdapter", () => {
  let adapter: BunAdapter;

  /** Base URL of the adapter's listening server. Call after `listen()`. */
  const baseUrl = (): string => `http://localhost:${adapter.getHttpServer().server?.port}`;

  beforeEach(() => {
    adapter = new BunAdapter();
  });

  afterEach(async () => {
    try {
      await adapter.close();
    } catch {
      // ignore
    }
  });

  describe("constructor", () => {
    it("should create adapter without server instance", () => {
      const adapter = new BunAdapter();
      expect(adapter).toBeInstanceOf(BunAdapter);
      expect(adapter.getInstance()).toBeDefined();
    });
  });

  describe("HTTP method registration", () => {
    it("should register GET route with path", async () => {
      const handler = vi.fn((req, res) => res.send("ok"));
      adapter.get("/test", handler);

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);
      expect(response.status).toBe(200);
    });

    it("should register GET route without path", async () => {
      const handler = vi.fn((req, res) => res.send("ok"));
      adapter.get(handler);

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`);
      expect(response.status).toBe(200);
    });

    it("should register POST route", async () => {
      adapter.post("/test", (req, res) => res.send("posted"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, { method: "POST" });
      expect(response.status).toBe(200);
    });

    it("should register POST route without path", async () => {
      adapter.post((req, res) => res.send("posted"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`, { method: "POST" });
      expect(response.status).toBe(200);
    });

    it("should register PUT route", async () => {
      adapter.put("/test", (req, res) => res.send("put"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, { method: "PUT" });
      expect(response.status).toBe(200);
    });

    it("should register PUT route without path", async () => {
      adapter.put((req, res) => res.send("put"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`, { method: "PUT" });
      expect(response.status).toBe(200);
    });

    it("should register DELETE route", async () => {
      adapter.delete("/test", (req, res) => res.send("deleted"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, { method: "DELETE" });
      expect(response.status).toBe(200);
    });

    it("should register DELETE route without path", async () => {
      adapter.delete((req, res) => res.send("deleted"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`, { method: "DELETE" });
      expect(response.status).toBe(200);
    });

    it("should register PATCH route", async () => {
      adapter.patch("/test", (req, res) => res.send("patched"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, { method: "PATCH" });
      expect(response.status).toBe(200);
    });

    it("should register PATCH route without path", async () => {
      adapter.patch((req, res) => res.send("patched"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`, { method: "PATCH" });
      expect(response.status).toBe(200);
    });

    it("should register OPTIONS route", async () => {
      adapter.options("/test", (req, res) => res.send("options"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, { method: "OPTIONS" });
      expect(response.status).toBe(200);
    });

    it("should register OPTIONS route without path", async () => {
      adapter.options((req, res) => res.send("options"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`, { method: "OPTIONS" });
      expect(response.status).toBe(200);
    });

    it("should register HEAD route", async () => {
      adapter.head("/test", (req, res) => res.end());

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, { method: "HEAD" });
      expect(response.status).toBe(200);
    });

    it("should register HEAD route without path", async () => {
      adapter.head((req, res) => res.end());

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`, { method: "HEAD" });
      expect(response.status).toBe(200);
    });

    it("should register ALL route", async () => {
      adapter.all("/test", (req, res) => res.send("all"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;

      const getResponse = await fetch(`http://localhost:${server?.port}/test`);
      expect(getResponse.status).toBe(200);

      const postResponse = await fetch(`http://localhost:${server?.port}/test`, { method: "POST" });
      expect(postResponse.status).toBe(200);
    });

    it("should register ALL route without path", async () => {
      adapter.all((req, res) => res.send("all"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/`);
      expect(response.status).toBe(200);
    });
  });

  describe("route parameters", () => {
    it("should extract route parameters", async () => {
      adapter.get("/users/:id", (req, res) => {
        res.json({ id: req.params.id });
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/users/123`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.id).toBe("123");
    });

    it("should handle multiple parameters", async () => {
      adapter.get("/users/:userId/posts/:postId", (req, res) => {
        res.json({ userId: req.params.userId, postId: req.params.postId });
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/users/1/posts/2`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ userId: "1", postId: "2" });
    });
  });

  describe("wildcard routes", () => {
    it("should handle wildcard routes", async () => {
      adapter.get("/files/*", (req, res) => res.send("file"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/files/path/to/file.txt`);
      expect(response.status).toBe(200);
    });
  });

  describe("global prefix", () => {
    it("should apply global prefix to routes", async () => {
      adapter.setGlobalPrefix("/api");
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/api/test`);
      expect(response.status).toBe(200);
    });

    it("should handle prefix without leading slash", async () => {
      adapter.setGlobalPrefix("api");
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/api/test`);
      expect(response.status).toBe(200);
    });

    // The prefix is baked into path/pathPattern/staticPaths by buildPath at
    // registration time, so setting it afterwards cannot re-path a route that
    // already exists. Pinned because the invalidation next to setGlobalPrefix
    // reads as though it did.
    it("should not apply a prefix retroactively to an already-registered route", async () => {
      adapter.get("/test", (req, res) => res.send("ok"));
      adapter.setGlobalPrefix("/api");

      await adapter.listen(0);
      expect((await fetch(`${baseUrl()}/test`)).status).toBe(200);
      expect((await fetch(`${baseUrl()}/api/test`)).status).toBe(404);
    });

    // Middleware paths ARE resolved through buildPath per request, and that
    // result is memoised on the entry. A prefix set after registration has to
    // invalidate the memo, or the middleware keeps matching its old path.
    it("should re-resolve a memoised middleware path when the prefix changes", async () => {
      const seen: string[] = [];
      adapter.use("/scoped", (req: ExpressRequest, _res: ExpressResponse, next: () => void) => {
        seen.push(req.url);
        next();
      });
      adapter.get("/api/scoped/thing", (req, res) => res.send("ok"));
      adapter.get("/scoped/thing", (req, res) => res.send("ok"));

      await adapter.listen(0);

      // Resolve and memoise the middleware path under no prefix.
      await fetch(`${baseUrl()}/scoped/thing`);
      expect(seen).toEqual(["/scoped/thing"]);

      adapter.setGlobalPrefix("/api");
      await fetch(`${baseUrl()}/api/scoped/thing`);

      expect(seen).toEqual(["/scoped/thing", "/api/scoped/thing"]);
    });
  });

  describe("request body parsing", () => {
    it("should parse JSON body", async () => {
      adapter.post("/test", (req, res) => {
        res.json(req.body);
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foo: "bar" }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ foo: "bar" });
    });

    it("should parse URL-encoded body", async () => {
      adapter.post("/test", (req, res) => {
        res.json(req.body);
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "foo=bar&baz=qux",
      });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ foo: "bar", baz: "qux" });
    });

    it("should parse text body", async () => {
      adapter.post("/test", (req, res) => {
        res.send(req.body);
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "Hello, World!",
      });
      const body = await response.text();
      expect(body).toBe("Hello, World!");
    });

    it("should handle multipart form data", async () => {
      adapter.post("/test", (req, res) => {
        res.json(req.body);
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;

      const formData = new FormData();
      formData.append("name", "John");

      const response = await fetch(`http://localhost:${server?.port}/test`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.name).toBe("John");
    });

    // The request path skips parseRequestBody entirely when no Content-Type is
    // declared. That shortcut is only sound while the skipped call would have
    // produced the same answer as an unclaimed content type, so pin the two
    // against each other rather than trusting the comment.
    it("should leave the body undefined both when no Content-Type is declared and when it is unclaimed", async () => {
      const seen: Array<{ declared: string | null; body: unknown }> = [];
      adapter.post("/body", (req, res) => {
        seen.push({ declared: req.get("content-type") ?? null, body: req.body });
        res.send("ok");
      });

      await adapter.listen(0);

      // `fetch` infers a Content-Type from most body types, so send raw bytes
      // with the header explicitly stripped to get a genuinely undeclared body.
      await fetch(`${baseUrl()}/body`, {
        method: "POST",
        headers: { "Content-Type": "" },
        body: new Uint8Array([1, 2, 3]),
      });
      await fetch(`${baseUrl()}/body`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array([1, 2, 3]),
      });

      expect(seen).toHaveLength(2);
      expect(seen[0].declared).toBeFalsy();
      expect(seen[0].body).toBeUndefined();
      expect(seen[1].declared).toBe("application/octet-stream");
      expect(seen[1].body).toBeUndefined();
    });
  });

  describe("middleware", () => {
    it("should execute global middleware", async () => {
      const middlewareSpy = vi.fn((req, res, next) => {
        req.customData = "test";
        next();
      });

      adapter.use(middlewareSpy);
      adapter.get("/test", (req, res) => {
        res.send((req as unknown as Record<string, unknown>).customData);
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);
      const body = await response.text();

      expect(middlewareSpy).toHaveBeenCalled();
      expect(body).toBe("test");
    });

    it("should execute path-specific middleware", async () => {
      const middlewareSpy = vi.fn((req, res, next) => next());

      adapter.use("/api", middlewareSpy);
      adapter.get("/api/test", (req, res) => res.send("ok"));
      adapter.get("/other", (req, res) => res.send("other"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;

      await fetch(`http://localhost:${server?.port}/api/test`);
      expect(middlewareSpy).toHaveBeenCalledTimes(1);

      await fetch(`http://localhost:${server?.port}/other`);
      expect(middlewareSpy).toHaveBeenCalledTimes(1); // Not called again
    });

    it("should handle middleware that ends response", async () => {
      adapter.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        res.status(401).send("Unauthorized");
      });
      adapter.get("/test", (req, res) => res.send("should not reach"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Unauthorized");
    });

    it("should handle error middleware", async () => {
      adapter.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        next(new Error("Test error"));
      });
      adapter.use((err: unknown, req: unknown, res: Record<string, unknown>, next: () => void) => {
        (res as { status: (code: number) => { send: (body: string) => void } })
          .status(500)
          .send("Error handled");
      });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Error handled");
    });

    it("should handle array of middleware", async () => {
      const middleware1 = vi.fn((req, res, next) => next());
      const middleware2 = vi.fn((req, res, next) => next());

      adapter.use([middleware1, middleware2]);
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/test`);

      expect(middleware1).toHaveBeenCalled();
      expect(middleware2).toHaveBeenCalled();
    });

    // `use(fn)` and `use([fn])` both worked, but the path branch used to check
    // only `typeof args[i] === "function"`, so an array argument was dropped
    // and `use("/api", [mw])` silently registered nothing.
    it("should handle an array of middleware behind a path", async () => {
      const middleware1 = vi.fn((req, res, next) => next());
      const middleware2 = vi.fn((req, res, next) => next());

      adapter.use("/api", [middleware1, middleware2]);
      adapter.get("/api/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/api/test`);

      expect(middleware1).toHaveBeenCalled();
      expect(middleware2).toHaveBeenCalled();
    });

    it("should not run path-scoped array middleware for a non-matching path", async () => {
      const scoped = vi.fn((req, res, next) => next());

      adapter.use("/api", [scoped]);
      adapter.get("/other", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/other`);

      expect(scoped).not.toHaveBeenCalled();
    });

    it("should handle multiple middleware in use call", async () => {
      const middleware1 = vi.fn((req, res, next) => next());
      const middleware2 = vi.fn((req, res, next) => next());

      adapter.use(middleware1, middleware2);
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/test`);

      expect(middleware1).toHaveBeenCalled();
      expect(middleware2).toHaveBeenCalled();
    });

    it("should handle path-specific multiple middleware", async () => {
      const middleware1 = vi.fn((req, res, next) => next());
      const middleware2 = vi.fn((req, res, next) => next());

      adapter.use("/api", middleware1, middleware2);
      adapter.get("/api/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/api/test`);

      expect(middleware1).toHaveBeenCalled();
      expect(middleware2).toHaveBeenCalled();
    });
  });

  describe("CORS", () => {
    // NestJS declares `enableCors(options?: any)` and does not narrow
    // `NestApplicationOptions["cors"]`, so these shapes reach the adapter with
    // no compile error via `NestBunFactory.create(App, { cors })`. Rendered as
    // a header value they produce a garbage origin or a 500 per request, so the
    // rejection has to be a runtime one.
    it("should reject a RegExp origin at configuration time", () => {
      expect(() => adapter.enableCors({ origin: /^https:\/\/.*\.example\.com$/ } as never)).toThrow(
        /must be a string, an array of strings, or a boolean/
      );
    });

    it("should reject a callback origin at configuration time", () => {
      expect(() =>
        adapter.enableCors({ origin: (_o: string, cb: (e: null, ok: boolean) => void) => cb(null, true) } as never)
      ).toThrow(/Received a callback/);
    });

    // An empty allow-list is the natural result of an unset env var. Falling
    // back to the first entry made it `*`, so an unconfigured deployment
    // allowed every caller.
    it("should grant no origin for an empty allow-list", async () => {
      adapter.enableCors({ origin: [] });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/test`, {
        headers: { Origin: "https://evil.test" },
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should grant no origin when the request origin is not in the allow-list", async () => {
      adapter.enableCors({ origin: ["https://good.test"] });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/test`, {
        headers: { Origin: "https://evil.test" },
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    // A response whose granted origin depends on the request must not be cached
    // under a key that ignores it, or a shared cache serves one origin's grant
    // to another.
    it("should set Vary: Origin only when the granted origin depends on the request", async () => {
      adapter.enableCors({ origin: true });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const varying = await fetch(`${baseUrl()}/test`, {
        headers: { Origin: "https://a.test" },
      });

      expect(varying.headers.get("Vary")).toBe("Origin");
      expect(varying.headers.get("Access-Control-Allow-Origin")).toBe("https://a.test");
    });

    it("should not set Vary for a static string origin", async () => {
      adapter.enableCors({ origin: "https://only.test" });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/test`, {
        headers: { Origin: "https://a.test" },
      });

      expect(response.headers.get("Vary")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://only.test");
    });

    it("should enable CORS with default options", async () => {
      adapter.enableCors();
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should enable CORS with custom origin", async () => {
      adapter.enableCors({ origin: "https://example.com" });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    });

    it("should handle CORS with origin array", async () => {
      adapter.enableCors({
        origin: ["https://example.com", "https://other.com"],
      });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        headers: { Origin: "https://example.com" },
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    });

    it("should handle CORS with boolean origin", async () => {
      adapter.enableCors({ origin: true });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        headers: { Origin: "https://example.com" },
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    });

    // `origin: true` echoes the request origin. This used to be spelled as a
    // callback too, but the shim never read the callback's verdict, so a deny
    // (`callback(null, false)`) was silently served as an allow. The callback
    // form is gone from the signature; this covers the behaviour that remains.
    it("should echo the request origin when origin is true", async () => {
      adapter.enableCors({ origin: true });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        headers: { Origin: "https://example.com" },
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    });

    // `origin: false` resolves to the empty string, and an empty header value
    // does not reach the client — so the caller is granted no origin at all,
    // which is the point of the setting.
    it("should grant no allow-origin when origin is false", async () => {
      adapter.enableCors({ origin: false });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        headers: { Origin: "https://example.com" },
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should handle CORS preflight", async () => {
      adapter.enableCors();
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        method: "OPTIONS",
      });

      expect(response.status).toBe(204);
    });

    it("should handle CORS preflight with continue", async () => {
      adapter.enableCors({ preflightContinue: true });
      adapter.options("/test", (req, res) => res.send("options handled"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        method: "OPTIONS",
      });

      expect(await response.text()).toBe("options handled");
    });

    it("should set credentials header when enabled", async () => {
      adapter.enableCors({ credentials: true });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("should handle exposed headers", async () => {
      adapter.enableCors({ exposedHeaders: ["X-Custom"] });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Custom");
    });

    it("should handle methods array", async () => {
      adapter.enableCors({ methods: ["GET", "POST"] });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
    });

    it("should handle allowed headers array", async () => {
      adapter.enableCors({ allowedHeaders: ["Content-Type", "Authorization"] });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Authorization");
    });

    it("should handle exposed headers array", async () => {
      adapter.enableCors({ exposedHeaders: ["X-One", "X-Two"] });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-One,X-Two");
    });
  });

  describe("Fastify compatibility", () => {
    it("should add hooks", async () => {
      const hookSpy = vi.fn((req, reply, done) => done());
      adapter.addHook("onRequest", hookSpy);
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/test`);

      expect(hookSpy).toHaveBeenCalled();
    });

    it("should register plugins", async () => {
      const pluginSpy = vi.fn((instance, opts, done) => done());
      adapter.register(pluginSpy, { option: "value" });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/test`);

      expect(pluginSpy).toHaveBeenCalled();
    });

    it("should decorate instance", () => {
      adapter.decorate("myValue", 123);
      expect(adapter.hasDecorator("myValue")).toBe(true);
    });

    it("should decorate request", () => {
      adapter.decorateRequest("user", null);
      expect(adapter.hasRequestDecorator("user")).toBe(true);
    });

    it("should decorate reply", () => {
      adapter.decorateReply("timing", null);
      expect(adapter.hasReplyDecorator("timing")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle route handler errors", async () => {
      adapter.get("/test", () => {
        throw new Error("Test error");
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });

    it("should use custom error handler", async () => {
      adapter.setErrorHandler((error, req, res) => {
        res.status(503).send("Custom error");
      });
      adapter.get("/test", () => {
        throw new Error("Test error");
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(503);
      expect(await response.text()).toBe("Custom error");
    });

    it("should use custom not found handler", async () => {
      adapter.setNotFoundHandler((req, res) => {
        res.status(404).send("Custom not found");
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/nonexistent`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Custom not found");
    });

    it("should return 404 for unmatched routes", async () => {
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/nonexistent`);

      expect(response.status).toBe(404);
    });

    it("should handle middleware throwing error", async () => {
      adapter.use(() => {
        throw new Error("Middleware error");
      });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });
  });

  describe("listen", () => {
    it("should listen on port with callback", async () => {
      const callback = vi.fn();
      await adapter.listen(0, callback);

      expect(callback).toHaveBeenCalled();
    });

    it("should listen on port and hostname", async () => {
      await adapter.listen(0, "127.0.0.1");
      const server = adapter.getHttpServer();
      const address = server.address();

      expect(address?.address).toBe("127.0.0.1");
    });

    it("should listen on port and hostname with callback", async () => {
      const callback = vi.fn();
      await adapter.listen(0, "127.0.0.1", callback);

      expect(callback).toHaveBeenCalled();
    });

    it("should listen on string port", async () => {
      await adapter.listen("0");
      const server = adapter.getHttpServer().server;
      expect(server?.port).toBeDefined();
    });
  });

  describe("close", () => {
    it("should close the server", async () => {
      await adapter.listen(0);
      const server = adapter.getHttpServer();
      expect(server.listening).toBe(true);

      await adapter.close();
      expect(server.listening).toBe(false);
    });
  });

  describe("getHttpServer", () => {
    it("should return the server wrapper", () => {
      const server = adapter.getHttpServer();
      expect(server).toBeDefined();
    });
  });

  describe("getInstance", () => {
    it("should return the instance", () => {
      const instance = adapter.getInstance();
      expect(instance).toBeDefined();
    });
  });

  describe("getType", () => {
    it("should return 'bun'", () => {
      expect(adapter.getType()).toBe("bun");
    });
  });

  describe("initHttpServer", () => {
    it("should initialize http server", () => {
      adapter.initHttpServer();
      expect(adapter.getHttpServer()).toBeDefined();
    });
  });

  describe("response helpers", () => {
    it("should handle handler returning value", async () => {
      adapter.get("/test", () => ({ result: "value" }));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(body).toEqual({ result: "value" });
    });

    it("should handle handler returning Response", async () => {
      adapter.get("/test", () => new Response("direct response"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);
      const body = await response.text();

      expect(body).toBe("direct response");
    });
  });

  describe("status and reply methods", () => {
    it("status should return response builder", () => {
      const res = adapter.status({} as Response, 201);
      expect(res).toBeDefined();
    });

    it("reply should return response builder", () => {
      const res = adapter.reply({} as Response, "body", 201);
      expect(res).toBeDefined();
    });
  });

  describe("abstract method implementations", () => {
    it("getRequestHostname should return hostname", () => {
      const req = new Request("http://example.com/path");
      expect(adapter.getRequestHostname(req)).toBe("example.com");
    });

    it("getRequestMethod should return method", () => {
      const req = new Request("http://example.com", { method: "POST" });
      expect(adapter.getRequestMethod(req)).toBe("POST");
    });

    it("getRequestUrl should return path including query, like Express originalUrl", () => {
      const req = new Request("http://example.com/path?foo=bar");
      expect(adapter.getRequestUrl(req)).toBe("/path?foo=bar");
    });

    it("getRequestUrl should accept the relative url NestJS actually passes", () => {
      // NestJS hands this the ExpressRequest, whose `url` is relative.
      // `new URL()` rejects it, which used to turn every 404 into a 500.
      const relative = { url: "/path?foo=bar" } as unknown as Request;
      expect(adapter.getRequestUrl(relative)).toBe("/path?foo=bar");
    });

    it("end should be a no-op", () => {
      // Should not throw
      adapter.end({} as Response, "message");
    });

    it("setHeader should mutate the ExpressResponse NestJS passes and return it", () => {
      // NestJS discards the return value, so setHeader MUST mutate in place.
      const res = createExpressResponse();
      const result = adapter.setHeader(res as unknown as Response, "X-Test", "value");
      expect(result).toBe(res);
      expect(res.getHeader("X-Test")).toBe("value");
    });

    it("appendHeader should mutate the ExpressResponse in place", () => {
      const res = createExpressResponse();
      adapter.appendHeader(res as unknown as Response, "X-Multi", "a");
      adapter.appendHeader(res as unknown as Response, "X-Multi", "b");
      expect(res.getHeader("X-Multi")).toContain("a");
      expect(res.getHeader("X-Multi")).toContain("b");
    });

    it("status should set the status on the ExpressResponse", () => {
      const res = createExpressResponse();
      const result = adapter.status(res as unknown as Response, 201);
      expect(result).toBe(res);
      expect(res._statusCode).toBe(201);
    });

    it("redirect should set Location on the ExpressResponse, including relative urls", () => {
      const res = createExpressResponse();
      adapter.redirect(res as unknown as Response, 302, "/login");
      expect(res._statusCode).toBe(302);
      expect(res.getHeader("Location")).toBe("/login");
    });

    it("isHeadersSent should return false", () => {
      expect(adapter.isHeadersSent({} as Response)).toBe(false);
    });

    it("useBodyParser should be a no-op", () => {
      // Should not throw
      adapter.useBodyParser("json");
    });

    it("registerParserMiddleware should set flag", () => {
      adapter.registerParserMiddleware();
      // Just verify it doesn't throw
    });

    it("setViewEngine should throw because view engines are unsupported", () => {
      // Failing loudly at bootstrap beats a silent empty 200 per request.
      expect(() => adapter.setViewEngine("ejs")).toThrow("not supported");
    });

    it("render should throw because view rendering is unsupported", () => {
      expect(() => adapter.render({} as Response, "view", {})).toThrow("not supported");
    });

    // `applyVersionFilter` and `createMiddlewareFactory` used to be asserted
    // here with `expect(typeof result).toBe("function")`, which passes for
    // `() => {}` and so measured nothing. They are exercised through real
    // requests in the "API versioning" and "createMiddlewareFactory" suites
    // below instead.

    it("getHeader should read a header back off the ExpressResponse NestJS passes", () => {
      const res = createExpressResponse();
      res.set("X-Test", "value");

      expect(adapter.getHeader(res as unknown as Response, "X-Test")).toBe("value");
    });

    it("getHeader should return undefined for a header absent from an ExpressResponse", () => {
      const res = createExpressResponse();

      expect(adapter.getHeader(res as unknown as Response, "X-Absent")).toBeUndefined();
    });

    it("getHeader should fall back to a native Response's headers", () => {
      const native = new Response("body", { headers: { "X-Native": "native-value" } });

      expect(adapter.getHeader(native, "X-Native")).toBe("native-value");
      expect(adapter.getHeader(native, "X-Absent")).toBeUndefined();
    });
  });

  describe("static assets", () => {
    // Each test gets its own throwaway tree, removed afterwards. The previous
    // fixed "/tmp/bun-adapter-test" paths leaked between runs, so a file written
    // by an earlier run could satisfy a later assertion.
    const DOTFILE_SECRET = "DOTFILE-SHOULD-NEVER-BE-SERVED";
    const SIBLING_SECRET = "SIBLING-SHOULD-NEVER-BE-SERVED";

    let tempRoot: string;
    let assetsRoot: string;

    beforeEach(() => {
      tempRoot = mkdtempSync(join(tmpdir(), "bun-adapter-assets-"));
      assetsRoot = join(tempRoot, "assets");
      mkdirSync(assetsRoot);
      writeFileSync(join(assetsRoot, "test.txt"), "Hello from static file");
      // Dotfiles are exactly what a static root leaks by accident (.env,
      // .git/config), so serve-static refuses them and so must this.
      writeFileSync(join(assetsRoot, ".gitignore"), DOTFILE_SECRET);
      // A SIBLING directory whose name has the root as a string prefix. A
      // `startsWith(root)` check without the trailing separator would serve it.
      mkdirSync(join(tempRoot, "assets-evil"));
      writeFileSync(join(tempRoot, "assets-evil", "secret"), SIBLING_SECRET);
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    /** Serve `assetsRoot`, start listening, and return the base URL. */
    const serveAssets = async (options?: {
      prefix?: string;
      transfer?: "stream" | "sendfile";
    }): Promise<string> => {
      adapter.useStaticAssets(assetsRoot, options);
      await adapter.listen(0);
      return baseUrl();
    };

    // Everything in here must hold identically whichever way the bytes are
    // transferred; the two modes differ only in framing and in whether the
    // symlink TOCTOU is closed, both covered separately below.
    describe.each(["stream", "sendfile"] as const)("transfer: %s", (transfer) => {
      it("should serve a file from the static root", async () => {
        const base = await serveAssets({ transfer });

        const response = await fetch(`${base}/test.txt`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Hello from static file");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      });

      it("should refuse a dotfile", async () => {
        const base = await serveAssets({ transfer });

        const response = await fetch(`${base}/.gitignore`);

        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain(DOTFILE_SECRET);
      });

      it("should refuse a traversal outside the root", async () => {
        const base = await serveAssets({ transfer });

        const response = await fetch(`${base}/../assets-evil/secret`);

        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain(SIBLING_SECRET);
      });

      it("should refuse a symlink that escapes the root", async () => {
        writeFileSync(join(tempRoot, "outside.txt"), SIBLING_SECRET);
        symlinkSync(join(tempRoot, "outside.txt"), join(assetsRoot, "escape.txt"));
        const base = await serveAssets({ transfer });

        const response = await fetch(`${base}/escape.txt`);

        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain(SIBLING_SECRET);
      });

      it("should follow a symlink whose target is inside the root", async () => {
        symlinkSync(join(assetsRoot, "test.txt"), join(assetsRoot, "linked.txt"));
        const base = await serveAssets({ transfer });

        const response = await fetch(`${base}/linked.txt`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Hello from static file");
      });

      it("should serve a large file intact", async () => {
        const size = 4 * 1024 * 1024;
        writeFileSync(join(assetsRoot, "big.bin"), "x".repeat(size));
        const base = await serveAssets({ transfer });

        const response = await fetch(`${base}/big.bin`);

        expect(response.status).toBe(200);
        expect((await response.text()).length).toBe(size);
      });

      it("should not leak a file descriptor per request", async () => {
        const base = await serveAssets({ transfer });
        const openFds = (): number => readdirSync("/proc/self/fd").length;

        await fetch(`${base}/test.txt`).then((r) => r.text());
        const before = openFds();
        for (let i = 0; i < 40; i++) {
          await fetch(`${base}/test.txt`).then((r) => r.text());
        }

        expect(openFds()).toBeLessThan(before + 10);
      });
    });

    // The two documented differences between the modes.
    it("should frame a streamed GET as chunked, without Content-Length", async () => {
      const base = await serveAssets({ transfer: "stream" });

      const response = await fetch(`${base}/test.txt`);

      expect(response.headers.get("Transfer-Encoding")).toBe("chunked");
      expect(response.headers.get("Content-Length")).toBeNull();
    });

    it("should report Content-Length for a sendfile GET", async () => {
      const base = await serveAssets({ transfer: "sendfile" });

      const response = await fetch(`${base}/test.txt`);

      expect(response.headers.get("Content-Length")).toBe("22");
      expect(response.headers.get("Transfer-Encoding")).toBeNull();
    });

    it("should default to the stream transfer", async () => {
      const base = await serveAssets();

      const response = await fetch(`${base}/test.txt`);

      expect(response.headers.get("Transfer-Encoding")).toBe("chunked");
    });

    // The reason the two modes exist. Drives the strategies directly with a
    // path that has become a symlink *after* containment was checked - which is
    // what a writer inside the root wins by racing the gap between the check
    // and the open. `stream` opens with O_NOFOLLOW and refuses; `sendfile` has
    // no descriptor to bind and serves whatever the path now points at.
    describe("symlink TOCTOU", () => {
      const swapAfterCheck = async (
        strategy: "stream" | "sendfile"
      ): Promise<{ nexted: boolean; body: string | null }> => {
        writeFileSync(join(tempRoot, "secret.txt"), SIBLING_SECRET);
        const swapped = join(assetsRoot, "swapped.txt");
        symlinkSync(join(tempRoot, "secret.txt"), swapped);

        const sent: unknown[] = [];
        const res = {
          type: () => res,
          set: () => res,
          end: () => sent.push(null),
          send: (b: unknown) => sent.push(b),
        };
        let nexted = false;
        const next = (): void => {
          nexted = true;
        };

        const statics = BunAdapter as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
        if (strategy === "stream") {
          await statics.sendStaticByDescriptor.call(
            BunAdapter,
            swapped,
            "text/plain",
            { method: "GET" },
            res,
            next
          );
        } else {
          await statics.sendStaticByPath.call(BunAdapter, swapped, "text/plain", res, next);
        }

        let body: string | null = null;
        for (const b of sent) {
          if (b && typeof (b as Blob).text === "function") body = await (b as Blob).text();
        }
        return { nexted, body };
      };

      it("stream refuses a target swapped to a symlink after the check", async () => {
        const { nexted, body } = await swapAfterCheck("stream");

        expect(nexted).toBe(true);
        expect(body).toBeNull();
      });

      it("sendfile serves it, which is the trade this mode accepts", async () => {
        const { nexted, body } = await swapAfterCheck("sendfile");

        expect(nexted).toBe(false);
        expect(body).toBe(SIBLING_SECRET);
      });
    });

    // HEAD sends no body, so the descriptor is released without streaming and
    // the size is reported outright - Content-Length survives in both modes.
    it("should answer HEAD for a static file without a body", async () => {
      const base = await serveAssets();

      const response = await fetch(`${base}/test.txt`, { method: "HEAD" });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Length")).toBe("22");
      expect(await response.text()).toBe("");
    });

    it("should not serve a directory", async () => {
      mkdirSync(join(assetsRoot, "sub"));
      const base = await serveAssets();

      const response = await fetch(`${base}/sub`);

      expect(response.status).toBe(404);
    });
    it("should serve a file under a configured prefix", async () => {
      const base = await serveAssets({ prefix: "/static" });

      const response = await fetch(`${base}/static/test.txt`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Hello from static file");
    });

    it("should fall through to 404 for a file that does not exist", async () => {
      const base = await serveAssets();

      const response = await fetch(`${base}/absent.txt`);

      expect(response.status).toBe(404);
    });

    it("should fall through for methods other than GET and HEAD", async () => {
      const base = await serveAssets();

      const response = await fetch(`${base}/test.txt`, { method: "POST" });

      expect(response.status).toBe(404);
    });

    it("should refuse a plain ../ traversal", async () => {
      const base = await serveAssets();

      // NOTE: the client collapses "/../.." before the request leaves, so the
      // server sees "/etc/passwd". Asserted anyway because it is the form an
      // operator will reach for, and it must never return file contents.
      const response = await fetch(`${base}/../../etc/passwd`);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("root:");
    });

    it("should refuse a percent-encoded ../ traversal", async () => {
      const base = await serveAssets();

      // %2e%2e%2f survives URL normalisation, so this reaches the adapter with
      // the traversal intact - the case the lexical check actually has to catch.
      const response = await fetch(`${base}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("root:");
    });

    it("should refuse a path containing a NUL byte", async () => {
      const base = await serveAssets();

      const response = await fetch(`${base}/%00test.txt`);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Hello from static file");
    });

    it("should refuse a malformed percent-escape instead of throwing", async () => {
      const base = await serveAssets();

      // decodeURIComponent throws on this; the request must 404, not 500.
      const response = await fetch(`${base}/%E0%A4%A`);

      expect(response.status).toBe(404);
    });

    it("should refuse a dotfile", async () => {
      const base = await serveAssets();

      const response = await fetch(`${base}/.gitignore`);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(DOTFILE_SECRET);
    });

    it("should refuse a sibling directory that merely shares the root's prefix", async () => {
      const base = await serveAssets();

      const response = await fetch(`${base}/%2e%2e%2fassets-evil%2fsecret`);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(SIBLING_SECRET);
    });
  });

  describe("request next with error in handler", () => {
    it("should handle next called with error in handler", async () => {
      adapter.get("/test", (req, res, next) => {
        next(new Error("Handler error"));
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });
  });

  describe("invalid JSON body", () => {
    it("should handle invalid JSON gracefully", async () => {
      adapter.post("/test", (req, res) => {
        res.json({ body: req.body });
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{",
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(body.body).toBeUndefined();
    });
  });

  describe("Fastify hooks lifecycle", () => {
    it("should run hooks in Fastify's documented order", async () => {
      // Fastify's order is onRequest -> preValidation -> preHandler -> handler
      // -> preSerialization -> onSend -> onResponse. preValidation previously
      // ran AFTER preHandler here, the reverse of upstream.
      const order: string[] = [];
      adapter.addHook("onRequest", (req, reply, done) => {
        order.push("onRequest");
        done();
      });
      adapter.addHook("preValidation", (req, reply, done) => {
        order.push("preValidation");
        done();
      });
      adapter.addHook("preHandler", (req, reply, done) => {
        order.push("preHandler");
        done();
      });
      adapter.addHook("preSerialization", (req, reply, payload, done) => {
        order.push("preSerialization");
        done(undefined, payload);
      });
      adapter.addHook("onSend", (req, reply, payload, done) => {
        order.push("onSend");
        done(undefined, payload);
      });
      adapter.addHook("onResponse", (req, reply, done) => {
        order.push("onResponse");
        done();
      });

      adapter.get("/ordered", (req, res) => {
        order.push("handler");
        res.send("ok");
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/ordered`);

      expect(order).toEqual([
        "onRequest",
        "preValidation",
        "preHandler",
        "handler",
        "preSerialization",
        "onSend",
        "onResponse",
      ]);
    });

    it("should reject an unsupported hook name instead of silently dropping it", () => {
      // Registering an unknown hook used to return success and never run it.
      expect(() =>
        (adapter.addHook as unknown as (n: string, h: () => void) => void)("preParsing", () => {})
      ).toThrow();
    });

    it("should handle onRequest hook error", async () => {
      adapter.addHook("onRequest", (req, reply, done) => {
        done(new Error("onRequest error"));
      });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });

    it("should handle preHandler hook error", async () => {
      adapter.addHook("preHandler", (req, reply, done) => {
        done(new Error("preHandler error"));
      });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });

    it("should handle onSend hook error", async () => {
      adapter.addHook("onSend", (req, reply, payload, done) => {
        done(new Error("onSend error"));
      });
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });

    it("should execute onResponse hook", async () => {
      const hookSpy = vi.fn((req, reply, done) => done());
      adapter.addHook("onResponse", hookSpy);
      adapter.get("/test", (req, res) => res.send("ok"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      await fetch(`http://localhost:${server?.port}/test`);

      expect(hookSpy).toHaveBeenCalled();
    });

    it("should handle reply sent during onRequest hook", async () => {
      adapter.addHook("onRequest", (req, reply, done) => {
        reply.send("early response");
        done();
      });
      adapter.get("/test", (req, res) => res.send("should not reach"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);
      const body = await response.text();

      expect(body).toBe("early response");
    });

    it("should handle reply sent during preHandler hook", async () => {
      adapter.addHook("preHandler", (req, reply, done) => {
        reply.send("early response");
        done();
      });
      adapter.get("/test", (req, res) => res.send("should not reach"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);
      const body = await response.text();

      expect(body).toBe("early response");
    });
  });

  // The adapter skips the whole Fastify request/reply pair while no hook,
  // plugin or decorator is registered. That predicate must be re-read at each
  // hook stage rather than sampled once per request: the stages run after body
  // parsing and after the entire Express middleware chain, so a hook registered
  // inside that window still applies to the request it lands in. Sampling once
  // turned a late-registered onRequest auth hook into a silent bypass that also
  // skipped onResponse, so it left no access-log entry either.
  describe("Fastify surface registered mid-request", () => {
    it("should reject a request whose onRequest auth hook is registered while its body is still arriving", async () => {
      const handler = vi.fn((req: ExpressRequest, res: ExpressResponse) =>
        res.send("HANDLER RAN - no auth")
      );
      adapter.post("/guarded", handler);
      await adapter.listen(0);

      // A body delivered in two chunks parks the adapter inside
      // `parseRequestBody` - before the onRequest gate - until the second chunk
      // lands. That window is attacker-controlled and bounded only by
      // `middlewareTimeout`, so a hook registered inside it must still run.
      let release!: () => void;
      const secondChunk = new Promise<void>((resolve) => {
        release = resolve;
      });
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":'));
          await secondChunk;
          controller.enqueue(new TextEncoder().encode("1}"));
          controller.close();
        },
      });

      const inFlight = fetch(`${baseUrl()}/guarded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });

      // Land inside the window, then let the request complete.
      await new Promise((resolve) => setTimeout(resolve, 40));
      adapter.addHook("onRequest", (req, reply, done) => {
        reply.code(401).send({ error: "denied" });
        done();
      });
      release();

      const response = await inFlight;

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "denied" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should apply a preHandler auth hook registered by an Express middleware to that same request", async () => {
      // Deterministic, not a race: the middleware chain runs strictly between
      // the onRequest and preHandler gates, so a hook it registers is always
      // inside the window.
      adapter.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        adapter.addHook("preHandler", (hookReq, reply, done) => {
          reply.code(401).send({ error: "denied" });
          done();
        });
        next();
      });
      const handler = vi.fn((req: ExpressRequest, res: ExpressResponse) =>
        res.send("HANDLER RAN - no auth")
      );
      adapter.get("/guarded", handler);

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/guarded`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "denied" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should run an onResponse hook registered while the request is still in flight", async () => {
      const observed: number[] = [];
      adapter.get("/slow", async (req: ExpressRequest, res: ExpressResponse) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        res.status(201).send("done");
      });

      await adapter.listen(0);
      const inFlight = fetch(`${baseUrl()}/slow`);

      await new Promise((resolve) => setTimeout(resolve, 40));
      adapter.addHook("onResponse", (req, reply, done) => {
        observed.push(reply.statusCode);
        done();
      });

      const response = await inFlight;

      expect(response.status).toBe(201);
      // The real status, not the reply's default 200: `finalize` publishes it
      // before observers read it.
      expect(observed).toEqual([201]);
    });

    it("should build no Fastify request for an app that never touches the Fastify surface", async () => {
      // `applyRequestDecorators` runs exactly once per Fastify context and
      // nowhere else, so it stands in for "was the pair constructed?". Without
      // this the optimisation is unpinned: hard-coding the predicate to `true`
      // keeps the rest of the suite green.
      const built = vi.spyOn(FastifyPluginRegistry.prototype, "applyRequestDecorators");
      try {
        adapter.get("/plain", (req, res) => res.send("ok"));
        await adapter.listen(0);

        expect((await fetch(`${baseUrl()}/plain`)).status).toBe(200);
        expect(built).not.toHaveBeenCalled();

        adapter.addHook("onResponse", (req, reply, done) => done());

        expect((await fetch(`${baseUrl()}/plain`)).status).toBe(200);
        expect(built).toHaveBeenCalled();
      } finally {
        built.mockRestore();
      }
    });
  });

  // `finalize` publishes the real status onto the Fastify reply and then runs
  // onResponse. Every hook-observable exit routes through it, so the standard
  // access-log / latency-histogram idiom sees failures and short-circuits too -
  // previously every error exit skipped onResponse entirely, so a 500 or a 401
  // left no trace at all.
  describe("onResponse observes every exit", () => {
    /** Register an onResponse recorder and return the statuses it saw. */
    const recordResponses = (): number[] => {
      const seen: number[] = [];
      adapter.addHook("onResponse", (req, reply, done) => {
        seen.push(reply.statusCode);
        done();
      });
      return seen;
    };

    it("should report the status of a Response returned straight from the handler", async () => {
      const seen = recordResponses();
      adapter.get("/raw", () => new Response("unavailable", { status: 503 }));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/raw`);

      expect(response.status).toBe(503);
      // Not 200: the handler-supplied Response bypasses the Express response,
      // so its status has to be published onto the reply explicitly.
      expect(seen).toEqual([503]);
    });

    it("should report a handler throw", async () => {
      const seen = recordResponses();
      adapter.get("/boom", () => {
        throw new Error("handler exploded");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/boom`);

      expect(response.status).toBe(500);
      expect(seen).toEqual([500]);
    });

    it("should report an Express middleware failure, and tell onError about it", async () => {
      const seen = recordResponses();
      const reported: string[] = [];
      adapter.addHook("onError", (req, reply, error, done) => {
        reported.push(error.message);
        done();
      });
      adapter.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        next(new Error("middleware exploded"));
      });
      adapter.get("/mw", (req, res) => res.send("unreachable"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/mw`);

      expect(response.status).toBe(500);
      expect(seen).toEqual([500]);
      // An Express middleware failure is a request failure; a Fastify onError
      // reporter has to learn about it just as it does for a handler throw.
      expect(reported).toEqual(["middleware exploded"]);
    });

    it("should report an onRequest short-circuit", async () => {
      const seen = recordResponses();
      adapter.addHook("onRequest", (req, reply, done) => {
        reply.code(401).send({ error: "denied" });
        done();
      });
      adapter.get("/guarded", (req, res) => res.send("unreachable"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/guarded`);

      expect(response.status).toBe(401);
      expect(seen).toEqual([401]);
    });

    it("should report a response ended by an Express middleware", async () => {
      const seen = recordResponses();
      adapter.use((req: ExpressRequest, res: ExpressResponse) => {
        res.status(418).send("teapot");
      });
      adapter.get("/short", (req, res) => res.send("unreachable"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/short`);

      expect(response.status).toBe(418);
      expect(seen).toEqual([418]);
    });
  });

  describe("error middleware chain", () => {
    it("should pass error to next error handler", async () => {
      const firstHandler = vi.fn((err, req, res, next) => {
        next(err); // Pass to next error handler
      });
      const secondHandler = vi.fn((err, req, res, next) => {
        res.status(500).send("Handled by second");
      });

      adapter.use(firstHandler);
      adapter.use(secondHandler);
      adapter.get("/test", () => {
        throw new Error("Test error");
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(await response.text()).toBe("Handled by second");
    });

    it("should handle error handler throwing", async () => {
      adapter.use((err: unknown, req: unknown, res: unknown, next: () => void) => {
        throw new Error("Error handler error");
      });
      adapter.get("/test", () => {
        throw new Error("Original error");
      });

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });
  });

  describe("setServerOptions validation", () => {
    // `trustProxy` is typed `boolean`, but it is a security control and the type
    // is not the only way in - JS callers and env/JSON-derived config reach here
    // unchecked. Express's numeric hop count is the likely mistake, and the only
    // thing this adapter could do with a number is degrade it to "trust the
    // left-most entry", which is what a hop count exists to prevent.
    it("should reject a numeric trustProxy rather than silently ignoring it", () => {
      expect(() => adapter.setServerOptions({ trustProxy: 1 } as never)).toThrow(
        /trustProxy must be a boolean/
      );
    });

    it("should accept a boolean trustProxy", () => {
      expect(() => adapter.setServerOptions({ trustProxy: true })).not.toThrow();
      expect(() => adapter.setServerOptions({ trustProxy: false })).not.toThrow();
    });
  });

  describe("middleware completion signalling", () => {
    it("should fail the request when middleware never signals", async () => {
      // Previously this returned an empty 200, reporting success for a request
      // that was never handled. It now fails once middlewareTimeout elapses.
      adapter.setServerOptions({ middlewareTimeout: 50 });
      adapter.use(() => {
        // Never calls next, never ends the response.
      });
      adapter.get("/test", (req, res) => res.send("should not reach"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/test`);

      expect(response.status).toBe(500);
    });

    it("should continue the chain when middleware calls next() asynchronously", async () => {
      // Callback-style middleware (express-session, passport, multer) calls
      // next() from a later tick. Sampling it synchronously ended the chain
      // early and returned an empty 200 without ever running the handler.
      adapter.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        setTimeout(() => next(), 10);
      });
      adapter.get("/async-next", (req, res) => res.send("handler reached"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/async-next`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("handler reached");
    });

    it("should surface an error passed to next() from a later tick", async () => {
      adapter.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        setTimeout(() => next(new Error("async failure")), 10);
      });
      adapter.get("/async-err", (req, res) => res.send("should not reach"));

      await adapter.listen(0);
      const server = adapter.getHttpServer().server;
      const response = await fetch(`http://localhost:${server?.port}/async-err`);

      expect(response.status).toBe(500);
    });
  });

  describe("extended (WebDAV) verbs", () => {
    // AbstractHttpAdapter declares each of these and NestJS's
    // RouterMethodFactory resolves @Search()/@Propfind()/... to `adapter[verb]`,
    // falling back to `use` only when the method is ABSENT. The inherited
    // implementations forward to `this.instance[verb]`, which does not exist on
    // the Bun server wrapper - so without these overrides a controller using one
    // of the decorators would TypeError at bootstrap. That claim is what these
    // tests hold to: every verb must actually route.
    const EXTENDED_VERBS = [
      "search",
      "propfind",
      "proppatch",
      "mkcol",
      "copy",
      "move",
      "lock",
      "unlock",
    ] as const;

    type ExtendedVerb = (typeof EXTENDED_VERBS)[number];
    type PathRegistrar = (path: string, handler: TestRouteHandler) => void;
    type BareRegistrar = (handler: TestRouteHandler) => void;

    const registerWithPath = (verb: ExtendedVerb, path: string, handler: TestRouteHandler): void => {
      (adapter[verb] as unknown as PathRegistrar).call(adapter, path, handler);
    };

    for (const verb of EXTENDED_VERBS) {
      const method = verb.toUpperCase();

      it(`should route ${method} to a handler registered via adapter.${verb}(path, handler)`, async () => {
        registerWithPath(verb, "/res", (req, res) => res.send(method));

        await adapter.listen(0);
        const response = await fetch(`${baseUrl()}/res`, { method });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(method);
      });
    }

    it("should register at / when given only a handler", async () => {
      (adapter.search as unknown as BareRegistrar).call(adapter, (req, res) =>
        res.send("root-search")
      );

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/`, { method: "SEARCH" });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("root-search");
    });

    it("should 404 an extended verb that was never registered", async () => {
      registerWithPath("search", "/res", (req, res) => res.send("SEARCH"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/res`, { method: "MKCOL" });

      expect(response.status).toBe(404);
    });
  });

  describe("Fastify plugin instance facade", () => {
    it("should serve a route registered through instance.get()", async () => {
      adapter.register(async (instance) => {
        instance.get("/plugin", async (req, reply) => {
          reply.send({ ok: true });
        });
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/plugin`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });

    it("should serve every verb registered through the plugin instance", async () => {
      const seen: string[] = [];

      adapter.register(async (instance) => {
        instance.get("/i/get", async (req, reply) => {
          seen.push("get");
          reply.send("get");
        });
        instance.post("/i/post", async (req, reply) => {
          seen.push("post");
          reply.send("post");
        });
        instance.put("/i/put", async (req, reply) => {
          seen.push("put");
          reply.send("put");
        });
        instance.delete("/i/delete", async (req, reply) => {
          seen.push("delete");
          reply.send("delete");
        });
        instance.patch("/i/patch", async (req, reply) => {
          seen.push("patch");
          reply.send("patch");
        });
        instance.options("/i/options", async (req, reply) => {
          seen.push("options");
          reply.send("options");
        });
        // No body: exercises the `reply._body == null` branch, which must end
        // the response rather than send a literal "null".
        instance.head("/i/head", async (req, reply) => {
          seen.push("head");
          reply.code(204).send();
        });
        instance.all("/i/all", async (req, reply) => {
          seen.push("all");
          reply.send("all");
        });
      });

      await adapter.listen(0);
      const base = baseUrl();

      for (const [path, method] of [
        ["/i/get", "GET"],
        ["/i/post", "POST"],
        ["/i/put", "PUT"],
        ["/i/delete", "DELETE"],
        ["/i/patch", "PATCH"],
        ["/i/options", "OPTIONS"],
      ] as const) {
        const response = await fetch(`${base}${path}`, { method });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(method.toLowerCase());
      }

      const headResponse = await fetch(`${base}/i/head`, { method: "HEAD" });
      expect(headResponse.status).toBe(204);
      expect(await headResponse.text()).toBe("");

      // `all` answers regardless of verb.
      expect(await (await fetch(`${base}/i/all`)).text()).toBe("all");
      expect(await (await fetch(`${base}/i/all`, { method: "POST" })).text()).toBe("all");

      expect(seen).toEqual([
        "get",
        "post",
        "put",
        "delete",
        "patch",
        "options",
        "head",
        "all",
        "all",
      ]);
    });

    it("should expose a decorator added by one plugin to plugins registered after it", async () => {
      // applyInstanceDecorators() binds the registry to the instance BEFORE any
      // plugin runs; if that ordering regresses, `instance.db` reads undefined
      // in the second plugin while hasDecorator() still reports true.
      const connection = { name: "db-connection" };
      let seenConnection: unknown = "not-read";
      let hadDecorator: boolean | undefined;

      adapter.register(async (instance) => {
        instance.decorate("db", connection);
      });
      adapter.register(async (instance) => {
        hadDecorator = instance.hasDecorator("db");
        seenConnection = (instance as FastifyInstance & { db?: unknown }).db;
      });

      await adapter.listen(0);

      expect(hadDecorator).toBe(true);
      expect(seenConnection).toBe(connection);
    });

    it("should apply request and reply decorators registered through the instance", async () => {
      let hadRequestDecorator: boolean | undefined;
      let hadReplyDecorator: boolean | undefined;

      adapter.register(async (instance) => {
        instance.decorateRequest("tenant", "acme");
        instance.decorateReply("channel", "web");
        hadRequestDecorator = instance.hasRequestDecorator("tenant");
        hadReplyDecorator = instance.hasReplyDecorator("channel");

        instance.get("/decorated", async (req, reply) => {
          reply.send({
            tenant: (req as typeof req & { tenant?: string }).tenant,
            channel: (reply as typeof reply & { channel?: string }).channel,
          });
        });
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/decorated`);

      expect(hadRequestDecorator).toBe(true);
      expect(hadReplyDecorator).toBe(true);
      expect(await response.json()).toEqual({ tenant: "acme", channel: "web" });
    });

    it("should run a hook added through instance.addHook()", async () => {
      const fired: string[] = [];

      adapter.register(async (instance) => {
        instance.addHook("onRequest", (req, reply, done) => {
          fired.push("onRequest");
          done();
        });
      });
      adapter.get("/hooked", (req, res) => {
        fired.push("handler");
        res.send("ok");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/hooked`);

      expect(response.status).toBe(200);
      expect(fired).toEqual(["onRequest", "handler"]);
    });

    it("should initialise a plugin registered by another plugin", async () => {
      const order: string[] = [];

      adapter.register(async (instance) => {
        order.push("outer");
        instance.register(async (inner) => {
          order.push("inner");
          inner.get("/nested", async (req, reply) => {
            reply.send("from nested plugin");
          });
        });
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/nested`);

      expect(order).toEqual(["outer", "inner"]);
      expect(await response.text()).toBe("from nested plugin");
    });

    it("should use a value returned by a plugin route handler as the body", async () => {
      adapter.register(async (instance) => {
        instance.get("/returned", async () => ({ from: "return value" }));
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/returned`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ from: "return value" });
    });

    it("should answer 200 with an empty body when a plugin handler neither sends nor returns", async () => {
      adapter.register(async (instance) => {
        instance.get("/silent", async () => {
          // Deliberately neither replies nor returns a value.
        });
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/silent`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    });

    it("should surface a throw inside a plugin route handler as a 500", async () => {
      adapter.register(async (instance) => {
        instance.get("/plugin-throws", async () => {
          throw new Error("plugin handler exploded");
        });
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/plugin-throws`);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        statusCode: 500,
        message: "plugin handler exploded",
      });
    });
  });

  describe("onSend payload rewriting", () => {
    it("should replace the body with a string returned by an onSend hook", async () => {
      adapter.addHook("onSend", (req, reply, payload, done) => done(undefined, "rewritten"));
      adapter.get("/rewrite", (req, res) => res.send("original"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/rewrite`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("rewritten");
    });

    it("should drop the body when an onSend hook returns null", async () => {
      adapter.addHook("onSend", (req, reply, payload, done) => done(undefined, null));
      adapter.get("/cleared", (req, res) => res.send("original"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/cleared`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
      // Bun frames the empty body itself; what matters is that the original
      // payload's length is gone.
      expect(Number(response.headers.get("content-length") ?? "0")).toBe(0);
    });

    it("should refuse to attach a body to a 204 even when onSend supplies one", async () => {
      // A 204 with Content-Length mis-frames the next response on a keep-alive
      // connection, so the payload must be discarded rather than attached.
      adapter.addHook("onSend", (req, reply, payload, done) => done(undefined, "should be dropped"));
      adapter.get("/no-content", (req, res) => {
        res.status(204).end();
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/no-content`);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(Number(response.headers.get("content-length") ?? "0")).toBe(0);
    });

    it("should pass binary payloads through unchanged and keep the content type", async () => {
      const bytes = new TextEncoder().encode("binary-payload");
      adapter.addHook("onSend", (req, reply, payload, done) => done(undefined, bytes));
      adapter.get("/binary", (req, res) => {
        res.type("text/plain").send("original");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/binary`);

      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(await response.text()).toBe("binary-payload");
    });

    it("should JSON-encode an object payload and default the content type", async () => {
      adapter.addHook("onSend", (req, reply, payload, done) => done(undefined, { replaced: true }));
      // `end()` leaves no Content-Type, so withPayload has to supply one.
      adapter.get("/object", (req, res) => {
        res.end();
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/object`);

      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ replaced: true });
    });
  });

  describe("404 lifecycle", () => {
    it("should run onSend and onResponse hooks for an unmatched route", async () => {
      // Skipping the reply lifecycle on the not-found path silently dropped
      // every 404 from access logs and latency metrics.
      const fired: string[] = [];
      let sawNotFoundFlag: boolean | undefined;

      adapter.addHook("onSend", (req, reply, payload, done) => {
        fired.push("onSend");
        done(undefined, payload);
      });
      adapter.addHook("onResponse", (req, reply, done) => {
        fired.push("onResponse");
        sawNotFoundFlag = req.is404;
        done();
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/no-such-route`);

      expect(response.status).toBe(404);
      expect(fired).toEqual(["onSend", "onResponse"]);
      expect(sawNotFoundFlag).toBe(true);
    });

    it("should let an onSend hook rewrite the 404 payload", async () => {
      adapter.addHook("onSend", (req, reply, payload, done) => done(undefined, "nothing here"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/no-such-route`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("nothing here");
    });
  });

  describe("route fall-through", () => {
    it("should run the next matching route when a handler declines with next()", async () => {
      const order: string[] = [];
      adapter.get("/multi", (req, res, next) => {
        order.push("first");
        next();
      });
      adapter.get("/multi", (req, res) => {
        order.push("second");
        res.send("second");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/multi`);

      expect(order).toEqual(["first", "second"]);
      expect(await response.text()).toBe("second");
    });

    it("should rebind params when falling through to a differently-named parameter", async () => {
      // toEqual (not toMatchObject) on purpose: a stale "id" key left behind
      // from the first route would make the second handler's params wrong in a
      // way a subset match would not catch.
      const seen: Array<Record<string, string>> = [];
      adapter.get("/items/:id", (req, res, next) => {
        seen.push({ ...req.params });
        next();
      });
      adapter.get("/items/:slug", (req, res) => {
        seen.push({ ...req.params });
        res.send("ok");
      });

      await adapter.listen(0);
      await fetch(`${baseUrl()}/items/42`);

      expect(seen[0]).toEqual({ id: "42" });
      expect(seen[1]).toEqual({ slug: "42" });
    });

    // Routes are pre-bucketed by method and walked in registration order; a
    // route with no parameters is matched by string comparison rather than by
    // regex. Registration order is what a declining handler falls through in,
    // so a static route and a parameterised route that both match the same path
    // must still be tried in the order they were registered - in both orders,
    // since the two take different arms of the match loop.
    it("should keep registration order when a parameterised route precedes a static one", async () => {
      const order: string[] = [];
      adapter.get("/order/:id", (req, res, next) => {
        order.push(`param:${req.params.id}`);
        next();
      });
      adapter.get("/order/fixed", (req, res) => {
        order.push("static");
        res.send("static");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/order/fixed`);

      expect(order).toEqual(["param:fixed", "static"]);
      expect(await response.text()).toBe("static");
    });

    it("should keep registration order when a static route precedes a parameterised one", async () => {
      const order: string[] = [];
      adapter.get("/order/fixed", (req, res, next) => {
        order.push("static");
        next();
      });
      adapter.get("/order/:id", (req, res) => {
        order.push(`param:${req.params.id}`);
        res.send("param");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/order/fixed`);

      expect(order).toEqual(["static", "param:fixed"]);
      expect(await response.text()).toBe("param");
    });

    it("should fall through between two static routes registered on the same path", async () => {
      const order: string[] = [];
      adapter.get("/twice", (req, res, next) => {
        order.push("first");
        next();
      });
      adapter.get("/twice", (req, res) => {
        order.push("second");
        res.send("second");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/twice`);

      expect(order).toEqual(["first", "second"]);
      expect(await response.text()).toBe("second");
    });

    it("should still tolerate a trailing slash on a static route", async () => {
      adapter.get("/trailing", (req, res) => res.send("matched"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/trailing/`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("matched");
    });

    // A parameterised sibling forces the match loop to test both arms, so the
    // static route's trailing-slash form has to be recognised by the string
    // comparison itself. Dropping `|| pathname === staticPaths[1]` still answers
    // 200 here - from the WRONG handler, because "/order/:id" swallows the
    // request with id="fixed" - so assert which handler replied, not the status.
    it("should answer a trailing slash from the static handler, not a parameterised sibling", async () => {
      const order: string[] = [];
      adapter.get("/order/fixed", (req, res) => {
        order.push("static");
        res.send("static");
      });
      adapter.get("/order/:id", (req, res) => {
        order.push(`param:${req.params.id}`);
        res.send("param");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/order/fixed/`);

      expect(response.status).toBe(200);
      expect(order).toEqual(["static"]);
      expect(await response.text()).toBe("static");
    });

    it("should answer an unregistered verb from an all() route", async () => {
      adapter.get("/verbs", (req, res) => res.send("get"));
      adapter.all("/verbs", (req, res) => res.send("all"));

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/verbs`, { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("all");
    });

    it("should pick up a route registered after an earlier request was served", async () => {
      adapter.get("/first", (req, res) => res.send("first"));

      await adapter.listen(0);
      expect(await (await fetch(`${baseUrl()}/first`)).text()).toBe("first");
      expect((await fetch(`${baseUrl()}/late`)).status).toBe(404);

      adapter.get("/late", (req, res) => res.send("late"));

      const response = await fetch(`${baseUrl()}/late`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("late");
    });

    it("should 404 - not empty-200 - when every matching handler declines", async () => {
      adapter.get("/declined", (req, res, next) => next());
      adapter.get("/declined", (req, res, next) => next());

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/declined`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ statusCode: 404, message: "Not Found" });
    });

    it("should serve HEAD from the matching GET handler", async () => {
      const handler = vi.fn((req: ExpressRequest, res: ExpressResponse) => res.send("body-text"));
      adapter.get("/head-from-get", handler);

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/head-from-get`, { method: "HEAD" });

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      // HEAD carries the headers but never the body.
      expect(await response.text()).toBe("");
      expect(response.headers.get("content-length")).toBe("9");
    });
  });

  describe("rawBody capture", () => {
    it("should expose the exact request bytes alongside the parsed body", async () => {
      adapter.initHttpServer({ rawBody: true });
      // Odd whitespace: byte-exact capture is the whole point for webhook
      // signature verification, and re-serialising the parsed value loses it.
      const raw = '{"a":  1}';
      adapter.post("/raw", (req, res) => {
        res.json({
          raw: (req as ExpressRequest & { rawBody?: Buffer }).rawBody?.toString(),
          parsed: req.body,
        });
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
      });

      expect(await response.json()).toEqual({ raw, parsed: { a: 1 } });
    });

    it("should leave rawBody undefined when raw capture was not requested", async () => {
      adapter.post("/raw", (req, res) => {
        res.json({
          hasRaw: (req as ExpressRequest & { rawBody?: Buffer }).rawBody !== undefined,
          parsed: req.body,
        });
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"a":  1}',
      });

      expect(await response.json()).toEqual({ hasRaw: false, parsed: { a: 1 } });
    });
  });

  describe("API versioning", () => {
    // applyVersionFilter's contract is "run the handler, or defer to the next
    // matching route". Registering a second handler on the same path makes both
    // outcomes observable: "versioned" means it ran, "fallback" means it
    // deferred. Asserting only that the filter is a function - as this suite
    // used to - passes for a filter that never defers, and for one that never runs.
    const mountVersioned = (version: string | symbol | Array<string | symbol>, options: VersioningOptions): void => {
      const handler = (req: ExpressRequest, res: ExpressResponse): void => res.send("versioned");
      const filtered = adapter.applyVersionFilter(handler, version, options);
      adapter.get("/v", filtered as unknown as TestRouteHandler);
      adapter.get("/v", (req, res) => res.send("fallback"));
    };

    const requestVersion = async (headers?: Record<string, string>): Promise<string> => {
      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/v`, { headers });
      return response.text();
    };

    describe("HEADER strategy", () => {
      const options: VersioningOptions = {
        type: VersioningType.HEADER,
        header: "X-API-Version",
      };

      it("should invoke the handler when the header matches", async () => {
        mountVersioned("2", options);

        expect(await requestVersion({ "X-API-Version": "2" })).toBe("versioned");
      });

      it("should defer when the header names a different version", async () => {
        mountVersioned("2", options);

        expect(await requestVersion({ "X-API-Version": "1" })).toBe("fallback");
      });

      it("should defer when the header is absent", async () => {
        mountVersioned("2", options);

        expect(await requestVersion()).toBe("fallback");
      });

      it("should accept any member of an array of versions", async () => {
        mountVersioned(["2", "3"], options);

        expect(await requestVersion({ "X-API-Version": "3" })).toBe("versioned");
      });

      it("should still defer for a version outside an array of versions", async () => {
        mountVersioned(["2", "3"], options);

        expect(await requestVersion({ "X-API-Version": "4" })).toBe("fallback");
      });
    });

    describe("MEDIA_TYPE strategy", () => {
      const options: VersioningOptions = {
        type: VersioningType.MEDIA_TYPE,
        key: "v=",
      };

      it("should invoke the handler when the Accept parameter matches", async () => {
        mountVersioned("2", options);

        expect(await requestVersion({ Accept: "application/json;v=2" })).toBe("versioned");
      });

      it("should defer when Accept carries no version parameter", async () => {
        mountVersioned("2", options);

        expect(await requestVersion({ Accept: "application/json" })).toBe("fallback");
      });

      it("should defer when the version parameter is present but empty", async () => {
        mountVersioned("2", options);

        expect(await requestVersion({ Accept: "application/json;v=" })).toBe("fallback");
      });

      it("should defer when no key is configured", async () => {
        mountVersioned("2", { type: VersioningType.MEDIA_TYPE, key: "" });

        expect(await requestVersion({ Accept: "application/json;v=2" })).toBe("fallback");
      });
    });

    describe("CUSTOM strategy", () => {
      it("should use the first element when the extractor returns an array", async () => {
        mountVersioned("3", {
          type: VersioningType.CUSTOM,
          extractor: () => ["3", "2"],
        });

        expect(await requestVersion()).toBe("versioned");
      });

      it("should ignore later elements of the extractor's array", async () => {
        // "2" is in the array but not first, so it must NOT match - otherwise
        // the extractor's precedence order is meaningless.
        mountVersioned("2", {
          type: VersioningType.CUSTOM,
          extractor: () => ["3", "2"],
        });

        expect(await requestVersion()).toBe("fallback");
      });

      it("should accept a bare string from the extractor", async () => {
        mountVersioned("2", {
          type: VersioningType.CUSTOM,
          extractor: () => "2",
        });

        expect(await requestVersion()).toBe("versioned");
      });
    });

    it("should always invoke a VERSION_NEUTRAL handler", async () => {
      mountVersioned(VERSION_NEUTRAL, {
        type: VersioningType.HEADER,
        header: "X-API-Version",
      });

      expect(await requestVersion({ "X-API-Version": "99" })).toBe("versioned");
    });

    it("should invoke URI-versioned handlers unconditionally", async () => {
      // NestJS resolves URI versions through the route path, so reaching the
      // handler already means the version matched.
      mountVersioned("9", { type: VersioningType.URI });

      expect(await requestVersion()).toBe("versioned");
    });

    it("should defer for an unrecognised versioning strategy", async () => {
      mountVersioned("1", { type: 999 } as unknown as VersioningOptions);

      expect(await requestVersion()).toBe("fallback");
    });
  });

  describe("createMiddlewareFactory", () => {
    it("should run consumer middleware before the controller and still return the controller's body", async () => {
      // Regression guard: this factory used to register a ROUTE, which matched
      // ahead of every controller, called next(), and left the controller's
      // response unreachable - consumer middleware shadowed the whole app.
      const order: string[] = [];
      const factory = adapter.createMiddlewareFactory(RequestMethod.GET);
      factory("/api", (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        order.push("mw");
        next();
      });
      adapter.get("/api", (req, res) => {
        order.push("handler");
        res.send("handler-body");
      });

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/api`);

      expect(order).toEqual(["mw", "handler"]);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("handler-body");
    });

    it("should skip method-scoped middleware for a different verb", async () => {
      const order: string[] = [];
      const factory = adapter.createMiddlewareFactory(RequestMethod.POST);
      factory("/api", (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        order.push("mw");
        next();
      });
      adapter.all("/api", (req, res) => {
        order.push("handler");
        res.send("handler-body");
      });

      await adapter.listen(0);
      const base = baseUrl();

      await fetch(`${base}/api`);
      expect(order).toEqual(["handler"]);

      await fetch(`${base}/api`, { method: "POST" });
      expect(order).toEqual(["handler", "mw", "handler"]);
    });

    it("should run RequestMethod.ALL middleware for every verb", async () => {
      const order: string[] = [];
      const factory = adapter.createMiddlewareFactory(RequestMethod.ALL);
      factory("/api", (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        order.push(`mw:${req.method}`);
        next();
      });
      adapter.all("/api", (req, res) => res.send("handler-body"));

      await adapter.listen(0);
      const base = baseUrl();

      await fetch(`${base}/api`);
      await fetch(`${base}/api`, { method: "POST" });

      expect(order).toEqual(["mw:GET", "mw:POST"]);
    });
  });

  describe("Bun.serve error callback", () => {
    /**
     * Force an error all the way out of `handleRequest`: the route throws, the
     * custom error handler throws while reporting it, and the top-level catch
     * calls that same handler again. Nothing is left to catch the second throw.
     */
    const mountEscapingError = (): void => {
      adapter.setErrorHandler(() => {
        throw new Error("error handler exploded");
      });
      adapter.get("/boom", () => {
        throw new Error("original failure");
      });
    };

    it("should answer with the adapter's JSON 500 rather than Bun's HTML error page", async () => {
      mountEscapingError();

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/boom`);

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({
        statusCode: 500,
        message: "Internal Server Error",
      });
    });

    it("should emit on the server wrapper when an error listener is attached", async () => {
      // EventEmitter throws on emit("error") with no listener, and that throw
      // would escape into Bun's own handler and replace the JSON 500 above.
      const observed: Error[] = [];
      adapter.getHttpServer().on("error", (error: Error) => {
        observed.push(error);
      });
      mountEscapingError();

      await adapter.listen(0);
      const response = await fetch(`${baseUrl()}/boom`);

      expect(response.status).toBe(500);
      expect(observed).toHaveLength(1);
      expect(observed[0]?.message).toBe("error handler exploded");
    });
  });
});
