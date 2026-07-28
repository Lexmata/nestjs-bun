import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestBunFactory } from "@lexmata/nestjs-platform-bun";
import type { ExpressErrorMiddleware, ExpressMiddleware } from "@lexmata/nestjs-platform-bun";

// The Express layer is an integration shim, not a reimplementation of Express.
// It covers the request/response surface middleware actually touches: req.method,
// req.path, req.headers, req.body, req.query/params, res.status/json/send/set/end,
// and the (req, res, next) contract including 4-argument error middleware.
//
// NOT supported: middleware that needs Node stream APIs on `res` — `res.write`,
// chunked `res.end`, `res.on('finish')`, piping. `compression` is the canonical
// example; it wraps `res.write`/`res.end` and will not work here.

/** Fail closed at boot rather than baking a credential into the source. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Refusing to start — a hardcoded fallback credential ` +
        `would ship in the source. Set one first, e.g.:\n` +
        `  export ${name}="$(openssl rand -hex 32)"`
    );
  }
  return value;
}

const ADMIN_TOKEN = requireEnv("ADMIN_TOKEN");

@Controller()
class AppController {
  @Get()
  root(): object {
    return { route: "/" };
  }
}

@Controller("admin")
class AdminController {
  @Get()
  dashboard(): object {
    return { route: "/admin" };
  }
}

@Module({ controllers: [AppController, AdminController] })
class AppModule {}

/** 1. Plain synchronous middleware. */
const logger: ExpressMiddleware = (req, _res, next) => {
  console.log(`[log] ${req.method} ${req.path}`);
  next();
};

/**
 * 2. Callback-style middleware that calls next() ASYNCHRONOUSLY.
 *
 * This is the important one. Middleware that defers next() to a later tick
 * (setTimeout, a callback-based library, anything after an await) used to
 * silently return an empty 200 without ever reaching the route handler. The
 * adapter now waits for next(), so the handler runs and headers set here
 * survive onto the response.
 */
const asyncNext: ExpressMiddleware = (_req, res, next) => {
  setTimeout(() => {
    res.set("X-Async-Middleware", "reached-handler");
    next();
  }, 10);
};

/**
 * 3. Path-scoped middleware — only runs for URLs under /admin.
 *
 * This demonstrates PATH SCOPING, not authentication. A real gate needs a
 * constant-time comparison (see `safeEqualHex` in 05-raw-body-webhook), a
 * signed/expiring credential rather than a shared static token, and rate
 * limiting. Do not copy the `!==` compare below into an auth check.
 */
const requireAdminToken: ExpressMiddleware = (req, res, next) => {
  if (req.get("x-admin-token") !== ADMIN_TOKEN) {
    res.status(403).json({ error: "forbidden" });
    return; // response ended; do not call next()
  }
  next();
};

/** Feeds the error handler: rejects /explode before it reaches a controller. */
const explode: ExpressMiddleware = (_req, _res, next) => {
  next(new Error("middleware exploded"));
};

/** 4. Express error middleware — recognised by its 4-argument signature. */
const errorHandler: ExpressErrorMiddleware = (err, _req, res, _next) => {
  res.status(500).json({
    error: "middleware-error-handler",
    message: err instanceof Error ? err.message : String(err),
  });
};

const PORT = Number(process.env.PORT ?? 3000);

const app = await NestBunFactory.create(AppModule);

app.use(logger);
app.use(asyncNext);
app.use("/explode", explode);
app.use("/admin", requireAdminToken);
app.use(errorHandler);

await app.listen(PORT);
console.log(`02-express-middleware listening on http://localhost:${PORT}`);

// export ADMIN_TOKEN="$(openssl rand -hex 32)"   # required; the app will not boot without it
// curl -i http://localhost:3000/                  # X-Async-Middleware: reached-handler
// curl -i http://localhost:3000/admin             # 403 forbidden
// curl -i http://localhost:3000/admin -H "x-admin-token: $ADMIN_TOKEN"   # 200 {"route":"/admin"}
// curl -i http://localhost:3000/explode           # 500 middleware-error-handler
