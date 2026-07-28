import type { Server } from "bun";
import { AbstractHttpAdapter } from "@nestjs/core";
import {
  Logger,
  RequestMethod,
  VersioningType,
  VERSION_NEUTRAL,
  type NestApplicationOptions,
  type VersioningOptions,
} from "@nestjs/common";
import { EventEmitter } from "node:events";
import { constants as fsConstants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { posix as pathPosix } from "node:path";
import { Readable } from "node:stream";
import type { BunServerOptions } from "./interfaces";
import { setOwn } from "./utils/request";

type VersionValue = string | symbol | Array<string | symbol>;
import {
  createExpressRequest,
  createExpressResponse,
  type ExpressRequest,
  type ExpressResponse,
  type ExpressMiddleware,
  type ExpressErrorMiddleware,
} from "./express-compat";
import {
  createFastifyRequest,
  createFastifyReply,
  FastifyHooksManager,
  FastifyPluginRegistry,
  type FastifyPlugin,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
  type FastifyHookName,
  type FastifyOnRequestHook,
  type FastifyPreValidationHook,
  type FastifyPreHandlerHook,
  type FastifyPreSerializationHook,
  type FastifyOnSendHook,
  type FastifyOnErrorHook,
  type FastifyOnResponseHook,
  type FastifyRouteHandler,
} from "./fastify-compat";

/**
 * Routed through NestJS's logger rather than `console`, so these respect the
 * app's configured log level and structured formatting.
 */
const logger = new Logger("BunAdapter");

/**
 * Statuses that must not carry a body, per the Fetch spec.
 *
 * NOTE: duplicated verbatim in `src/express-compat.ts`, `src/fastify-compat.ts`
 * and `src/utils/response.ts`. Any change to the set must land in all four.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/**
 * Trailing wildcard in a middleware path: `/x*`, `/x/*`, `/x/(.*)`, `/x/{*splat}`.
 *
 * Module scope, not a literal inside `pathMatchesMiddleware`: that function runs
 * once per registered middleware per request, and a regex literal constructs a
 * fresh `RegExp` on every evaluation. Safe to share because the pattern carries
 * no `g`/`y` flag, so there is no `lastIndex` state to alias between calls.
 */
const MIDDLEWARE_WILDCARD_SUFFIX = /\/?(\*[^/]*|\(\.\*\)|\{\*[^}]*\})$/;

type RouteHandler = (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => unknown;
type RequestHandler = RouteHandler;

interface Route {
  path: string | RegExp;
  method: string;
  handler: RouteHandler;
  pathPattern: RegExp;
  paramNames: string[];
  /**
   * The exact pathnames `pathPattern` accepts, for a route with no parameters
   * and no trailing wildcard: the path itself, and the same path with the
   * optional trailing slash Express tolerates. Two string comparisons then stand
   * in for a regex execution. `null` when the route genuinely needs the regex.
   */
  staticPaths: readonly [string, string] | null;
}

/**
 * The Fastify-compatible request/reply pair for one in-flight request.
 *
 * Built only when the application has actually touched the Fastify surface -
 * i.e. when a hook, plugin or decorator is registered; `undefined` everywhere
 * else, which is what lets the hot path skip two object constructions and the
 * decorator passes. See the `fastifyCtx` accessor in `handleRequest`.
 */
interface FastifyContext {
  req: FastifyRequest;
  reply: FastifyReply;
}

interface MiddlewareEntry {
  path: string;
  handler: ExpressMiddleware;
  /** Path is already fully qualified; do not prepend the global prefix. */
  absolute?: boolean;
  /**
   * Memoised `buildPath(path)`. A pure function of `path` and the global
   * prefix, both fixed by the time requests flow, and `buildPath` allocates a
   * template string plus (with a prefix set) a `RegExp` on every call - which
   * would otherwise run per middleware per request. Invalidated in {@link
   * BunAdapter.setGlobalPrefix}, the only thing that can change the result.
   */
  resolvedPath?: string;
}

interface ErrorMiddlewareEntry {
  path: string;
  handler: ExpressErrorMiddleware;
}

/**
 * Wrapper that provides EventEmitter interface for Bun server
 * Required for NestJS compatibility
 */
class BunServerWrapper extends EventEmitter {
  private _server: Server<unknown> | null = null;
  public listening = false;

  public get server(): Server<unknown> | null {
    return this._server;
  }

  public set server(value: Server<unknown> | null) {
    this._server = value;
    if (value) {
      this.listening = true;
      this.emit("listening");
    }
  }

  public address(): { port: number; address: string } | null {
    if (!this._server) return null;
    return {
      port: this._server.port ?? 0,
      address: this._server.hostname ?? "0.0.0.0",
    };
  }

  /**
   * Stop the server, draining in-flight requests.
   *
   * `stop(true)` severs live sockets, which drops responses for requests whose
   * handler already completed - on a rolling deploy that makes clients retry
   * non-idempotent mutations. Drain first, and only force after the deadline.
   * State is reset in `finally` so a failed stop cannot leave the wrapper
   * claiming to be listening with no handle to retry through.
   *
   * The deadline is an explicitly-cleared timer rather than `Bun.sleep`:
   * `Promise.race` does not cancel the loser, so a sleep that loses the race
   * stays armed and keeps the event loop referenced for the full drain window.
   */
  public async close(callback?: () => void, drainTimeoutMs = 10_000): Promise<void> {
    const server = this._server;
    if (server) {
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        drainTimer = setTimeout(resolve, drainTimeoutMs);
      });
      try {
        await Promise.race([server.stop(), deadline]);
        // No-op if the graceful stop already completed.
        await server.stop(true);
      } finally {
        clearTimeout(drainTimer);
        this._server = null;
        this.listening = false;
      }
    }
    if (callback) callback();
    this.emit("close");
  }
}

/**
 * NestJS HTTP adapter for Bun runtime
 *
 * This adapter maps Bun's native HTTP server to the NestJS HTTP abstraction,
 * allowing NestJS applications to run natively on Bun without Express or Fastify.
 *
 * Features full Express and Fastify middleware compatibility.
 */
export class BunAdapter extends AbstractHttpAdapter<BunServerWrapper, Request, Response> {
  private routes: Route[] = [];

  /**
   * Method-bucketed view of {@link routes}, rebuilt lazily after any change.
   * `null` means "stale"; see {@link routeBucketFor}.
   */
  private routeIndex: { byMethod: Map<string, readonly Route[]>; fallback: readonly Route[] } | null = null;

  private middlewares: MiddlewareEntry[] = [];
  private errorMiddlewares: ErrorMiddlewareEntry[] = [];
  private globalPrefix = "";
  private serverWrapper: BunServerWrapper = new BunServerWrapper();
  private serverOptions: BunServerOptions = {};
  private appOptions: NestApplicationOptions = {};
  private captureRawBody = false;

  /**
   * How long a single Express middleware may run without calling `next()` or
   * ending the response before the request is failed. Express itself waits
   * forever; a bounded wait keeps a buggy middleware from leaking connections.
   */
  private middlewareTimeout = 30_000;

  // Fastify compatibility
  private fastifyHooks: FastifyHooksManager = new FastifyHooksManager();
  private fastifyPlugins: FastifyPluginRegistry = new FastifyPluginRegistry();
  private fastifyInitialized = false;

  private notFoundHandler?: RouteHandler;
  private errorHandler?: (error: Error, req: ExpressRequest, res: ExpressResponse) => void;

  /** True when the caller supplied their own Bun server for us to serve through. */
  private usingExternalServer = false;

  constructor(instance?: Server<unknown>, serverOptions?: BunServerOptions) {
    super();
    if (serverOptions) {
      this.setServerOptions(serverOptions);
    }
    if (instance) {
      this.serverWrapper.server = instance;
      this.usingExternalServer = true;
    }
    this.setInstance(this.serverWrapper);
  }

  /**
   * Merge Bun-specific server options. Options supplied here are applied when
   * the server starts; explicit `listen()` arguments still win for host/port.
   */
  public setServerOptions(options: BunServerOptions): void {
    this.serverOptions = { ...this.serverOptions, ...options };

    // `trustProxy` is typed `boolean`, but this is a security control and the
    // type is not the only way in: JS callers, `JSON.parse`d config and
    // env-derived values all reach here unchecked. Express's numeric hop count
    // is the likely mistake, and the only thing this adapter could do with a
    // number is degrade it to "trust the left-most entry" - precisely the
    // spoofing a hop count exists to prevent. Fail at bootstrap instead.
    if (options.trustProxy !== undefined && typeof options.trustProxy !== "boolean") {
      throw new TypeError(
        "serverOptions.trustProxy must be a boolean. The numeric hop-count form is not " +
          "implemented by the compat layers; call getIp(req.raw, { trustProxy: n, server }) " +
          "directly if you need one."
      );
    }

    if (options.middlewareTimeout !== undefined) {
      const ms = options.middlewareTimeout;
      if (!Number.isFinite(ms) || ms < 0) {
        throw new Error("middlewareTimeout must be a non-negative finite number (0 disables the timeout)");
      }
      // 0 means "no timeout", matching the Node/Express convention.
      this.middlewareTimeout = ms;
      // Fastify hooks are bounded by the same budget; without it a hook that
      // declares `done` and never calls it hangs the request forever.
      this.fastifyHooks.setHookTimeout(ms);
    }
  }

  /**
   * Convert a path pattern to a RegExp and extract parameter names.
   *
   * For a path holding no `:param` and no trailing `*` the result is
   * `^<escaped path>/?$` - it accepts exactly two pathnames, `path` and
   * `path + "/"`, and nothing else. {@link addRoute}'s `staticPaths` fast path
   * is derived from that guarantee, so the two must change together: widening
   * what this pattern accepts without widening `staticPaths` would make the
   * string comparison reject requests the regex would have matched.
   */
  private pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];

    // Normalize path
    let normalizedPath = path.startsWith("/") ? path : `/${path}`;

    let trailingWildcard = false;
    if (normalizedPath.endsWith("*")) {
      normalizedPath = normalizedPath.slice(0, -1);
      trailingWildcard = true;
    }

    // Build the pattern segment by segment so literal text is escaped.
    // Interpolating the raw path would make regex metacharacters live: "/a.txt"
    // would also match "/aXtxt", and a path containing "(" would throw.
    let regexPath = "";
    let lastIndex = 0;
    const paramPattern = /:([a-zA-Z0-9_]+)/g;
    let match: RegExpExecArray | null;

    while ((match = paramPattern.exec(normalizedPath)) !== null) {
      regexPath += BunAdapter.escapeRegex(normalizedPath.slice(lastIndex, match.index));
      paramNames.push(match[1]);
      regexPath += "([^/]+)";
      lastIndex = match.index + match[0].length;
    }
    regexPath += BunAdapter.escapeRegex(normalizedPath.slice(lastIndex));

    if (trailingWildcard) {
      regexPath += "(.*)";
    }

    // Tolerate an optional trailing slash, as Express does.
    return {
      pattern: new RegExp(`^${regexPath}/?$`),
      paramNames,
    };
  }

  private static escapeRegex(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Decode a captured route parameter. Express/Fastify hand handlers decoded
   * values; a malformed escape must not crash the request.
   */
  private static decodeParam(value: string): string {
    if (!value.includes("%")) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  /**
   * Build the full path including global prefix
   */
  private buildPath(path: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (this.globalPrefix) {
      const prefix = this.globalPrefix.startsWith("/") ? this.globalPrefix : `/${this.globalPrefix}`;
      return `${prefix}${normalizedPath}`.replace(/\/+/g, "/");
    }
    return normalizedPath;
  }

  /**
   * Check whether a request path matches a registered middleware path.
   *
   * This must understand the forms NestJS emits from `forRoutes()`, not just
   * literal prefixes: `/*`, `/{*path}` and `/(.*)` are wildcards, and a
   * trailing `$` anchors an exact match (NestJS uses `<prefix>$` for the
   * global-prefix root entry). Plain prefix matching silently skipped every
   * `forRoutes('*')` middleware, which meant global auth middleware never ran.
   */
  private pathMatchesMiddleware(requestPath: string, middlewarePath: string): boolean {
    if (middlewarePath === "/" || middlewarePath === "" || middlewarePath === "*") {
      return true;
    }

    const normalized = middlewarePath.startsWith("/") ? middlewarePath : `/${middlewarePath}`;

    // "<prefix>$" means exactly <prefix>.
    if (normalized.endsWith("$")) {
      return requestPath === normalized.slice(0, -1);
    }

    if (MIDDLEWARE_WILDCARD_SUFFIX.test(normalized)) {
      const base = normalized.replace(MIDDLEWARE_WILDCARD_SUFFIX, "");
      return base === "" || requestPath === base || requestPath.startsWith(`${base}/`);
    }

    return requestPath === normalized || requestPath.startsWith(`${normalized}/`);
  }

  /**
   * Register a route handler
   */
  private addRoute(method: string, path: string, handler: RouteHandler): void {
    const fullPath = this.buildPath(path);
    const { pattern, paramNames } = this.pathToRegex(fullPath);

    // With no `:param` and no trailing `*`, `pathToRegex` anchors the escaped
    // literal with an optional trailing slash - so exactly these two pathnames
    // match, and nothing else can. (It also prepends a leading `/` when one is
    // missing, which is inert here only because `buildPath` already guarantees
    // one; `fullPath` and the pattern therefore describe the same string.)
    const staticPaths: readonly [string, string] | null =
      paramNames.length === 0 && !fullPath.endsWith("*") ? [fullPath, `${fullPath}/`] : null;

    this.routes.push({
      path: fullPath,
      method: method.toUpperCase(),
      handler,
      pathPattern: pattern,
      paramNames,
      staticPaths,
    });

    this.routeIndex = null;
  }

  /**
   * The routes that can serve `method`, in registration order.
   *
   * Built once and reused so the request path neither rescans every registered
   * route nor re-derives method compatibility per request. Order is registration
   * order, because that is the order a handler calling `next()` falls through
   * in.
   *
   * The bucket key space is bounded by the methods actually registered (plus
   * `HEAD` whenever a `GET` route exists, since Express serves HEAD from the
   * matching GET handler). A client cannot grow the map by inventing verbs:
   * anything unregistered falls back to the `all()` routes, which are the only
   * ones that could have matched it anyway.
   */
  private routeBucketFor(method: string): readonly Route[] {
    let index = this.routeIndex;

    if (index === null) {
      const methods = new Set<string>();
      for (const route of this.routes) {
        if (route.method !== "ALL") methods.add(route.method);
        if (route.method === "GET") methods.add("HEAD");
      }

      const byMethod = new Map<string, readonly Route[]>();
      for (const registered of methods) {
        byMethod.set(
          registered,
          this.routes.filter(
            (route) =>
              route.method === registered ||
              route.method === "ALL" ||
              (registered === "HEAD" && route.method === "GET")
          )
        );
      }

      index = { byMethod, fallback: this.routes.filter((route) => route.method === "ALL") };
      this.routeIndex = index;
    }

    return index.byMethod.get(method) ?? index.fallback;
  }

  /**
   * Parse the request body according to its declared Content-Type.
   *
   * Returns `undefined` for two distinct situations, which the return value
   * cannot tell apart: no branch claimed the content type (so there was nothing
   * to parse), and a claimed branch threw (so a body that *was* declared could
   * not be read). Both surface to the handler as `req.body === undefined`.
   */
  private async parseRequestBody(bunRequest: Request, contentType: string): Promise<unknown> {
    // One `try` around the dispatch rather than one per branch: exactly one
    // branch can run per call, every branch swallowed to `undefined` anyway,
    // and nothing outside them can throw.
    try {
      if (contentType.includes("application/json")) {
        return await bunRequest.json();
      }

      if (contentType.includes("application/x-www-form-urlencoded")) {
        const body: Record<string, string> = {};
        new URLSearchParams(await bunRequest.text()).forEach((value, key) => {
          setOwn(body, key, value);
        });
        return body;
      }

      if (contentType.includes("multipart/form-data")) {
        const body: Record<string, unknown> = {};
        (await bunRequest.formData()).forEach((value, key) => {
          setOwn(body, key, value);
        });
        return body;
      }

      if (contentType.includes("text/")) {
        return await bunRequest.text();
      }
    } catch {
      // A declared body that cannot be read surfaces as `req.body === undefined`.
      return undefined;
    }

    return undefined;
  }

  /**
   * Execute middleware chain
   */
  private async executeMiddlewareChain(
    req: ExpressRequest,
    res: ExpressResponse,
    pathname: string
  ): Promise<{ error?: unknown; completed: boolean }> {
    const middlewares = this.middlewares;
    for (let i = 0; i < middlewares.length; i++) {
      const middleware = middlewares[i];
      const middlewarePath = middleware.absolute
        ? middleware.path
        : (middleware.resolvedPath ??= this.buildPath(middleware.path));

      if (!this.pathMatchesMiddleware(pathname, middlewarePath)) {
        continue;
      }

      const outcome = await this.runMiddleware(middleware.handler, req, res);

      if (outcome.kind === "error") {
        return { error: outcome.error, completed: false };
      }

      // Response was ended by this middleware - stop the chain
      if (outcome.kind === "ended" || res._ended) {
        return { completed: true };
      }
    }

    return { completed: false };
  }

  /**
   * Run a single Express middleware and wait for it to signal completion.
   *
   * Express middleware signals via `next()` or by ending the response, and may
   * do so from a later tick (an IO callback, a timer). Treating the return
   * value as the signal breaks any callback-style middleware, so this waits for
   * a real signal and falls back to `middlewareTimeout` rather than hanging.
   */
  private runMiddleware(
    handler: ExpressMiddleware,
    req: ExpressRequest,
    res: ExpressResponse
  ): Promise<{ kind: "next" | "ended" } | { kind: "error"; error: unknown }> {
    return new Promise((resolve) => {
      let settled = false;
      const pending: { timer?: ReturnType<typeof setTimeout> } = {};

      const finish = (outcome: { kind: "next" | "ended" } | { kind: "error"; error: unknown }) => {
        if (settled) return;
        settled = true;
        if (pending.timer) clearTimeout(pending.timer);
        resolve(outcome);
      };

      const next = (err?: unknown) => {
        if (err !== undefined && err !== null) {
          finish({ kind: "error", error: err });
        } else {
          finish({ kind: "next" });
        }
      };

      let returned: unknown;
      try {
        returned = handler(req, res, next);
      } catch (err) {
        finish({ kind: "error", error: err });
        return;
      }

      // A synchronous middleware that called `next()` has already settled by
      // now, so both callbacks below would be no-ops - but attaching them still
      // costs two promise allocations and a microtask turn per middleware, per
      // request. Only the rejection still needs consuming, so it does not
      // surface as an unhandled rejection.
      if (settled) {
        if (returned !== undefined && returned !== null) {
          Promise.resolve(returned).catch(() => {});
        }
        return;
      }

      Promise.resolve(returned).then(
        () => {
          if (res._ended) finish({ kind: "ended" });
        },
        (err) => finish({ kind: "error", error: err })
      );

      // The middleware returned without signalling yet. Subscribe to the
      // response's own end notification rather than polling for it - a 5ms
      // interval per in-flight middleware is a DoS amplifier under load and
      // adds latency jitter.
      res._onEnd(() => finish({ kind: "ended" }));

      if (settled || this.middlewareTimeout === 0) return;

      pending.timer = setTimeout(() => {
        finish({
          kind: "error",
          error: new Error(
            `Middleware timed out after ${this.middlewareTimeout}ms without calling next() or ending the response`
          ),
        });
      }, this.middlewareTimeout);
    });
  }

  /**
   * Execute error middleware chain
   */
  private async executeErrorMiddlewareChain(
    error: unknown,
    req: ExpressRequest,
    res: ExpressResponse,
    pathname: string
  ): Promise<boolean> {
    for (const middleware of this.errorMiddlewares) {
      const middlewarePath = this.buildPath(middleware.path);

      if (!this.pathMatchesMiddleware(pathname, middlewarePath)) {
        continue;
      }

      let nextCalled = false;
      let nextError: unknown = undefined;

      const next = (err?: unknown) => {
        nextCalled = true;
        if (err) {
          nextError = err;
        }
      };

      try {
        await middleware.handler(error, req, res, next);
      } catch (handlerError) {
        // Express forwards a throw inside an error handler to the next one as
        // the new error. Swallowing it hides the handler's own bug and leaves
        // the original error propagating with misleading context.
        logger.error("Error thrown by error-handling middleware:", handlerError);
        error = handlerError;
        continue;
      }

      // If response was ended, we're done
      if (res._ended) {
        return true;
      }

      // If next was called with an error, continue to next error handler
      if (nextError) {
        error = nextError;
        continue;
      }

      // Calling next() is delegation, not handling: Express passes control on
      // to the next error handler and ultimately to finalhandler, which still
      // emits a status. Treating a bare next() as "handled" turned a log-only
      // error handler into an empty HTTP 200.
      if (nextCalled) {
        continue;
      }

      // The handler neither responded nor delegated. It has NOT handled the
      // error - reporting otherwise turns a 500 into an empty 200.
      return false;
    }

    return false;
  }

  /**
   * Main request handler that routes incoming requests
   */
  private async handleRequest(bunRequest: Request): Promise<Response> {
    const url = new URL(bunRequest.url);
    const pathname = url.pathname;
    const method = bunRequest.method.toUpperCase();

    // Collect every matching route, not just the first: a handler may call
    // next() to defer to the next match. Method compatibility is resolved by the
    // bucket, so only paths are tested here. A route with no parameters answers
    // with two string comparisons instead of a regex execution; only the rest
    // pay for `RegExp.exec`.
    const candidates: Array<{ route: Route; params: Record<string, string> }> = [];
    for (const route of this.routeBucketFor(method)) {
      const staticPaths = route.staticPaths;
      if (staticPaths !== null) {
        if (pathname === staticPaths[0] || pathname === staticPaths[1]) {
          candidates.push({ route, params: {} });
        }
        continue;
      }

      const match = pathname.match(route.pathPattern);
      if (!match) continue;

      const routeParams: Record<string, string> = {};
      const paramNames = route.paramNames;
      for (let i = 0; i < paramNames.length; i++) {
        routeParams[paramNames[i]] = BunAdapter.decodeParam(match[i + 1]);
      }
      candidates.push({ route, params: routeParams });
    }

    let candidateIndex = 0;
    const firstCandidate = candidates[0];
    let matchedRoute: Route | undefined = firstCandidate?.route;
    // Adopted rather than copied: the first candidate's params object is never
    // read again, and this object is mutated in place on fall-through anyway.
    const params: Record<string, string> = firstCandidate?.params ?? {};

    // Create Express-compatible request and response.
    //
    // `=== true`, not a truthy test: anything else - including a value that
    // reached `serverOptions` without passing through `setServerOptions` - means
    // "do not trust proxy headers". Do not loosen this.
    const trustProxy = this.serverOptions.trustProxy === true;
    const remoteAddress = this.serverWrapper.server?.requestIP(bunRequest)?.address;

    // `url` is threaded into both compat layers: each would otherwise re-parse
    // the same request URL, so a single request paid for two or three
    // `new URL()` constructions.
    const req = createExpressRequest(bunRequest, params, trustProxy, remoteAddress, url);
    // Pass the request so `res.req` is populated for middleware that pairs the
    // two (error handlers, loggers).
    const res = createExpressResponse(req);

    // Parse body. When rawBody was requested (NestJS `rawBody: true`), clone
    // first so the untouched bytes survive alongside the parsed value -
    // signature verification for webhooks needs the exact payload.
    let rawBody: Buffer | undefined;
    if (this.captureRawBody && bunRequest.body) {
      try {
        rawBody = Buffer.from(await bunRequest.clone().arrayBuffer());
        (req as ExpressRequest & { rawBody?: Buffer }).rawBody = rawBody;
      } catch {
        // A body that cannot be re-read is not fatal; parsing still proceeds.
      }
    }

    // `parseRequestBody` dispatches purely on the Content-Type header, so a
    // request that declares none (every plain GET) can skip the call - and the
    // extra await - outright: with no content type there is nothing to dispatch
    // on and the result would be `undefined`. That is not the same as the
    // `undefined` the function returns when a *declared* body fails to parse -
    // that case still runs, and still reports the failure as a missing body.
    // The header is read once here and handed down; an incoming request's
    // headers are immutable, so a second read could only return the same value.
    const contentType = bunRequest.headers.get("content-type");
    req.body = contentType ? await this.parseRequestBody(bunRequest, contentType) : undefined;

    // The Fastify-compatible request/reply pair, built on first use.
    //
    // With no hook, plugin or decorator registered the pair is unobservable and
    // every hook stage below is a no-op, so a plain NestJS app skips two object
    // constructions and both decorator passes. The predicate is re-read at each
    // gate rather than sampled once at entry: hooks run after body parsing and
    // after the whole Express middleware chain, so a hook registered during that
    // window - by a middleware, by the route handler, or simply by another
    // request in flight - must still apply to this request. Sampling once turned
    // a late-registered `onRequest` auth hook into a silent bypass.
    const entryRoute = matchedRoute;
    let fastify: FastifyContext | undefined;
    const fastifyCtx = (): FastifyContext | undefined => {
      if (!(this.fastifyHooks.hasHooks() || this.fastifyPlugins.hasAny())) return undefined;
      if (fastify === undefined) {
        const fastifyReq = createFastifyRequest(bunRequest, params, undefined, {
          // routerPath must be the matched pattern ("/users/:id"), not the
          // concrete path, or per-route metrics get one series per id. The
          // route matched at entry is reported even if the context is built
          // later, so the value does not depend on when the pair was needed.
          routePattern: typeof entryRoute?.path === "string" ? entryRoute.path : undefined,
          trustProxy,
          remoteAddress,
          parsedUrl: url,
        });
        const fastifyReply = createFastifyReply(fastifyReq);

        // Apply Fastify decorators
        this.fastifyPlugins.applyRequestDecorators(fastifyReq);
        this.fastifyPlugins.applyReplyDecorators(fastifyReply);

        if (rawBody !== undefined) {
          (fastifyReq as { rawBody?: Buffer }).rawBody = rawBody;
        }
        fastifyReq.body = req.body;

        fastify = { req: fastifyReq, reply: fastifyReply };
      }
      return fastify;
    };

    try {
      // Execute Fastify onRequest hooks
      const onRequestCtx = fastifyCtx();
      if (onRequestCtx) {
        const shortCircuit = await this.runHookStage(onRequestCtx, (request, reply) =>
          this.fastifyHooks.executeOnRequest(request, reply)
        );
        if (shortCircuit) return shortCircuit;
      }

      // Execute Express middleware chain. An empty chain is the common case for
      // an app with no `configure(consumer)`, and walking it costs an extra
      // await for a result that is fixed.
      const middlewareResult: { error?: unknown; completed: boolean } =
        this.middlewares.length > 0
          ? await this.executeMiddlewareChain(req, res, pathname)
          : { completed: false };

      // If middleware returned an error, handle it
      if (middlewareResult.error) {
        return this.handleRequestError(middlewareResult.error, req, res, pathname, fastifyCtx);
      }

      // If middleware ended the response, return it
      if (middlewareResult.completed || res._ended) {
        const endedCtx = fastifyCtx();
        const endedResponse = res._buildResponse();
        return endedCtx ? this.finalize(endedCtx, endedResponse) : endedResponse;
      }

      // Execute Fastify preValidation then preHandler hooks. These run in
      // Fastify's order - onRequest -> preValidation -> preHandler -> handler -
      // and the body has already been parsed by this point.
      const preHandlerCtx = fastifyCtx();
      if (preHandlerCtx) {
        const preValidation = await this.runHookStage(preHandlerCtx, (request, reply) =>
          this.fastifyHooks.executePreValidation(request, reply)
        );
        if (preValidation) return preValidation;

        const preHandler = await this.runHookStage(preHandlerCtx, (request, reply) =>
          this.fastifyHooks.executePreHandler(request, reply)
        );
        if (preHandler) return preHandler;
      }

      // Execute route handler
      while (matchedRoute) {
        let nextCalled = false;
        let nextError: unknown = undefined;

        const next = (err?: unknown) => {
          nextCalled = true;
          if (err) {
            nextError = err;
          }
        };

        try {
          const handlerResult = await matchedRoute.handler(req, res, next);

          // If next was called with an error, handle it
          if (nextError) {
            return this.handleRequestError(nextError, req, res, pathname, fastifyCtx);
          }

          // The handler declined with next(): advance to the next matching
          // route, or fall through to the not-found path when none remain.
          // Previously this flag was ignored, so declining produced an empty 200.
          if (nextCalled && !res._ended && (handlerResult === undefined || handlerResult === null)) {
            candidateIndex += 1;
            const nextCandidate = candidates[candidateIndex];
            if (nextCandidate) {
              matchedRoute = nextCandidate.route;
              for (const key of Object.keys(params)) delete params[key];
              Object.assign(params, nextCandidate.params);
              req.params = params;
              continue;
            }
            matchedRoute = undefined;
            break;
          }

          // If handler returned a value and response not ended, use it
          if (!res._ended && handlerResult !== undefined && handlerResult !== null) {
            if (handlerResult instanceof Response) {
              // A handler-supplied Response bypasses the Express response, so
              // its status has to be published onto the reply before onResponse
              // observers read it - hence `finalize`, which returns the response
              // unchanged, rather than executeOnResponse directly.
              const responseCtx = fastifyCtx();
              return responseCtx ? this.finalize(responseCtx, handlerResult) : handlerResult;
            }
            res.send(handlerResult);
          }

          // With no Fastify surface in use there is nothing to transform the
          // payload or observe the response, and preSerialization/onSend/
          // onResponse would each return the payload untouched. Build and go.
          const fx = fastifyCtx();
          if (!fx) {
            return res._buildResponse();
          }

          // Execute Fastify onSend hooks
          const originalBody = res._body;

          // preSerialization runs before onSend and may transform the payload.
          let payload: unknown = originalBody;
          const preSerialization = await this.fastifyHooks.executePreSerialization(fx.req, fx.reply, payload);
          if (preSerialization.error) {
            const errorHandled = await this.fastifyHooks.executeOnError(fx.req, fx.reply, preSerialization.error);
            if (errorHandled) {
              return this.finalize(fx, fx.reply._buildResponse());
            }
            // The response is already sent, so res.json() would silently no-op
            // and ship the SUCCESS body under a 500. Build the failure directly.
            logger.error("preSerialization hook failed:", preSerialization.error);
            return this.finalize(fx, BunAdapter.errorResponse(500));
          }
          payload = preSerialization.payload;

          const onSendResult = await this.fastifyHooks.executeOnSend(fx.req, fx.reply, payload);
          if (onSendResult.error) {
            const errorHandled = await this.fastifyHooks.executeOnError(fx.req, fx.reply, onSendResult.error);
            if (errorHandled) {
              return this.finalize(fx, fx.reply._buildResponse());
            }
            // Same hazard as above - and worse here, since an onSend hook is
            // typically what redacts the payload it just failed to transform.
            logger.error("onSend hook failed:", onSendResult.error);
            return this.finalize(fx, BunAdapter.errorResponse(500));
          }

          let response = res._buildResponse();

          // An onSend hook may rewrite the payload. Applying it to the built
          // Response avoids reaching into the Express response's internals.
          if (onSendResult.payload !== originalBody) {
            response = BunAdapter.withPayload(response, onSendResult.payload);
          }

          return this.finalize(fx, response);
        } catch (error) {
          return this.handleRequestError(error, req, res, pathname, fastifyCtx);
        }
      }

      // No route matched. The not-found response still runs through the reply
      // lifecycle so onSend/onResponse hooks - access logs, metrics - observe
      // it. Skipping them here silently dropped every 404 from those hooks.
      const notFoundCtx = fastifyCtx();
      if (notFoundCtx) {
        notFoundCtx.req.is404 = true;
      }

      let notFoundResponse: Response;
      // Track the body the hooks should actually see. The default 404 is built
      // directly into the Response, so res._body stays null - passing that to
      // onSend meant a hook that transforms the payload (redaction, envelope
      // wrapping) operated on null and could never rewrite the real body.
      let notFoundBody: unknown;
      if (this.notFoundHandler) {
        await this.notFoundHandler(req, res, () => {});
        notFoundResponse = res._buildResponse();
        notFoundBody = res._body;
      } else {
        notFoundBody = JSON.stringify({ statusCode: 404, message: "Not Found" });
        notFoundResponse = new Response(notFoundBody as string, {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // No Fastify surface in use: no onSend hook can rewrite the payload and no
      // onResponse hook can observe it, so the response is already final.
      if (!notFoundCtx) {
        return notFoundResponse;
      }

      const notFoundSend = await this.fastifyHooks.executeOnSend(
        notFoundCtx.req,
        notFoundCtx.reply,
        notFoundBody
      );
      if (notFoundSend.error) {
        // Every other executeOnSend call site routes its error; this one used to
        // discard it, so a hook that threw on 404s failed invisibly.
        const errorHandled = await this.fastifyHooks.executeOnError(
          notFoundCtx.req,
          notFoundCtx.reply,
          notFoundSend.error
        );
        if (errorHandled) {
          return this.finalize(notFoundCtx, notFoundCtx.reply._buildResponse());
        }
        logger.error("onSend hook failed on the not-found path:", notFoundSend.error);
      } else if (notFoundSend.payload !== notFoundBody) {
        notFoundResponse = BunAdapter.withPayload(notFoundResponse, notFoundSend.payload);
      }

      return this.finalize(notFoundCtx, notFoundResponse);
    } catch (error) {
      // Top-level error handling. This is the one exit that does NOT route
      // through `finalize`: reaching it means the lifecycle itself threw -
      // plausibly from inside `finalize` - so running onResponse again here
      // could double-report a request that was already observed.
      if (this.errorHandler) {
        this.errorHandler(error as Error, req, res);
        return res._buildResponse();
      }

      return BunAdapter.errorResponse(
        500,
        error instanceof Error ? error.message : "Internal Server Error"
      );
    }
  }

  /**
   * Run one short-circuiting Fastify hook stage - `onRequest`, `preValidation`
   * or `preHandler`.
   *
   * Returns the response to send when the stage ended the request (a hook
   * failed, or a hook replied), or `undefined` to carry on. Both endings are
   * routed through {@link finalize} so onResponse observers see them.
   */
  private async runHookStage(
    fx: FastifyContext,
    execute: (request: FastifyRequest, reply: FastifyReply) => Promise<Error | undefined>
  ): Promise<Response | undefined> {
    const hookError = await execute(fx.req, fx.reply);

    if (hookError) {
      const errorHandled = await this.fastifyHooks.executeOnError(fx.req, fx.reply, hookError);
      if (!errorHandled) {
        fx.reply.code(500).send({
          statusCode: 500,
          error: "Internal Server Error",
          message: "Internal Server Error",
        });
      }
      return this.finalize(fx, fx.reply._buildResponse());
    }

    // A hook that replied short-circuits the rest of the request.
    if (fx.reply.sent) {
      return this.finalize(fx, fx.reply._buildResponse());
    }

    return undefined;
  }

  /**
   * Common tail for a failure raised by an Express middleware or a route
   * handler: Express error middleware first, then Fastify `onError`, then the
   * configured error handler, then the default 500.
   *
   * The result is routed through {@link finalize} so an onResponse observer -
   * an access log, a latency histogram - records the failure rather than
   * silently missing every 500.
   */
  private async handleRequestError(
    error: unknown,
    req: ExpressRequest,
    res: ExpressResponse,
    pathname: string,
    fastifyCtx: () => FastifyContext | undefined
  ): Promise<Response> {
    const errorHandled = await this.executeErrorMiddlewareChain(error, req, res, pathname);

    if (!errorHandled) {
      // Try Fastify error hooks
      const fx = fastifyCtx();
      if (fx) {
        const fastifyErrorHandled = await this.fastifyHooks.executeOnError(
          fx.req,
          fx.reply,
          error instanceof Error ? error : new Error(String(error))
        );
        if (fastifyErrorHandled) {
          return this.finalize(fx, fx.reply._buildResponse());
        }
      }
      if (this.errorHandler) {
        this.errorHandler(error as Error, req, res);
      } else {
        res.status(500).json({
          statusCode: 500,
          message: error instanceof Error ? error.message : "Internal Server Error",
        });
      }
    }

    const observer = fastifyCtx();
    const response = res._buildResponse();
    return observer ? this.finalize(observer, response) : response;
  }

  // ==================== HTTP Method Handlers ====================

  public get(handler: RequestHandler): void;
  public get(path: string, handler: RequestHandler): void;
  public get(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("GET", pathOrHandler, handler);
  }

  public post(handler: RequestHandler): void;
  public post(path: string, handler: RequestHandler): void;
  public post(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("POST", pathOrHandler, handler);
  }

  public put(handler: RequestHandler): void;
  public put(path: string, handler: RequestHandler): void;
  public put(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("PUT", pathOrHandler, handler);
  }

  public delete(handler: RequestHandler): void;
  public delete(path: string, handler: RequestHandler): void;
  public delete(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("DELETE", pathOrHandler, handler);
  }

  public patch(handler: RequestHandler): void;
  public patch(path: string, handler: RequestHandler): void;
  public patch(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("PATCH", pathOrHandler, handler);
  }

  public options(handler: RequestHandler): void;
  public options(path: string, handler: RequestHandler): void;
  public options(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("OPTIONS", pathOrHandler, handler);
  }

  public head(handler: RequestHandler): void;
  public head(path: string, handler: RequestHandler): void;
  public head(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("HEAD", pathOrHandler, handler);
  }

  public all(handler: RequestHandler): void;
  public all(path: string, handler: RequestHandler): void;
  public all(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("ALL", pathOrHandler, handler);
  }

  /**
   * Shared body for every verb method: a lone function argument means the
   * root path, otherwise the first argument is the path.
   *
   * Every verb - including the extended ones (@Search, @Propfind, ...) - must
   * exist as its own method. NestJS's RouterMethodFactory resolves a decorator
   * to `adapter[verb]` and only falls back to `use` when the method is ABSENT,
   * and inheriting AbstractHttpAdapter's implementations would forward to
   * `this.instance[verb]`, which the Bun server wrapper does not have - a
   * TypeError at bootstrap.
   */
  private registerVerb(
    method: string,
    pathOrHandler: string | RequestHandler,
    handler?: RequestHandler
  ): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute(method, "/", pathOrHandler);
    } else {
      this.addRoute(method, pathOrHandler, handler!);
    }
  }

  public search(handler: RequestHandler): void;
  public search(path: string, handler: RequestHandler): void;
  public search(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("SEARCH", pathOrHandler, handler);
  }

  public propfind(handler: RequestHandler): void;
  public propfind(path: string, handler: RequestHandler): void;
  public propfind(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("PROPFIND", pathOrHandler, handler);
  }

  public proppatch(handler: RequestHandler): void;
  public proppatch(path: string, handler: RequestHandler): void;
  public proppatch(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("PROPPATCH", pathOrHandler, handler);
  }

  public mkcol(handler: RequestHandler): void;
  public mkcol(path: string, handler: RequestHandler): void;
  public mkcol(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("MKCOL", pathOrHandler, handler);
  }

  public copy(handler: RequestHandler): void;
  public copy(path: string, handler: RequestHandler): void;
  public copy(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("COPY", pathOrHandler, handler);
  }

  public move(handler: RequestHandler): void;
  public move(path: string, handler: RequestHandler): void;
  public move(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("MOVE", pathOrHandler, handler);
  }

  public lock(handler: RequestHandler): void;
  public lock(path: string, handler: RequestHandler): void;
  public lock(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("LOCK", pathOrHandler, handler);
  }

  public unlock(handler: RequestHandler): void;
  public unlock(path: string, handler: RequestHandler): void;
  public unlock(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerVerb("UNLOCK", pathOrHandler, handler);
  }

  // ==================== Server Lifecycle ====================

  public async listen(port: string | number, callback?: () => void): Promise<void>;
  public async listen(port: string | number, hostname: string, callback?: () => void): Promise<void>;
  public async listen(
    port: string | number,
    hostnameOrCallback?: string | (() => void),
    callback?: () => void
  ): Promise<void> {
    const numericPort = typeof port === "string" ? parseInt(port, 10) : port;
    const hostname = typeof hostnameOrCallback === "string" ? hostnameOrCallback : "0.0.0.0";
    const cb = typeof hostnameOrCallback === "function" ? hostnameOrCallback : callback;

    // Initialize Fastify plugins before starting server
    await this.initializeFastifyPlugins();

    // Errors that escape `handleRequest` land here - including a static asset
    // that vanishes between the existence check and the streamed read, which
    // Bun raises at serialize time rather than inside the handler.
    const onServerError = (error: Error): Response => {
      // EventEmitter throws on emit("error") when nothing is listening, and
      // NestJS removes its listener after a successful listen. That throw
      // would escape into Bun's own handler and replace this JSON 500 with
      // Bun's HTML error page, losing the original error.
      if (this.serverWrapper.listenerCount("error") > 0) {
        this.serverWrapper.emit("error", error);
      } else {
        logger.error("Unhandled adapter error:", error);
      }
      return BunAdapter.errorResponse(500);
    };

    // When the caller supplied a server, re-point it at this application rather
    // than starting a second one. The error handler goes with it: without one a
    // caller-supplied server falls back to Bun's default handling, so the same
    // failure is an unlogged HTML error page there and a logged JSON 500 here.
    const existing = this.serverWrapper.server;
    if (this.usingExternalServer && existing) {
      existing.reload({
        fetch: (req: Request) => this.handleRequest(req),
        error: onServerError,
      } as Parameters<typeof existing.reload>[0]);
      if (cb) cb();
      return;
    }

    const opts = this.serverOptions;
    const serveOptions: Record<string, unknown> = {
      fetch: (req: Request) => this.handleRequest(req),
      error: onServerError,
    };

    // A unix socket replaces host/port entirely.
    if (opts.unix) {
      serveOptions.unix = opts.unix;
    } else {
      serveOptions.port = numericPort;
      serveOptions.hostname = hostname;
    }

    // TLS may come from BunServerOptions.tls or NestJS's httpsOptions.
    const tls = opts.tls ?? this.httpsOptionsToTls(this.appOptions.httpsOptions);
    if (tls) serveOptions.tls = tls;
    if (opts.development !== undefined) serveOptions.development = opts.development;
    if (opts.maxRequestBodySize !== undefined) serveOptions.maxRequestBodySize = opts.maxRequestBodySize;
    if (opts.lowMemoryMode !== undefined) serveOptions.lowMemoryMode = opts.lowMemoryMode;

    const server = Bun.serve(serveOptions as unknown as Parameters<typeof Bun.serve>[0]);

    this.serverWrapper.server = server;

    if (cb) {
      cb();
    }
  }

  /**
   * Map NestJS `httpsOptions` onto Bun's `tls` option so `NestFactory.create`'s
   * documented TLS configuration actually reaches the server.
   */
  private httpsOptionsToTls(
    httpsOptions: NestApplicationOptions["httpsOptions"]
  ): BunServerOptions["tls"] | undefined {
    if (!httpsOptions) return undefined;
    const { key, cert, ca, passphrase } = httpsOptions as {
      key?: BunServerOptions["tls"] extends infer T ? (T extends { key?: infer K } ? K : never) : never;
      cert?: unknown;
      ca?: unknown;
      passphrase?: string;
    };
    if (!key && !cert) return undefined;
    return { key, cert, ca, passphrase } as BunServerOptions["tls"];
  }

  public async close(): Promise<void> {
    await this.serverWrapper.close();
    // Allow a subsequent listen() to re-run plugin initialization.
    this.fastifyInitialized = false;
  }

  // ==================== Middleware & Configuration ====================

  /**
   * Register Express-style middleware
   *
   * Supports:
   * - `use(middleware)` - global middleware
   * - `use(path, middleware)` - path-specific middleware
   * - `use(errorMiddleware)` - error middleware (4 arguments)
   * - `use(path, errorMiddleware)` - path-specific error middleware
   *
   * Arrays are flattened one level, so `use([a, b])` and `use(path, [a, b])`
   * both register each entry against the same path. Non-function arguments are
   * ignored, which is what makes `use(path)` alone a no-op.
   */
  public use(...args: unknown[]): void {
    type MiddlewareFn = ExpressMiddleware | ExpressErrorMiddleware;

    // Express tells error middleware from ordinary middleware by arity alone:
    // a 4-argument handler is called as (err, req, res, next).
    const register = (path: string, fn: MiddlewareFn): void => {
      if (fn.length === 4) {
        this.errorMiddlewares.push({ path, handler: fn as ExpressErrorMiddleware });
      } else {
        this.middlewares.push({ path, handler: fn as ExpressMiddleware });
      }
    };

    const registerEach = (path: string, entries: readonly unknown[]): void => {
      for (const entry of entries) {
        if (typeof entry === "function") {
          register(path, entry as MiddlewareFn);
        } else if (Array.isArray(entry)) {
          for (const nested of entry) {
            if (typeof nested === "function") register(path, nested as MiddlewareFn);
          }
        }
      }
    };

    if (args.length >= 2 && typeof args[0] === "string") {
      registerEach(args[0], args.slice(1));
      return;
    }

    registerEach("/", args);
  }

  /**
   * Set the prefix prepended to every route registered *from now on*.
   *
   * This is not retroactive: `buildPath` runs at registration time and its
   * result is baked into each route's `path`, `pathPattern` and `staticPaths`,
   * so a route registered before this call keeps the path it was registered
   * with. NestJS always calls this before the routes resolver runs, which is
   * why that ordering is not a problem in practice.
   */
  public setGlobalPrefix(prefix: string): void {
    this.globalPrefix = prefix;
    // Cheap insurance: the index is a view of `this.routes`, which this call
    // does not touch, so the rebuild is byte-identical today. Dropping it costs
    // nothing and keeps the index honest if route paths ever become derived.
    this.routeIndex = null;
    // Memoised middleware paths ARE derived from the prefix, so they must go.
    for (const middleware of this.middlewares) {
      middleware.resolvedPath = undefined;
    }
  }

  /**
   * `origin` accepts a string, an array of strings, or a boolean.
   *
   * The callback and `RegExp` forms are rejected. A callback needs an async
   * round trip before the headers are written, which this shim does not do, so
   * its verdict cannot be honoured; a `RegExp` has no rendering as a header
   * value. The type here excludes both, but the rejection is enforced at
   * runtime as well: NestJS declares `INestApplication.enableCors(options?:
   * any)` and does not narrow `NestApplicationOptions["cors"]`, so
   * `NestBunFactory.create(App, { cors })` reaches this method with NestJS's
   * wider `CorsOptions` and no compile error. Failing loudly at bootstrap beats
   * writing a stringified function into `Access-Control-Allow-Origin`.
   *
   * For a dynamic policy, register your own middleware ahead of this one.
   */
  public enableCors(options?: {
    origin?: string | string[] | boolean;
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  }): void {
    const corsOptions = {
      origin: options?.origin ?? "*",
      methods: options?.methods ?? "GET,HEAD,PUT,PATCH,POST,DELETE",
      allowedHeaders: options?.allowedHeaders ?? "*",
      exposedHeaders: options?.exposedHeaders ?? "",
      credentials: options?.credentials ?? false,
      maxAge: options?.maxAge ?? 86400,
      preflightContinue: options?.preflightContinue ?? false,
      optionsSuccessStatus: options?.optionsSuccessStatus ?? 204,
    };

    // `corsOptions` is frozen once `enableCors()` returns, so every header value
    // that does not depend on the request is built here rather than re-joined
    // and re-stringified on each one. CORS sits on the request path of every
    // browser-facing route.
    const methods = Array.isArray(corsOptions.methods)
      ? corsOptions.methods.join(",")
      : corsOptions.methods;

    const allowedHeaders = Array.isArray(corsOptions.allowedHeaders)
      ? corsOptions.allowedHeaders.join(",")
      : corsOptions.allowedHeaders;

    const exposedHeaders = Array.isArray(corsOptions.exposedHeaders)
      ? corsOptions.exposedHeaders.join(",")
      : corsOptions.exposedHeaders;

    const maxAgeHeader = String(corsOptions.maxAge);

    // Select the origin strategy once instead of re-running the typeof chain
    // per request.
    const origin = corsOptions.origin;
    if (typeof origin === "function" || origin instanceof RegExp) {
      throw new TypeError(
        "enableCors: `origin` must be a string, an array of strings, or a boolean. " +
          `Received ${origin instanceof RegExp ? "a RegExp" : "a callback"}, which this ` +
          "adapter cannot honour - it writes CORS headers synchronously and has no way to " +
          "render either as a header value. Register your own middleware ahead of this one " +
          "for a dynamic policy."
      );
    }

    // Whether the granted origin depends on the request, which decides both the
    // `Vary` header below and how a non-match is handled.
    const originVaries = origin === true || Array.isArray(origin);

    let resolveOrigin: (requestOrigin: string) => string;
    if (typeof origin === "boolean") {
      resolveOrigin = origin ? (requestOrigin) => requestOrigin || "*" : () => "";
    } else if (Array.isArray(origin)) {
      const allowed = new Set(origin);
      // A non-match is a deny, so grant no origin. Falling back to `origin[0]`
      // turned an EMPTY allow-list - the natural result of an unset env var -
      // into `*`, i.e. an unconfigured deployment allowed every caller.
      resolveOrigin = (requestOrigin) => (allowed.has(requestOrigin) ? requestOrigin : "");
    } else {
      resolveOrigin = () => origin;
    }

    this.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
      const requestOrigin = req.get("origin") ?? "";
      const allowOrigin = resolveOrigin(requestOrigin);

      // A response whose allowed origin is derived from the request must not be
      // cached under a key that ignores it, or a shared cache serves one
      // origin's grant to another.
      if (originVaries) res.set("Vary", "Origin");

      // Set CORS headers. An empty origin means "no grant" - skip the header
      // rather than emitting a present-but-empty one.
      if (allowOrigin) res.set("Access-Control-Allow-Origin", allowOrigin);
      res.set("Access-Control-Allow-Methods", methods);
      res.set("Access-Control-Allow-Headers", allowedHeaders);

      if (exposedHeaders) {
        res.set("Access-Control-Expose-Headers", exposedHeaders);
      }

      if (corsOptions.credentials) {
        res.set("Access-Control-Allow-Credentials", "true");
      }

      res.set("Access-Control-Max-Age", maxAgeHeader);

      // Handle preflight
      if (req.method === "OPTIONS") {
        if (corsOptions.preflightContinue) {
          next();
        } else {
          res.status(corsOptions.optionsSuccessStatus).end();
        }
        return;
      }

      next();
    });
  }

  // ==================== Fastify Compatibility ====================

  /**
   * Add a Fastify-style hook
   *
   * Supported hooks, in the order they run:
   * - `addHook('onRequest', hook)` - start of request, before body parsing
   * - `addHook('preValidation', hook)` - after body parsing, before preHandler
   * - `addHook('preHandler', hook)` - immediately before the route handler
   * - `addHook('preSerialization', hook)` - may transform the payload
   * - `addHook('onSend', hook)` - last chance to rewrite the payload
   * - `addHook('onResponse', hook)` - after the response has been built
   * - `addHook('onError', hook)` - when a hook raises an error
   *
   * Any other name throws; see {@link SUPPORTED_FASTIFY_HOOKS}.
   */
  public addHook(name: "onRequest", hook: FastifyOnRequestHook): this;
  public addHook(name: "preValidation", hook: FastifyPreValidationHook): this;
  public addHook(name: "preHandler", hook: FastifyPreHandlerHook): this;
  public addHook(name: "preSerialization", hook: FastifyPreSerializationHook): this;
  public addHook(name: "onSend", hook: FastifyOnSendHook): this;
  public addHook(name: "onError", hook: FastifyOnErrorHook): this;
  public addHook(name: "onResponse", hook: FastifyOnResponseHook): this;
  public addHook(
    name: FastifyHookName,
    hook:
      | FastifyOnRequestHook
      | FastifyPreValidationHook
      | FastifyPreHandlerHook
      | FastifyPreSerializationHook
      | FastifyOnSendHook
      | FastifyOnErrorHook
      | FastifyOnResponseHook
  ): this {
    this.fastifyHooks.addHook(name, hook);
    return this;
  }

  /**
   * Register a Fastify plugin
   *
   * @example
   * ```typescript
   * app.register(async (instance, opts) => {
   *   instance.addHook('onRequest', async (req, reply) => {
   *     console.log('Request received');
   *   });
   * });
   * ```
   */
  public register<Options = Record<string, unknown>>(
    plugin: FastifyPlugin<Options>,
    opts?: Options
  ): this {
    this.fastifyPlugins.register(plugin, opts);
    return this;
  }

  /**
   * Decorate the Fastify instance
   */
  public decorate<T>(name: string, value: T): this {
    this.fastifyPlugins.decorate(name, value);
    return this;
  }

  /**
   * Decorate request objects
   */
  public decorateRequest<T>(name: string, value: T): this {
    this.fastifyPlugins.decorateRequest(name, value);
    return this;
  }

  /**
   * Decorate reply objects
   */
  public decorateReply<T>(name: string, value: T): this {
    this.fastifyPlugins.decorateReply(name, value);
    return this;
  }

  /**
   * Check if a decorator exists
   */
  public hasDecorator(name: string): boolean {
    return this.fastifyPlugins.hasDecorator(name);
  }

  /**
   * Check if a request decorator exists
   */
  public hasRequestDecorator(name: string): boolean {
    return this.fastifyPlugins.hasRequestDecorator(name);
  }

  /**
   * Check if a reply decorator exists
   */
  public hasReplyDecorator(name: string): boolean {
    return this.fastifyPlugins.hasReplyDecorator(name);
  }

  /**
   * Initialize Fastify plugins (called before listening)
   */
  private async initializeFastifyPlugins(): Promise<void> {
    if (this.fastifyInitialized) return;

    const instance: FastifyInstance = {
      prefix: this.globalPrefix,
      decorate: <T>(name: string, value: T) => {
        this.decorate(name, value);
        return instance;
      },
      decorateRequest: <T>(name: string, value: T) => {
        this.decorateRequest(name, value);
        return instance;
      },
      decorateReply: <T>(name: string, value: T) => {
        this.decorateReply(name, value);
        return instance;
      },
      hasDecorator: (name: string) => this.hasDecorator(name),
      hasRequestDecorator: (name: string) => this.hasRequestDecorator(name),
      hasReplyDecorator: (name: string) => this.hasReplyDecorator(name),
      addHook: ((name: string, hook: FastifyOnRequestHook | FastifyPreHandlerHook | FastifyOnSendHook | FastifyOnErrorHook | FastifyOnResponseHook) => {
        this.addHook(name as "onRequest", hook as FastifyOnRequestHook);
        return instance;
      }) as FastifyInstance["addHook"],
      register: <Options>(plugin: FastifyPlugin<Options>, opts?: Options) => {
        this.register(plugin, opts);
        return instance;
      },
      get: (path: string, handler: FastifyRouteHandler) => {
        this.get(path, this.wrapFastifyHandler(handler));
        return instance;
      },
      post: (path: string, handler: FastifyRouteHandler) => {
        this.post(path, this.wrapFastifyHandler(handler));
        return instance;
      },
      put: (path: string, handler: FastifyRouteHandler) => {
        this.put(path, this.wrapFastifyHandler(handler));
        return instance;
      },
      delete: (path: string, handler: FastifyRouteHandler) => {
        this.delete(path, this.wrapFastifyHandler(handler));
        return instance;
      },
      patch: (path: string, handler: FastifyRouteHandler) => {
        this.patch(path, this.wrapFastifyHandler(handler));
        return instance;
      },
      options: (path: string, handler: FastifyRouteHandler) => {
        this.options(path, this.wrapFastifyHandler(handler));
        return instance;
      },
      head: (path: string, handler: FastifyRouteHandler) => {
        this.head(path, this.wrapFastifyHandler(handler));
        return instance;
      },
      all: (path: string, handler: FastifyRouteHandler) => {
        this.all(path, this.wrapFastifyHandler(handler));
        return instance;
      },
    };

    // Bind decorators to the instance BEFORE plugins run, so a value one plugin
    // registers with `instance.decorate('db', conn)` is readable as
    // `instance.db` by every plugin registered after it.
    this.fastifyPlugins.applyInstanceDecorators(instance);

    // Bound plugin initialisation too: a plugin that never calls done() would
    // otherwise leave listen() pending forever, so the process boots but never
    // serves and never reports why.
    await this.fastifyPlugins.initializePlugins(instance, this.middlewareTimeout);
    this.fastifyInitialized = true;
  }

  /**
   * Wrap a Fastify route handler to work with Express-style routing
   */
  private wrapFastifyHandler(handler: FastifyRouteHandler): RouteHandler {
    return async (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
      const fastifyReq = createFastifyRequest(req.raw, req.params);
      fastifyReq.body = req.body;
      const fastifyReply = createFastifyReply();

      this.fastifyPlugins.applyRequestDecorators(fastifyReq);
      this.fastifyPlugins.applyReplyDecorators(fastifyReply);

      try {
        const result = await handler(fastifyReq, fastifyReply);

        if (fastifyReply.sent) {
          const builtResponse = fastifyReply._buildResponse();
          res.status(fastifyReply.statusCode);
          builtResponse.headers.forEach((value, key) => {
            res.set(key, value);
          });
          if (fastifyReply._body !== null && fastifyReply._body !== undefined) {
            res.send(fastifyReply._body);
          } else {
            res.end();
          }
          return;
        }

        if (result !== undefined) {
          return result;
        }
      } catch (error) {
        next(error);
      }
    };
  }

  // ==================== Request/Response Helpers ====================

  /**
   * Narrow a response to the ExpressResponse the adapter actually puts in
   * flight. NestJS passes these methods whatever `handleRequest` created, not a
   * native `Response`, so every override has to accept both shapes.
   */
  /**
   * Run the tail of the reply lifecycle and return the response unchanged.
   *
   * Every exit from `handleRequest` that can be observed by a Fastify hook goes
   * through here - success, 404, hook short-circuit, middleware error, handler
   * error - so onResponse hooks (access logs, latency metrics, tracing spans)
   * see failures as well as successes. The one deliberate exception is
   * `handleRequest`'s outermost `catch`, which is reached only when the
   * lifecycle itself threw and so must not risk observing the request twice.
   *
   * Hook errors are logged inside `executeOnResponse`, so this is safe on an
   * error path. Callers only reach it when a {@link FastifyContext} exists; with
   * no Fastify surface in use there is, by construction, no onResponse hook to
   * run.
   */
  private async finalize(fastify: FastifyContext, response: Response): Promise<Response> {
    // Publish the real status onto the reply before observers read it. The
    // fastify reply is a parallel object that the Express-handler path never
    // writes to, so without this every hook sees 200 - including on a 404 or a
    // 500 - which silently corrupts the standard access-log/metrics idiom.
    if (fastify.reply.statusCode !== response.status) {
      fastify.reply.statusCode = response.status;
    }
    await this.fastifyHooks.executeOnResponse(fastify.req, fastify.reply);
    return response;
  }

  /**
   * Build a JSON error response with a constant message.
   *
   * Exception messages from hooks and middleware carry internals - connection
   * strings, file paths, driver errors - and these paths bypass NestJS's
   * exception filters, so the detail is logged rather than returned.
   */
  private static errorResponse(status: number, message = "Internal Server Error"): Response {
    return new Response(JSON.stringify({ statusCode: status, message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Rebuild a Response around a replacement payload, preserving status and
   * headers. Used to apply a payload rewritten by a Fastify onSend hook.
   */
  private static withPayload(response: Response, payload: unknown): Response {
    const headers = new Headers(response.headers);
    const status = response.status;

    // 101/204/205/304 forbid a body; attaching one produces malformed HTTP
    // (a 204 carrying Content-Length) that can mis-frame the next response on a
    // keep-alive connection. For every other status an absent payload just
    // means an empty body. Both strip the framing headers and return the same
    // response.
    if (NULL_BODY_STATUSES.has(status) || payload === null || payload === undefined) {
      headers.delete("Content-Type");
      headers.delete("Content-Length");
      return new Response(null, { status, headers });
    }

    if (
      typeof payload === "string" ||
      payload instanceof Uint8Array ||
      payload instanceof ArrayBuffer ||
      payload instanceof Blob ||
      payload instanceof ReadableStream
    ) {
      return new Response(payload as ConstructorParameters<typeof Response>[0], { status, headers });
    }

    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return new Response(JSON.stringify(payload), { status, headers });
  }

  private static asExpressResponse(response: unknown): ExpressResponse | null {
    const candidate = response as ExpressResponse | null;
    return candidate && typeof candidate.status === "function" && typeof candidate.set === "function"
      ? candidate
      : null;
  }

  public getRequestMethod(request: Request): string {
    return request.method;
  }

  public getRequestUrl(request: Request): string {
    // ExpressRequest.url is relative ("/foo?a=1"), which `new URL()` rejects.
    // NestJS calls this to build its 404 message, so throwing here turns every
    // unmatched route into a 500.
    const raw = request.url;
    if (typeof raw !== "string") return "/";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return raw.startsWith("/") ? raw : `/${raw}`;
    }
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  }

  public getRequestHostname(request: Request): string {
    const raw = request.url;
    if (typeof raw === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return new URL(raw).hostname;
    }
    const host = (request as unknown as ExpressRequest).hostname;
    if (host) return host;
    return request.headers?.get?.("host")?.split(":")[0] ?? "";
  }

  public reply(response: unknown, body: unknown, statusCode?: number): unknown {
    // Handle ExpressResponse from our middleware
    const expressRes = response as ExpressResponse;
    if (expressRes && typeof expressRes.status === "function" && typeof expressRes.send === "function") {
      if (statusCode) {
        expressRes.status(statusCode);
      }

      if (body === null || body === undefined) {
        expressRes.end();
        return expressRes;
      }

      if (typeof body === "object" && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer) && !(body instanceof ReadableStream)) {
        expressRes.json(body);
      } else {
        expressRes.send(body);
      }
      return expressRes;
    }

    // Handle native Response
    const nativeRes = response as Response;
    const status = statusCode ?? 200;
    const headers = new Headers(nativeRes.headers);

    if (body === null || body === undefined) {
      return new Response(null, { status, headers });
    }

    if (typeof body === "string") {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "text/plain");
      }
      return new Response(body, { status, headers });
    }

    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/octet-stream");
      }
      return new Response(body, { status, headers });
    }

    if (body instanceof ReadableStream) {
      return new Response(body, { status, headers });
    }

    // Default to JSON
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return new Response(JSON.stringify(body), { status, headers });
  }

  public end(response: Response, message?: string): void {
    const res = BunAdapter.asExpressResponse(response);
    if (res) {
      res.end(message);
    }
  }

  public status(response: Response, statusCode: number): Response {
    const res = BunAdapter.asExpressResponse(response);
    if (res) {
      res.status(statusCode);
      return response;
    }
    return new Response(response.body, {
      status: statusCode,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  public redirect(response: Response, statusCode: number, url: string): Response {
    const res = BunAdapter.asExpressResponse(response);
    if (res) {
      res.redirect(statusCode, url);
      return response;
    }
    // Set Location directly: Response.redirect() rejects relative URLs and
    // discards every header already on the response.
    const headers = new Headers(response.headers);
    headers.set("Location", url);
    return new Response(null, { status: statusCode, headers });
  }

  public setHeader(response: Response, name: string, value: string): Response {
    const res = BunAdapter.asExpressResponse(response);
    if (res) {
      res.set(name, value);
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  public setErrorHandler(handler: (error: Error, req: ExpressRequest, res: ExpressResponse) => void): void {
    this.errorHandler = handler;
  }

  public setNotFoundHandler(handler: RouteHandler): void {
    this.notFoundHandler = handler;
  }

  public isHeadersSent(response: Response): boolean {
    const res = BunAdapter.asExpressResponse(response);
    return res ? res.headersSent === true : false;
  }

  public getHeader(response: Response, name: string): string | undefined {
    const res = BunAdapter.asExpressResponse(response);
    if (res) {
      return res.getHeader(name) ?? undefined;
    }
    return response.headers.get(name) ?? undefined;
  }

  public appendHeader(response: Response, name: string, value: string): Response {
    const res = BunAdapter.asExpressResponse(response);
    if (res) {
      res.append(name, value);
      return response;
    }
    const headers = new Headers(response.headers);
    headers.append(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // ==================== Body Parsers ====================

  public useBodyParser(
    _type: "json" | "urlencoded" | "text" | "raw",
    rawBody?: boolean,
    _options?: Record<string, unknown>
  ): void {
    // Bun parses bodies natively in handleRequest; the only meaningful option
    // here is whether to retain the raw bytes alongside the parsed value.
    if (rawBody) {
      this.captureRawBody = true;
    }
  }

  public registerParserMiddleware(_prefix?: string, rawBody?: boolean): void {
    if (rawBody) {
      this.captureRawBody = true;
    }
  }

  // ==================== View Engine (Unsupported) ====================

  // Declared as `this` to match HttpServer.setViewEngine?(): this, so BunAdapter
  // stays assignable to it and NestBunApplication.getHttpAdapter() can be typed
  // as a plain BunAdapter. The body always throws, which satisfies any return type.
  public setViewEngine(engine: string): this {
    throw new Error(
      `View engines are not supported by BunAdapter (received "${engine}"). ` +
        `Render templates inside your handler and return the resulting string instead.`
    );
  }

  public render(_response: Response, view: string, _options: Record<string, unknown>): void {
    throw new Error(
      `View rendering is not supported by BunAdapter (received "${view}"). ` +
        `@Render() has no effect; return the rendered output from the handler instead.`
    );
  }

  // ==================== Versioning ====================

  /* eslint-disable @typescript-eslint/no-unsafe-function-type -- mirrors AbstractHttpAdapter's own signature */
  public applyVersionFilter(
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions
  ): (req: Request, res: Response, next: () => void) => Function {
    // The base signature types the inner function as returning `Function`, but
    // NestJS registers the inner function itself as the route handler and
    // ignores what it returns. The casts below reconcile the two.
    //
    // Everything derivable from `version` and `versioningOptions` is fixed when
    // NestJS registers the route, so it is resolved once here rather than on
    // every request through this handler.
    const accepted = Array.isArray(version) ? version : [version];

    // VERSION_NEUTRAL answers regardless of the requested version, and URI
    // versioning is resolved by NestJS through the route path itself - so
    // reaching the handler already means the version matched. Either way the
    // filter has nothing left to decide, and the wrapper frame is pure cost.
    if (
      accepted.includes(VERSION_NEUTRAL as unknown as string | symbol) ||
      versioningOptions.type === VersioningType.URI
    ) {
      return handler as unknown as (req: Request, res: Response, next: () => void) => Function;
    }

    const acceptedVersions = new Set(accepted.map(String));

    const filtered = (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
      const requested = this.extractRequestVersion(req, versioningOptions);
      if (requested !== undefined && acceptedVersions.has(requested)) {
        return handler(req, res, next);
      }

      // No match: defer so another version of this route (or the 404 path) runs.
      return next();
    };

    return filtered as unknown as (req: Request, res: Response, next: () => void) => Function;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-function-type */

  /**
   * Resolve the version a request is asking for, per the configured strategy.
   */
  private extractRequestVersion(
    req: ExpressRequest,
    options: VersioningOptions
  ): string | undefined {
    switch (options.type) {
      case VersioningType.HEADER: {
        const header = (options as { header: string }).header;
        return req.get(header) ?? undefined;
      }
      case VersioningType.MEDIA_TYPE: {
        const key = (options as { key: string }).key;
        const accept = req.get("accept");
        if (!accept || !key) return undefined;
        const found = accept
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(key));
        return found ? found.slice(key.length) || undefined : undefined;
      }
      case VersioningType.CUSTOM: {
        const extractor = (options as { extractor: (request: unknown) => string | string[] }).extractor;
        const extracted = extractor(req);
        return Array.isArray(extracted) ? extracted[0] : extracted;
      }
      default:
        return undefined;
    }
  }

  // ==================== Static Assets ====================

  /**
   * Serve files from `root`.
   *
   * `transfer` picks how the bytes reach the client. The two modes differ in
   * exactly two observable ways, and neither is strictly better:
   *
   * | | `"stream"` (default) | `"sendfile"` |
   * |---|---|---|
   * | Symlink TOCTOU | closed - the descriptor is validated and streamed | open - the path is re-opened later |
   * | `GET` framing | `Transfer-Encoding: chunked` | `Content-Length` |
   *
   * `"stream"` opens the file once, checks containment against *that*
   * descriptor, and streams it, so nothing re-opens a path that could have been
   * swapped in the meantime. The cost is that a stream has no declared length,
   * so Bun frames the response as chunked and clients lose `Content-Length`
   * (and with it, download progress). `HEAD` reports the size either way.
   *
   * `"sendfile"` hands Bun the path, keeping `Content-Length` and Bun's
   * `sendfile(2)` fast path. Containment is still checked, but against the path
   * rather than the opened inode - so anyone able to write into `root` can, in
   * principle, replace a file with a symlink between the check and the open.
   * Choose it when `root` holds build output that no untrusted process can
   * write to and `Content-Length` matters.
   *
   * Both modes stream rather than buffer, so peak memory does not scale with
   * `filesize x concurrency` in either.
   */
  public useStaticAssets(
    root: string,
    options?: { prefix?: string; transfer?: "stream" | "sendfile" }
  ): this {
    let prefix = options?.prefix ?? "/";
    if (!prefix.startsWith("/")) prefix = `/${prefix}`;
    if (prefix.length > 1 && prefix.endsWith("/")) prefix = prefix.slice(0, -1);

    const transfer = options?.transfer ?? "stream";

    // Registered as middleware, not a route: a wildcard route would be matched
    // ahead of every controller and a miss could not fall through.
    this.middlewares.push({
      path: prefix,
      absolute: true,
      handler: async (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();

        const relative = prefix === "/" ? req.path : req.path.slice(prefix.length);
        const resolved = BunAdapter.resolveWithinRoot(root, relative);
        if (!resolved) return next();

        const realTarget = await BunAdapter.realTargetWithinRoot(root, resolved);
        if (!realTarget) return next();

        // MIME comes from the REQUESTED path's extension, not the link target's,
        // matching what the client asked for. `Bun.file()` derives it from the
        // name without touching the disk.
        const contentType = Bun.file(resolved).type || "application/octet-stream";

        return transfer === "sendfile"
          ? BunAdapter.sendStaticByPath(realTarget, contentType, res, next)
          : BunAdapter.sendStaticByDescriptor(realTarget, contentType, req, res, next);
      },
    });

    return this;
  }

  /**
   * Join a request path onto a static root, refusing anything that escapes it.
   * Returns null when the path traverses outside the root.
   */
  private static resolveWithinRoot(root: string, relative: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(relative);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;

    const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
    const candidate = pathPosix.normalize(pathPosix.join(normalizedRoot, decoded));

    if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}/`)) {
      return null;
    }

    // Refuse dotfiles, as serve-static does by default. Static roots routinely
    // contain .env and .git/config, and serving them is an unauthenticated
    // credential and source leak.
    const withinRoot = candidate.slice(normalizedRoot.length + 1);
    if (withinRoot && withinRoot.split("/").some((segment) => segment.startsWith("."))) {
      return null;
    }

    return candidate;
  }

  /**
   * Resolve a path to the file it actually names and confirm that file is
   * inside the root, or return null.
   *
   * `realpath` is what makes a legitimate symlink inside the root work: it is
   * the link's *target* that has to be contained, and the lexical check in
   * {@link resolveWithinRoot} cannot see where a link points.
   */
  private static async realTargetWithinRoot(root: string, resolved: string): Promise<string | null> {
    try {
      const realRoot = await realpath(root.endsWith("/") ? root.slice(0, -1) : root);
      const realTarget = await realpath(resolved);
      if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}/`)) return null;
      return realTarget;
    } catch {
      // Missing, unreadable, or a dangling link.
      return null;
    }
  }

  /**
   * `transfer: "stream"`. Open the validated path, re-check it against the
   * opened descriptor, and stream that descriptor.
   *
   * This is what closes the TOCTOU. A check-then-open against a path leaves a
   * gap an attacker who can write to the root can exploit by swapping the file
   * for a symlink; with `sendfile` that gap spans the rest of the request,
   * because Bun opens the path when the response is serialised. Here the path
   * has already been fully resolved, so `O_NOFOLLOW` succeeds for honest files
   * and fails with `ELOOP` if the target became a symlink in between - exactly
   * the swap being defended against. A swap to a regular file still resolves
   * inside the root, so serving it is within policy.
   */
  private static async sendStaticByDescriptor(
    realTarget: string,
    contentType: string,
    req: ExpressRequest,
    res: ExpressResponse,
    next: (err?: unknown) => void
  ): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(realTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch {
      return next();
    }

    try {
      const stat = await handle.stat();
      // A directory opens successfully; streaming one is not meaningful.
      if (!stat.isFile()) {
        await handle.close();
        return next();
      }

      res.type(contentType);
      // Static content is attacker-influenced in any app that lets users
      // populate the root, so refuse MIME sniffing.
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Content-Length", String(stat.size));

      if (req.method === "HEAD") {
        // Nothing to stream, so release the descriptor rather than handing over
        // a body that will never be read. Content-Length survives here.
        await handle.close();
        res.end();
        return;
      }

      // The stream owns the descriptor - `createReadStream` closes it on end,
      // on error and on destroy - so a client that disconnects mid-transfer
      // does not leak one. Handing Bun a bare fd instead (`Bun.file(fd)`) does
      // leak: Bun never closes a descriptor it did not open.
      //
      // Bun frames a stream body as chunked and drops Content-Length, which is
      // the documented cost of this mode.
      res.send(Readable.toWeb(handle.createReadStream()) as unknown as ReadableStream);
    } catch (err) {
      await handle.close().catch(() => {});
      next(err);
    }
  }

  /**
   * `transfer: "sendfile"`. Hand Bun the validated path and let it open the
   * file when the response is serialised.
   *
   * Keeps `Content-Length` and Bun's `sendfile(2)` path. The containment check
   * above ran against the path, not the inode Bun eventually opens, so a writer
   * inside the root can swap the file in between - see
   * {@link sendStaticByDescriptor} for the mode that closes that.
   */
  private static async sendStaticByPath(
    realTarget: string,
    contentType: string,
    res: ExpressResponse,
    next: (err?: unknown) => void
  ): Promise<void> {
    try {
      const file = Bun.file(realTarget);
      if (!(await file.exists())) return next();

      res.type(contentType);
      res.set("X-Content-Type-Options", "nosniff");
      // A BunFile is a Blob, so `send` takes size and type from it and Bun
      // streams the bytes off disk. Never read it into a Uint8Array first -
      // that makes peak RSS `filesize x concurrency`.
      res.send(file);
    } catch (err) {
      next(err);
    }
  }

  // ==================== Type Helpers ====================

  public getType(): string {
    return "bun";
  }

  public getInstance<T = BunServerWrapper>(): T {
    return this.serverWrapper as unknown as T;
  }

  public initHttpServer(options?: NestApplicationOptions): void {
    // NestJS passes the application options here; this is where the Express and
    // Fastify adapters read httpsOptions. Retain them for listen().
    if (options) {
      this.appOptions = options;
      if ((options as { rawBody?: boolean }).rawBody) {
        this.captureRawBody = true;
      }
      const nested = (options as { serverOptions?: BunServerOptions }).serverOptions;
      if (nested) {
        this.setServerOptions(nested);
      }
    }

    // Set the server wrapper as the httpServer
    // This provides EventEmitter interface for NestJS compatibility
    (this as unknown as { httpServer: BunServerWrapper }).httpServer = this.serverWrapper;
  }

  public getHttpServer(): BunServerWrapper {
    return this.serverWrapper;
  }

  /**
   * Factory NestJS uses to install middleware from `configure(consumer)`.
   *
   * This must register MIDDLEWARE, not a route. NestJS runs it before the
   * routes resolver, so registering a route here puts it ahead of every
   * controller: it matches first, calls next(), and the controller never runs.
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  public createMiddlewareFactory(method: RequestMethod): (path: string, callback: Function) => void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    return (path: string, callback: Function) => {
      const handler = callback as ExpressMiddleware;
      const expectedMethod = method === RequestMethod.ALL ? null : RequestMethod[method];

      this.middlewares.push({
        path,
        absolute: true,
        handler: (req, res, next) => {
          if (expectedMethod && req.method?.toUpperCase() !== expectedMethod) {
            return next();
          }
          return handler(req, res, next);
        },
      });
    };
  }
}
