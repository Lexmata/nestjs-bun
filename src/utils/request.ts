/**
 * Extended request interface with parsed data.
 *
 * `bodyPromise` is lazy: the body is only read when the property is accessed.
 *
 * @remarks
 * Replaces the eager `parsedBody?: unknown` of 0.1.0. The value is now a
 * promise, so it was renamed rather than retyped in place: `req.parsedBody` is
 * a compile error you fix once, instead of a cast that keeps compiling and
 * silently hands your code a `Promise` at runtime. The name is `bodyPromise`
 * and not `body` because `Request.body` is already the raw `ReadableStream` —
 * shadowing it would break stream consumers just as quietly.
 */
export interface ParsedRequest extends Request {
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  /**
   * Lazily parsed request body.
   *
   * - `undefined` when the request cannot carry a body (`GET`/`HEAD`/`OPTIONS`,
   *   or `request.body === null`) — nothing is read in that case.
   * - Otherwise a promise that resolves to the parsed body (see {@link parseBody}).
   *   The promise rejects with a {@link BodyParseError} if the body is malformed.
   *
   * `await` handles both cases, since `await undefined` is `undefined`:
   *
   * ```ts
   * const body = (await request.bodyPromise) as MyDto | undefined;
   * ```
   *
   * The promise is created on first access and cached, so repeated reads are safe.
   */
  readonly bodyPromise: Promise<unknown> | undefined;
}

/**
 * Thrown when a request body is present but cannot be parsed as its declared
 * content type (malformed JSON, an unreadable stream, a broken multipart body).
 *
 * Callers can map this to a `400 Bad Request`:
 *
 * ```ts
 * try {
 *   const body = await parseBody(request);
 * } catch (err) {
 *   if (err instanceof BodyParseError) return error(err.message, 400);
 *   throw err;
 * }
 * ```
 */
export class BodyParseError extends Error {
  /** The media type (parameters stripped) the body was parsed as, `""` if absent. */
  public readonly contentType: string;

  constructor(message: string, options: { contentType?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "BodyParseError";
    this.contentType = options.contentType ?? "";
  }
}

/** Methods that are defined to never carry a request body. */
const BODYLESS_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** `application/json` plus structured suffixes (`application/vnd.api+json`, …). */
const JSON_MEDIA_TYPE = /^application\/([\w.-]+\+)?json$/;

/** `application/xml` plus structured suffixes (`application/atom+xml`, …). */
const XML_MEDIA_TYPE = /^application\/([\w.-]+\+)?xml$/;

/**
 * Parse query parameters from a URL.
 *
 * Repeated keys are preserved as an array: `?tag=a&tag=b` yields
 * `{ tag: ["a", "b"] }`, while a single occurrence yields a plain string.
 */
export function parseQueryParams(url: URL): Record<string, string | string[]> {
  return groupEntries(url.searchParams);
}

/**
 * Collapse an iterable of `[key, value]` pairs into an object, promoting
 * repeated keys to arrays instead of silently discarding earlier values.
 */
function groupEntries<T>(entries: Iterable<[string, T]>): Record<string, T | T[]> {
  const result: Record<string, T | T[]> = {};
  for (const [key, value] of entries) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = value;
      continue;
    }
    const existing = result[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing as T, value];
    }
  }
  return result;
}

/** Extract the lower-cased media type from `Content-Type`, without parameters. */
function getMediaType(request: Request): string {
  const header = request.headers.get("content-type");
  if (header === null) {
    return "";
  }
  const [mediaType = ""] = header.split(";");
  return mediaType.trim().toLowerCase();
}

/** Read the body as text, converting stream failures into a `BodyParseError`. */
async function readText(request: Request, mediaType: string): Promise<string> {
  try {
    return await request.text();
  } catch (cause) {
    throw new BodyParseError("Failed to read request body", { contentType: mediaType, cause });
  }
}

/**
 * Parse the request body based on its content type.
 *
 * Returns `undefined` when the request has no body at all (`request.body === null`,
 * `Content-Length: 0`, or an empty payload) — that is the *only* meaning of a
 * missing value. A body of literal `null` (`"null"` with a JSON content type)
 * resolves to `null`, so the two are distinguishable.
 *
 * Recognised content types:
 * - `application/json` and structured suffixes (`application/problem+json`,
 *   `application/vnd.api+json`, …) → parsed JSON
 * - `application/x-www-form-urlencoded` → object (repeated keys become arrays)
 * - `multipart/form-data` → object of fields/`File`s (repeated keys become arrays)
 * - `text/*` and `application/*+xml` → string
 * - anything else, including a missing `Content-Type` → `ArrayBuffer`
 *
 * @throws {BodyParseError} if the body is present but malformed or unreadable.
 */
export async function parseBody(request: Request): Promise<unknown> {
  if (request.body === null || request.headers.get("content-length") === "0") {
    return undefined;
  }

  const mediaType = getMediaType(request);

  if (JSON_MEDIA_TYPE.test(mediaType)) {
    const raw = await readText(request, mediaType);
    if (raw.trim() === "") {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch (cause) {
      throw new BodyParseError("Invalid JSON body", { contentType: mediaType, cause });
    }
  }

  if (mediaType === "application/x-www-form-urlencoded") {
    const raw = await readText(request, mediaType);
    if (raw === "") {
      return undefined;
    }
    return groupEntries(new URLSearchParams(raw));
  }

  if (mediaType === "multipart/form-data") {
    try {
      const formData = await request.formData();
      return groupEntries(formData);
    } catch (cause) {
      throw new BodyParseError("Invalid multipart/form-data body", {
        contentType: mediaType,
        cause,
      });
    }
  }

  if (mediaType.startsWith("text/") || XML_MEDIA_TYPE.test(mediaType)) {
    return await readText(request, mediaType);
  }

  // Unknown or absent content type: hand back the raw bytes.
  try {
    return await request.arrayBuffer();
  } catch (cause) {
    throw new BodyParseError("Failed to read request body", { contentType: mediaType, cause });
  }
}

/**
 * Attach parsed routing data to a request.
 *
 * This **mutates and returns the same `Request` instance** (`enhanceRequest(req) === req`);
 * it does not clone. Mutating is deliberate — cloning a `Request` would tee its body stream.
 *
 * The body is *not* read here: `bodyPromise` is a lazy getter, so a handler that
 * never touches the body never pays for parsing it, and bodyless methods
 * (`GET`/`HEAD`/`OPTIONS`) get `undefined` instead of a 0-byte `ArrayBuffer`.
 *
 * @param url An already-parsed URL for `request.url`, to avoid re-parsing it.
 */
export async function enhanceRequest(
  request: Request,
  params: Record<string, string> = {},
  url?: URL
): Promise<ParsedRequest> {
  const parsedUrl = url ?? new URL(request.url);

  const enhanced = request as ParsedRequest;
  enhanced.params = params;
  enhanced.query = parseQueryParams(parsedUrl);

  const canHaveBody = !BODYLESS_METHODS.has(request.method.toUpperCase()) && request.body !== null;
  let cached: Promise<unknown> | undefined;

  Object.defineProperty(enhanced, "bodyPromise", {
    configurable: true,
    enumerable: true,
    get(): Promise<unknown> | undefined {
      if (!canHaveBody) {
        return undefined;
      }
      cached ??= parseBody(request);
      return cached;
    },
  });

  return enhanced;
}

/**
 * Get a header value from the request (case-insensitive)
 */
export function getHeader(request: Request, name: string): string | null {
  return request.headers.get(name);
}

interface AcceptEntry {
  type: string;
  subtype: string;
  quality: number;
}

/** Parse an `Accept` header into media ranges ordered by descending quality. */
function parseAcceptHeader(header: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];

  for (const part of header.split(",")) {
    const segments = part.split(";");
    const range = (segments.shift() ?? "").trim().toLowerCase();
    const slash = range.indexOf("/");
    if (slash === -1) {
      continue; // Not a media range — ignore it.
    }

    let quality = 1;
    for (const segment of segments) {
      const eq = segment.indexOf("=");
      if (eq === -1 || segment.slice(0, eq).trim().toLowerCase() !== "q") {
        continue;
      }
      const parsed = Number.parseFloat(segment.slice(eq + 1).trim());
      quality = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 1;
      break; // Parameters after `q` are accept-extensions, not quality.
    }

    entries.push({ type: range.slice(0, slash), subtype: range.slice(slash + 1), quality });
  }

  return entries.sort((a, b) => b.quality - a.quality);
}

/**
 * How specifically a media range matches a concrete type:
 * exact type and subtype (2) > subtype wildcard (1) > full wildcard (0).
 * Returns `-1` when the range does not match at all.
 */
function matchSpecificity(entry: AcceptEntry, type: string, subtype: string): number {
  if (entry.type === "*" && entry.subtype === "*") {
    return 0;
  }
  if (type === "" || entry.type !== type) {
    return -1;
  }
  if (entry.subtype === "*") {
    return 1;
  }
  return entry.subtype === subtype ? 2 : -1;
}

/**
 * Check whether the request accepts a specific content type.
 *
 * The `Accept` header is parsed properly rather than substring-scanned, so:
 * - `application/json;q=0` is an explicit rejection and returns `false`
 * - `text/*` matches `text/html`
 * - `application/json` does **not** match `application/json-patch+json`
 * - the most specific matching media range wins, per RFC 9110 §12.5.1
 *
 * A missing or empty `Accept` header means "no preference" and returns `true`.
 *
 * @remarks
 * **Behaviour change since 0.1.0.** 0.1.0 answered this with a substring scan
 * of the raw header, so the signature is unchanged but the answer is not.
 * Middleware that branches on `accepts()` can take a different path for the
 * same header than it did before. Cases that flip:
 *
 * | `Accept` | `type` | 0.1.0 | now |
 * | --- | --- | --- | --- |
 * | `application/json;q=0` | `application/json` | `true` | `false` |
 * | `text/*` | `text/html` | `false` | `true` |
 * | `application/json-patch+json` | `application/json` | `true` | `false` |
 * | `application/json` | `json` | `true` | `false` |
 *
 * @param type A concrete media type such as `application/json`. Bare extension
 *   names (`"json"`) are not media types and only match a full wildcard range.
 */
export function accepts(request: Request, type: string): boolean {
  const header = request.headers.get("accept");
  if (header === null || header.trim() === "") {
    return true;
  }

  const [wantedRange = ""] = type.split(";");
  const wanted = wantedRange.trim().toLowerCase();
  const slash = wanted.indexOf("/");
  const wantedType = slash === -1 ? "" : wanted.slice(0, slash);
  const wantedSubtype = slash === -1 ? "" : wanted.slice(slash + 1);

  let bestSpecificity = -1;
  let bestQuality = 0;

  for (const entry of parseAcceptHeader(header)) {
    const specificity = matchSpecificity(entry, wantedType, wantedSubtype);
    if (specificity === -1) {
      continue;
    }
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      bestQuality = entry.quality;
    } else if (specificity === bestSpecificity && entry.quality > bestQuality) {
      bestQuality = entry.quality;
    }
  }

  return bestSpecificity >= 0 && bestQuality > 0;
}

/**
 * Anything that can resolve the peer address of a request — notably `Bun.Server`,
 * whose `requestIP()` is structurally compatible.
 */
export interface RequestIpResolver {
  requestIP(request: Request): { address: string } | null;
}

export interface GetIpOptions {
  /**
   * Whether `X-Forwarded-For` / `X-Real-IP` may be believed. Defaults to `false`.
   *
   * - `false` — headers are ignored entirely; only the socket address is used.
   * - `true` — trust the whole chain and take the left-most (client-claimed) entry.
   * - `n` (a positive integer) — trust the last `n` entries as your own proxies and
   *   take the `n`-th entry counting from the **right**, i.e. the address the
   *   outermost trusted proxy saw. `1` selects the right-most entry.
   */
  trustProxy?: boolean | number;
  /** The Bun server handling the request, used to resolve the real peer address. */
  server?: RequestIpResolver;
}

/**
 * Get the client IP address for a request.
 *
 * **Forwarding headers are spoofable.** `X-Forwarded-For` and `X-Real-IP` are
 * plain request headers: on a direct connection any client can set them to any
 * value. Trusting them unconditionally makes rate limits, IP allowlists, and
 * audit logs trivially forgeable. They are therefore ignored unless you opt in
 * with `trustProxy`, and you should only opt in when every request provably
 * arrives through a proxy you control (ALB/CloudFront/nginx) that overwrites or
 * appends the header itself. Prefer a hop count over `true`: with `true` the
 * left-most entry is whatever the original client claimed.
 *
 * Without `trustProxy`, the address is resolved from the socket via
 * `options.server.requestIP(request)`. Bun only exposes that through the server
 * instance, so omitting `server` on a direct connection yields `null`.
 *
 * @returns The resolved address, or `null` if it cannot be determined.
 */
export function getIp(request: Request, options: GetIpOptions = {}): string | null {
  const { trustProxy = false, server } = options;
  const socketAddress = server?.requestIP(request)?.address ?? null;

  const trustHops = trustProxy === true ? Number.POSITIVE_INFINITY : Number(trustProxy);
  if (!(trustHops > 0)) {
    return socketAddress;
  }

  const forwarded = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  if (forwarded.length > 0) {
    const index = Math.max(0, forwarded.length - Math.floor(Math.min(trustHops, forwarded.length)));
    return forwarded[index] ?? socketAddress;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp !== undefined && realIp !== "") {
    return realIp;
  }

  return socketAddress;
}
