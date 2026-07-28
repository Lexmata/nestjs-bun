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
import { EventEmitter } from "events";
import { posix as pathPosix } from "path";
import type { BunServerOptions } from "./interfaces";

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
 * Duplicated in `express-compat.ts` and `utils/response.ts`; keep the three in sync.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

type RouteHandler = (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => unknown;
type RequestHandler = RouteHandler;

interface Route {
  path: string | RegExp;
  method: string;
  handler: RouteHandler;
  pathPattern: RegExp;
  paramNames: string[];
}

interface MiddlewareEntry {
  path: string;
  handler: ExpressMiddleware;
  /** Path is already fully qualified; do not prepend the global prefix. */
  absolute?: boolean;
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
   */
  public async close(callback?: () => void, drainTimeoutMs = 10_000): Promise<void> {
    const server = this._server;
    if (server) {
      try {
        await Promise.race([server.stop(), Bun.sleep(drainTimeoutMs)]);
        // No-op if the graceful stop already completed.
        await server.stop(true);
      } finally {
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
  private versioningOptions?: VersioningOptions;

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

    // The numeric hop-count form is declared on BunServerOptions but the
    // compat layers only implement boolean trust. Silently degrading a numeric
    // value to "trust the left-most entry" would hand an attacker exactly the
    // spoofing the hop count exists to prevent, so refuse it outright.
    if (typeof options.trustProxy === "number") {
      throw new Error(
        "serverOptions.trustProxy: the numeric hop-count form is not implemented yet. " +
          "Use `true` to trust X-Forwarded-* headers, or `false` (the default) to ignore them."
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
   * Convert a path pattern to a RegExp and extract parameter names
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
    if (value === undefined || !value.includes("%")) return value;
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

    // Trailing wildcard: "/x*", "/x/*", "/x/(.*)", "/x/{*splat}".
    const wildcard = /\/?(\*[^/]*|\(\.\*\)|\{\*[^}]*\})$/;
    if (wildcard.test(normalized)) {
      const base = normalized.replace(wildcard, "");
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

    this.routes.push({
      path: fullPath,
      method: method.toUpperCase(),
      handler,
      pathPattern: pattern,
      paramNames,
    });
  }

  /**
   * Parse request body based on content type
   */
  private async parseRequestBody(bunRequest: Request): Promise<unknown> {
    const contentType = bunRequest.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        return await bunRequest.json();
      } catch {
        return undefined;
      }
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
      try {
        const text = await bunRequest.text();
        const params = new URLSearchParams(text);
        const body: Record<string, string> = {};
        params.forEach((value, key) => {
          body[key] = value;
        });
        return body;
      } catch {
        return undefined;
      }
    }

    if (contentType.includes("multipart/form-data")) {
      try {
        const formData = await bunRequest.formData();
        const body: Record<string, unknown> = {};
        formData.forEach((value, key) => {
          body[key] = value;
        });
        return body;
      } catch {
        return undefined;
      }
    }

    if (contentType.includes("text/")) {
      try {
        return await bunRequest.text();
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Execute middleware chain
   */
  private async executeMiddlewareChain(
    middlewares: MiddlewareEntry[],
    req: ExpressRequest,
    res: ExpressResponse,
    pathname: string,
    startIndex: number = 0
  ): Promise<{ error?: unknown; completed: boolean }> {
    for (let i = startIndex; i < middlewares.length; i++) {
      const middleware = middlewares[i];
      const middlewarePath = middleware.absolute ? middleware.path : this.buildPath(middleware.path);

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

      Promise.resolve(returned).then(
        () => {
          if (res._ended) finish({ kind: "ended" });
        },
        (err) => finish({ kind: "error", error: err })
      );

      if (settled) return;

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
    // next() to defer to the next match.
    const candidates: Array<{ route: Route; params: Record<string, string> }> = [];

    for (const route of this.routes) {
      const methodMatches =
        route.method === method ||
        route.method === "ALL" ||
        // HEAD is served by the matching GET handler, as in Express.
        (method === "HEAD" && route.method === "GET");
      if (!methodMatches) continue;

      const match = pathname.match(route.pathPattern);
      if (!match) continue;

      const routeParams: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        routeParams[name] = BunAdapter.decodeParam(match[index + 1]);
      });
      candidates.push({ route, params: routeParams });
    }

    let candidateIndex = 0;
    let matchedRoute: Route | undefined = candidates[0]?.route;
    const params: Record<string, string> = { ...(candidates[0]?.params ?? {}) };

    // Create Express-compatible request and response
    // Numeric values are rejected in setServerOptions, so this is boolean here.
    const trustProxy = this.serverOptions.trustProxy === true;
    const remoteAddress = this.serverWrapper.server?.requestIP(bunRequest)?.address;

    const req = createExpressRequest(bunRequest, params, trustProxy, remoteAddress);
    // Pass the request so `res.req` is populated for middleware that pairs the
    // two (error handlers, loggers).
    const res = createExpressResponse(req);

    // Create Fastify-compatible request and reply
    const fastifyReq = createFastifyRequest(bunRequest, params, undefined, {
      // routerPath must be the matched pattern ("/users/:id"), not the concrete
      // path, or per-route metrics get one series per id.
      routePattern: typeof matchedRoute?.path === "string" ? matchedRoute.path : undefined,
      trustProxy,
      remoteAddress,
    });
    const fastifyReply = createFastifyReply(fastifyReq);

    // Apply Fastify decorators
    this.fastifyPlugins.applyRequestDecorators(fastifyReq);
    this.fastifyPlugins.applyReplyDecorators(fastifyReply);

    // Parse body. When rawBody was requested (NestJS `rawBody: true`), clone
    // first so the untouched bytes survive alongside the parsed value -
    // signature verification for webhooks needs the exact payload.
    if (this.captureRawBody && bunRequest.body) {
      try {
        const raw = Buffer.from(await bunRequest.clone().arrayBuffer());
        (req as ExpressRequest & { rawBody?: Buffer }).rawBody = raw;
        (fastifyReq as { rawBody?: Buffer }).rawBody = raw;
      } catch {
        // A body that cannot be re-read is not fatal; parsing still proceeds.
      }
    }

    const parsedBody = await this.parseRequestBody(bunRequest);
    req.body = parsedBody;
    fastifyReq.body = parsedBody;

    try {
      // Execute Fastify onRequest hooks
      const onRequestError = await this.fastifyHooks.executeOnRequest(fastifyReq, fastifyReply);
      if (onRequestError) {
        const errorHandled = await this.fastifyHooks.executeOnError(fastifyReq, fastifyReply, onRequestError);
        if (!errorHandled) {
          fastifyReply.code(500).send({
            statusCode: 500,
            error: "Internal Server Error",
            message: "Internal Server Error",
          });
        }
        return fastifyReply._buildResponse();
      }

      // If Fastify reply was sent during onRequest hooks
      if (fastifyReply.sent) {
        return fastifyReply._buildResponse();
      }

      // Execute Express middleware chain
      const middlewareResult = await this.executeMiddlewareChain(this.middlewares, req, res, pathname);

      // If middleware returned an error, handle it
      if (middlewareResult.error) {
        const errorHandled = await this.executeErrorMiddlewareChain(middlewareResult.error, req, res, pathname);
        if (!errorHandled) {
          // Use default error handler
          if (this.errorHandler) {
            this.errorHandler(middlewareResult.error as Error, req, res);
          } else {
            res.status(500).json({
              statusCode: 500,
              message: middlewareResult.error instanceof Error ? middlewareResult.error.message : "Internal Server Error",
            });
          }
        }
        return res._buildResponse();
      }

      // If middleware ended the response, return it
      if (middlewareResult.completed || res._ended) {
        return res._buildResponse();
      }

      // Execute Fastify preValidation hooks. These run BEFORE preHandler, as in
      // Fastify: onRequest -> preValidation -> preHandler -> handler. The body
      // has already been parsed by this point.
      const preValidationError = await this.fastifyHooks.executePreValidation(fastifyReq, fastifyReply);
      if (preValidationError) {
        const errorHandled = await this.fastifyHooks.executeOnError(fastifyReq, fastifyReply, preValidationError);
        if (!errorHandled) {
          fastifyReply.code(500).send({
            statusCode: 500,
            error: "Internal Server Error",
            message: "Internal Server Error",
          });
        }
        return fastifyReply._buildResponse();
      }

      // If Fastify reply was sent during preValidation hooks
      if (fastifyReply.sent) {
        return fastifyReply._buildResponse();
      }

      // Execute Fastify preHandler hooks
      const preHandlerError = await this.fastifyHooks.executePreHandler(fastifyReq, fastifyReply);
      if (preHandlerError) {
        const errorHandled = await this.fastifyHooks.executeOnError(fastifyReq, fastifyReply, preHandlerError);
        if (!errorHandled) {
          fastifyReply.code(500).send({
            statusCode: 500,
            error: "Internal Server Error",
            message: "Internal Server Error",
          });
        }
        return fastifyReply._buildResponse();
      }

      // If Fastify reply was sent during preHandler hooks
      if (fastifyReply.sent) {
        return fastifyReply._buildResponse();
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
            const errorHandled = await this.executeErrorMiddlewareChain(nextError, req, res, pathname);
            if (!errorHandled) {
              // Try Fastify error hooks
              const fastifyErrorHandled = await this.fastifyHooks.executeOnError(
                fastifyReq,
                fastifyReply,
                nextError instanceof Error ? nextError : new Error(String(nextError))
              );
              if (!fastifyErrorHandled) {
                if (this.errorHandler) {
                  this.errorHandler(nextError as Error, req, res);
                } else {
                  res.status(500).json({
                    statusCode: 500,
                    message: nextError instanceof Error ? nextError.message : "Internal Server Error",
                  });
                }
              } else {
                return fastifyReply._buildResponse();
              }
            }
            return res._buildResponse();
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
              // Execute Fastify onResponse hooks
              await this.fastifyHooks.executeOnResponse(fastifyReq, fastifyReply);
              return handlerResult;
            }
            res.send(handlerResult);
          }

          // Execute Fastify onSend hooks
          const originalBody = res._body;

          // preSerialization runs before onSend and may transform the payload.
          let payload: unknown = originalBody;
          const preSerialization = await this.fastifyHooks.executePreSerialization(
            fastifyReq,
            fastifyReply,
            payload
          );
          if (preSerialization.error) {
            const errorHandled = await this.fastifyHooks.executeOnError(
              fastifyReq,
              fastifyReply,
              preSerialization.error
            );
            if (errorHandled) {
              return this.finalize(fastifyReq, fastifyReply, fastifyReply._buildResponse());
            }
            // The response is already sent, so res.json() would silently no-op
            // and ship the SUCCESS body under a 500. Build the failure directly.
            logger.error("preSerialization hook failed:", preSerialization.error);
            return this.finalize(fastifyReq, fastifyReply, BunAdapter.errorResponse(500));
          }
          payload = preSerialization.payload;

          const onSendResult = await this.fastifyHooks.executeOnSend(fastifyReq, fastifyReply, payload);
          if (onSendResult.error) {
            const errorHandled = await this.fastifyHooks.executeOnError(fastifyReq, fastifyReply, onSendResult.error);
            if (errorHandled) {
              return this.finalize(fastifyReq, fastifyReply, fastifyReply._buildResponse());
            }
            // Same hazard as above - and worse here, since an onSend hook is
            // typically what redacts the payload it just failed to transform.
            logger.error("onSend hook failed:", onSendResult.error);
            return this.finalize(fastifyReq, fastifyReply, BunAdapter.errorResponse(500));
          }

          let response = res._buildResponse();

          // An onSend hook may rewrite the payload. Applying it to the built
          // Response avoids reaching into the Express response's internals.
          if (onSendResult.payload !== originalBody) {
            response = BunAdapter.withPayload(response, onSendResult.payload);
          }

          return this.finalize(fastifyReq, fastifyReply, response);
        } catch (error) {
          const errorHandled = await this.executeErrorMiddlewareChain(error, req, res, pathname);
          if (!errorHandled) {
            // Try Fastify error hooks
            const fastifyErrorHandled = await this.fastifyHooks.executeOnError(
              fastifyReq,
              fastifyReply,
              error instanceof Error ? error : new Error(String(error))
            );
            if (!fastifyErrorHandled) {
              if (this.errorHandler) {
                this.errorHandler(error as Error, req, res);
              } else {
                res.status(500).json({
                  statusCode: 500,
                  message: error instanceof Error ? error.message : "Internal Server Error",
                });
              }
            } else {
              return fastifyReply._buildResponse();
            }
          }
          return res._buildResponse();
        }
      }

      // No route matched. The not-found response still runs through the reply
      // lifecycle so onSend/onResponse hooks - access logs, metrics - observe
      // it. Skipping them here silently dropped every 404 from those hooks.
      fastifyReq.is404 = true;

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

      const notFoundSend = await this.fastifyHooks.executeOnSend(fastifyReq, fastifyReply, notFoundBody);
      if (notFoundSend.error) {
        // Every other executeOnSend call site routes its error; this one used to
        // discard it, so a hook that threw on 404s failed invisibly.
        const errorHandled = await this.fastifyHooks.executeOnError(fastifyReq, fastifyReply, notFoundSend.error);
        if (errorHandled) {
          return this.finalize(fastifyReq, fastifyReply, fastifyReply._buildResponse());
        }
        logger.error("onSend hook failed on the not-found path:", notFoundSend.error);
      } else if (notFoundSend.payload !== notFoundBody) {
        notFoundResponse = BunAdapter.withPayload(notFoundResponse, notFoundSend.payload);
      }

      return this.finalize(fastifyReq, fastifyReply, notFoundResponse);
    } catch (error) {
      // Top-level error handling
      if (this.errorHandler) {
        this.errorHandler(error as Error, req, res);
        return res._buildResponse();
      }

      return new Response(
        JSON.stringify({
          statusCode: 500,
          message: error instanceof Error ? error.message : "Internal Server Error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // ==================== HTTP Method Handlers ====================

  public get(handler: RequestHandler): void;
  public get(path: string, handler: RequestHandler): void;
  public get(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("GET", "/", pathOrHandler);
    } else {
      this.addRoute("GET", pathOrHandler, handler!);
    }
  }

  public post(handler: RequestHandler): void;
  public post(path: string, handler: RequestHandler): void;
  public post(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("POST", "/", pathOrHandler);
    } else {
      this.addRoute("POST", pathOrHandler, handler!);
    }
  }

  public put(handler: RequestHandler): void;
  public put(path: string, handler: RequestHandler): void;
  public put(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("PUT", "/", pathOrHandler);
    } else {
      this.addRoute("PUT", pathOrHandler, handler!);
    }
  }

  public delete(handler: RequestHandler): void;
  public delete(path: string, handler: RequestHandler): void;
  public delete(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("DELETE", "/", pathOrHandler);
    } else {
      this.addRoute("DELETE", pathOrHandler, handler!);
    }
  }

  public patch(handler: RequestHandler): void;
  public patch(path: string, handler: RequestHandler): void;
  public patch(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("PATCH", "/", pathOrHandler);
    } else {
      this.addRoute("PATCH", pathOrHandler, handler!);
    }
  }

  public options(handler: RequestHandler): void;
  public options(path: string, handler: RequestHandler): void;
  public options(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("OPTIONS", "/", pathOrHandler);
    } else {
      this.addRoute("OPTIONS", pathOrHandler, handler!);
    }
  }

  public head(handler: RequestHandler): void;
  public head(path: string, handler: RequestHandler): void;
  public head(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("HEAD", "/", pathOrHandler);
    } else {
      this.addRoute("HEAD", pathOrHandler, handler!);
    }
  }

  public all(handler: RequestHandler): void;
  public all(path: string, handler: RequestHandler): void;
  public all(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    if (typeof pathOrHandler === "function") {
      this.addRoute("ALL", "/", pathOrHandler);
    } else {
      this.addRoute("ALL", pathOrHandler, handler!);
    }
  }

  /**
   * Register a handler for one of the extended verbs NestJS supports
   * (@Search, @Propfind, ...). AbstractHttpAdapter declares each of these, and
   * NestJS's RouterMethodFactory resolves the decorator to `adapter[verb]`,
   * only falling back to `use` when the method is ABSENT. Inheriting the base
   * implementations would forward to `this.instance[verb]`, which on the Bun
   * server wrapper does not exist - a TypeError at bootstrap.
   */
  private registerExtendedVerb(
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
    this.registerExtendedVerb("SEARCH", pathOrHandler, handler);
  }

  public propfind(handler: RequestHandler): void;
  public propfind(path: string, handler: RequestHandler): void;
  public propfind(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerExtendedVerb("PROPFIND", pathOrHandler, handler);
  }

  public proppatch(handler: RequestHandler): void;
  public proppatch(path: string, handler: RequestHandler): void;
  public proppatch(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerExtendedVerb("PROPPATCH", pathOrHandler, handler);
  }

  public mkcol(handler: RequestHandler): void;
  public mkcol(path: string, handler: RequestHandler): void;
  public mkcol(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerExtendedVerb("MKCOL", pathOrHandler, handler);
  }

  public copy(handler: RequestHandler): void;
  public copy(path: string, handler: RequestHandler): void;
  public copy(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerExtendedVerb("COPY", pathOrHandler, handler);
  }

  public move(handler: RequestHandler): void;
  public move(path: string, handler: RequestHandler): void;
  public move(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerExtendedVerb("MOVE", pathOrHandler, handler);
  }

  public lock(handler: RequestHandler): void;
  public lock(path: string, handler: RequestHandler): void;
  public lock(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerExtendedVerb("LOCK", pathOrHandler, handler);
  }

  public unlock(handler: RequestHandler): void;
  public unlock(path: string, handler: RequestHandler): void;
  public unlock(pathOrHandler: string | RequestHandler, handler?: RequestHandler): void {
    this.registerExtendedVerb("UNLOCK", pathOrHandler, handler);
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

    // When the caller supplied a server, re-point it at this application rather
    // than starting a second one. Previously the supplied instance was simply
    // overwritten here, so it kept serving whatever it was built with.
    const existing = this.serverWrapper.server;
    if (this.usingExternalServer && existing) {
      existing.reload({ fetch: (req: Request) => this.handleRequest(req) } as Parameters<
        typeof existing.reload
      >[0]);
      if (cb) cb();
      return;
    }

    const opts = this.serverOptions;
    const serveOptions: Record<string, unknown> = {
      fetch: (req: Request) => this.handleRequest(req),
      error: (error: Error) => {
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
      },
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
   */
  public use(...args: unknown[]): void {
    type MiddlewareFn = ExpressMiddleware | ExpressErrorMiddleware;
    if (args.length === 1 && typeof args[0] === "function") {
      const fn = args[0] as MiddlewareFn;
      // Check if it's an error middleware (4 parameters)
      if (fn.length === 4) {
        this.errorMiddlewares.push({
          path: "/",
          handler: fn as ExpressErrorMiddleware,
        });
      } else {
        this.middlewares.push({
          path: "/",
          handler: fn as ExpressMiddleware,
        });
      }
    } else if (args.length >= 2 && typeof args[0] === "string") {
      const path = args[0] as string;
      // Handle multiple middleware functions
      for (let i = 1; i < args.length; i++) {
        if (typeof args[i] === "function") {
          const fn = args[i] as MiddlewareFn;
          if (fn.length === 4) {
            this.errorMiddlewares.push({
              path,
              handler: fn as ExpressErrorMiddleware,
            });
          } else {
            this.middlewares.push({
              path,
              handler: fn as ExpressMiddleware,
            });
          }
        }
      }
    } else if (args.length >= 1) {
      // Handle array of middleware or multiple middleware functions
      for (const arg of args) {
        if (typeof arg === "function") {
          const fn = arg as MiddlewareFn;
          if (fn.length === 4) {
            this.errorMiddlewares.push({
              path: "/",
              handler: fn as ExpressErrorMiddleware,
            });
          } else {
            this.middlewares.push({
              path: "/",
              handler: fn as ExpressMiddleware,
            });
          }
        } else if (Array.isArray(arg)) {
          for (const middleware of arg) {
            if (typeof middleware === "function") {
              const fn = middleware as MiddlewareFn;
              if (fn.length === 4) {
                this.errorMiddlewares.push({
                  path: "/",
                  handler: fn as ExpressErrorMiddleware,
                });
              } else {
                this.middlewares.push({
                  path: "/",
                  handler: fn as ExpressMiddleware,
                });
              }
            }
          }
        }
      }
    }
  }

  public setGlobalPrefix(prefix: string): void {
    this.globalPrefix = prefix;
  }

  public enableCors(options?: {
    origin?: string | string[] | boolean | ((origin: string, callback: (err: Error | null, allow?: boolean) => void) => void);
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

    this.use((req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
      const requestOrigin = req.get("origin") ?? "";

      // Determine the allowed origin
      let allowOrigin = "*";
      if (typeof corsOptions.origin === "boolean") {
        allowOrigin = corsOptions.origin ? requestOrigin || "*" : "";
      } else if (typeof corsOptions.origin === "string") {
        allowOrigin = corsOptions.origin;
      } else if (Array.isArray(corsOptions.origin)) {
        if (corsOptions.origin.includes(requestOrigin)) {
          allowOrigin = requestOrigin;
        } else {
          allowOrigin = corsOptions.origin[0] ?? "*";
        }
      } else if (typeof corsOptions.origin === "function") {
        // For function-based origin, we'd need async handling
        // For simplicity, default to allowing the request origin
        allowOrigin = requestOrigin || "*";
      }

      const methods = Array.isArray(corsOptions.methods)
        ? corsOptions.methods.join(",")
        : corsOptions.methods;

      const allowedHeaders = Array.isArray(corsOptions.allowedHeaders)
        ? corsOptions.allowedHeaders.join(",")
        : corsOptions.allowedHeaders;

      const exposedHeaders = Array.isArray(corsOptions.exposedHeaders)
        ? corsOptions.exposedHeaders.join(",")
        : corsOptions.exposedHeaders;

      // Set CORS headers
      res.set("Access-Control-Allow-Origin", allowOrigin);
      res.set("Access-Control-Allow-Methods", methods);
      res.set("Access-Control-Allow-Headers", allowedHeaders);

      if (exposedHeaders) {
        res.set("Access-Control-Expose-Headers", exposedHeaders);
      }

      if (corsOptions.credentials) {
        res.set("Access-Control-Allow-Credentials", "true");
      }

      res.set("Access-Control-Max-Age", String(corsOptions.maxAge));

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
   * Run the tail of the reply lifecycle and return the response.
   *
   * Every exit from `handleRequest` goes through here so onResponse hooks -
   * access logs, latency metrics, tracing spans - observe failures and
   * short-circuits, not just successes. Hook errors are logged inside
   * `executeOnResponse`, so this is safe on an error path.
   */
  private async finalize(
    fastifyReq: Parameters<FastifyHooksManager["executeOnResponse"]>[0],
    fastifyReply: Parameters<FastifyHooksManager["executeOnResponse"]>[1],
    response: Response
  ): Promise<Response> {
    // Publish the real status onto the reply before observers read it. The
    // fastifyReply is a parallel object that the Express-handler path never
    // writes to, so without this every hook sees 200 - including on a 404 or a
    // 500 - which silently corrupts the standard access-log/metrics idiom.
    if (fastifyReply.statusCode !== response.status) {
      fastifyReply.statusCode = response.status;
    }
    await this.fastifyHooks.executeOnResponse(fastifyReq, fastifyReply);
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

    // 101/204/205/304 forbid a body. Attaching one produces malformed HTTP
    // (e.g. 204 with Content-Length) that can mis-frame the next response on a
    // keep-alive connection.
    if (NULL_BODY_STATUSES.has(status)) {
      headers.delete("Content-Type");
      headers.delete("Content-Length");
      return new Response(null, { status, headers });
    }

    if (payload === null || payload === undefined) {
      // 204/205/304 forbid a body; for the rest an empty body is correct.
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
    this.versioningOptions = versioningOptions;

    // The base signature types the inner function as returning `Function`, but
    // NestJS registers the inner function itself as the route handler and
    // ignores what it returns. The casts below reconcile the two.
    const filtered = (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
      const accepted = Array.isArray(version) ? version : [version];

      // VERSION_NEUTRAL handlers answer regardless of the requested version.
      if (accepted.includes(VERSION_NEUTRAL as unknown as string | symbol)) {
        return handler(req, res, next);
      }

      // URI versioning is resolved by NestJS through the route path itself, so
      // reaching this handler already means the version matched.
      if (versioningOptions.type === VersioningType.URI) {
        return handler(req, res, next);
      }

      const requested = this.extractRequestVersion(req, versioningOptions);
      if (requested !== undefined && accepted.some((v) => String(v) === requested)) {
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

  public useStaticAssets(root: string, options?: { prefix?: string }): this {
    let prefix = options?.prefix ?? "/";
    if (!prefix.startsWith("/")) prefix = `/${prefix}`;
    if (prefix.length > 1 && prefix.endsWith("/")) prefix = prefix.slice(0, -1);

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

        try {
          const file = Bun.file(resolved);
          if (!(await file.exists())) return next();
          if (!(await BunAdapter.isWithinRootOnDisk(root, resolved))) return next();
          res.type(file.type || "application/octet-stream");
          // Static content is attacker-influenced in any app that lets users
          // populate the root, so refuse MIME sniffing.
          res.set("X-Content-Type-Options", "nosniff");
          res.send(new Uint8Array(await file.arrayBuffer()));
        } catch {
          next();
        }
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
   * Confirm a resolved path is still inside the root once symlinks are followed.
   * The lexical check above cannot see a link that points outside the root.
   */
  private static async isWithinRootOnDisk(root: string, resolved: string): Promise<boolean> {
    try {
      const { realpath } = await import("fs/promises");
      const realRoot = await realpath(root.endsWith("/") ? root.slice(0, -1) : root);
      const realTarget = await realpath(resolved);
      return realTarget === realRoot || realTarget.startsWith(`${realRoot}/`);
    } catch {
      return false;
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
