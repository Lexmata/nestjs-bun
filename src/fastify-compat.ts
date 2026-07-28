/**
 * Fastify compatibility layer for Bun
 *
 * This module provides Fastify-like request and reply objects,
 * as well as hook and plugin support for Fastify middleware compatibility.
 *
 * This layer targets Bun only; Node compatibility is a non-goal.
 */

import { Logger } from "@nestjs/common";

/** Shared logger so diagnostics honour the app's log level and structured output. */
const logger = new Logger("FastifyCompat");

/**
 * Default ceiling for a single hook (or plugin) that declares `done` but never
 * calls it. `Bun.serve` has no request timeout of its own, so without this a
 * buggy hook would pin the connection — and its heap — forever.
 */
export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/**
 * Fastify-compatible request object
 */
export interface FastifyRequest {
  // Original Bun request
  readonly raw: Request;

  // Fastify-like properties
  id: string;
  params: Record<string, string>;

  /**
   * Parsed query string.
   *
   * NOTE: repeated keys are collapsed **last-wins** — `?a=1&a=2` yields
   * `{ a: "2" }`. Read `request.raw.url` / `new URL(...).searchParams.getAll()`
   * when every value of a repeated key matters.
   */
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
  method: string;
  url: string;

  /**
   * The matched route pattern (e.g. `/users/:id`) when the caller supplied
   * `routePattern`, otherwise the concrete request pathname. Prefer supplying
   * the pattern: it is the low-cardinality key used for metrics/logging.
   */
  routerPath: string;
  routerMethod: string;

  /**
   * Remote address. Proxy headers (`x-forwarded-for`, `x-real-ip`) are only
   * consulted when the request was created with `trustProxy: true`.
   */
  ip: string;

  /**
   * Forwarded address chain. Always `[]` unless `trustProxy: true` was set,
   * matching Fastify's default of `trustProxy: false`.
   */
  ips: string[];
  hostname: string;
  protocol: "http" | "https";
  is404: boolean;

  /**
   * Schema validation is **not implemented** — `getValidationFunction`,
   * `compileValidationSchema` and `validateInput` all throw.
   *
   * This adapter does not ship a JSON-schema validator; use a NestJS
   * `ValidationPipe` (or a DTO validator) instead. Throwing keeps misuse loud:
   * returning `undefined` from the compiler pair only defers the failure to a
   * `TypeError: validate is not a function` at request time, and returning
   * `true` from `validateInput` would silently report every input as valid.
   */
  getValidationFunction(httpPart: string): unknown;

  /** @see {@link FastifyRequest.getValidationFunction} — not implemented, throws. */
  compileValidationSchema(schema: unknown, httpPart: string): unknown;

  /** @see {@link FastifyRequest.getValidationFunction} — not implemented, throws. */
  validateInput(input: unknown, schema: unknown, httpPart: string): boolean;
}

/**
 * Fastify-compatible reply object
 */
export interface FastifyReply {
  // Internal state (getters/setters over a single source of truth)
  readonly _headers: Headers;
  _statusCode: number;
  _body: unknown;
  _sent: boolean;
  readonly sent: boolean;

  // Properties
  statusCode: number;
  readonly elapsedTime: number;

  // Methods
  code(statusCode: number): FastifyReply;
  status(statusCode: number): FastifyReply;
  header(key: string, value: string): FastifyReply;
  headers(headers: Record<string, string>): FastifyReply;
  getHeader(key: string): string | null;
  getHeaders(): Record<string, string>;
  removeHeader(key: string): FastifyReply;
  hasHeader(key: string): boolean;
  type(contentType: string): FastifyReply;
  serializer(fn: (payload: unknown) => string): FastifyReply;
  send(payload?: unknown): void;
  redirect(url: string): FastifyReply;
  redirect(statusCode: number, url: string): FastifyReply;
  callNotFound(): void;
  getResponseTime(): number;

  // Build final response
  _buildResponse(): Response;
}

/**
 * Fastify hook names supported by this adapter.
 *
 * Fastify itself also defines `preParsing`, `onTimeout`, `onClose`, `onReady`
 * and `onListen`; those have no meaningful execution stage here and
 * {@link FastifyHooksManager.addHook} throws when they are registered.
 */
export type FastifyHookName =
  | "onRequest"
  | "preValidation"
  | "preHandler"
  | "preSerialization"
  | "onSend"
  | "onError"
  | "onResponse";

/**
 * Runtime list matching {@link FastifyHookName}.
 */
export const SUPPORTED_FASTIFY_HOOKS: readonly FastifyHookName[] = [
  "onRequest",
  "preValidation",
  "preHandler",
  "preSerialization",
  "onSend",
  "onError",
  "onResponse",
] as const;

export type FastifyOnRequestHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
) => void | Promise<void>;

/**
 * Runs after the body has been parsed and before the route handler.
 */
export type FastifyPreValidationHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
) => void | Promise<void>;

export type FastifyPreHandlerHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
) => void | Promise<void>;

/**
 * Payload-transforming hook signature.
 *
 * The payload may be replaced either by calling `done(null, newPayload)` or by
 * returning it from an `async` hook. Returning/receiving `undefined` leaves the
 * payload untouched; passing an explicit `null` clears it (empty body).
 */
export type FastifyPayloadHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  done: (err?: Error | null, payload?: unknown) => void
) => unknown;

/**
 * Runs before `onSend` and may transform the payload.
 */
export type FastifyPreSerializationHook = FastifyPayloadHook;

export type FastifyOnSendHook = FastifyPayloadHook;

export type FastifyOnErrorHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  error: Error,
  done: (err?: Error) => void
) => void | Promise<void>;

export type FastifyOnResponseHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
) => void | Promise<void>;

type AnyFastifyHook =
  | FastifyOnRequestHook
  | FastifyPreValidationHook
  | FastifyPreHandlerHook
  | FastifyPreSerializationHook
  | FastifyOnSendHook
  | FastifyOnErrorHook
  | FastifyOnResponseHook;

/**
 * Fastify plugin interface
 */
export type FastifyPlugin<Options = Record<string, unknown>> = (
  instance: FastifyInstance,
  opts: Options,
  done: (err?: Error) => void
) => void | Promise<void>;

/**
 * Fastify instance interface (subset for compatibility)
 */
export interface FastifyInstance {
  // Decorators
  decorate<T>(name: string, value: T): FastifyInstance;
  decorateRequest<T>(name: string, value: T): FastifyInstance;
  decorateReply<T>(name: string, value: T): FastifyInstance;
  hasDecorator(name: string): boolean;
  hasRequestDecorator(name: string): boolean;
  hasReplyDecorator(name: string): boolean;

  // Hooks
  addHook(name: "onRequest", hook: FastifyOnRequestHook): FastifyInstance;
  addHook(name: "preValidation", hook: FastifyPreValidationHook): FastifyInstance;
  addHook(name: "preHandler", hook: FastifyPreHandlerHook): FastifyInstance;
  addHook(name: "preSerialization", hook: FastifyPreSerializationHook): FastifyInstance;
  addHook(name: "onSend", hook: FastifyOnSendHook): FastifyInstance;
  addHook(name: "onError", hook: FastifyOnErrorHook): FastifyInstance;
  addHook(name: "onResponse", hook: FastifyOnResponseHook): FastifyInstance;

  // Plugins
  register<Options>(plugin: FastifyPlugin<Options>, opts?: Options): FastifyInstance;

  // Routing (for completeness)
  get(path: string, handler: FastifyRouteHandler): FastifyInstance;
  post(path: string, handler: FastifyRouteHandler): FastifyInstance;
  put(path: string, handler: FastifyRouteHandler): FastifyInstance;
  delete(path: string, handler: FastifyRouteHandler): FastifyInstance;
  patch(path: string, handler: FastifyRouteHandler): FastifyInstance;
  options(path: string, handler: FastifyRouteHandler): FastifyInstance;
  head(path: string, handler: FastifyRouteHandler): FastifyInstance;
  all(path: string, handler: FastifyRouteHandler): FastifyInstance;

  // Properties
  prefix: string;
}

export type FastifyRouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply
) => unknown | Promise<unknown>;

/**
 * Options for {@link createFastifyRequest}
 */
export interface CreateFastifyRequestOptions {
  /**
   * The matched route pattern (e.g. `/users/:id`). Used for `routerPath`.
   * Falls back to the concrete pathname when omitted.
   */
  routePattern?: string;

  /**
   * Whether `x-forwarded-*` headers may be trusted. Defaults to `false`,
   * matching Fastify.
   */
  trustProxy?: boolean;

  /**
   * The peer/socket address of the connection, when the server can provide it.
   */
  remoteAddress?: string;
}

/**
 * Create a Fastify-compatible request object from a Bun Request
 *
 * @param bunRequest - the incoming Bun/WHATWG request
 * @param params - route parameters extracted by the router
 * @param requestId - explicit request id (generated when omitted)
 * @param options - see {@link CreateFastifyRequestOptions}
 */
export function createFastifyRequest(
  bunRequest: Request,
  params: Record<string, string> = {},
  requestId?: string,
  options: CreateFastifyRequestOptions = {}
): FastifyRequest {
  const url = new URL(bunRequest.url);
  const { routePattern, trustProxy = false, remoteAddress } = options;

  // Parse headers into object
  const headers: Record<string, string | undefined> = {};
  bunRequest.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Parse query string (last-wins for repeated keys, see FastifyRequest.query)
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  // Resolve the client address. Proxy headers are only honoured when the
  // caller opted into trusting them; otherwise they are trivially spoofable.
  let ip: string;
  let ips: string[];

  if (trustProxy) {
    const forwarded = bunRequest.headers.get("x-forwarded-for");
    const forwardedChain = forwarded
      ? forwarded
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];

    ip =
      forwardedChain[0] ??
      bunRequest.headers.get("x-real-ip") ??
      remoteAddress ??
      "127.0.0.1";
    ips = forwardedChain.length > 0 ? forwardedChain : [ip];
  } else {
    ip = remoteAddress ?? "127.0.0.1";
    ips = [];
  }

  const forwardedProto = trustProxy
    ? bunRequest.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    : undefined;
  const forwardedHost = trustProxy
    ? bunRequest.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    : undefined;

  const protocol: "http" | "https" = forwardedProto
    ? forwardedProto === "https"
      ? "https"
      : "http"
    : url.protocol === "https:"
      ? "https"
      : "http";

  const req: FastifyRequest = {
    raw: bunRequest,
    id: requestId ?? generateRequestId(),
    params,
    query,
    body: undefined,
    headers,
    method: bunRequest.method,
    url: url.pathname + url.search,
    routerPath: routePattern ?? url.pathname,
    routerMethod: bunRequest.method,
    ip,
    ips,
    hostname: forwardedHost ?? url.hostname,
    protocol,
    is404: false,

    getValidationFunction(_httpPart: string): unknown {
      throw createValidationNotImplementedError();
    },

    compileValidationSchema(_schema: unknown, _httpPart: string): unknown {
      throw createValidationNotImplementedError();
    },

    validateInput(_input: unknown, _schema: unknown, _httpPart: string): boolean {
      throw createValidationNotImplementedError();
    },
  };

  return req;
}

/**
 * Every entry point of the (unimplemented) schema-validation surface throws
 * this, so misuse fails at the call site instead of at request time.
 */
function createValidationNotImplementedError(): Error {
  return new Error("Schema validation is not implemented; use a NestJS ValidationPipe");
}

/**
 * Statuses for which the fetch `Response` constructor forbids a body.
 *
 * NOTE: duplicated in `src/express-compat.ts` and `src/utils/response.ts`; all
 * three must stay in sync with the Fetch spec's null-body status set.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Create a Fastify-compatible reply object
 *
 * @param request - optional originating request, used only to add context to
 *   `FST_ERR_REP_ALREADY_SENT` errors.
 */
export function createFastifyReply(
  request?: Pick<FastifyRequest, "id" | "method" | "url">
): FastifyReply {
  const headers = new Headers();
  let statusCode = 200;
  let body: unknown = null;
  let sent = false;
  const startTime = Date.now();
  let sentAt: number | null = null;
  let serializer: ((payload: unknown) => string) | null = null;

  const markSent = (): void => {
    sent = true;
    if (sentAt === null) sentAt = Date.now();
  };

  const describeRequest = (): string =>
    request ? ` (request ${request.id}: ${request.method} ${request.url})` : "";

  const reply: FastifyReply = {
    _headers: headers,

    // Internal fields are views over the closure state so there is exactly one
    // source of truth (no snapshot copies that drift out of sync).
    get _statusCode() {
      return statusCode;
    },
    set _statusCode(code: number) {
      statusCode = code;
    },

    get _body() {
      return body;
    },
    set _body(value: unknown) {
      body = value;
    },

    get _sent() {
      return sent;
    },
    set _sent(value: boolean) {
      sent = value;
      if (value && sentAt === null) sentAt = Date.now();
    },

    get sent() {
      return sent;
    },

    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },

    get elapsedTime() {
      return (sentAt ?? Date.now()) - startTime;
    },

    code(code: number): FastifyReply {
      statusCode = code;
      return this;
    },

    status(code: number): FastifyReply {
      return this.code(code);
    },

    header(key: string, value: string): FastifyReply {
      headers.set(key, value);
      return this;
    },

    headers(newHeaders: Record<string, string>): FastifyReply {
      for (const [key, value] of Object.entries(newHeaders)) {
        headers.set(key, value);
      }
      return this;
    },

    getHeader(key: string): string | null {
      return headers.get(key);
    },

    getHeaders(): Record<string, string> {
      const result: Record<string, string> = {};
      headers.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    },

    removeHeader(key: string): FastifyReply {
      headers.delete(key);
      return this;
    },

    hasHeader(key: string): boolean {
      return headers.has(key);
    },

    type(contentType: string): FastifyReply {
      headers.set("Content-Type", contentType);
      return this;
    },

    serializer(fn: (payload: unknown) => string): FastifyReply {
      serializer = fn;
      return this;
    },

    send(payload?: unknown): void {
      if (sent) {
        throw createAlreadySentError(describeRequest());
      }

      if (payload !== undefined) {
        body = payload;
      }

      markSent();
    },

    redirect(statusOrUrl: number | string, url?: string): FastifyReply {
      if (typeof statusOrUrl === "number" && url) {
        statusCode = statusOrUrl;
        headers.set("Location", url);
      } else {
        statusCode = 302;
        headers.set("Location", statusOrUrl as string);
      }
      markSent();
      return this;
    },

    callNotFound(): void {
      statusCode = 404;
      body = { statusCode: 404, error: "Not Found", message: "Route not found" };
      markSent();
    },

    getResponseTime(): number {
      return (sentAt ?? Date.now()) - startTime;
    },

    _buildResponse(): Response {
      // Redirect: build the response manually. `Response.redirect` drops every
      // header except `location` (losing Set-Cookie) and throws RangeError for
      // 3xx codes outside {301,302,303,307,308}.
      if (headers.has("Location") && statusCode >= 300 && statusCode < 400) {
        return new Response(null, { status: statusCode, headers });
      }

      let responseBody: string | ArrayBuffer | Uint8Array | ReadableStream | Blob | null = null;

      // 101/204/205/304 must not carry a body — the Response constructor throws.
      if (!NULL_BODY_STATUSES.has(statusCode) && body !== null && body !== undefined) {
        if (serializer) {
          responseBody = serializer(body);
        } else if (typeof body === "string") {
          responseBody = body;
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "text/plain; charset=utf-8");
          }
        } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
          responseBody = body;
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/octet-stream");
          }
        } else if (body instanceof ReadableStream) {
          responseBody = body;
        } else if (body instanceof Blob) {
          responseBody = body;
        } else {
          responseBody = JSON.stringify(body);
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json; charset=utf-8");
          }
        }
      }

      return new Response(responseBody, {
        status: statusCode,
        headers,
      });
    },
  };

  return reply;
}

/**
 * Error thrown when `reply.send()` is called on an already-sent reply.
 */
function createAlreadySentError(context: string): Error & { code: string } {
  const error = new Error(`Reply was already sent${context}`) as Error & { code: string };
  error.code = "FST_ERR_REP_ALREADY_SENT";
  return error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Error settled for a hook that declared `done` (or returned a promise) and
 * never completed within the configured budget.
 */
function createHookTimeoutError(hookName: string, timeoutMs: number): Error {
  return new Error(`${hookName} hook timed out after ${timeoutMs}ms without calling done()`);
}

/**
 * Options for {@link FastifyHooksManager}
 */
export interface FastifyHooksManagerOptions {
  /**
   * How long a single hook may run without calling `done()` (or settling the
   * promise it returned) before the stage is failed. Defaults to
   * {@link DEFAULT_HOOK_TIMEOUT_MS}.
   */
  hookTimeout?: number;
}

/**
 * Fastify hooks manager
 */
export class FastifyHooksManager {
  /**
   * Ceiling for a single hook. A hook that declares `done` and never calls it
   * would otherwise leave the request pending forever, since `Bun.serve` has no
   * request timeout of its own.
   */
  private hookTimeout: number;

  private onRequestHooks: FastifyOnRequestHook[] = [];
  private preValidationHooks: FastifyPreValidationHook[] = [];
  private preHandlerHooks: FastifyPreHandlerHook[] = [];
  private preSerializationHooks: FastifyPreSerializationHook[] = [];
  private onSendHooks: FastifyOnSendHook[] = [];
  private onErrorHooks: FastifyOnErrorHook[] = [];
  private onResponseHooks: FastifyOnResponseHook[] = [];

  constructor(options: FastifyHooksManagerOptions = {}) {
    this.hookTimeout = options.hookTimeout ?? DEFAULT_HOOK_TIMEOUT_MS;
  }

  /**
   * Update the per-hook timeout after construction (the adapter's
   * `middlewareTimeout` may be set via `setServerOptions()` after the manager
   * has been created). Non-finite or non-positive values are ignored.
   */
  public setHookTimeout(timeoutMs: number): void {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      this.hookTimeout = timeoutMs;
    }
  }

  /** The timeout currently applied to each hook, in milliseconds. */
  public getHookTimeout(): number {
    return this.hookTimeout;
  }

  public addHook(name: "onRequest", hook: FastifyOnRequestHook): void;
  public addHook(name: "preValidation", hook: FastifyPreValidationHook): void;
  public addHook(name: "preHandler", hook: FastifyPreHandlerHook): void;
  public addHook(name: "preSerialization", hook: FastifyPreSerializationHook): void;
  public addHook(name: "onSend", hook: FastifyOnSendHook): void;
  public addHook(name: "onError", hook: FastifyOnErrorHook): void;
  public addHook(name: "onResponse", hook: FastifyOnResponseHook): void;
  /**
   * Escape hatch for dynamically-computed hook names. Names outside
   * {@link SUPPORTED_FASTIFY_HOOKS} throw instead of being silently dropped.
   */
  public addHook(name: string, hook: AnyFastifyHook): void;
  public addHook(name: string, hook: AnyFastifyHook): void {
    switch (name) {
      case "onRequest":
        this.onRequestHooks.push(hook as FastifyOnRequestHook);
        break;
      case "preValidation":
        this.preValidationHooks.push(hook as FastifyPreValidationHook);
        break;
      case "preHandler":
        this.preHandlerHooks.push(hook as FastifyPreHandlerHook);
        break;
      case "preSerialization":
        this.preSerializationHooks.push(hook as FastifyPreSerializationHook);
        break;
      case "onSend":
        this.onSendHooks.push(hook as FastifyOnSendHook);
        break;
      case "onError":
        this.onErrorHooks.push(hook as FastifyOnErrorHook);
        break;
      case "onResponse":
        this.onResponseHooks.push(hook as FastifyOnResponseHook);
        break;
      default:
        throw new Error(`Fastify hook "${name}" is not supported by BunAdapter`);
    }
  }

  public async executeOnRequest(request: FastifyRequest, reply: FastifyReply): Promise<Error | undefined> {
    return this.executeLifecycleHooks("onRequest", this.onRequestHooks, request, reply);
  }

  /**
   * Runs after the request body has been parsed and before the route handler.
   */
  public async executePreValidation(request: FastifyRequest, reply: FastifyReply): Promise<Error | undefined> {
    return this.executeLifecycleHooks("preValidation", this.preValidationHooks, request, reply);
  }

  public async executePreHandler(request: FastifyRequest, reply: FastifyReply): Promise<Error | undefined> {
    return this.executeLifecycleHooks("preHandler", this.preHandlerHooks, request, reply);
  }

  /**
   * Runs before `onSend` and may replace the payload.
   */
  public async executePreSerialization(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown
  ): Promise<{ error?: Error; payload: unknown }> {
    return this.executePayloadHooks("preSerialization", this.preSerializationHooks, request, reply, payload);
  }

  public async executeOnSend(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown
  ): Promise<{ error?: Error; payload: unknown }> {
    return this.executePayloadHooks("onSend", this.onSendHooks, request, reply, payload);
  }

  /**
   * Run `onError` hooks.
   *
   * `onError` is observability-only in Fastify: it may not change the reply.
   * The returned boolean therefore reports whether a hook actually *replied*
   * (`reply.sent`), not whether it called `done()` without an error. A
   * logging-only hook returns `false` so the caller still emits its 500.
   *
   * A hook that throws, rejects or never calls `done()` is logged (the original
   * error is preserved and still reported by the caller) rather than swallowed:
   * a broken reporting hook must not make the dashboard read as healthy.
   */
  public async executeOnError(request: FastifyRequest, reply: FastifyReply, error: Error): Promise<boolean> {
    for (const hook of this.onErrorHooks) {
      await new Promise<void>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const settle = (hookError?: Error): void => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          if (hookError) {
            logger.error(
              `onError hook failed while reporting "${error.message}": ${hookError.message}`,
              hookError.stack
            );
          }
          resolve();
        };

        const armTimeout = (): void => {
          if (settled) return;
          timer = setTimeout(
            () => settle(createHookTimeoutError("onError", this.hookTimeout)),
            this.hookTimeout
          );
        };

        try {
          const maybePromise = hook(request, reply, error, () => settle());

          if (maybePromise instanceof Promise) {
            maybePromise
              .then(() => settle())
              .catch((err: unknown) => settle(toError(err)));
            armTimeout();
          } else if (hook.length < 4) {
            // Hook never received `done` and returned no promise — nothing to await.
            settle();
          } else {
            // Hook holds `done`; bound the wait so a stuck reporter cannot pin
            // the request that is already failing.
            armTimeout();
          }
        } catch (err) {
          settle(toError(err));
        }
      });

      if (reply.sent) return true;
    }

    return reply.sent;
  }

  public async executeOnResponse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    for (const hook of this.onResponseHooks) {
      const error = await this.executeHook("onResponse", hook, request, reply);
      if (error) {
        // onResponse runs after the reply is committed, so the error cannot be
        // surfaced to the client — but it must not vanish either.
        logger.error(`onResponse hook failed: ${error.message}`, error.stack);
      }
    }
  }

  private async executeLifecycleHooks(
    hookName: FastifyHookName,
    hooks: Array<(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void | Promise<void>>,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<Error | undefined> {
    for (const hook of hooks) {
      const result = await this.executeHook(hookName, hook, request, reply);
      if (result instanceof Error) return result;
      if (reply.sent) return undefined;
    }
    return undefined;
  }

  private async executePayloadHooks(
    hookName: FastifyHookName,
    hooks: FastifyPayloadHook[],
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown
  ): Promise<{ error?: Error; payload: unknown }> {
    let currentPayload = payload;

    for (const hook of hooks) {
      const result = await new Promise<{ error?: Error; payload?: unknown }>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const settle = (value: { error?: Error; payload?: unknown }): void => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          resolve(value);
        };

        const armTimeout = (): void => {
          if (settled) return;
          timer = setTimeout(
            () => settle({ error: createHookTimeoutError(hookName, this.hookTimeout) }),
            this.hookTimeout
          );
        };

        try {
          const maybePromise = hook(request, reply, currentPayload, (err, newPayload) => {
            settle({ error: err ?? undefined, payload: newPayload });
          });

          if (maybePromise instanceof Promise) {
            // An async hook may replace the payload by returning it.
            maybePromise
              .then((value) => settle({ payload: value }))
              .catch((err: unknown) => settle({ error: toError(err) }));
            armTimeout();
          } else if (hook.length < 4) {
            // Hook never received `done` and returned no promise; a plain
            // return value still replaces the payload.
            settle({ payload: maybePromise });
          } else {
            // Hook holds `done` and may never call it; fail the stage instead
            // of leaving the response pending forever.
            armTimeout();
          }
        } catch (err) {
          settle({ error: toError(err) });
        }
      });

      if (result.error) {
        return { error: result.error, payload: currentPayload };
      }

      // `undefined` means "unchanged"; an explicit `null` clears the payload.
      if (result.payload !== undefined) {
        currentPayload = result.payload;
      }
    }

    return { payload: currentPayload };
  }

  private async executeHook(
    hookName: FastifyHookName,
    hook: (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void | Promise<void>,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<Error | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(err);
      };

      const armTimeout = (): void => {
        if (settled) return;
        timer = setTimeout(
          () => settle(createHookTimeoutError(hookName, this.hookTimeout)),
          this.hookTimeout
        );
      };

      try {
        const maybePromise = hook(request, reply, settle);

        if (maybePromise instanceof Promise) {
          maybePromise.then(() => settle(undefined)).catch((err: unknown) => settle(toError(err)));
          armTimeout();
        } else if (hook.length < 3) {
          // Hook never received `done` and returned no promise, so nothing will
          // ever complete it — resolve now instead of hanging the request.
          settle(undefined);
        } else {
          // Hook holds `done`. If it never calls it nothing else will settle
          // this promise, and Bun.serve has no request timeout — so bound the
          // wait and route the failure through onError as a 500.
          armTimeout();
        }
      } catch (err) {
        // A synchronous throw must be routed through onError, not rejected.
        settle(toError(err));
      }
    });
  }
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Fastify plugin registry
 *
 * NOTE: this registry provides **no encapsulation**. Every plugin receives the
 * same shared instance, so hooks, decorators and routes added inside a plugin
 * apply to the whole application. `register(plugin, { prefix })` therefore
 * throws rather than silently ignoring the prefix.
 */
export class FastifyPluginRegistry {
  private decorators: Map<string, unknown> = new Map();
  private requestDecorators: Map<string, unknown> = new Map();
  private replyDecorators: Map<string, unknown> = new Map();
  private requestDecoratorFactories: Map<string, (request: FastifyRequest) => unknown> = new Map();
  private replyDecoratorFactories: Map<string, (reply: FastifyReply) => unknown> = new Map();
  private plugins: Array<{ plugin: FastifyPlugin; opts: unknown }> = [];
  private initializedPluginCount = 0;
  private instance?: FastifyInstance;
  private appliedInstanceKeys: Set<string> = new Set();

  public decorate<T>(name: string, value: T): void {
    this.decorators.set(name, value);
    if (this.instance) {
      this.attachInstanceDecorator(this.instance, name, value);
    }
  }

  public decorateRequest<T>(name: string, value: T): void {
    this.requestDecorators.set(name, value);
  }

  public decorateReply<T>(name: string, value: T): void {
    this.replyDecorators.set(name, value);
  }

  /**
   * Decorate every request with a value computed per request.
   *
   * Use this instead of passing a function to {@link decorateRequest}: plain
   * function values are attached as-is so they become callable methods.
   */
  public decorateRequestLazy(name: string, factory: (request: FastifyRequest) => unknown): void {
    this.requestDecoratorFactories.set(name, factory);
  }

  /**
   * Decorate every reply with a value computed per request.
   */
  public decorateReplyLazy(name: string, factory: (reply: FastifyReply) => unknown): void {
    this.replyDecoratorFactories.set(name, factory);
  }

  public hasDecorator(name: string): boolean {
    return this.decorators.has(name);
  }

  public hasRequestDecorator(name: string): boolean {
    return this.requestDecorators.has(name) || this.requestDecoratorFactories.has(name);
  }

  public hasReplyDecorator(name: string): boolean {
    return this.replyDecorators.has(name) || this.replyDecoratorFactories.has(name);
  }

  public getDecorator<T>(name: string): T | undefined {
    return this.decorators.get(name) as T | undefined;
  }

  /**
   * Bind the registry to the Fastify instance object and copy every registered
   * instance decorator onto it. Call this *before* {@link initializePlugins}
   * so that decorators added by one plugin are readable (as `instance.<name>`)
   * by plugins registered later.
   */
  public applyInstanceDecorators(instance: FastifyInstance): void {
    this.instance = instance;
    this.decorators.forEach((value, key) => {
      this.attachInstanceDecorator(instance, key, value);
    });
  }

  private attachInstanceDecorator(instance: FastifyInstance, name: string, value: unknown): void {
    if (!this.appliedInstanceKeys.has(name) && name in (instance as unknown as object)) {
      throw new Error(`The decorator "${name}" has already been added to the Fastify instance`);
    }
    (instance as unknown as Record<string, unknown>)[name] = value;
    this.appliedInstanceKeys.add(name);
  }

  /**
   * Register a plugin.
   *
   * @throws when `opts.prefix` is supplied — route prefixing requires
   *   encapsulation, which this compatibility layer does not implement.
   */
  public register<Options>(plugin: FastifyPlugin<Options>, opts?: Options): void {
    if (
      opts !== null &&
      typeof opts === "object" &&
      "prefix" in (opts as Record<string, unknown>) &&
      (opts as Record<string, unknown>).prefix !== undefined
    ) {
      throw new Error("plugin prefix is not supported");
    }
    this.plugins.push({ plugin: plugin as FastifyPlugin, opts });
  }

  /**
   * Initialize every plugin that has not been initialized yet. Calling this
   * more than once only runs plugins registered since the previous call.
   *
   * @param instance - the Fastify instance handed to each plugin
   * @param timeoutMs - how long a single plugin may run without calling
   *   `done()` (or settling its promise) before initialization is rejected.
   *   Defaults to {@link DEFAULT_HOOK_TIMEOUT_MS}. Rejecting is deliberate: a
   *   plugin that never calls `done()` would otherwise leave `listen()` pending
   *   forever, so the process would boot, never serve, and fail health checks
   *   with no diagnostic at all.
   */
  public async initializePlugins(
    instance: FastifyInstance,
    timeoutMs: number = DEFAULT_HOOK_TIMEOUT_MS
  ): Promise<void> {
    while (this.initializedPluginCount < this.plugins.length) {
      const index = this.initializedPluginCount;
      const entry = this.plugins[index]!;
      this.initializedPluginCount++;

      const { plugin, opts } = entry;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const settle = (err?: unknown): void => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          if (err) reject(toError(err));
          else resolve();
        };

        const armTimeout = (): void => {
          if (settled) return;
          timer = setTimeout(
            () =>
              settle(
                new Error(
                  `Fastify plugin at index ${index} timed out after ${timeoutMs}ms without calling done()`
                )
              ),
            timeoutMs
          );
        };

        const pluginOpts = (opts ?? {}) as Record<string, unknown>;
        const maybePromise = plugin(instance, pluginOpts, (err) => settle(err));

        if (maybePromise instanceof Promise) {
          maybePromise.then(() => settle()).catch((err: unknown) => settle(err));
          armTimeout();
        } else if (plugin.length < 3) {
          // Plugin never received `done` and returned no promise — Fastify
          // treats that as "finished synchronously".
          settle();
        } else {
          armTimeout();
        }
      });
    }
  }

  public applyRequestDecorators(request: FastifyRequest): void {
    this.requestDecorators.forEach((value, key) => {
      // Attach as-is: function values become real methods whose `this` binds to
      // the request at call time (the documented Fastify idiom).
      (request as unknown as Record<string, unknown>)[key] = value;
    });
    this.requestDecoratorFactories.forEach((factory, key) => {
      (request as unknown as Record<string, unknown>)[key] = factory(request);
    });
  }

  public applyReplyDecorators(reply: FastifyReply): void {
    this.replyDecorators.forEach((value, key) => {
      (reply as unknown as Record<string, unknown>)[key] = value;
    });
    this.replyDecoratorFactories.forEach((factory, key) => {
      (reply as unknown as Record<string, unknown>)[key] = factory(reply);
    });
  }
}

/**
 * Type for Fastify-style middleware (using hooks pattern)
 */
export type FastifyMiddleware = FastifyOnRequestHook | FastifyPreHandlerHook;

/**
 * Check whether a function has been explicitly tagged as Fastify middleware.
 *
 * There is no arity- or shape-based detection: Fastify hooks
 * `(request, reply, done)` and Express middleware `(req, res, next)` are
 * indistinguishable at runtime. Only functions passed through
 * {@link markAsFastify} return `true`.
 */
export function isFastifyMiddleware(fn: (...args: unknown[]) => unknown): boolean {
  return (fn as { _fastify?: boolean })._fastify === true;
}

/**
 * Mark a function as Fastify middleware so {@link isFastifyMiddleware}
 * recognises it.
 */
export function markAsFastify<T extends (...args: unknown[]) => unknown>(fn: T): T {
  (fn as T & { _fastify: boolean })._fastify = true;
  return fn;
}
