/**
 * Shared benchmark harness pieces used by both `run-benchmarks.ts` (the full
 * suite) and `verify-benchmarks.ts` (the reduced CI gate).
 *
 * Keeping the adapter list, the endpoint list and the process management in one
 * place is deliberate: when the CI gate covers a different set of endpoints than
 * the suite it is supposed to guard, a regression can pass CI while the
 * published benchmark quietly says something else.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

// Type-only: see `runAutocannon` for why the value import is dynamic.
import type autocannon from "autocannon";

/** The subset of `autocannon.Result` both callers consume. */
export type AutocannonResult = autocannon.Result;

/**
 * Absolute path to the workspace-local `tsx`.
 *
 * Deliberately not `npx`: `npx` will happily fetch a `tsx` from the registry
 * when it cannot find one locally, so the benchmark could end up measuring a
 * different transpiler than CI installed — and silently, since `npx` prints
 * nothing distinctive when it does. `pnpm exec tsx` would also work; the direct
 * binary is used because it removes a process layer between us and the server
 * we later have to signal.
 *
 * Resolved against `process.cwd()` rather than the module's own directory
 * because the adapter argv (`apps/express-app.ts`) is already relative to the
 * working directory: both `pnpm bench` and `pnpm verify` run from `benchmark/`.
 * If the binary is missing, `startServer`'s `error` handler reports the full
 * path, which names the fix (`pnpm install` in `benchmark/`).
 */
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");

export interface AdapterConfig {
  name: string;
  command: string;
  args: string[];
  port: number;
  env?: Record<string, string>;
}

export interface EndpointSpec {
  name: string;
  path: string;
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** Returns an error message when the response is wrong, or null when it is correct. */
  validate: (status: number, text: string) => string | null;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}=${raw}: expected a non-negative integer`);
  }
  return parsed;
}

/**
 * Build the adapter list for a given port base. The full suite and the CI gate
 * use different bases so a stale process from one can never be mistaken for the
 * other.
 */
export function buildAdapters(portBase: number): AdapterConfig[] {
  return [
    {
      name: "Express",
      command: TSX_BIN,
      args: ["apps/express-app.ts"],
      port: portBase + 1,
      env: { PORT: String(portBase + 1) },
    },
    {
      name: "Fastify",
      command: TSX_BIN,
      args: ["apps/fastify-app.ts"],
      port: portBase + 2,
      env: { PORT: String(portBase + 2) },
    },
    {
      name: "Bun",
      command: "bun",
      args: ["apps/bun-app.ts"],
      port: portBase + 3,
      env: { PORT: String(portBase + 3) },
    },
  ];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function expect200(status: number): string | null {
  return status === 200 ? null : `expected HTTP 200, got ${status}`;
}

/**
 * NestJS defaults `@Post()` handlers to HTTP 201, but the Bun adapter currently
 * answers 200. Both are successes, so the POST benchmark accepts either rather
 * than declaring one adapter broken over a status-code default.
 */
function expect2xx(status: number): string | null {
  return status >= 200 && status < 300 ? null : `expected a 2xx status, got ${status}`;
}

function snippet(text: string): string {
  return JSON.stringify(text.slice(0, 120));
}

/**
 * The benchmarked endpoints, each paired with an assertion about the response
 * body. Without the assertion an adapter that 404s `/cpu/light` would score as
 * the fastest, because a 404 is far cheaper than fibonacci(20).
 */
export const endpoints: EndpointSpec[] = [
  {
    name: "Hello World (text)",
    path: "/",
    method: "GET",
    validate: (status, text) =>
      expect200(status) ?? (text === "Hello World!" ? null : `expected body "Hello World!", got ${snippet(text)}`),
  },
  {
    name: "JSON Response",
    path: "/json",
    method: "GET",
    validate: (status, text) => {
      const bad = expect200(status);
      if (bad) return bad;
      const body = parseJson(text) as { message?: string; nested?: { foo?: string } } | undefined;
      if (body?.message !== "Hello World!") return `expected message "Hello World!", got ${snippet(text)}`;
      if (body?.nested?.foo !== "bar") return `expected nested.foo "bar", got ${snippet(text)}`;
      return null;
    },
  },
  {
    name: "Path Parameter",
    path: "/users/123",
    method: "GET",
    validate: (status, text) => {
      const bad = expect200(status);
      if (bad) return bad;
      const body = parseJson(text) as { id?: string; name?: string } | undefined;
      if (body?.id !== "123") return `expected id "123" (param extraction), got ${snippet(text)}`;
      if (body?.name !== "User 123") return `expected name "User 123", got ${snippet(text)}`;
      return null;
    },
  },
  {
    name: "Health Check",
    path: "/health",
    method: "GET",
    validate: (status, text) => {
      const bad = expect200(status);
      if (bad) return bad;
      const body = parseJson(text) as { status?: string } | undefined;
      return body?.status === "ok" ? null : `expected status "ok", got ${snippet(text)}`;
    },
  },
  {
    name: "CPU Light (fib 20)",
    path: "/cpu/light",
    method: "GET",
    validate: (status, text) => {
      const bad = expect200(status);
      if (bad) return bad;
      const body = parseJson(text) as { result?: number } | undefined;
      return body?.result === 6765 ? null : `expected fibonacci(20) === 6765, got ${snippet(text)}`;
    },
  },
  {
    name: "POST JSON Body",
    path: "/items",
    method: "POST",
    body: JSON.stringify({ name: "Test Item", value: 42 }),
    headers: { "Content-Type": "application/json" },
    validate: (status, text) => {
      const bad = expect2xx(status);
      if (bad) return bad;
      const body = parseJson(text) as { id?: string; name?: string; value?: number } | undefined;
      if (typeof body?.id !== "string" || body.id.length === 0) return `expected a generated id, got ${snippet(text)}`;
      // Undefined name/value here means the body never reached the handler -
      // exactly the "body parsing broken" case the POST benchmark must catch.
      if (body.name !== "Test Item" || body.value !== 42) {
        return `expected the posted body to be echoed back, got ${snippet(text)}`;
      }
      return null;
    },
  },
];

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll /health until the server answers or the timeout elapses.
 * Returns null on success, or a human-readable reason on failure.
 */
export async function waitForServer(port: number, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return null;
      lastError = `HTTP ${response.status} from /health`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }

  return `timed out after ${timeoutMs}ms waiting for http://localhost:${port}/health (last error: ${lastError})`;
}

/**
 * Spawn a server detached so it becomes its own process-group leader.
 *
 * A launcher may exec a child of its own; killing only the direct child would
 * orphan the real server, leave the port held, and silently benchmark a stale
 * process on the next run. Killing the group avoids that. `shell: true` is
 * deliberately not used - no shell features are needed and it adds another
 * untracked layer between us and the process we intend to signal.
 */
export function startServer(config: AdapterConfig): ChildProcess {
  const proc = spawn(config.command, config.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...config.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  proc.stdout?.on("data", (data: Buffer) => {
    const output = data.toString().trim();
    if (output) console.log(`    [${config.name} stdout] ${output}`);
  });

  // Never swallow stderr: a bootstrap crash, a port conflict or an OOM shows up
  // here and nowhere else.
  proc.stderr?.on("data", (data: Buffer) => {
    const output = data.toString().trimEnd();
    if (output) console.error(`    [${config.name} stderr] ${output}`);
  });

  proc.on("error", (err) => {
    console.error(`    [${config.name}] failed to spawn: ${err.message}`);
  });

  proc.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`    [${config.name}] exited with code ${code}`);
    } else if (signal !== null && signal !== "SIGTERM") {
      console.error(`    [${config.name}] exited on signal ${signal}`);
    }
  });

  return proc;
}

/** Kill the server's whole process group and wait for the port to be released. */
export async function stopServer(proc: ChildProcess, port: number): Promise<void> {
  const killGroup = (signal: NodeJS.Signals): void => {
    if (proc.pid === undefined) return;
    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        // Already gone.
      }
    }
  };

  if (proc.exitCode === null) killGroup("SIGTERM");

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/health`);
    } catch {
      return;
    }
    await sleep(100);
  }

  killGroup("SIGKILL");
}

/**
 * Issue one request per endpoint and assert the response is what the benchmark
 * claims to be measuring. Returns the list of problems found (empty when sound).
 */
export async function validateEndpoints(adapter: string, port: number, specs: EndpointSpec[]): Promise<string[]> {
  const problems: string[] = [];

  for (const spec of specs) {
    try {
      const response = await fetch(`http://localhost:${port}${spec.path}`, {
        method: spec.method,
        body: spec.body,
        headers: spec.headers,
      });
      const text = await response.text();
      const problem = spec.validate(response.status, text);
      if (problem) problems.push(`${adapter} ${spec.method} ${spec.path}: ${problem}`);
    } catch (err) {
      problems.push(
        `${adapter} ${spec.method} ${spec.path}: request failed - ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return problems;
}

/** Load-generator settings a caller varies between the full suite and the CI gate. */
export interface LoadOptions {
  /** Seconds to sustain the load for. */
  duration: number;
  /** Concurrent connections. */
  connections: number;
  /** Pipelined requests per connection. */
  pipelining: number;
  /** autocannon worker threads. 0 (or omitted) keeps it single-threaded. */
  workers?: number;
}

/**
 * `autocannon` is imported lazily, and only here.
 *
 * A top-level `import autocannon from "autocannon"` would put it on the module
 * graph of everything that imports this file - including `harness.test.ts`,
 * which runs under `bun test` at the repository root, where
 * `benchmark/node_modules` has not necessarily been installed. The unit tests
 * do not generate load, so they should not have to pay for the dependency.
 */
let autocannonModule: typeof autocannon | undefined;

async function loadAutocannon(): Promise<typeof autocannon> {
  if (!autocannonModule) {
    const imported = (await import("autocannon")) as unknown as
      | { default: typeof autocannon }
      | typeof autocannon;
    // `@types/autocannon` uses `export =`, so the interop shape differs between
    // the ESM and CJS transpilations tsx may produce. Accept either.
    autocannonModule =
      typeof imported === "function" ? imported : (imported as { default: typeof autocannon }).default;
  }
  return autocannonModule;
}

/**
 * Translate an endpoint plus load settings into autocannon's option bag.
 *
 * Split out from {@link runAutocannon} so it can be tested without generating
 * load: getting `method`, `body` or `headers` wrong here would silently measure
 * a GET where the benchmark claims to measure a POST, and the resulting number
 * would look entirely plausible.
 *
 * `workers` is omitted rather than passed as 0 - autocannon treats the key's
 * presence as a request to use worker threads.
 */
export function buildAutocannonOptions(
  url: string,
  spec: EndpointSpec,
  opts: LoadOptions
): autocannon.Options {
  return {
    url,
    connections: opts.connections,
    pipelining: opts.pipelining,
    duration: opts.duration,
    ...(opts.workers !== undefined && opts.workers > 0 ? { workers: opts.workers } : {}),
    method: spec.method,
    body: spec.body,
    headers: spec.headers,
  };
}

/**
 * Run autocannon once against a single endpoint.
 *
 * `workers` spreads the load generator across threads so a single event loop is
 * less likely to become the bottleneck - which would clip the fastest adapter
 * hardest and compress exactly the margin being reported.
 *
 * `autocannon.track()` is deliberately not called: it *adds* console rendering
 * rather than suppressing it, and it does not compose with worker threads.
 */
export async function runAutocannon(
  url: string,
  spec: EndpointSpec,
  opts: LoadOptions
): Promise<AutocannonResult> {
  const autocannonFn = await loadAutocannon();

  return new Promise((resolve, reject) => {
    autocannonFn(buildAutocannonOptions(url, spec, opts), (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * The three counters autocannon keeps for requests that did not succeed.
 *
 * They are separate counters, and gating on `non2xx` alone is how a run in which
 * the adapter reset or hung half its connections passes: those requests never
 * produce a status code at all, so `non2xx` stays 0 while the surviving fast
 * requests inflate req/s. A Fastify hook that never calls `done()` shows up in
 * `timeouts` and nowhere else.
 */
export interface FailureCounters {
  errors: number;
  timeouts: number;
  non2xx: number;
}

/**
 * Describe any non-zero failure counters, or null when the run was clean.
 * Used by both callers so the CI gate and the published suite fail on the same
 * evidence.
 */
export function describeFailures(counters: FailureCounters): string | null {
  const parts: string[] = [];
  if (counters.non2xx > 0) parts.push(`${counters.non2xx} non-2xx responses`);
  if (counters.errors > 0) parts.push(`${counters.errors} socket errors`);
  if (counters.timeouts > 0) parts.push(`${counters.timeouts} timeouts`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function formatNumber(num: number): string {
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${formatNumber(size)} ${units[unitIndex]}`;
}

/**
 * Relative difference as a percentage, or null when there is no usable baseline.
 * Returning null rather than a number is what stops `Infinity% faster` from ever
 * being printed when a baseline server failed to boot.
 */
export function relativeTo(value: number, baseline: number | null): number | null {
  if (baseline === null || !Number.isFinite(baseline) || baseline <= 0) return null;
  return (value / baseline - 1) * 100;
}

export function formatRelative(pct: number | null): string {
  if (pct === null) return "N/A";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
