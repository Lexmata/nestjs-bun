/**
 * Express compatibility layer for Bun
 *
 * This module provides Express-like request and response objects
 * that wrap Bun's native Request/Response to enable Express middleware compatibility.
 */

import { Logger } from "@nestjs/common";

/** Shared logger so warnings honour the app's log level and structured output. */
const logger = new Logger("ExpressCompat");

/**
 * Express-compatible request object
 */
export interface ExpressRequest {
  // Original Bun request
  readonly raw: Request;

  // Express-like properties
  method: string;
  url: string;
  originalUrl: string;
  path: string;
  baseUrl: string;
  hostname: string;
  ip: string;
  ips: string[];
  protocol: string;
  secure: boolean;
  subdomains: string[];
  xhr: boolean;

  // Parsed data
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  cookies: Record<string, string>;

  // Headers
  headers: Record<string, string | string[] | undefined>;

  // Methods
  get(field: string): string | undefined;
  header(field: string): string | undefined;
  accepts(...types: string[]): string | false;
  acceptsCharsets(...charsets: string[]): string | false;
  acceptsEncodings(...encodings: string[]): string | false;
  acceptsLanguages(...languages: string[]): string | false;
  is(type: string): string | false | null;
  /**
   * Not implemented by this shim: `Range` parsing always returns `undefined`.
   * Read `req.get("range")` and parse it yourself (e.g. with `range-parser`).
   * Kept on the interface so middleware that calls it does not crash.
   */
  range(size: number, options?: { combine?: boolean }): undefined;
}

/**
 * Express-compatible response object
 */
export interface ExpressResponse {
  // Internal state
  readonly _headers: Headers;
  _statusCode: number;
  _body: unknown;
  _ended: boolean;
  headersSent: boolean;
  locals: Record<string, unknown>;

  /**
   * The request this response belongs to. Optional — middleware that pairs the
   * two (error handlers, loggers) reads it off the response.
   */
  req?: ExpressRequest | Request;

  // Status
  statusCode: number;
  statusMessage: string;

  // Methods
  status(code: number): ExpressResponse;
  sendStatus(code: number): void;
  json(body: unknown): void;
  send(body?: unknown): void;
  end(data?: unknown): void;
  set(field: string, value: string): ExpressResponse;
  set(field: Record<string, string>): ExpressResponse;
  header(field: string, value: string): ExpressResponse;
  header(field: Record<string, string>): ExpressResponse;
  /** Reading form — Express returns the response untouched. */
  header(field: string): ExpressResponse;
  setHeader(field: string, value: string): ExpressResponse;
  get(field: string): string | undefined;
  getHeader(field: string): string | undefined;
  removeHeader(field: string): void;
  append(field: string, value: string | string[]): ExpressResponse;
  type(type: string): ExpressResponse;
  contentType(type: string): ExpressResponse;
  /**
   * Not implemented by this shim: `Accept` negotiation never happens, only
   * `obj.default` runs. Call the handler you want directly instead. Kept on the
   * interface so middleware that calls it does not crash.
   */
  format(obj: Record<string, () => void>): void;
  attachment(filename?: string): ExpressResponse;
  cookie(name: string, value: string, options?: CookieOptions): ExpressResponse;
  clearCookie(name: string, options?: CookieOptions): ExpressResponse;
  redirect(url: string): void;
  redirect(status: number, url: string): void;
  location(url: string): ExpressResponse;
  links(links: Record<string, string>): ExpressResponse;
  vary(field: string | string[]): ExpressResponse;

  /**
   * Internal: invoked once when the response is ended. Used by the adapter to
   * avoid polling for out-of-band completion.
   *
   * Registering after the response has already ended invokes `listener`
   * synchronously. Otherwise every registered listener is invoked once, in
   * registration order, at the moment the response is marked ended.
   */
  _onEnd(listener: () => void): void;

  // Build final response
  _buildResponse(): Response;
}

export interface CookieOptions {
  domain?: string;
  encode?: (val: string) => string;
  expires?: Date;
  httpOnly?: boolean;
  /** Milliseconds, exactly like Express. Serialized as `Max-Age` in seconds. */
  maxAge?: number;
  path?: string;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
}

// ==================== Module-scope tables ====================

const STATUS_TEXTS: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  text: "text/plain",
  css: "text/css",
  csv: "text/csv",
  md: "text/markdown",
  markdown: "text/markdown",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  jsonld: "application/ld+json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  wasm: "application/wasm",
  form: "application/x-www-form-urlencoded",
  urlencoded: "application/x-www-form-urlencoded",
  multipart: "multipart/form-data",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  bin: "application/octet-stream",
};

/**
 * Statuses that must never carry a body (per the Fetch/HTTP specs).
 *
 * NOTE: this constant is duplicated in `src/fastify-compat.ts` and
 * `src/utils/response.ts`, and those two copies currently omit `101`. Any fix
 * to the set needs to land in all three places until they are consolidated.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Everything the `Response` constructor accepts as a body in this runtime.
 * Derived from the constructor so it tracks Bun's own typings.
 */
type ResponseBody = NonNullable<ConstructorParameters<typeof Response>[0]>;

// ==================== Shared helpers ====================

/**
 * Get HTTP status text
 */
function getStatusText(status: number): string {
  return STATUS_TEXTS[status] ?? "Unknown";
}

/**
 * Get MIME type from extension or type name.
 * A leading `.` is stripped so `res.type('.html')` behaves like `res.type('html')`.
 */
function getMimeType(type: string): string {
  let value = type.trim();
  while (value.startsWith(".")) {
    value = value.slice(1);
  }

  // If it looks like a MIME type already, return it untouched
  if (value.includes("/")) {
    return value;
  }

  return MIME_TYPES[value.toLowerCase()] ?? "application/octet-stream";
}

/** Byte length of a string without pulling in Node's Buffer typings at call sites. */
function byteLength(value: string): number {
  return Buffer.byteLength(value);
}

// ==================== Request ====================

/**
 * Create an Express-compatible request object from a Bun Request
 *
 * @param bunRequest - the native request
 * @param params - route parameters
 * @param trustProxy - when `true`, `X-Forwarded-*` headers are honoured. Defaults to `false`
 *   because those headers are trivially spoofable when the server is directly reachable.
 * @param remoteAddress - the real peer address (e.g. `server.requestIP(req)?.address`)
 */
export function createExpressRequest(
  bunRequest: Request,
  params: Record<string, string> = {},
  trustProxy = false,
  remoteAddress?: string
): ExpressRequest {
  const url = new URL(bunRequest.url);

  // Lazily-computed, memoised state. Nothing below is parsed until it is read.
  let headersCache: Record<string, string | string[] | undefined> | undefined;
  let queryCache: Record<string, string | string[]> | undefined;
  let cookiesCache: Record<string, string> | undefined;
  let forwardedForCache: string[] | undefined;
  let ipCache: string | undefined;
  let ipsCache: string[] | undefined;
  let protocolCache: string | undefined;
  let hostnameCache: string | undefined;
  let subdomainsCache: string[] | undefined;

  function forwardedFor(): string[] {
    if (forwardedForCache === undefined) {
      const raw = trustProxy ? bunRequest.headers.get("x-forwarded-for") : null;
      forwardedForCache = raw
        ? raw
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        : [];
    }
    return forwardedForCache;
  }

  function parseHeaders(): Record<string, string | string[] | undefined> {
    const result: Record<string, string | string[] | undefined> = {};
    bunRequest.headers.forEach((value, key) => {
      const existing = result[key];
      if (existing) {
        result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        result[key] = value;
      }
    });
    return result;
  }

  function parseQuery(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      if (values.length > 1) {
        result[key] = values;
        continue;
      }
      const first = values[0];
      // `getAll` on a key taken from `keys()` always yields at least one value
      if (first === undefined) continue;
      result[key] = first;
    }
    return result;
  }

  function parseCookies(): Record<string, string> {
    const result: Record<string, string> = {};
    const cookieHeader = bunRequest.headers.get("cookie");
    if (!cookieHeader) return result;

    for (const pair of cookieHeader.split(";")) {
      const eq = pair.indexOf("=");
      // A cookie without a value is not a cookie — skip rather than yielding ""
      if (eq === -1) continue;

      const name = pair.slice(0, eq).trim();
      if (!name || name in result) continue;

      let value = pair.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      try {
        result[name] = decodeURIComponent(value);
      } catch {
        // Malformed percent-escapes: fall back to the raw value like Express does
        result[name] = value;
      }
    }

    return result;
  }

  const req: ExpressRequest = {
    raw: bunRequest,
    method: bunRequest.method,
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    path: url.pathname,
    baseUrl: "",

    get hostname(): string {
      if (hostnameCache === undefined) {
        const forwardedHost = trustProxy ? bunRequest.headers.get("x-forwarded-host") : null;
        if (forwardedHost) {
          // `split` on a non-empty string always yields a first element
          const first = forwardedHost.split(",")[0] ?? forwardedHost;
          hostnameCache = first.trim().replace(/:\d+$/, "");
        } else {
          hostnameCache = url.hostname;
        }
      }
      return hostnameCache;
    },
    set hostname(value: string) {
      hostnameCache = value;
      subdomainsCache = undefined;
    },

    get ip(): string {
      if (ipCache === undefined) {
        if (trustProxy) {
          ipCache =
            forwardedFor()[0] ??
            bunRequest.headers.get("x-real-ip")?.trim() ??
            remoteAddress ??
            "";
        } else {
          ipCache = remoteAddress ?? "";
        }
      }
      return ipCache;
    },
    set ip(value: string) {
      ipCache = value;
    },

    get ips(): string[] {
      // Express: empty unless the proxy chain is actually trusted
      ipsCache ??= trustProxy ? forwardedFor() : [];
      return ipsCache;
    },
    set ips(value: string[]) {
      ipsCache = value;
    },

    get protocol(): string {
      if (protocolCache === undefined) {
        const forwardedProto = trustProxy ? bunRequest.headers.get("x-forwarded-proto") : null;
        if (forwardedProto) {
          // `split` on a non-empty string always yields a first element
          const first = forwardedProto.split(",")[0] ?? forwardedProto;
          protocolCache = first.trim().toLowerCase();
        } else {
          protocolCache = url.protocol.replace(":", "");
        }
      }
      return protocolCache;
    },
    set protocol(value: string) {
      protocolCache = value;
    },

    get secure(): boolean {
      return this.protocol === "https";
    },
    set secure(value: boolean) {
      protocolCache = value ? "https" : "http";
    },

    get subdomains(): string[] {
      subdomainsCache ??= this.hostname.split(".").slice(0, -2).reverse();
      return subdomainsCache;
    },
    set subdomains(value: string[]) {
      subdomainsCache = value;
    },

    xhr: bunRequest.headers.get("x-requested-with")?.toLowerCase() === "xmlhttprequest",
    params,

    get query(): Record<string, string | string[]> {
      queryCache ??= parseQuery();
      return queryCache;
    },
    set query(value: Record<string, string | string[]>) {
      queryCache = value;
    },

    body: undefined,

    get cookies(): Record<string, string> {
      cookiesCache ??= parseCookies();
      return cookiesCache;
    },
    set cookies(value: Record<string, string>) {
      cookiesCache = value;
    },

    get headers(): Record<string, string | string[] | undefined> {
      headersCache ??= parseHeaders();
      return headersCache;
    },
    set headers(value: Record<string, string | string[] | undefined>) {
      headersCache = value;
    },

    get(field: string): string | undefined {
      // Headers.get is already case-insensitive, so no normalisation is needed
      const lower = field.toLowerCase();
      if (lower === "referer" || lower === "referrer") {
        // Express aliases the two spellings
        return (
          bunRequest.headers.get("referrer") ?? bunRequest.headers.get("referer") ?? undefined
        );
      }
      return bunRequest.headers.get(field) ?? undefined;
    },

    header(field: string): string | undefined {
      return this.get(field);
    },

    accepts(...types: string[]): string | false {
      const accept = bunRequest.headers.get("accept") ?? "*/*";
      for (const type of types) {
        if (accept.includes(type) || accept.includes("*/*")) {
          return type;
        }
      }
      return false;
    },

    acceptsCharsets(...charsets: string[]): string | false {
      const accept = bunRequest.headers.get("accept-charset") ?? "*";
      for (const charset of charsets) {
        if (accept.includes(charset) || accept.includes("*")) {
          return charset;
        }
      }
      return false;
    },

    acceptsEncodings(...encodings: string[]): string | false {
      const accept = bunRequest.headers.get("accept-encoding") ?? "*";
      for (const encoding of encodings) {
        if (accept.includes(encoding) || accept.includes("*")) {
          return encoding;
        }
      }
      return false;
    },

    acceptsLanguages(...languages: string[]): string | false {
      const accept = bunRequest.headers.get("accept-language") ?? "*";
      for (const lang of languages) {
        if (accept.includes(lang) || accept.includes("*")) {
          return lang;
        }
      }
      return false;
    },

    is(type: string): string | false | null {
      const contentType = bunRequest.headers.get("content-type");
      if (!contentType) return null;
      return contentType.includes(type) ? type : false;
    },

    /**
     * Not implemented by this shim: always returns `undefined`. Read
     * `req.get("range")` and parse it yourself (e.g. with `range-parser`).
     */
    range(_size: number, _options?: { combine?: boolean }): undefined {
      return undefined;
    },
  };

  return req;
}

// ==================== Response ====================

/**
 * Create an Express-compatible response object
 *
 * @param request - optional originating request, exposed as `res.req` for
 *   middleware that pairs the two (error handlers, loggers).
 */
export function createExpressResponse(request?: ExpressRequest | Request): ExpressResponse {
  const headers = new Headers();
  let statusCode = 200;
  let statusMessageOverride: string | undefined;
  let body: unknown = null;
  let ended = false;
  let headersSent = false;

  // One-shot end notification. `endNotified` guards against a second emission
  // when both `markSent()` and the `_ended` setter run for the same response.
  let endNotified = false;
  const endListeners: Array<() => void> = [];

  function notifyEnd(): void {
    if (endNotified) return;
    endNotified = true;
    // Drain before invoking so a listener that re-registers is not looped over
    const listeners = endListeners.splice(0, endListeners.length);
    for (const listener of listeners) {
      listener();
    }
  }

  /** Warn + no-op on a double send, matching Express's guard. */
  function alreadySent(method: string): boolean {
    if (!headersSent) return false;
    logger.warn(`Cannot call res.${method}() after the response has already been sent`);
    return true;
  }

  function markSent(): void {
    ended = true;
    headersSent = true;
    notifyEnd();
  }

  function setContentLength(length: number): void {
    if (!NULL_BODY_STATUSES.has(statusCode)) {
      headers.set("Content-Length", String(length));
    }
  }

  const res: ExpressResponse = {
    _headers: headers,
    locals: {},
    req: request,

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

    get _ended() {
      return ended;
    },
    set _ended(value: boolean) {
      ended = value;
      if (value) notifyEnd();
    },

    get headersSent() {
      return headersSent;
    },
    set headersSent(value: boolean) {
      headersSent = value;
    },

    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },

    get statusMessage() {
      return statusMessageOverride ?? getStatusText(statusCode);
    },
    set statusMessage(msg: string) {
      statusMessageOverride = msg;
    },

    status(code: number): ExpressResponse {
      statusCode = code;
      return this;
    },

    sendStatus(code: number): void {
      if (alreadySent("sendStatus")) return;

      statusCode = code;
      const text = getStatusText(code);
      statusMessageOverride = text;

      if (NULL_BODY_STATUSES.has(code)) {
        // 101/204/205/304 must never carry a body
        body = null;
        headers.delete("Content-Type");
        headers.delete("Content-Length");
      } else {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "text/plain");
        }
        body = text;
        setContentLength(byteLength(text));
      }

      markSent();
    },

    json(data: unknown): void {
      if (alreadySent("json")) return;

      // Don't clobber a caller-chosen type such as application/problem+json
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const payload = JSON.stringify(data);
      body = payload === undefined ? "" : payload;
      setContentLength(byteLength(body as string));
      markSent();
    },

    send(data?: unknown): void {
      if (alreadySent("send")) return;

      if (data === undefined || data === null) {
        // Never serialise `undefined` into a literal "undefined" body
        body = null;
        setContentLength(0);
      } else if (typeof data === "string") {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "text/html");
        }
        body = data;
        setContentLength(byteLength(data));
      } else if (data instanceof Blob) {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", data.type || "application/octet-stream");
        }
        body = data;
        setContentLength(data.size);
      } else if (data instanceof ReadableStream) {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/octet-stream");
        }
        body = data;
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/octet-stream");
        }
        body = data;
        setContentLength((data as ArrayBufferView | ArrayBuffer).byteLength);
      } else if (typeof data === "object") {
        this.json(data);
        return;
      } else {
        const text = String(data);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "text/html");
        }
        body = text;
        setContentLength(byteLength(text));
      }

      markSent();
    },

    end(data?: unknown): void {
      if (alreadySent("end")) return;
      if (data !== undefined) {
        body = data;
      }
      markSent();
    },

    set(field: string | Record<string, string>, value?: string): ExpressResponse {
      if (typeof field === "object") {
        for (const [key, val] of Object.entries(field)) {
          headers.set(key, val);
        }
      } else if (value !== undefined) {
        headers.set(field, value);
      }
      return this;
    },

    header(field: string | Record<string, string>, value?: string): ExpressResponse {
      if (typeof field === "object") {
        return this.set(field);
      }
      if (value !== undefined) {
        return this.set(field, value);
      }
      return this;
    },

    setHeader(field: string, value: string): ExpressResponse {
      headers.set(field, value);
      return this;
    },

    get(field: string): string | undefined {
      // Express/Node return undefined — not null — for an unset header
      return headers.get(field) ?? undefined;
    },

    getHeader(field: string): string | undefined {
      return headers.get(field) ?? undefined;
    },

    removeHeader(field: string): void {
      headers.delete(field);
    },

    append(field: string, value: string | string[]): ExpressResponse {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        headers.append(field, v);
      }
      return this;
    },

    type(type: string): ExpressResponse {
      headers.set("Content-Type", getMimeType(type));
      return this;
    },

    contentType(type: string): ExpressResponse {
      return this.type(type);
    },

    /**
     * Not implemented by this shim: `Accept` negotiation never happens, only
     * `obj.default` runs. Call the handler you want directly instead.
     */
    format(obj: Record<string, () => void>): void {
      obj.default?.();
    },

    attachment(filename?: string): ExpressResponse {
      if (filename) {
        headers.set("Content-Disposition", `attachment; filename="${filename}"`);
        headers.set("Content-Type", getMimeType(filename.split(".").pop() ?? "bin"));
      } else {
        headers.set("Content-Disposition", "attachment");
      }
      return this;
    },

    cookie(name: string, value: string, options: CookieOptions = {}): ExpressResponse {
      const encode = options.encode ?? encodeURIComponent;
      let cookie = `${name}=${encode(value)}`;

      let expires = options.expires;

      if (options.maxAge !== undefined && !Number.isNaN(Number(options.maxAge))) {
        // Express `maxAge` is milliseconds; Max-Age is seconds
        const maxAge = Number(options.maxAge);
        cookie += `; Max-Age=${Math.floor(maxAge / 1000)}`;
        expires ??= new Date(Date.now() + maxAge);
      }
      if (expires) {
        cookie += `; Expires=${expires.toUTCString()}`;
      }
      if (options.path) {
        cookie += `; Path=${options.path}`;
      }
      if (options.domain) {
        cookie += `; Domain=${options.domain}`;
      }
      if (options.secure) {
        cookie += "; Secure";
      }
      if (options.httpOnly) {
        cookie += "; HttpOnly";
      }
      if (options.sameSite) {
        const sameSiteValue = options.sameSite === true ? "Strict" : options.sameSite;
        cookie += `; SameSite=${sameSiteValue.charAt(0).toUpperCase() + sameSiteValue.slice(1)}`;
      }

      headers.append("Set-Cookie", cookie);
      return this;
    },

    clearCookie(name: string, options: CookieOptions = {}): ExpressResponse {
      const { maxAge: _maxAge, ...rest } = options;
      return this.cookie(name, "", { ...rest, expires: new Date(0) });
    },

    redirect(statusOrUrl: number | string, url?: string): void {
      if (alreadySent("redirect")) return;

      // Discriminate purely on the type so redirect(302, "") cannot be misread
      if (typeof statusOrUrl === "number") {
        statusCode = statusOrUrl;
        headers.set("Location", url ?? "");
      } else {
        statusCode = 302;
        headers.set("Location", statusOrUrl);
      }

      markSent();
    },

    location(url: string): ExpressResponse {
      headers.set("Location", url);
      return this;
    },

    links(links: Record<string, string>): ExpressResponse {
      const link = Object.entries(links)
        .map(([rel, url]) => `<${url}>; rel="${rel}"`)
        .join(", ");

      // Express merges with anything already present
      const existing = headers.get("Link");
      headers.set("Link", existing ? `${existing}, ${link}` : link);
      return this;
    },

    vary(field: string | string[]): ExpressResponse {
      const fields = (Array.isArray(field) ? field : String(field).split(","))
        .map((value) => value.trim())
        .filter(Boolean);

      const existing = headers.get("Vary");
      if (existing?.trim() === "*") return this;

      if (fields.includes("*")) {
        headers.set("Vary", "*");
        return this;
      }

      const current = existing
        ? existing
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
      const seen = new Set(current.map((value) => value.toLowerCase()));

      for (const value of fields) {
        const lower = value.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        current.push(value);
      }

      headers.set("Vary", current.join(", "));
      return this;
    },

    /**
     * Internal: invoked once when the response is ended. Used by the adapter to
     * avoid polling for out-of-band completion.
     *
     * If the response has already ended, `listener` runs synchronously before
     * this returns. Otherwise it is queued and every queued listener is invoked
     * once, in registration order, when the response is marked ended.
     */
    _onEnd(listener: () => void): void {
      if (endNotified) {
        listener();
        return;
      }
      endListeners.push(listener);
    },

    _buildResponse(): Response {
      headersSent = true;

      const nullBody = NULL_BODY_STATUSES.has(statusCode);
      if (nullBody) {
        // These statuses must never carry a body or describe one
        headers.delete("Content-Type");
        headers.delete("Content-Length");
      }

      let responseBody: ResponseBody | null = null;

      if (!nullBody && body !== null && body !== undefined) {
        if (
          typeof body === "string" ||
          body instanceof ArrayBuffer ||
          ArrayBuffer.isView(body) ||
          body instanceof ReadableStream ||
          body instanceof Blob ||
          body instanceof FormData ||
          body instanceof URLSearchParams
        ) {
          responseBody = body as ResponseBody;
        } else {
          responseBody = JSON.stringify(body) ?? null;
        }
      }

      return new Response(responseBody, {
        status: statusCode,
        statusText: statusMessageOverride ?? getStatusText(statusCode),
        headers,
      });
    },
  };

  return res;
}

/**
 * Type for Express middleware
 */
export type ExpressMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: (err?: unknown) => void
) => void | Promise<void>;

/**
 * Type for Express error middleware
 */
export type ExpressErrorMiddleware = (
  err: unknown,
  req: ExpressRequest,
  res: ExpressResponse,
  next: (err?: unknown) => void
) => void | Promise<void>;
