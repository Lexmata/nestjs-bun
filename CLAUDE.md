# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@lexmata/nestjs-platform-bun` — a NestJS `AbstractHttpAdapter` implementation backed by `Bun.serve()`, a third platform alongside `@nestjs/platform-express` and `@nestjs/platform-fastify`. It ships Express- and Fastify-shaped compatibility layers so middleware, guards, interceptors and exception filters written against those platforms keep working.

**Bun-only, by design.** The adapter calls `Bun.serve()`, `Bun.file()` and other Bun built-ins with no Node fallbacks. Node support is an explicit non-goal — don't add polyfills or `typeof Bun === "undefined"` branches to "improve compatibility."

## Commands

```bash
bun test                        # whole suite — the ONLY supported runner
bun test --coverage             # thresholds in bunfig.toml; exits 1 when missed
bun test src/utils/request.test.ts          # single file
bun test -t "parses repeated query keys"    # single test by name
bun test --watch

pnpm lint                       # eslint across src/, test/, benchmark/, examples/
pnpm typecheck                  # tsc --noEmit over src/ only
pnpm typecheck:test             # src/ + test/ — see "Two typecheck gates" below
pnpm typecheck:examples         # build, then typecheck examples/ against the built package
pnpm build                      # tsup -> dist/
pnpm bench                      # full benchmark suite (BENCHMARK.md)
pnpm bench:verify               # the reduced suite CI gates on
```

`pnpm` drives the toolchain (eslint, tsup, tsc); `bun` runs the code and the tests. Use `pnpx`, never `npx`.

### `bun test` is not a preference

vitest workers always execute under Node, where `globalThis.Bun` is `undefined` and `process.versions.bun` reports `"none"` regardless of how vitest is launched. Every Bun-gated suite — the adapter itself and the entire e2e suite — silently skips there while vitest still exits `0`. Two gates were once green on code neither was reading.

`vitest` remains a devDependency **for its type declarations only**: test files still `import { describe, it, expect } from "vitest"`, which Bun transparently maps to `bun:test` but TypeScript cannot resolve on its own. Switching those imports to `bun:test` is what unblocks dropping it.

## Architecture

### Request flow

Everything funnels through `BunAdapter#handleRequest` in `src/bun-adapter.ts` (~2,400 lines, the core of the package). One pass per request:

1. **Route match** — routes live in per-method buckets (`routeBucketFor`). Parameterless routes answer with two string comparisons (`staticPaths`); only parameterised ones pay for `RegExp.exec`. *All* matching candidates are collected, not just the first, because a handler may call `next()` to fall through.
2. **Express pair** — `createExpressRequest` / `createExpressResponse` are built unconditionally; NestJS itself consumes this shape. The parsed `URL` is threaded into both compat layers so a request never re-parses its own URL.
3. **Body** — parsed natively by the adapter, which is why `NestBunFactory` forces `bodyParser: false`. `parseRequestBody` dispatches purely on `Content-Type`, so a request declaring none skips the call entirely.
4. **Fastify pair** — built lazily via the `fastifyCtx()` closure, only when hooks/plugins are actually registered.
5. **Hook stages** → middleware chain → handler → `finalize`.

### The `fastifyCtx()` predicate is security-critical

`fastifyCtx()` re-reads `this.fastifyHooks.hasHooks() || this.fastifyPlugins.hasAny()` **at every gate** rather than sampling once at request entry. Hooks run after body parsing and after the whole Express middleware chain, so a hook registered during that window — by a middleware, by the route handler, or by another request in flight — must still apply to this request. A previous version latched this value at entry, which turned a late-registered `onRequest` auth hook into a silent bypass. Do not "optimise" it back into a single sample.

Similarly, `trustProxy` is tested with `=== true`, never a truthy check: anything reaching `serverOptions` without passing through `setServerOptions` must mean "do not trust proxy headers."

### Response exits go through `finalize`

Every request ending — success, 404, hook short-circuit, hook error — routes through `finalize` so `onResponse` observers (access logs, metrics) see it. The one deliberate exception is the top-level `catch` in `handleRequest`: reaching it means the lifecycle itself threw, plausibly from inside `finalize`, so running `onResponse` again would double-report. The 404 path in particular runs the full reply lifecycle on purpose — skipping it once dropped every 404 from those hooks.

### Module layout

| File | Role |
|---|---|
| `src/bun-adapter.ts` | `BunAdapter` + `BunServerWrapper`. Routing, lifecycle, CORS, static assets, versioning. |
| `src/express-compat.ts` | Express-shaped `req`/`res` over Bun's `Request`/`Response`. Heavily lazy — headers, query, cookies, `ip` etc. are memoised per-request getters. |
| `src/fastify-compat.ts` | Fastify request/reply, `FastifyHooksManager` (7 supported hooks, timeouts), `FastifyPluginRegistry`. |
| `src/nest-bun-application.ts` | `NestBunFactory.create` / `.createWithServer`. |
| `src/utils/request.ts`, `src/utils/response.ts` | Parsing helpers and `ResponseBuilder`, both part of the public API. |
| `src/interfaces/index.ts` | Public types. Never imported by tests, so absent from coverage. |

`BunServerWrapper` exists because NestJS requires an EventEmitter-shaped server and `Bun.serve()`'s return value is not one. `getHttpServer()` returns the wrapper; `.server` is the raw Bun server and is `null` before `listen()` and after `close()`.

## Gates and their gotchas

### Two typecheck gates, deliberately split

The root `tsconfig.json` includes only `src/**/*`. `test/e2e/` has known type errors tracked by `tsconfig.test.json` and run via `pnpm typecheck:test`, which is `continue-on-error: true` in CI. The split keeps the `src/` gate meaningful while those are worked through — fold `typecheck:test` back into `typecheck` and make it blocking once `test/e2e/` is clean.

### Coverage thresholds

In `bunfig.toml`, enforced **per file**, not just on the "All files" row — one under-covered file fails the run even when the total looks healthy. Only under `--coverage`; a bare `bun test` measures and gates nothing.

**The keys must be plural.** Bun reads `lines` / `functions` / `statements` and silently ignores the singular spellings, so a threshold object using `line`/`function` enforces nothing while still exiting 0. This file previously had exactly that bug. Raise the thresholds as coverage improves; never lower them to make a run pass.

### Benchmark ratio gate

`pnpm bench:verify` gates **per endpoint** on ratios against Express and Fastify measured in the same run (`VERIFY_MIN_RATIO_EXPRESS` / `VERIFY_MIN_RATIO_FASTIFY` in `ci.yml`). Floors are derived from `pnpm verify`, **not** `pnpm bench` — the two use different load shapes (50 conns / pipelining 5 vs 100 / 10) and yield different ratios; conflating them is why an earlier set of floors was wrong. Because they're relative, they cannot catch a slowdown affecting all three adapters equally. The correctness half (every adapter must boot and return correct responses) is not tunable.

### Three separate pnpm projects

Root, `examples/` and `benchmark/` each have their own `pnpm-lock.yaml` and need their own `pnpm install`. `examples/` additionally has its own `pnpm-workspace.yaml` to satisfy `ERR_PNPM_IGNORED_BUILDS` on pnpm >= 10.26.

`pnpm typecheck:examples` is the only check that resolves the package **by name** (`"@lexmata/nestjs-platform-bun": "file:.."`) through its `exports` map and the emitted `dist/index.d.ts`, rather than reading `src/`. That makes it the de-facto contract test for what users actually install — 0.1.0 shipped an `exports` map pointing at a `dist/index.mjs` tsup never emitted, and nothing in CI noticed because nothing resolved the package by name.

### CI triggers only on `main`

`.github/workflows/ci.yml` fires on `push` and `pull_request` for `main` only. The project uses git flow, so PRs land on `develop` first — those get **no CI run at all**, and the suite first executes when `develop` merges to `main`. Verify locally (`pnpm lint && pnpm typecheck && bun test --coverage`) before merging anything into `develop`.

## Publishing

`package.json` `files` is `["dist"]` — sources are not published. `tsup.config.ts` therefore leaves `sourcesContent` at its default so each sourcemap embeds the TypeScript it maps to; a map with bare relative `sources` paths would resolve to nothing on a consumer's disk and minified stack traces would not symbolicate. If you ever re-add `src` to `files`, that tradeoff flips back.

The build minifies with `keepNames: true` (NestJS surfaces adapter and class names in its own error messages) and sets `removeNodeProtocol: false` (bare builtin specifiers are also real npm packages, so a consumer bundling for a non-node platform would resolve them to browserify shims).

## Conventions

- **Commits:** conventional commits, enforced by commitlint on `commit-msg`. `subject-case` is **lower-case** — `chore: ignore tls material` passes, `chore: ignore TLS material` fails. Husky runs `pnpm lint` on `pre-commit`.
- **Git flow:** `develop` is the integration branch, `main` is releases, tagged `vX.Y.Z`. `origin` is `Lexmata/nestjs-bun`.
- **Tests:** one test file per source file, colocated in `src/`; e2e lives in `test/e2e/`.
- **Comments in this repo carry decision history.** Several explain a bug that a "cleaner" rewrite would reintroduce (the plural coverage keys, the `fastifyCtx()` predicate, the benchmark floor derivation). Read them before simplifying the code they sit on.
