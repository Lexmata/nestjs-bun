# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-07-28

Contains breaking changes, so the MINOR moves — pre-1.0 that is the only
signal a caret range (`^0.2.0`) respects.

### Added

- **An already-parsed `URL` can now be handed to `createExpressRequest()` and
  `createFastifyRequest()`.** The two take it in different positions, so check
  the one you call:

  ```ts
  // fifth positional parameter
  createExpressRequest(request, params, trustProxy, remoteAddress, parsedUrl);

  // a field on the existing options object
  createFastifyRequest(request, params, requestId, { ...options, parsedUrl });
  ```

  Both are optional and both parse the URL themselves when it is omitted, so
  existing call sites keep working unchanged.

  It exists so a caller that already holds a `new URL(request.url)` does not pay
  to build the same object again. The adapter parses the request URL in order to
  route the request, and previously each compat layer re-parsed it, so a single
  request could construct two or three identical `URL`s.

  The URL **must describe `request.url`**, and both factories check it: it is the
  sole source of the request's `url`, `path`, `query` and `hostname`, so a caller
  that normalised the URL first (collapsing `//`, stripping a trailing slash,
  lower-casing) would make middleware read a different path from the one the
  router matched. A URL that does not describe the request raises a `TypeError`
  rather than yielding an incoherent request. The instance is retained rather
  than copied, so mutating it after the call is not supported.

### Changed

- **Per-request work that never varies is now resolved once, at registration.**
  Measured on this repo's benchmark fixture at 100 connections without
  pipelining, mean of two runs against the previous commit: text `+21%`
  (79.2k → 95.7k req/s), JSON `+31%` (75.5k → 98.7k), path parameter `+29%`
  (73.4k → 94.7k).

  What moved off the request path: `applyVersionFilter` returns the handler
  unwrapped entirely for `VERSION_NEUTRAL` and URI versioning, and otherwise
  matches against a prebuilt `Set` instead of re-normalising the version array
  per request; `enableCors` builds its header strings and selects its origin
  strategy once instead of re-joining arrays and re-running a `typeof` chain;
  middleware paths are memoised on the entry (invalidated by `setGlobalPrefix`,
  which is the only thing that can change them); the middleware wildcard regex is
  module scope rather than a literal re-evaluated per middleware per request; a
  synchronous middleware that already called `next()` no longer allocates two
  promises and burns a microtask turn to observe a settled result; `req.url` and
  `req.originalUrl` share one built string; `req.xhr`, the Fastify request's
  `headers`, and the response's end-listener array are all deferred to first use;
  and `Content-Type` is read once and handed down rather than read again inside
  `parseRequestBody`.

  These hoists are behaviour-preserving. Two cases worth naming: middleware path
  memoisation is invalidated in `setGlobalPrefix`, with a regression test that
  fails if that invalidation is removed; and the `enableCors` hoist tightened the
  `origin` handling, which is a deliberate behaviour change recorded under
  *Removed* and *Fixed* rather than here.

- **The published bundle is minified and no longer embeds its sources twice.**
  `sourcesContent` is dropped from both sourcemaps and `src/` is shipped once
  instead, which is what the maps' relative `sources` paths already pointed at —
  so stack traces still resolve into the original TypeScript (verified under
  `node --enable-source-maps`). `keepNames` is on, so class and function names
  survive for NestJS's error messages. The tarball goes from 226.1 kB to
  170.2 kB and unpacked from 946.9 kB to 622.0 kB.

- **Static assets are streamed from a validated file descriptor.**
  `useStaticAssets()` read each file fully into a `Uint8Array` per request. It
  now opens the file once, checks containment against that descriptor, and
  streams it. Measured at 64 MB across 8 concurrent readers, peak RSS *above
  baseline* drops from ~1068 MB to ~46 MB. A `HEAD` releases the descriptor
  without reading the file at all.

  This also closes a symlink TOCTOU. The containment check and the open now
  refer to the same inode: `realpath` resolves the path and range-checks it
  against the root, then that already-resolved path is opened with `O_NOFOLLOW`.
  Previously the check ran against a path and Bun opened it lazily when the
  response was serialised, so anyone able to write into the static root could
  swap the file for a symlink in between. A symlink whose *target* is inside the
  root still serves normally — it is the target that must be contained.

  Which behaviour you get is selectable, because the two options trade against
  each other and neither is strictly better:

  ```ts
  // Default. Validated descriptor, symlink TOCTOU closed, GET is chunked.
  app.useStaticAssets(root);

  // Keeps Content-Length and Bun's sendfile(2) path; the containment check is
  // against the path, so a writer inside `root` can still win the race.
  app.useStaticAssets(root, { transfer: 'sendfile' });
  ```

  | | `transfer: 'stream'` (default) | `transfer: 'sendfile'` |
  |---|---|---|
  | Symlink TOCTOU | closed | open |
  | `GET` framing | `Transfer-Encoding: chunked` | `Content-Length` |

  `HEAD` reports `Content-Length` in both. Both stream rather than buffer, so
  peak memory does not scale with `filesize × concurrency` either way. Pick
  `sendfile` when `root` holds build output no untrusted process can write to
  and `Content-Length` matters to your clients.

  One more consequence, in `stream` mode only: a file that disappears between
  the open and the send no longer falls through to `next()`. That error reaches
  the server's `error` handler, turning a 404 into a logged 500. That handler is
  also installed on the external-server path (`NestBunFactory.createWithServer`)
  now, where `reload()` previously left it unset and the same failure produced
  Bun's default error page with nothing in the adapter's log.

- **CI runs `test` and `benchmark` in parallel.** `needs: test` bought no cache
  or artifact reuse — the benchmark job repeats the full setup regardless — so it
  only serialized the pipeline. Wall clock is now `max(test, benchmark)` rather
  than the sum. A build with failing tests costs one extra runner.

- **`node:`-prefixed builtin imports.** `events` and `path` were imported bare and
  reached the artifact that way. Both are real npm packages, so a consumer
  bundling for a non-node platform resolves them to browserify shims and inlines
  them; `node:` specifiers are unconditionally externalized instead.

- **The Fastify request/reply pair is now built lazily, and only when the Fastify
  surface is actually in use.** A plain NestJS application registers no Fastify
  hook, plugin or decorator, and for it the pair was pure per-request overhead:
  two object constructions and both decorator passes, feeding hook stages that
  were all no-ops. The pair is now constructed on first need, and not at all when
  nothing is registered.

  Whether anything is registered is re-tested at each lifecycle gate rather than
  sampled once when the request starts, so a hook registered *during* a request —
  by a middleware, by the route handler, or by another request in flight — still
  applies to that request. `routerPath` still reports the route matched when the
  request entered, so it does not depend on when the pair happened to be built.

- **Route matching now goes through a per-method index.** Routes are bucketed by
  method once and the bucket reused, instead of rescanning every registered route
  and re-deriving method compatibility on each request. Routes with no `:param`
  and no trailing `*` are resolved by hash lookup and two string comparisons
  rather than by executing a regular expression.

  Behaviour is unchanged: registration order is preserved inside each bucket, so
  a handler calling `next()` falls through in the same order as before; `HEAD` is
  still served by the matching `GET` route; routes registered with `all()` still
  answer verbs that have no route of their own; the optional trailing slash is
  still tolerated; and the index is invalidated whenever a route is added, so a
  route registered after the adapter has already served a request is still
  picked up.

- **Body parsing is skipped for a request that declares no `Content-Type`.**
  `parseRequestBody()` dispatches solely on that header and returns `undefined`
  for everything it does not recognise, so `req.body` is exactly what it was; what
  goes away is the call and its `await` on every plain `GET`. In the same spirit,
  the Express middleware chain is no longer awaited when no middleware is
  registered.

  **Measured effect of the three changes together**, on this repository's own
  suite (`pnpm bench`, median of 3 × 5s runs, 100 connections, pipelining 10) on
  the machine recorded in [BENCHMARK.md](BENCHMARK.md): **+2.1% to +15.4%**
  requests/sec depending on the endpoint — `GET /` +15.4%, `POST /items` +12.9%,
  `GET /health` +11.6%, `GET /json` +7.7%, `GET /users/:id` +4.0%,
  `GET /cpu/light` +2.1%.

  Treat that as "a real but modest improvement", not a specification: the host
  was heavily loaded, and several of those figures sit inside the suite's own
  ~20% noise band.

  **The size of the gain depends heavily on the load shape, and the committed
  harness measures only one of them.** `pnpm bench` defaults to 100 connections
  with pipelining 10, where Bun's HTTP server — not this adapter — is the
  bottleneck, so removing per-request JavaScript work has little room to help.
  Without pipelining (10 connections, pipelining 1), which is what ordinary
  browser and load-balancer traffic looks like, the same build measures
  `GET /json` at **35,840 → 50,648 req/s (+41%)** and `GET /` at
  **38,584 → 56,472 (+46%)**. Both sets of numbers are correct; they answer
  different questions. See BENCHMARK.md for the full tables and caveats.

### Fixed

- **`close()` no longer holds the process open for ten seconds after it
  returns.** The graceful drain raced `server.stop()` against
  `Bun.sleep(drainTimeoutMs)`, and `Promise.race` does not cancel the loser — so
  the sleep stayed armed and kept the Bun event loop referenced for the full
  window. A script that awaited `close()` and then ended took 10.1s to exit
  instead of 0.1s. The deadline is now an explicitly-cleared `setTimeout`.

- **`app.use(path, [middleware])` registers the middleware.** The path branch
  checked only for a function argument, so an array behind a path was dropped
  silently — `use([middleware])` worked and `use('/api', [middleware])`
  registered nothing at all. Arrays are now flattened one level on both branches.

- **Every parser that turns request input into an object now guards
  prototype-named keys.** The first pass covered `req.query` and `req.headers`;
  four more had the same bug and are now routed through one shared helper:

  - A **multipart** part named `__proto__` re-pointed `req.body`'s prototype at
    the uploaded `File`, because a `File` is an object and `__proto__` hits
    `Object.prototype`'s setter. `req.body instanceof Blob` became true and every
    inherited accessor threw when invoked on it — so an upload DTO with a `name`,
    `size` or `type` field was a deterministic unauthenticated 500.
  - **Cookies** named `constructor`, `toString`, `valueOf` or `hasOwnProperty`
    were dropped entirely: the presence test used `in`, which walks the prototype
    chain and reported them present before anything was written.
  - The **Fastify** request's `query` and `headers`, and the reply's
    `getHeaders()`, silently discarded a `__proto__` key.
  - The exported **`parseQueryParams()`** / **`parseBody()`** did the same, so the
    public helpers and the adapter's own `req.query` disagreed.

- **`Vary: Origin` is set when the granted CORS origin depends on the request.**
  Both `origin: true` and `origin: string[]` derive the
  `Access-Control-Allow-Origin` from the caller's `Origin`, so without `Vary` a
  shared cache can serve one origin's grant to another.

- **An empty CORS allow-list no longer allows everything.** `origin: []` — the
  natural result of an unset env var — fell back to `*`. A non-match now grants
  no origin at all, which is also what `origin: false` does.

- **Query keys and header names that collide with `Object.prototype` are handled
  correctly.** Both parsers wrote client-controlled keys onto a plain object with
  `target[key] = value` and tested for a previous occurrence by reading
  `target[key]` back. Two consequences, both reachable from a request:
  `?__proto__=a&__proto__=b` re-pointed `req.query`'s prototype at an array
  instead of creating an own property, and a `constructor:` header parsed as
  `[Object, "value"]` because the inherited member read as a previous
  occurrence. Keys are now defined as own properties and existence is tested with
  `Object.hasOwn`.


- **A Fastify hook registered while a request was already in flight could be
  silently skipped for that request.** Whether the Fastify surface was in use was
  decided once, when the request started, so a hook registered afterwards — from
  a middleware, from the route handler, or from a concurrent request — did not
  run. For an `onRequest` hook doing authentication, that is a bypass rather than
  a missed log line. The test is now re-evaluated at each lifecycle gate.
- **`onError` hooks now also observe failures raised by Express middleware**,
  not only by route handlers. Both error paths share one exit, so a hook that
  replies supplies the response on either. Previously a middleware failure went
  straight to the registered error handler and Fastify hooks never saw it.

- **`onResponse` hooks did not run on every exit.** Two observable paths returned
  without them: a response ended by Express middleware (or by anything that set
  `res._ended`), and the error path once an Express error middleware or a
  registered error handler had produced the response. Access logs, latency
  metrics and tracing spans built on `onResponse` silently missed those requests.
  Both now run the hook, with the real status published onto the reply first.
- **`error(message, 101)` returned a 101 carrying a JSON body.** `101` was
  missing from the null-body status set in `utils/response.ts`, though the three
  other copies of that set in the codebase had it. Bun's `Response` constructor
  accepts a body on a null-body status; the Fetch spec forbids one, and strict
  runtimes and intermediaries reject it.

### Removed

- **BREAKING: `serverOptions.trustProxy` no longer accepts a number.** The
  numeric hop-count form was declared on the type and recommended by the README,
  the docs site and the 0.2.0 changelog — but it was never implemented, and
  passing one threw at bootstrap. Every documented example using it was
  therefore broken; the type now says what the adapter actually does. Passing a
  non-boolean still throws, so the mistake stays loud for callers who reach
  `setServerOptions` from untyped config.

  The capability itself still exists in `getIp()`, which is exported and takes
  the hop count directly:

  ```diff
  -const app = await NestBunFactory.create(AppModule, {
  -  serverOptions: { trustProxy: 1 },
  -});
  +const app = await NestBunFactory.create(AppModule, {
  +  serverOptions: { trustProxy: true },
  +});
  +
  +// Where you need the hop count, resolve the address yourself:
  +import { getIp } from '@lexmata/nestjs-platform-bun';
  +const ip = getIp(req.raw, { trustProxy: 1, server });
  ```

- **BREAKING: `enableCors({ origin })` no longer accepts a callback or a
  `RegExp`.** The signature advertised Express's `(origin, callback) => void`
  form, but the shim never read the callback's verdict — it echoed the request
  origin regardless, so `callback(null, false)` was silently served as an
  *allow*. A `RegExp` was worse: it fell through to a `*` wildcard, so a
  restrictive pattern allowed every origin.

  Both are now rejected, and the rejection is enforced at **runtime**, not only
  in the type. NestJS declares `INestApplication.enableCors(options?: any)` and
  does not narrow `NestApplicationOptions["cors"]`, so
  `NestBunFactory.create(App, { cors })` reaches the adapter with NestJS's wider
  `CorsOptions` and no compile error. Use a string, an array of strings, or a
  boolean; for a dynamic policy, register your own middleware ahead of this
  one.

- **`isFastifyMiddleware()` and `markAsFastify()`.** Neither was on the package
  barrel or in `dist/`, and `package.json#exports` has no subpath, so no consumer
  could reach them. `markAsFastify` had no caller outside its own tests, which
  made `isFastifyMiddleware` constant-`false` by construction; the adapter
  discriminates error middleware on `fn.length === 4` and never consulted the
  marker.

- **`tsx` from the benchmark's devDependencies**, along with its `esbuild` build
  allowance and two vestigial `#!/usr/bin/env tsx` shebangs. Every benchmark
  script has compiled through `tsc` and run under `node`/`bun` directly since the
  harness stopped measuring a transpiler. Takes ~289 MB of platform binaries out
  of the benchmark install.

## [0.2.0] - 2026-07-27

**This release renames the package.** `@pegasusheavy/nestjs-platform-bun` is now
`@lexmata/nestjs-platform-bun`. There is no code change implied by the rename
itself — update the dependency name and your import specifiers:

```diff
-import { NestBunFactory } from '@pegasusheavy/nestjs-platform-bun';
+import { NestBunFactory } from '@lexmata/nestjs-platform-bun';
```

The old name will be deprecated on npm pointing here. It will not receive
further releases.

0.2.0 is the first release that is actually installable — see **Fixed**. The
published 0.1.0 artifact could not be imported at all, so in practice nobody is
upgrading *from* a working 0.1.0; the breaking changes below are recorded for
anyone who vendored the source or installed from git.

### Changed

- **`getHttpServer()` now returns a `BunHttpServer` wrapper, not Bun's `Server`.**
  NestJS requires an EventEmitter-shaped server object, which `Bun.serve()`'s
  return value is not. Reach the raw Bun server through `.server`:

  ```diff
  -const server = app.getHttpServer();
  -server.reload({ fetch });
  +const server = app.getHttpServer().server;
  +server?.reload({ fetch });
  ```

  `.server` is `null` before `listen()` and after `close()`. The wrapper itself
  exposes `listening`, `address()`, `close()`, `on()`, `once()` and `emit()`.

- **`ParsedRequest` body access is now a lazy promise named `bodyPromise`.**
  The eager `parsedBody?: unknown` of 0.1.0 is gone. The body is read only when
  the property is first accessed, and the result is cached.

  ```diff
  -const body = req.parsedBody as MyDto;
  +const body = (await req.bodyPromise) as MyDto | undefined;
  ```

  It is `undefined` — with nothing read — when the request cannot carry a body
  (`GET`/`HEAD`/`OPTIONS`, or `request.body === null`). `await undefined` is
  `undefined`, so a single `await` handles both cases. The property was renamed
  rather than retyped in place on purpose: `req.parsedBody` is now a compile
  error you fix once, instead of a cast that keeps compiling and silently hands
  your code a `Promise`. It is not called `body` because `Request.body` is
  already the raw `ReadableStream`, and shadowing that would break stream
  consumers just as quietly.

- **`req.ip` and `req.ips` no longer trust `X-Forwarded-*` by default.**
  `serverOptions.trustProxy` gates them and defaults to `false`, so `req.ip` is
  the socket address unless you opt in. Previously the forwarding headers were
  honoured unconditionally, which let any client on a direct connection forge
  its own address.

  `trustProxy` accepts `boolean`:

  | Value | Behaviour |
  | --- | --- |
  | `false` (default) | Headers ignored entirely; socket address only. |
  | `true` | Trust the chain, take the **left-most** `X-Forwarded-For` entry. |

  ```diff
   const app = await NestBunFactory.create(AppModule, {
  +  serverOptions: { trustProxy: true },
   });
  ```

  > **Corrected after merge.** This entry originally documented a
  > `boolean | number` type and recommended `trustProxy: 1`. The numeric form was
  > declared but never implemented — passing it threw at bootstrap — so every
  > example here that used it was broken. 0.2.0 was merged but never tagged or
  > published to npm, so no consumer received the broken form. See the
  > Unreleased entry.

- **`setViewEngine()` and `render()` now throw instead of warning.** The adapter
  has no template engine, so in 0.1.0 both logged a warning and continued —
  `render()` then produced a response that was not the rendered view. Failing
  loudly at the call site is the honest behaviour. Serve pre-rendered HTML, or
  use an adapter that implements views.

- **`parseBody()` throws `BodyParseError` instead of returning `null`.** A
  malformed JSON body and a legitimately empty one both returned `null` before,
  which is indistinguishable at the call site. `BodyParseError` carries the
  offending `contentType` and the underlying `cause`, so it can be mapped to a
  `400`:

  ```ts
  try {
    const body = await parseBody(request);
  } catch (err) {
    if (err instanceof BodyParseError) return error(err.message, 400);
    throw err;
  }
  ```

- **`FastifyHookName` narrowed from 11 members to 7.** The supported set is now
  exactly `onRequest`, `preValidation`, `preHandler`, `preSerialization`,
  `onSend`, `onError`, `onResponse` (also exported at runtime as
  `SUPPORTED_FASTIFY_HOOKS`). `addHook()` now **throws** on an unsupported name
  rather than silently dropping the registration.

  Removed: `preParsing`, `onTimeout`, `onClose`, `onReady`, `onListen`. Two of
  these have direct NestJS equivalents and should move there rather than being
  reimplemented:

  | Removed hook | Use instead |
  | --- | --- |
  | `onReady` | NestJS `onApplicationBootstrap` lifecycle hook |
  | `onClose` | NestJS `onApplicationShutdown` lifecycle hook |
  | `preParsing` | No equivalent — the adapter parses bodies natively |
  | `onTimeout` | No equivalent |
  | `onListen` | No equivalent — run the code after `await app.listen()` |

- **`req.range()` is no longer implemented.** It is declared as returning
  `undefined` so the type still matches Express's shape, but it never parses.
  Read `req.get("range")` and parse it yourself (e.g. with `range-parser`).

- **`res.format()` no longer negotiates.** It no longer inspects `Accept` to
  pick a branch. Do your own negotiation with `accepts()`.

- **`res.get()` / `getHeader()` return `undefined`, not `null`,** for a missing
  header. This matches Express. Update truthiness checks that specifically
  compared against `null`.

- **Query values may now be `string[]`.** Repeated keys are preserved instead of
  the last one winning: `?tag=a&tag=b` yields `{ tag: ["a", "b"] }`, while a
  single occurrence still yields a plain string. The type is
  `Record<string, string | string[]>`, so consumers must handle both.

- **`BunServerOptions.port` and `BunServerOptions.hostname` were removed.** The
  listen address comes from `app.listen(port, hostname?)` and had two competing
  sources of truth before. The one exception is `serverOptions.unix`, which
  replaces host/port entirely and causes the `listen()` arguments to be ignored.

  The keys `listen()` actually forwards to `Bun.serve()` are `unix`,
  `development`, `maxRequestBodySize`, `tls` and `lowMemoryMode`. `trustProxy`
  and `middlewareTimeout` are adapter-level behaviour and are deliberately not
  forwarded.

### Fixed

- **The published package could not be imported at all.** The `exports` map
  pointed at `dist/index.mjs`, which the build never emitted, so every
  `import ... from "@pegasusheavy/nestjs-platform-bun"` failed to resolve. The
  map now points at the files tsup actually produces (`dist/index.js`,
  `dist/index.cjs`, and the matching `.d.ts`/`.d.cts`), and CI typechecks the
  `examples/` workspace — which imports the package **by name** — so the
  resolved artifact is exercised on every run instead of only `src/`.
- **`@Header()` returned a 500.** The decorator's headers were applied through a
  path that threw, so any route carrying `@Header()` failed outright.
- **Unmatched routes returned 500 instead of 404.** A missing route fell through
  to the generic error path rather than the not-found path.
- **NestJS `configure(consumer)` middleware never ran.** Middleware registered
  via `MiddlewareConsumer` in a module's `configure()` was collected but never
  wired into the request pipeline, so it silently did nothing.
- **Async `next()` Express middleware silently returned an empty 200.** When a
  middleware called `next()` from an async continuation, the adapter resolved
  the request before the chain finished and sent an empty 200 body. Middleware
  is now awaited properly, bounded by `serverOptions.middlewareTimeout`
  (default 30000 ms) so a middleware that never calls `next()` fails the request
  instead of leaking the connection.

[Unreleased]: https://github.com/Lexmata/nestjs-bun/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Lexmata/nestjs-bun/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Lexmata/nestjs-bun/releases/tag/v0.2.0
