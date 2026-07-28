import type { Server } from "bun";
import type { INestApplication, NestApplicationOptions } from "@nestjs/common";
// Type-only: erased at runtime, so this does not create a cycle with
// `bun-adapter.ts`, which imports `BunServerOptions` from this module.
import type { BunAdapter } from "../bun-adapter";

/**
 * Options for configuring the Bun HTTP server.
 *
 * The address to listen on is **not** configured here: it comes from the
 * arguments to `app.listen(port, hostname?)`. The only exception is {@link unix},
 * which replaces host/port entirely.
 */
export interface BunServerOptions {
  /**
   * Unix socket path. When set, the server binds to this socket and the
   * `port`/`hostname` passed to `app.listen()` are ignored.
   */
  unix?: string;

  /**
   * Enable development mode for better error messages
   */
  development?: boolean;

  /**
   * Maximum request body size in bytes
   */
  maxRequestBodySize?: number;

  /**
   * TLS configuration
   */
  tls?: {
    key?: string | Buffer | Array<string | Buffer>;
    cert?: string | Buffer | Array<string | Buffer>;
    ca?: string | Buffer | Array<string | Buffer>;
    passphrase?: string;
  };

  /**
   * Reduce memory usage at some cost to throughput (Bun `lowMemoryMode`).
   *
   * Caution: on Bun 1.3.14 setting this to `true` produces a server that
   * accepts connections and then resets every request (ECONNRESET). This
   * reproduces with a bare `Bun.serve({ lowMemoryMode: true })`, so it is a Bun
   * defect rather than an adapter one - but the option is forwarded verbatim,
   * so enabling it will break your server on that version.
   */
  lowMemoryMode?: boolean;

  /**
   * Trust `X-Forwarded-*` headers when deriving `req.ip`, `req.protocol` and
   * `req.hostname`. Defaults to `false`: these headers are client-controlled, so
   * trusting them unconditionally lets any caller spoof its own address. Enable
   * only when the app sits behind a proxy you control.
   *
   * - `false` — headers are ignored entirely; only the socket address is used.
   * - `true` — trust the chain and take the left-most (client-claimed) entry of
   *   `X-Forwarded-For`.
   *
   * Express's numeric hop-count form is deliberately **not** accepted here. The
   * compat layers implement boolean trust only, so a number could only be
   * degraded to "trust the left-most entry" — which is precisely the spoofing a
   * hop count exists to prevent. {@link getIp} does implement hop counts if you
   * need one; call it directly with the count.
   *
   * This is an adapter-level option; it is not forwarded to `Bun.serve()`.
   */
  trustProxy?: boolean;

  /**
   * How long, in milliseconds, a single Express middleware may run without
   * calling `next()` or ending the response before the request fails with a
   * 500. Express waits indefinitely; a bounded wait stops a buggy middleware
   * from leaking connections. Defaults to 30000.
   *
   * This is an adapter-level option; it is not forwarded to `Bun.serve()`.
   */
  middlewareTimeout?: number;
}

/**
 * A `Request` carrying the routing data the adapter attaches to it.
 *
 * There is deliberately no body member here: the body is read asynchronously and
 * is exposed by `ParsedRequest` (from `enhanceRequest()`) as a lazily-created
 * promise. Use `ParsedRequest` when you need the parsed body, or reach it from
 * the Express/Fastify wrappers as `req.body`.
 */
export interface BunRequest extends Request {
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  /** Raw request bytes, present only when the app was created with `rawBody: true`. */
  rawBody?: Buffer;
}

/**
 * The HTTP server object the adapter exposes.
 *
 * This is deliberately NOT Bun's `Server`: NestJS requires an
 * EventEmitter-shaped server, so the adapter wraps it. Reach the underlying
 * Bun server through `.server` when you need `reload()`, `publish()` or
 * `requestIP()`.
 */
export interface BunHttpServer {
  /** The underlying Bun server, or null before `listen()` and after `close()`. */
  readonly server: Server<unknown> | null;
  readonly listening: boolean;
  address(): { port: number; address: string } | null;
  close(callback?: () => void): Promise<void> | void;
  on(event: string, listener: (...args: never[]) => void): unknown;
  once(event: string, listener: (...args: never[]) => void): unknown;
  emit(event: string, ...args: never[]): boolean;
}

/**
 * NestJS application instance configured for Bun
 */
export interface NestBunApplication extends INestApplication {
  /**
   * Get the adapter's HTTP server wrapper. Use `.server` on the result to
   * reach the underlying `Bun.Server`.
   */
  getHttpServer(): BunHttpServer;

  /**
   * Get the underlying {@link BunAdapter}.
   *
   * Narrowed from `INestApplication`'s `HttpServer` return type so that
   * adapter-specific APIs — `addHook()`, `register()`, `useMiddleware()` — are
   * reachable without the `as unknown as BunAdapter` double cast, which erased
   * the hook-name checking that `addHook`'s overloads exist to provide.
   *
   */
  getHttpAdapter(): BunAdapter;
}

/**
 * Options for creating a NestJS Bun application.
 *
 * `bodyParser` is intentionally omitted: Bun parses request bodies natively and
 * the adapter always does so, so the option had no effect in either direction.
 */
export interface NestBunApplicationOptions extends Omit<NestApplicationOptions, "bodyParser"> {
  /**
   * Bun-specific server options.
   *
   * Most members (`unix`, `development`, `maxRequestBodySize`, `tls`,
   * `lowMemoryMode`) are forwarded to the underlying `Bun.serve()` call.
   * `trustProxy` and `middlewareTimeout` are adapter-level behaviour and are
   * deliberately **not** forwarded — `Bun.serve()` does not understand them.
   */
  serverOptions?: BunServerOptions;
}
