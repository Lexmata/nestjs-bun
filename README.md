# @lexmata/nestjs-platform-bun

A NestJS HTTP adapter that serves your application directly from [`Bun.serve()`](https://bun.sh/docs/api/http), in place of `@nestjs/platform-express` or `@nestjs/platform-fastify`.

It implements NestJS's `AbstractHttpAdapter` on top of Bun's native HTTP server, and ships Express- and Fastify-shaped compatibility layers so that middleware, guards, interceptors and exception filters written against those platforms keep working.

## Requirements

**This package runs on Bun only.** Node.js support is an explicit non-goal — the adapter calls `Bun.serve()`, `Bun.file()` and other Bun built-ins directly, and there are no Node fallbacks. Running it under Node will fail at startup.

- Bun `>= 1.0.0`
- `@nestjs/common` and `@nestjs/core` `^10` or `^11` (peer dependencies)

## Installation

```bash
bun add @lexmata/nestjs-platform-bun
```

Your `tsconfig.json` needs NestJS's usual decorator settings — Bun reads them to decide between legacy and TC39 decorator semantics, and NestJS requires the legacy ones:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["bun"]
  }
}
```

## Quick start

```typescript
// app.module.ts
import { Module, Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'Hello World!';
  }
}

@Module({ controllers: [AppController] })
export class AppModule {}
```

```typescript
// main.ts
import 'reflect-metadata';
import { NestBunFactory } from '@lexmata/nestjs-platform-bun';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestBunFactory.create(AppModule);
  await app.listen(3000);
  console.log('Application is running on: http://localhost:3000');
}

bootstrap();
```

```bash
bun run main.ts
```

`NestBunFactory.create()` is the drop-in replacement for `NestFactory.create()`. It builds a `BunAdapter` for you and disables NestJS's own body-parser middleware, because the adapter parses request bodies natively.

### Passing options to `Bun.serve()`

`serverOptions` forwards a **curated subset** of Bun's server options, not everything `Bun.serve()` accepts:

| Option | Type | Forwarded to `Bun.serve()`? |
| --- | --- | --- |
| `unix` | `string` | yes — replaces host/port entirely |
| `tls` | `{ key?, cert?, ca?, passphrase? }` | yes — also fed by NestJS's `httpsOptions` |
| `maxRequestBodySize` | `number` | yes |
| `development` | `boolean` | yes |
| `lowMemoryMode` | `boolean` | yes |
| `trustProxy` | `boolean \| number` | **no** — adapter-level |
| `middlewareTimeout` | `number` | **no** — adapter-level |

```typescript
const app = await NestBunFactory.create(AppModule, {
  serverOptions: {
    maxRequestBodySize: 10 * 1024 * 1024,
  },
});
```

There is no `idleTimeout`, and no `port`/`hostname`: the listen address comes from `app.listen(port, hostname?)`, with `unix` as the one exception — set it and the `listen()` arguments are ignored.

`trustProxy` and `middlewareTimeout` are adapter behaviour rather than server configuration, so they are deliberately withheld from `Bun.serve()`, which does not understand them.

#### `trustProxy`

`req.ip`, `req.ips`, `req.protocol` and `req.hostname` only consult `X-Forwarded-*` when this is set. It defaults to `false` — those headers are client-controlled, so trusting them unconditionally lets any caller on a direct connection spoof its own address.

| Value | Behaviour |
| --- | --- |
| `false` (default) | Headers ignored entirely; socket address only. |
| `true` | Trust the whole chain, take the **left-most** `X-Forwarded-For` entry. Forgeable — prefer a hop count. |
| `n` (positive integer) | Trust the last `n` entries as your own proxies and take the `n`-th counting **from the right**. `1` selects the right-most entry. Matches Express's numeric `trust proxy`. |

```typescript
// One proxy in front of the app (e.g. a single ALB):
const app = await NestBunFactory.create(AppModule, {
  serverOptions: { trustProxy: 1 },
});
```

### Using an existing Bun server

If you already have a `Bun.serve()` instance, hand it to the factory. The adapter re-points it at the Nest request handler with `server.reload()`, and `app.listen()` becomes a no-op because the server is already listening.

```typescript
import { NestBunFactory } from '@lexmata/nestjs-platform-bun';

const server = Bun.serve({ port: 3000, fetch: () => new Response('booting') });
const app = await NestBunFactory.createWithServer(AppModule, server);
```

## What's exported

| Export | Purpose |
| --- | --- |
| `NestBunFactory` | Creates a NestJS application backed by `Bun.serve()` |
| `BunAdapter` | The `AbstractHttpAdapter` implementation, if you want to construct it yourself |
| `createExpressRequest`, `createExpressResponse` | Express-shaped `req`/`res` wrappers around Bun's `Request`/`Response` |
| `createFastifyRequest`, `createFastifyReply`, `FastifyHooksManager`, `FastifyPluginRegistry` | Fastify-shaped request/reply objects, lifecycle hooks and plugin registration |
| `parseQueryParams`, `parseBody`, `enhanceRequest`, `getHeader`, `accepts`, `getIp`, `BodyParseError` | Request helpers, and the error `parseBody()` throws |
| `ResponseBuilder`, `response`, `json`, `text`, `html`, `error` | Response helpers |
| `SUPPORTED_FASTIFY_HOOKS`, `DEFAULT_HOOK_TIMEOUT_MS` | The 7 hook names `addHook()` accepts, and its default timeout |

Every type these declare is exported alongside them:

- **Adapter/application:** `BunServerOptions`, `BunRequest`, `BunHttpServer`, `NestBunApplication`, `NestBunApplicationOptions`
- **Express layer:** `ExpressRequest`, `ExpressResponse`, `ExpressMiddleware`, `ExpressErrorMiddleware`, `CookieOptions`
- **Fastify layer:** `FastifyRequest`, `FastifyReply`, `FastifyPlugin`, `FastifyInstance`, `FastifyHookName`, `FastifyRouteHandler`, `FastifyMiddleware`, `FastifyHooksManagerOptions`, `CreateFastifyRequestOptions`, and one type per hook (`FastifyOnRequestHook`, `FastifyPreValidationHook`, `FastifyPreHandlerHook`, `FastifyPayloadHook`, `FastifyPreSerializationHook`, `FastifyOnSendHook`, `FastifyOnErrorHook`, `FastifyOnResponseHook`)
- **Request helpers:** `ParsedRequest`, `GetIpOptions`, `RequestIpResolver`

The response helpers are the one exception, and not an omission: `src/utils/response.ts` declares no interfaces or type aliases at all. `ResponseBuilder` is a class, so its type is its export; `response`, `json`, `text`, `html` and `error` take and return plain `Response`/`unknown`.

## Migrating from `@pegasusheavy/nestjs-platform-bun`

This package was previously published as `@pegasusheavy/nestjs-platform-bun`. The old name is deprecated on npm and will not receive further releases. Update the dependency and your import specifiers:

```diff
-import { NestBunFactory } from '@pegasusheavy/nestjs-platform-bun';
+import { NestBunFactory } from '@lexmata/nestjs-platform-bun';
```

0.2.0 is also the first release that is actually installable — the 0.1.0 `exports` map pointed at a `dist/index.mjs` that the build never emitted, so importing the package failed to resolve outright. If you are coming from a vendored copy or a git install, these are the breaking changes. [`CHANGELOG.md`](./CHANGELOG.md) has the full detail.

| What changed | Before | After |
| --- | --- | --- |
| Raw Bun server | `app.getHttpServer()` | `app.getHttpServer().server` (may be `null`) |
| Parsed body | `req.parsedBody` | `await req.bodyPromise` (may be `undefined`) |
| `req.ip` / `req.ips` | trusted `X-Forwarded-*` always | requires `serverOptions.trustProxy` |
| Signed cookies | `req.signedCookies`, `CookieOptions.signed` | removed |
| Views | `setViewEngine()` / `render()` warned | both **throw** |
| Bad body | `parseBody()` returned `null` | throws `BodyParseError` |
| Fastify hooks | 11 names | 7 names; `addHook()` throws on the rest |
| `req.range()` | parsed the header | not implemented, returns `undefined` |
| `res.format()` | negotiated on `Accept` | no longer negotiates |
| `res.get()` / `getHeader()` | `null` when missing | `undefined` when missing |
| Repeated query keys | last one won | `string[]` |
| Listen address | `serverOptions.port` / `.hostname` | `app.listen(port, hostname?)` |

The changes worth reading twice:

- **`getHttpServer()` returns a `BunHttpServer` wrapper**, because NestJS requires an EventEmitter-shaped server and `Bun.serve()`'s return value is not one. Use `.server` for `reload()`, `publish()` and `requestIP()`; it is `null` before `listen()` and after `close()`.
- **`bodyPromise` is lazy and renamed.** It is not called `body` because `Request.body` is already the raw `ReadableStream`. The rename is deliberate: `req.parsedBody` is now a compile error you fix once, rather than a cast that keeps compiling and hands your code a `Promise` at runtime. It is `undefined` — with nothing read — for `GET`/`HEAD`/`OPTIONS`, and `await undefined` is `undefined`, so one `await` covers both cases.
- **`trustProxy` defaults to `false`.** See [`trustProxy`](#trustproxy) above for the `boolean | number` semantics. If you were relying on `req.ip` behind a load balancer, set it explicitly — prefer the hop count over `true`.
- **Two removed Fastify hooks have NestJS equivalents**: `onReady` → `onApplicationBootstrap`, `onClose` → `onApplicationShutdown`. Move that code to the NestJS lifecycle rather than reimplementing it. `preParsing`, `onTimeout` and `onListen` have no equivalent; for `onListen`, just run the code after `await app.listen()`.
- **`addHook()` now throws on an unsupported name** instead of silently dropping the registration, so a hook that was quietly never running will now surface at startup.

## Documentation

The full documentation site lives in [`docs/`](./docs) as an Angular application. To read it locally:

```bash
cd docs
pnpm install
pnpm start
```

## Benchmarks

[`BENCHMARK.md`](./BENCHMARK.md) describes the benchmark suite, how to run it, and the numbers measured on a single machine. Run it yourself with:

```bash
pnpm bench
```

## Development

```bash
bun test                 # run the whole suite (Bun is the only supported runner)
bun test --coverage      # with coverage; thresholds in bunfig.toml exit 1 when missed
pnpm lint                # ESLint across src/, test/, benchmark/ and examples/
pnpm typecheck           # tsc --noEmit over src/
pnpm typecheck:test      # tsc --noEmit over src/ + test/ (see tsconfig.test.json)
pnpm typecheck:examples  # build, then typecheck examples/ against the built package
pnpm build               # tsup -> dist/
```

`typecheck` and `typecheck:test` are split because the e2e suite still has type errors of its own; the split keeps the `src/` gate meaningful while they are worked through. `tsconfig.test.json` records the plan to fold them back together.

`typecheck:examples` is the one check that resolves the package **by name** through its `exports` map rather than reading `src/`, which makes it the contract test for what users actually install.

`bun test` is the only test runner. vitest workers always execute under Node, where `globalThis.Bun` is `undefined`, so every Bun-dependent suite silently skips there while vitest still exits 0.

`vitest` remains a devDependency **for its type declarations only** — the test files still write `import { describe, it, expect } from "vitest"`, which Bun's runtime transparently maps to `bun:test` but TypeScript cannot resolve on its own. Once those imports are switched to `bun:test`, the dependency can be dropped outright.

## License

MIT — see [LICENSE](./LICENSE).
