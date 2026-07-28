type ResponseBody = string | ArrayBuffer | Uint8Array | ReadableStream | Blob | null;

/** Status codes that must not carry a body — `new Response(body, { status })` throws for these. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** The only status codes a redirect may use. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Reason phrases, hoisted so it is allocated once rather than per call. */
const STATUS_TEXTS: Readonly<Record<number, string>> = Object.freeze({
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
});

/**
 * Response builder for creating Bun-compatible Response objects.
 *
 * Methods come in two flavours:
 * - **Chainable** — {@link ResponseBuilder.status}, {@link ResponseBuilder.header},
 *   {@link ResponseBuilder.headers}. These return `this`, so they can be chained.
 * - **Terminal** — {@link ResponseBuilder.json}, {@link ResponseBuilder.text},
 *   {@link ResponseBuilder.html}, {@link ResponseBuilder.binary},
 *   {@link ResponseBuilder.stream}, {@link ResponseBuilder.file},
 *   {@link ResponseBuilder.redirect}, {@link ResponseBuilder.build}. These set the
 *   body (where applicable) and return the finished `Response`, ending the chain.
 *
 * ```ts
 * response().status(201).header("X-Request-Id", id).json({ ok: true });
 * ```
 *
 * A `Content-Type` you set explicitly is never overwritten by a terminal method.
 */
export class ResponseBuilder {
  private _status: number = 200;
  private _headers: Headers = new Headers();
  private _body: ResponseBody = null;

  /**
   * Set the status code (chainable)
   */
  public status(code: number): this {
    this._status = code;
    return this;
  }

  /**
   * Set a header (chainable)
   */
  public header(name: string, value: string): this {
    this._headers.set(name, value);
    return this;
  }

  /**
   * Set multiple headers (chainable)
   */
  public headers(headers: Record<string, string>): this {
    for (const [name, value] of Object.entries(headers)) {
      this._headers.set(name, value);
    }
    return this;
  }

  /**
   * Build a Response with a JSON body (terminal — ends the chain).
   *
   * Defaults `Content-Type` to `application/json` unless one was already set.
   */
  public json(data: unknown): Response {
    this.defaultContentType("application/json");
    this._body = JSON.stringify(data);
    return this.build();
  }

  /**
   * Build a Response with a text body (terminal — ends the chain).
   *
   * Defaults `Content-Type` to `text/plain` unless one was already set.
   */
  public text(data: string): Response {
    this.defaultContentType("text/plain");
    this._body = data;
    return this.build();
  }

  /**
   * Build a Response with an HTML body (terminal — ends the chain).
   *
   * Defaults `Content-Type` to `text/html` unless one was already set.
   */
  public html(data: string): Response {
    this.defaultContentType("text/html");
    this._body = data;
    return this.build();
  }

  /**
   * Build a Response with a binary body (terminal — ends the chain).
   *
   * Defaults `Content-Type` to `application/octet-stream` unless one was already set.
   */
  public binary(data: ArrayBuffer | Uint8Array): Response {
    this.defaultContentType("application/octet-stream");
    this._body = data;
    return this.build();
  }

  /**
   * Build a Response streaming the given body (terminal — ends the chain).
   */
  public stream(data: ReadableStream): Response {
    this._body = data;
    return this.build();
  }

  /**
   * Build a Response serving a file from disk (terminal — ends the chain).
   *
   * If the file does not exist the accumulated headers are kept and the status is
   * forced to 404. `Content-Type` is taken from the file's extension unless one
   * was already set, falling back to `application/octet-stream`.
   */
  public async file(path: string): Promise<Response> {
    const file = Bun.file(path);

    if (!(await file.exists())) {
      this._status = 404;
      this.defaultContentType("text/plain");
      this._body = "Not Found";
      return this.build();
    }

    this.defaultContentType(file.type === "" ? "application/octet-stream" : file.type);
    this._body = file;
    return this.build();
  }

  /**
   * Build a redirect Response (terminal — ends the chain).
   *
   * Unlike `Response.redirect()`, this goes through the builder, so headers set
   * earlier (cookies, tracing ids) survive and relative URLs are allowed.
   *
   * @param status Defaults to a redirect status set earlier via {@link status}, else 302.
   * @throws {RangeError} if `status` is not a redirect status code.
   */
  public redirect(url: string, status?: number): Response {
    const code = status ?? (REDIRECT_STATUSES.has(this._status) ? this._status : 302);
    if (!REDIRECT_STATUSES.has(code)) {
      throw new RangeError(
        `Invalid redirect status code: ${code}. Expected one of 301, 302, 303, 307, 308.`
      );
    }

    this._headers.set("Location", url);
    this._status = code;
    this._body = null;
    return this.build();
  }

  /**
   * Build the final Response object (terminal — ends the chain).
   *
   * The body is dropped for statuses that must not carry one (204, 205, 304),
   * which would otherwise make the `Response` constructor throw.
   */
  public build(): Response {
    return new Response(NULL_BODY_STATUSES.has(this._status) ? null : this._body, {
      status: this._status,
      headers: this._headers,
    });
  }

  /** Set `Content-Type` only if the caller has not already chosen one. */
  private defaultContentType(value: string): void {
    if (!this._headers.has("Content-Type")) {
      this._headers.set("Content-Type", value);
    }
  }
}

/**
 * Create a new response builder
 */
export function response(): ResponseBuilder {
  return new ResponseBuilder();
}

/**
 * Quick JSON response
 */
export function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Quick text response
 */
export function text(data: string, status: number = 200): Response {
  return new Response(data, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Quick HTML response
 */
export function html(data: string, status: number = 200): Response {
  return new Response(data, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

/**
 * Quick error response.
 *
 * Produces a JSON body of `{ statusCode, message, error }`, except for statuses
 * that must not carry a body (204, 205, 304), which yield an empty response.
 */
export function error(message: string, statusCode: number = 500): Response {
  if (NULL_BODY_STATUSES.has(statusCode)) {
    return new Response(null, { status: statusCode });
  }
  return json({ statusCode, message, error: getStatusText(statusCode) }, statusCode);
}

/**
 * Get HTTP status text for a status code
 */
function getStatusText(status: number): string {
  return STATUS_TEXTS[status] ?? "Unknown";
}
