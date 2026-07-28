import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestBunFactory } from "@lexmata/nestjs-platform-bun";
import type { FastifyPlugin, FastifyRequest } from "@lexmata/nestjs-platform-bun";

// The Fastify layer is an integration shim so existing Fastify hooks and plugins
// can run on the Bun server. The supported hook names are exactly:
//
//   onRequest, preValidation, preHandler, preSerialization, onSend, onResponse, onError
//
// Any other Fastify hook name (preParsing, onTimeout, onReady, onClose, onListen)
// throws at addHook() time rather than silently never firing.
//
// Execution order, matching upstream Fastify (printed by the onResponse hook below):
//
//   onRequest -> preValidation -> preHandler -> handler
//              -> preSerialization -> onSend -> onResponse
//
// One difference from upstream worth knowing: preSerialization receives the
// already-serialised payload here, not the handler's object, so it sees the same
// value onSend does. Rewrite the payload in either hook, but parse it first if
// you need the object.

@Controller()
class AppController {
  @Get()
  root(): object {
    return { message: "original payload" };
  }

  @Get("hook-error")
  hookError(): object {
    return { unreachable: true };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const traces = new WeakMap<object, string[]>();
const traceOf = (req: FastifyRequest): string[] => {
  let t = traces.get(req);
  if (!t) {
    t = [];
    traces.set(req, t);
  }
  return t;
};

/**
 * A Fastify plugin. `instance.addHook` accepts all seven supported hook names;
 * `adapter.addHook` works too, but its overload list is narrower.
 */
const lifecyclePlugin: FastifyPlugin = (instance, _opts, done) => {
  instance.addHook("onRequest", (req, _reply, hookDone) => {
    traceOf(req).push("onRequest");
    // A hook that calls done(err) short-circuits the request into onError.
    if (req.url.startsWith("/hook-error")) {
      hookDone(new Error("rejected by onRequest hook"));
      return;
    }
    hookDone();
  });

  instance.addHook("preValidation", (req, _reply, hookDone) => {
    traceOf(req).push("preValidation");
    hookDone();
  });

  instance.addHook("preHandler", (req, _reply, hookDone) => {
    traceOf(req).push("preHandler");
    hookDone();
  });

  instance.addHook("preSerialization", (req, _reply, payload, hookDone) => {
    traceOf(req).push("preSerialization");
    hookDone(null, payload);
  });

  // onSend may REWRITE the payload — either via done(null, newPayload) or by
  // returning it from an async hook. This was inert until recently; the rewritten
  // body is what actually reaches the client.
  //
  // As in Fastify, the payload here is the already-serialised body (a string for
  // JSON responses), not the object the controller returned.
  instance.addHook("onSend", (req, _reply, payload, hookDone) => {
    const trace = traceOf(req);
    trace.push("onSend");
    const original: unknown = typeof payload === "string" ? JSON.parse(payload) : payload;
    hookDone(
      null,
      JSON.stringify({
        ...(original as Record<string, unknown>),
        rewrittenBy: "onSend",
        hooks: [...trace],
      })
    );
  });

  instance.addHook("onResponse", (req, _reply, hookDone) => {
    const trace = traceOf(req);
    trace.push("onResponse");
    console.log(`[hooks] ${trace.join(" -> ")}`);
    hookDone();
  });

  // onError sees errors raised inside hooks. Exceptions thrown by a controller
  // are caught by NestJS's own exception layer before they reach the adapter.
  instance.addHook("onError", (req, reply, error, hookDone) => {
    console.log(`[hooks] onError: ${error.message}`);
    reply.code(400).send({ error: error.message, hooks: traceOf(req) });
    hookDone();
  });

  done();
};

const PORT = Number(process.env.PORT ?? 3000);

const app = await NestBunFactory.create(AppModule, { logger: ["error", "warn"] });

// Hooks and plugins live on the adapter, not on the application. getHttpServer()
// returns the EventEmitter-shaped server wrapper NestJS needs, so reach the
// adapter with getHttpAdapter(), which is typed as BunAdapter — no cast needed.
// Plugins are initialised during listen().
const adapter = app.getHttpAdapter();
adapter.register(lifecyclePlugin);

// Unsupported names throw immediately instead of failing silently at runtime.
// "preParsing" is not in addHook's overload list, so this call is invalid at the
// type level too — @ts-expect-error keeps that honest rather than casting the
// mistake away. A dynamically-computed hook name would reach the same runtime
// throw without any compile-time warning, which is what this guards against.
try {
  // @ts-expect-error - "preParsing" is not a supported hook name
  adapter.addHook("preParsing", () => {});
} catch (err) {
  console.log(`[hooks] rejected unsupported hook: ${(err as Error).message}`);
}

await app.listen(PORT);
console.log(`03-fastify-hooks listening on http://localhost:${PORT}`);

// curl http://localhost:3000/
//   -> {"message":"original payload","rewrittenBy":"onSend","hooks":[...]}
// curl -i http://localhost:3000/hook-error
//   -> 400, onError handled the hook failure
