/**
 * Unit tests for the shared benchmark harness.
 *
 * These functions decide whether the CI performance gate fires at all: if
 * `envInt` silently accepted garbage, if an endpoint's `validate` returned null
 * for a wrong body, or if `relativeTo` returned Infinity for a missing baseline,
 * the gate would keep reporting a pass over numbers that mean nothing. That is
 * worth testing even though the harness is not shipped code.
 *
 * Runs under `bun test` (the repository's only runner). The fixture servers use
 * `node:http` rather than `Bun.serve` so the file still typechecks under
 * `benchmark/tsconfig.json`, which declares `types: ["node"]`.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { type ChildProcess } from "node:child_process";
import {
  buildAdapters,
  buildAutocannonOptions,
  describeFailures,
  endpoints,
  envInt,
  formatBytes,
  formatNumber,
  formatRelative,
  relativeTo,
  sleep,
  startServer,
  stopServer,
  validateEndpoints,
  waitForServer,
  type EndpointSpec,
} from "./harness";

// ---------------------------------------------------------------- fixtures --

const openServers: Server[] = [];

/** Bodies a correct adapter returns, keyed by path. */
const CORRECT_BODIES: Record<string, string> = {
  "/": "Hello World!",
  "/json": JSON.stringify({ message: "Hello World!", nested: { foo: "bar" } }),
  "/users/123": JSON.stringify({ id: "123", name: "User 123" }),
  "/health": JSON.stringify({ status: "ok" }),
  "/cpu/light": JSON.stringify({ result: 6765 }),
  "/items": JSON.stringify({ id: "generated-id", name: "Test Item", value: 42 }),
};

/**
 * Start a throwaway HTTP server on an ephemeral port.
 * `respond` returns the [status, body] pair for a given path.
 */
async function startFixture(
  respond: (path: string) => [number, string]
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const [status, body] = respond(path);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  });

  openServers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

function endpointNamed(name: string): EndpointSpec {
  const spec = endpoints.find((e) => e.name === name);
  if (!spec) throw new Error(`No benchmark endpoint named "${name}"`);
  return spec;
}

// ------------------------------------------------------------------ envInt --

describe("envInt", () => {
  const KEY = "HARNESS_TEST_ENV_INT";

  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns the parsed value for a valid integer", () => {
    process.env[KEY] = "42";
    expect(envInt(KEY, 7)).toBe(42);
  });

  it("accepts zero, which is a meaningful setting (e.g. BENCH_WARMUP=0)", () => {
    process.env[KEY] = "0";
    expect(envInt(KEY, 7)).toBe(0);
  });

  it("falls back when the variable is unset", () => {
    expect(envInt(KEY, 7)).toBe(7);
  });

  it("falls back when the variable is set but empty", () => {
    // An unset variable in CI usually arrives as "", not as undefined.
    process.env[KEY] = "";
    expect(envInt(KEY, 7)).toBe(7);
  });

  it("throws on a negative value rather than silently benchmarking backwards", () => {
    process.env[KEY] = "-1";
    expect(() => envInt(KEY, 7)).toThrow(/non-negative integer/);
  });

  it("throws on a non-numeric value", () => {
    process.env[KEY] = "not-a-number";
    expect(() => envInt(KEY, 7)).toThrow(/expected a non-negative integer/);
  });

  it("names the offending variable and value in the error", () => {
    process.env[KEY] = "-5";
    expect(() => envInt(KEY, 7)).toThrow(new RegExp(`${KEY}=-5`));
  });
});

// ----------------------------------------------------------- buildAdapters --

describe("buildAdapters", () => {
  it("assigns each adapter a distinct port off the given base", () => {
    const adapters = buildAdapters(4000);
    expect(adapters.map((a) => a.port)).toEqual([4001, 4002, 4003]);
    expect(adapters.map((a) => a.name)).toEqual(["Express", "Fastify", "Bun"]);
  });

  it("keeps the CI gate's ports disjoint from the full suite's", () => {
    const suite = buildAdapters(4000).map((a) => a.port);
    const gate = buildAdapters(5000).map((a) => a.port);
    expect(suite.filter((port) => gate.includes(port))).toEqual([]);
  });

  it("passes each adapter its own port through the environment", () => {
    for (const adapter of buildAdapters(5000)) {
      expect(adapter.env?.["PORT"]).toBe(String(adapter.port));
    }
  });

  it("runs the Node baselines on node directly, with no transpiler in the process", () => {
    // Running these under tsx biased the comparison: an esbuild loader hook
    // stayed resident for the life of the process, a cost the natively-executed
    // Bun app never paid, and esbuild does not emit decorator metadata.
    const nodeBaselines = buildAdapters(4000).filter((a) => a.name !== "Bun");
    expect(nodeBaselines).toHaveLength(2);

    for (const adapter of nodeBaselines) {
      expect(adapter.command).toBe("node");
      expect(adapter.command).not.toBe("npx");
      expect(adapter.args).toHaveLength(1);
      expect(adapter.args[0]).toMatch(/[\\/]dist[\\/]apps[\\/].+-app\.js$/);
      // A .ts entry point here would mean a transpiler is back in the loop.
      expect(adapter.args[0]).not.toMatch(/\.ts$/);
    }
  });

  it("runs the compiled Bun app on bun directly", () => {
    const bun = buildAdapters(4000).find((a) => a.name === "Bun");
    expect(bun?.command).toBe("bun");
    expect(bun?.args).toHaveLength(1);
    expect(bun?.args[0]).toMatch(/[\\/]dist[\\/]apps[\\/]bun-app\.js$/);
    expect(bun?.args[0]).not.toMatch(/\.ts$/);
  });
});

// ------------------------------------------------------------- relativeTo ---

describe("relativeTo", () => {
  it("reports a percentage difference against a usable baseline", () => {
    expect(relativeTo(150, 100)).toBeCloseTo(50);
    expect(relativeTo(50, 100)).toBeCloseTo(-50);
    expect(relativeTo(100, 100)).toBeCloseTo(0);
  });

  it("returns null for a zero baseline instead of Infinity", () => {
    // A baseline server that booted but served nothing must not read as an
    // infinite speedup.
    expect(relativeTo(1000, 0)).toBeNull();
  });

  it("returns null for a negative baseline", () => {
    expect(relativeTo(1000, -1)).toBeNull();
  });

  it("returns null for a missing baseline", () => {
    expect(relativeTo(1000, null)).toBeNull();
  });

  it("returns null for a non-finite baseline", () => {
    expect(relativeTo(1000, Number.NaN)).toBeNull();
    expect(relativeTo(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatRelative", () => {
  it("renders N/A when there is no comparison to make", () => {
    expect(formatRelative(null)).toBe("N/A");
  });

  it("signs an improvement explicitly", () => {
    expect(formatRelative(12.34)).toBe("+12.3%");
  });

  it("renders a regression with its own minus sign", () => {
    expect(formatRelative(-12.34)).toBe("-12.3%");
  });

  it("does not sign zero", () => {
    expect(formatRelative(0)).toBe("0.0%");
  });
});

// -------------------------------------------------------------- formatting --

describe("formatNumber / formatBytes", () => {
  it("groups thousands and caps the fraction", () => {
    expect(formatNumber(1234567.891)).toBe("1,234,567.89");
  });

  it("scales bytes to the largest unit that keeps the number above 1", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1024 * 1024 * 3)).toBe("3 MB");
    expect(formatBytes(1024 ** 3 * 2)).toBe("2 GB");
  });

  it("stops at GB rather than running off the end of the unit list", () => {
    expect(formatBytes(1024 ** 4)).toBe("1,024 GB");
  });
});

// -------------------------------------------------------- describeFailures --

describe("describeFailures", () => {
  it("returns null for a clean run", () => {
    expect(describeFailures({ non2xx: 0, errors: 0, timeouts: 0 })).toBeNull();
  });

  it("reports timeouts, which non-2xx alone would miss entirely", () => {
    // A hook that never calls done() hangs the request: no status code is ever
    // produced, so non2xx stays 0 and only `timeouts` moves.
    expect(describeFailures({ non2xx: 0, errors: 0, timeouts: 3 })).toBe("3 timeouts");
  });

  it("reports socket errors", () => {
    expect(describeFailures({ non2xx: 0, errors: 5, timeouts: 0 })).toBe("5 socket errors");
  });

  it("reports non-2xx responses", () => {
    expect(describeFailures({ non2xx: 2, errors: 0, timeouts: 0 })).toBe("2 non-2xx responses");
  });

  it("reports every non-zero counter at once", () => {
    expect(describeFailures({ non2xx: 1, errors: 2, timeouts: 3 })).toBe(
      "1 non-2xx responses, 2 socket errors, 3 timeouts"
    );
  });
});

// --------------------------------------------------------- endpoint checks --

describe("endpoints[].validate", () => {
  it("covers every endpoint the benchmark measures", () => {
    expect(endpoints.length).toBeGreaterThan(0);
    for (const spec of endpoints) {
      expect(typeof spec.validate).toBe("function");
      expect(spec.path.startsWith("/")).toBe(true);
    }
  });

  it("accepts the correct response for every endpoint", () => {
    for (const spec of endpoints) {
      const body = CORRECT_BODIES[spec.path];
      expect(body, `No fixture body for ${spec.path}`).toBeDefined();
      expect(spec.validate(200, body!), `${spec.path} rejected a correct response`).toBeNull();
    }
  });

  it("rejects a non-200 for every GET endpoint", () => {
    // A 404 is far cheaper than the work the endpoint is supposed to do, so an
    // adapter that does not implement the route must not score as the fastest.
    for (const spec of endpoints.filter((e) => e.method === "GET")) {
      expect(spec.validate(404, "Not Found")).toMatch(/expected HTTP 200/);
    }
  });

  it("rejects the wrong body on the text endpoint", () => {
    const spec = endpointNamed("Hello World (text)");
    expect(spec.validate(200, "Goodbye World!")).toMatch(/expected body "Hello World!"/);
  });

  it("rejects a JSON response with the wrong message or missing nesting", () => {
    const spec = endpointNamed("JSON Response");
    expect(spec.validate(200, JSON.stringify({ message: "nope", nested: { foo: "bar" } }))).toMatch(
      /expected message/
    );
    expect(spec.validate(200, JSON.stringify({ message: "Hello World!" }))).toMatch(
      /expected nested\.foo/
    );
    expect(spec.validate(200, "not json at all")).toMatch(/expected message/);
  });

  it("rejects a path-parameter response that did not extract the param", () => {
    const spec = endpointNamed("Path Parameter");
    // The failure mode this exists for: a router that matches the route but
    // never populates params, so every id comes back undefined.
    expect(spec.validate(200, JSON.stringify({ name: "User 123" }))).toMatch(
      /param extraction/
    );
    expect(spec.validate(200, JSON.stringify({ id: "123", name: "Someone Else" }))).toMatch(
      /expected name "User 123"/
    );
  });

  it("rejects a health check that is not ok", () => {
    const spec = endpointNamed("Health Check");
    expect(spec.validate(200, JSON.stringify({ status: "degraded" }))).toMatch(/expected status "ok"/);
  });

  it("rejects a CPU endpoint that did not actually compute fibonacci(20)", () => {
    const spec = endpointNamed("CPU Light (fib 20)");
    expect(spec.validate(200, JSON.stringify({ result: 0 }))).toMatch(/6765/);
    expect(spec.validate(200, JSON.stringify({}))).toMatch(/6765/);
  });

  describe("POST JSON Body", () => {
    const spec = endpointNamed("POST JSON Body");

    it("accepts either 200 or 201, since NestJS and the adapter disagree on the default", () => {
      const body = CORRECT_BODIES["/items"]!;
      expect(spec.validate(200, body)).toBeNull();
      expect(spec.validate(201, body)).toBeNull();
    });

    it("rejects a non-2xx status", () => {
      expect(spec.validate(500, "{}")).toMatch(/expected a 2xx status/);
    });

    it("rejects a response with no generated id", () => {
      expect(spec.validate(201, JSON.stringify({ name: "Test Item", value: 42 }))).toMatch(
        /expected a generated id/
      );
      expect(
        spec.validate(201, JSON.stringify({ id: "", name: "Test Item", value: 42 }))
      ).toMatch(/expected a generated id/);
    });

    it("rejects a response that did not echo the posted body back", () => {
      // Undefined name/value means the body never reached the handler - the
      // "body parsing is broken" case the POST benchmark exists to catch.
      expect(spec.validate(201, JSON.stringify({ id: "x" }))).toMatch(/echoed back/);
      expect(
        spec.validate(201, JSON.stringify({ id: "x", name: "Test Item", value: 41 }))
      ).toMatch(/echoed back/);
    });

    it("sends a JSON body with a Content-Type", () => {
      expect(spec.method).toBe("POST");
      expect(spec.headers?.["Content-Type"]).toBe("application/json");
      expect(JSON.parse(spec.body!)).toEqual({ name: "Test Item", value: 42 });
    });
  });
});

// -------------------------------------------------- buildAutocannonOptions --

describe("buildAutocannonOptions", () => {
  const load = { duration: 5, connections: 50, pipelining: 10, workers: 2 };

  it("carries the load settings straight through", () => {
    const opts = buildAutocannonOptions("http://localhost:1/", endpointNamed("Health Check"), load);
    expect(opts).toMatchObject({
      url: "http://localhost:1/",
      duration: 5,
      connections: 50,
      pipelining: 10,
      workers: 2,
    });
  });

  it("carries the endpoint's method, body and headers", () => {
    // Losing these would measure a GET while reporting a POST, and the number
    // would look perfectly plausible.
    const spec = endpointNamed("POST JSON Body");
    const opts = buildAutocannonOptions("http://localhost:1/items", spec, load);

    expect(opts.method).toBe("POST");
    expect(opts.body).toBe(spec.body);
    expect(opts.headers).toEqual(spec.headers);
  });

  it("omits workers entirely when single-threaded, rather than passing 0", () => {
    // autocannon treats the presence of the key as a request for worker threads.
    expect(buildAutocannonOptions("http://x/", endpoints[0]!, { ...load, workers: 0 })).not.toHaveProperty(
      "workers"
    );
    expect(
      buildAutocannonOptions("http://x/", endpoints[0]!, {
        duration: 1,
        connections: 1,
        pipelining: 1,
      })
    ).not.toHaveProperty("workers");
  });
});

// ------------------------------------------------------------------- sleep --

describe("sleep", () => {
  it("resolves after roughly the requested delay", async () => {
    const started = Date.now();
    await sleep(20);
    // Timer slack is generous on purpose: this asserts sleep waits at all, not
    // that the platform scheduler is precise.
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------- waitForServer ---

describe("waitForServer", () => {
  it("returns null once /health answers", async () => {
    const fixture = await startFixture(() => [200, JSON.stringify({ status: "ok" })]);
    expect(await waitForServer(fixture.port, 5_000)).toBeNull();
  });

  it("reports a timeout, with the URL and the last error, when nothing is listening", async () => {
    // Port 1 is privileged and never bound by a test fixture.
    const reason = await waitForServer(1, 100, 25);
    expect(reason).toContain("timed out after 100ms");
    expect(reason).toContain("http://localhost:1/health");
    expect(reason).toContain("last error");
  });

  it("keeps waiting while /health answers non-2xx", async () => {
    const fixture = await startFixture(() => [503, "starting"]);
    const reason = await waitForServer(fixture.port, 100, 25);
    expect(reason).toContain("HTTP 503 from /health");
  });
});

// ------------------------------------------------------- validateEndpoints --

describe("validateEndpoints", () => {
  it("reports no problems against a correct server", async () => {
    const fixture = await startFixture((path) => [200, CORRECT_BODIES[path] ?? ""]);
    expect(await validateEndpoints("Fixture", fixture.port, endpoints)).toEqual([]);
  });

  it("names the adapter, method and path of every wrong response", async () => {
    const fixture = await startFixture(() => [404, "Not Found"]);
    const problems = await validateEndpoints("Fixture", fixture.port, endpoints);

    expect(problems).toHaveLength(endpoints.length);
    expect(problems[0]).toContain("Fixture GET /:");
    expect(problems.some((p) => p.includes("POST /items"))).toBe(true);
  });

  it("reports only the endpoints that are actually wrong", async () => {
    const fixture = await startFixture((path) =>
      path === "/cpu/light" ? [200, JSON.stringify({ result: 0 })] : [200, CORRECT_BODIES[path] ?? ""]
    );
    const problems = await validateEndpoints("Fixture", fixture.port, endpoints);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("/cpu/light");
    expect(problems[0]).toContain("6765");
  });

  it("turns a failed request into a problem rather than throwing", async () => {
    const problems = await validateEndpoints("Dead", 1, endpoints);
    expect(problems).toHaveLength(endpoints.length);
    for (const problem of problems) {
      expect(problem).toContain("request failed");
    }
  });
});

// -------------------------------------------------- startServer/stopServer --

describe("startServer / stopServer", () => {
  /** A one-liner HTTP server, launched the same way the adapters are. */
  const inlineServer = (port: number): string =>
    `require('node:http').createServer((_q,s)=>{s.writeHead(200,{'Content-Type':'application/json'});s.end('{"status":"ok"}')}).listen(${port},'127.0.0.1')`;

  it("starts a process that serves /health, and stops it again", async () => {
    const port = 43_517;
    const proc = startServer({
      name: "Fixture",
      command: process.execPath,
      args: ["-e", inlineServer(port)],
      port,
    });

    try {
      expect(await waitForServer(port, 15_000)).toBeNull();
    } finally {
      await stopServer(proc, port);
    }

    // The port must actually be free afterwards, otherwise the next adapter in
    // the run silently benchmarks this leftover process.
    expect(await waitForServer(port, 300)).toContain("timed out");
  }, 30_000);

  it("reports a command that cannot be spawned instead of hanging", async () => {
    const port = 43_518;
    const proc = startServer({
      name: "Missing",
      command: "/nonexistent/definitely-not-a-real-binary",
      args: [],
      port,
    });

    expect(await waitForServer(port, 100, 25)).toContain("timed out");
    await stopServer(proc, port);
  }, 15_000);

  /** Resolve once the child has exited and its pipes have drained. */
  function waitForExit(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      proc.on("close", () => resolve());
    });
  }

  it("relays the server's stdout and stderr instead of swallowing them", async () => {
    // A bootstrap crash, a port conflict or an OOM in a benchmarked adapter
    // shows up on its stderr and nowhere else.
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const proc = startServer({
        name: "Noisy",
        command: process.execPath,
        args: ["-e", "console.log('boot ok'); console.error('boot warning');"],
        port: 43_519,
      });
      await waitForExit(proc);

      expect(log.mock.calls.flat().join("\n")).toContain("[Noisy stdout] boot ok");
      expect(error.mock.calls.flat().join("\n")).toContain("[Noisy stderr] boot warning");
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }, 20_000);

  it("reports a non-zero exit code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const proc = startServer({
        name: "Crasher",
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
        port: 43_520,
      });
      await waitForExit(proc);

      expect(error.mock.calls.flat().join("\n")).toContain("[Crasher] exited with code 3");
    } finally {
      error.mockRestore();
    }
  }, 20_000);

  it("reports an exit on a signal other than the SIGTERM it sends itself", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const proc = startServer({
        name: "Killed",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
        port: 43_521,
      });

      // Give the child a moment to exist before signalling it.
      await sleep(200);
      expect(proc.pid).toBeDefined();
      process.kill(proc.pid!, "SIGKILL");
      await waitForExit(proc);

      expect(error.mock.calls.flat().join("\n")).toContain("[Killed] exited on signal SIGKILL");
    } finally {
      error.mockRestore();
    }
  }, 20_000);

  it("does not throw when the process group is already gone", async () => {
    // process.kill(-pid) raises ESRCH once the group has exited; stopServer must
    // fall back to the direct kill and then return, not propagate.
    const killed: string[] = [];
    const ghost = {
      pid: 0x7ffffff0,
      exitCode: null,
      kill: (signal?: string) => {
        killed.push(String(signal));
        return true;
      },
    } as unknown as ChildProcess;

    await stopServer(ghost, 1);
    expect(killed).toEqual(["SIGTERM"]);
  }, 15_000);

  it("is a no-op when the child never got a pid", async () => {
    const ghost = { pid: undefined, exitCode: null, kill: () => true } as unknown as ChildProcess;
    await expect(stopServer(ghost, 1)).resolves.toBeUndefined();
  }, 15_000);
});
