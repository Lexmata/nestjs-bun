import "reflect-metadata";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Module,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { NestBunFactory } from "@lexmata/nestjs-platform-bun";

/**
 * Fail closed at boot. A `?? "some-default"` fallback here would mean a deploy
 * that forgets the env var still starts, still reports every webhook as
 * "verified", and signs with a secret that is public in this repository — so
 * anyone could forge a request. Refusing to start is the safe failure.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Refusing to start — a default signing secret would make ` +
        `every signature forgeable. Set one first, e.g.:\n` +
        `  export ${name}="$(openssl rand -hex 32)"`
    );
  }
  return value;
}

const SECRET = requireEnv("WEBHOOK_SECRET");

/** Reject signatures whose timestamp is more than this far from now. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/** Request shape after the adapter attaches the untouched bytes. */
interface RawBodyRequest {
  rawBody?: Buffer;
}

/** Constant-time comparison of two hex digests. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= (bufA[i] as number) ^ (bufB[i] as number);
  return diff === 0;
}

@Controller("webhook")
class WebhookController {
  // 200 rather than NestJS's POST default of 201: a webhook receiver is
  // acknowledging a delivery, not creating a resource. This governs the SUCCESS
  // path only — every rejection below throws, and NestJS's exception layer sets
  // the status from the exception (401/500), not from this decorator.
  @Post()
  @HttpCode(200)
  handle(
    @Req() req: RawBodyRequest,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-timestamp") timestamp: string | undefined,
    @Body() body: unknown
  ): object {
    const raw = req.rawBody;
    if (!raw) {
      // Misconfiguration, not a bad caller: the app was not created with
      // { rawBody: true }, so nothing can be verified. 500, loudly.
      throw new InternalServerErrorException(
        "rawBody missing — create the app with { rawBody: true }"
      );
    }

    // Replay protection. The timestamp is part of the signed payload, so a
    // captured request cannot simply have its header rewritten to look fresh —
    // changing it invalidates the signature.
    const sentAtSeconds = Number(timestamp);
    if (!timestamp || !Number.isFinite(sentAtSeconds)) {
      throw new UnauthorizedException("missing or malformed x-timestamp");
    }
    if (Math.abs(Date.now() - sentAtSeconds * 1000) > MAX_SKEW_MS) {
      throw new UnauthorizedException("timestamp outside the 5 minute replay window");
    }

    // Sign the EXACT bytes that arrived, prefixed with `${timestamp}.`. The
    // parsed body cannot be used here: JSON.stringify(body) re-serialises with
    // different key order, whitespace and number formatting, so its HMAC would
    // not match the sender's signature even though the payload is semantically
    // identical. The raw Buffer is fed to the hasher directly rather than
    // interpolated into a string, so binary bodies survive byte-for-byte.
    const hasher = new Bun.CryptoHasher("sha256", SECRET);
    hasher.update(`${timestamp}.`);
    hasher.update(raw);
    const expected = hasher.digest("hex");

    if (!signature || !safeEqualHex(signature, expected)) {
      // 401, never 200. Senders like Stripe and GitHub read a 2xx as
      // "delivered, stop retrying", so returning 200 with {ok:false} silently
      // discards the delivery and hides the rejection from any monitoring or
      // alerting keyed on status code. NestJS's exception layer turns this into
      // a proper 401 through the Bun adapter.
      throw new UnauthorizedException("invalid signature");
    }

    return { ok: true, event: body };
  }
}

@Module({ controllers: [WebhookController] })
class AppModule {}

const PORT = Number(process.env.PORT ?? 3000);

// rawBody: true tells the adapter to keep a Buffer of the original request bytes
// alongside the parsed body.
const app = await NestBunFactory.create(AppModule, { rawBody: true });

await app.listen(PORT);
console.log(`05-raw-body-webhook listening on http://localhost:${PORT}`);

// export WEBHOOK_SECRET="$(openssl rand -hex 32)"   # required; the app will not boot without it
// BODY='{"type":"invoice.paid","id":"in_1"}'
// TS=$(date +%s)
// SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')
// curl -s -X POST http://localhost:3000/webhook \
//   -H 'content-type: application/json' \
//   -H "x-timestamp: $TS" -H "x-signature: $SIG" -d "$BODY"
