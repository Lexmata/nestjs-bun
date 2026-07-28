# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

  `trustProxy` accepts `boolean | number`:

  | Value | Behaviour |
  | --- | --- |
  | `false` (default) | Headers ignored entirely; socket address only. |
  | `true` | Trust the whole chain, take the **left-most** `X-Forwarded-For` entry. Forgeable — prefer a hop count. |
  | `n` (positive integer) | Trust the last `n` entries as your own proxies and take the `n`-th counting **from the right**. `1` selects the right-most entry. Matches Express's numeric `trust proxy`. |

  ```diff
   const app = await NestBunFactory.create(AppModule, {
  +  serverOptions: { trustProxy: 1 },
   });
  ```

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

[Unreleased]: https://github.com/quinnjr/nestjs-bun/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/quinnjr/nestjs-bun/releases/tag/v0.2.0
