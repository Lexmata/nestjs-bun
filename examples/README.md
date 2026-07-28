# Examples

Runnable applications for `@lexmata/nestjs-platform-bun`.

## Requirements

- **Bun >= 1.0.0** (the root `package.json` `engines` constraint). These examples
  run on Bun only — the adapter targets `Bun.serve`, and Node compatibility is an
  explicit non-goal.
- `pnpm` for the one-time install.

## Setup

All five examples share a single `package.json` — one install, one lockfile:

```bash
cd examples
pnpm install
```

The package is depended on **by name** (`"@lexmata/nestjs-platform-bun": "file:.."`)
and imported that way in every example, so they exercise the built artifact that
users actually install rather than the TypeScript sources.

## After changing library source: rebuild AND reinstall

pnpm **hard-copies** `file:` dependencies at install time — it does not symlink
them. Rebuilding `dist/` alone therefore leaves the examples running the old
code. Both steps are required:

```bash
bun run build                 # from the repo root
cd examples && pnpm install --force
```

Skipping the second step is the trap: the examples keep silently running a stale
build, and a broken `exports` map or a missing `dist/` shows up as an unrelated
import error much later.

## The examples

| Example | Demonstrates | Run |
| --- | --- | --- |
| `01-basic` | `NestBunFactory.create`, `@Get`/`@Post`, `@Param()` routes, and `@Header()` on a response | `pnpm start:basic` |
| `02-express-middleware` | Express middleware on the Bun server: sync, **async `next()`**, path-scoped `app.use('/admin', fn)`, and 4-argument error middleware | `pnpm start:express-middleware` |
| `03-fastify-hooks` | The seven supported Fastify hooks, their execution order, an `onSend` hook rewriting the payload, and `onError` | `pnpm start:fastify-hooks` |
| `04-tls` | HTTPS through `serverOptions.tls`, passed to `Bun.serve` | `pnpm start:tls` |
| `05-raw-body-webhook` | `rawBody: true`, constant-time HMAC verification over the exact request bytes, timestamped replay protection, and NestJS exception filters (401/500) through the adapter | `pnpm start:webhook` |

Every example listens on port 3000 by default, except `04-tls`, which uses 3443. Override any of them with `PORT=…`.

### 01-basic

```bash
pnpm start:basic
curl http://localhost:3000/
curl http://localhost:3000/users/42
curl -X POST http://localhost:3000/echo -H 'content-type: application/json' -d '{"a":1}'
curl -i http://localhost:3000/cached      # Cache-Control: max-age=3600
```

### 02-express-middleware

The Express layer is an **integration shim** so existing Express middleware can run
inside the Bun server — not a reimplementation of Express. It covers the
request/response surface middleware touches. Middleware that needs Node stream
APIs on `res` (`res.write`, chunked `res.end`, `res.on('finish')`) — `compression`
being the canonical case — is not supported.

The `/admin` middleware reads its token from `ADMIN_TOKEN` and the app refuses to
boot if it is unset — no hardcoded fallback credential. It demonstrates **path
scoping**, not authentication: the plain `!==` compare is not a constant-time
comparison, and a static shared token is not a credential. See `05-raw-body-webhook`
for the real pattern.

```bash
export ADMIN_TOKEN="$(openssl rand -hex 32)"
pnpm start:express-middleware

curl -i http://localhost:3000/          # X-Async-Middleware: reached-handler
curl -i http://localhost:3000/admin     # 403 forbidden
curl -i http://localhost:3000/admin -H "x-admin-token: $ADMIN_TOKEN"   # 200 {"route":"/admin"}
curl -i http://localhost:3000/explode   # 500 middleware-error-handler
```

### 03-fastify-hooks

Supported hook names are exactly `onRequest`, `preValidation`, `preHandler`,
`preSerialization`, `onSend`, `onResponse`, `onError`. Any other name throws at
`addHook()` time.

```bash
pnpm start:fastify-hooks
curl http://localhost:3000/
# {"message":"original payload","rewrittenBy":"onSend","hooks":[...]}
curl -i http://localhost:3000/hook-error   # 400, handled by the onError hook
```

The server log prints the hook order for each request.

### 04-tls

Certificates are never committed. Generate a self-signed pair first — the example
exits with instructions if `key.pem`/`cert.pem` are missing:

```bash
./04-tls/generate-cert.sh
pnpm start:tls
curl -k https://localhost:3443/
```

### 05-raw-body-webhook

The app is created with `rawBody: true`, so `req.rawBody` holds the untouched
request bytes. The signature must be computed over those bytes: re-serialising
the parsed body with `JSON.stringify` changes whitespace, key order and number
formatting, which changes the HMAC.

Three things this example is careful about, all of which matter in production:

- **No fallback secret.** `WEBHOOK_SECRET` is required; the app throws at boot if
  it is unset, rather than starting with a default that would make every
  signature forgeable.
- **Rejections are HTTP failures.** A bad signature is a `401`, a missing
  `rawBody` (i.e. the app was built without `rawBody: true`) is a `500`. Returning
  `200 {"ok":false}` tells Stripe/GitHub the delivery succeeded, so they stop
  retrying and the rejection is invisible to status-code monitoring.
- **Replay protection.** The signed payload is `` `${timestamp}.${rawBody}` ``, and
  an `x-timestamp` more than 5 minutes from now is rejected. Without it a single
  captured valid request can be replayed forever.

```bash
export WEBHOOK_SECRET="$(openssl rand -hex 32)"
pnpm start:webhook
```

Then, in the same shell (so `$WEBHOOK_SECRET` matches the running server):

```bash
BODY='{"type":"invoice.paid","id":"in_1"}'
TS=$(date +%s)
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

# valid -> 200 {"ok":true,"event":{...}}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/webhook \
  -H 'content-type: application/json' \
  -H "x-timestamp: $TS" -H "x-signature: $SIG" -d "$BODY"

# bad signature -> 401 Unauthorized
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/webhook \
  -H 'content-type: application/json' \
  -H "x-timestamp: $TS" -H 'x-signature: deadbeef' -d "$BODY"

# stale timestamp (10 minutes old, correctly signed) -> 401 Unauthorized
STALE=$(( $(date +%s) - 600 ))
STALE_SIG=$(printf '%s' "$STALE.$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/webhook \
  -H 'content-type: application/json' \
  -H "x-timestamp: $STALE" -H "x-signature: $STALE_SIG" -d "$BODY"
```
