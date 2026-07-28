#!/usr/bin/env tsx
/**
 * NestJS adapter benchmark suite.
 *
 * Boots each adapter (Express, Fastify, Bun) out-of-process and sequentially,
 * validates that every endpoint actually returns the response it is supposed to
 * return, then measures each endpoint several times and reports the median plus
 * the run-to-run spread.
 *
 * The harness is deliberately noisy about failure: a server that will not boot,
 * an endpoint that returns the wrong body, or any non-2xx response during a run
 * fails the whole process with a non-zero exit code. A benchmark that cannot
 * tell you it measured the wrong thing is worse than no benchmark.
 *
 * Tunables (all optional environment variables):
 *   BENCH_RUNS             measurement runs per endpoint      (default 3)
 *   BENCH_DURATION         seconds per measurement run        (default 5)
 *   BENCH_WARMUP           seconds of warmup per endpoint     (default 3)
 *   BENCH_CONNECTIONS      concurrent connections             (default 100)
 *   BENCH_PIPELINING       pipelined requests per connection  (default 10)
 *   BENCH_WORKERS          autocannon worker threads          (default: half the CPUs, 2..4)
 *   BENCH_BOOT_TIMEOUT_MS  server boot timeout                (default 60000)
 */

import { cpus } from "node:os";
import {
  buildAdapters,
  describeFailures,
  endpoints,
  envInt,
  formatBytes,
  formatNumber,
  formatRelative,
  relativeTo,
  runAutocannon,
  startServer,
  stopServer,
  validateEndpoints,
  waitForServer,
  type AutocannonResult,
  type EndpointSpec,
} from "./harness";

const RUNS = envInt("BENCH_RUNS", 3);
const BENCHMARK_DURATION = envInt("BENCH_DURATION", 5);
const WARMUP_DURATION = envInt("BENCH_WARMUP", 3);
const CONNECTIONS = envInt("BENCH_CONNECTIONS", 100);
const PIPELINING = envInt("BENCH_PIPELINING", 10);
const DEFAULT_WORKERS = Math.max(2, Math.min(4, Math.floor(cpus().length / 2)));
const WORKERS = envInt("BENCH_WORKERS", DEFAULT_WORKERS);
const BOOT_TIMEOUT_MS = envInt("BENCH_BOOT_TIMEOUT_MS", 60_000);

const adapters = buildAdapters(4000);

interface RunSample {
  reqPerSec: number;
  latencyAvg: number;
  latencyP99: number;
  throughputAvg: number;
  totalRequests: number;
  errors: number;
  timeouts: number;
  non2xx: number;
}

interface BenchmarkResult {
  adapter: string;
  endpoint: string;
  samples: RunSample[];
  median: RunSample;
  /** (max - min) / median, as a percentage. A proxy for run-to-run stability. */
  spreadPct: number;
}

/** Load settings for a measurement run. Warmup overrides `connections`. */
const LOAD = {
  duration: BENCHMARK_DURATION,
  connections: CONNECTIONS,
  pipelining: PIPELINING,
  workers: WORKERS,
};

function toSample(result: AutocannonResult): RunSample {
  return {
    reqPerSec: result.requests.average,
    latencyAvg: result.latency.average,
    latencyP99: result.latency.p99,
    throughputAvg: result.throughput.average,
    totalRequests: result.requests.total,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
  };
}

/**
 * Warm up using the *same* method, body and headers the measurement will use.
 * A GET-only warmup leaves the body-parsing path of a POST benchmark cold, so
 * the POST numbers would measure first-call deoptimisation rather than steady
 * state.
 */
async function warmup(port: number, spec: EndpointSpec): Promise<void> {
  if (WARMUP_DURATION === 0) return;
  await runAutocannon(`http://localhost:${port}${spec.path}`, spec, {
    ...LOAD,
    duration: WARMUP_DURATION,
    connections: 10,
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** The sample whose req/sec is the median of the set - an actual observation, not a synthetic average. */
function medianSample(samples: RunSample[]): RunSample {
  const sorted = [...samples].sort((a, b) => a.reqPerSec - b.reqPerSec);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

const RULE = "=".repeat(120);
const THIN_RULE = "-".repeat(120);

function printResults(results: BenchmarkResult[]): void {
  console.log("\n" + RULE);
  console.log("BENCHMARK RESULTS (median of " + RUNS + " runs)");
  console.log(RULE);

  const byEndpoint = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const existing = byEndpoint.get(result.endpoint) ?? [];
    existing.push(result);
    byEndpoint.set(result.endpoint, existing);
  }

  for (const [endpoint, endpointResults] of byEndpoint) {
    console.log(`\n${endpoint}`);
    console.log(THIN_RULE);
    console.log(
      "| Adapter  | Req/sec    | Spread | Avg Latency | P99 Latency | Throughput  | Errors | non-2xx | vs Express | vs Fastify |"
    );
    console.log(THIN_RULE);

    endpointResults.sort((a, b) => b.median.reqPerSec - a.median.reqPerSec);

    const expressBaseline = endpointResults.find((r) => r.adapter === "Express")?.median.reqPerSec ?? null;
    const fastifyBaseline = endpointResults.find((r) => r.adapter === "Fastify")?.median.reqPerSec ?? null;

    for (const result of endpointResults) {
      const m = result.median;
      console.log(
        `| ${result.adapter.padEnd(8)}` +
          ` | ${formatNumber(m.reqPerSec).padStart(10)}` +
          ` | ${(result.spreadPct.toFixed(1) + "%").padStart(6)}` +
          ` | ${(m.latencyAvg.toFixed(2) + " ms").padStart(11)}` +
          ` | ${(m.latencyP99.toFixed(2) + " ms").padStart(11)}` +
          ` | ${formatBytes(m.throughputAvg).padStart(11)}` +
          ` | ${String(m.errors).padStart(6)}` +
          ` | ${String(m.non2xx).padStart(7)}` +
          ` | ${formatRelative(relativeTo(m.reqPerSec, expressBaseline)).padStart(10)}` +
          ` | ${formatRelative(relativeTo(m.reqPerSec, fastifyBaseline)).padStart(10)} |`
      );
    }
  }

  console.log("\n" + RULE);
  console.log("SUMMARY");
  console.log(RULE);

  const totalFor = (adapter: string): number =>
    results.filter((r) => r.adapter === adapter).reduce((sum, r) => sum + r.median.totalRequests, 0);

  const bunTotal = totalFor("Bun");
  const expressTotal = totalFor("Express");
  const fastifyTotal = totalFor("Fastify");

  console.log("\nTotal requests across all benchmarked endpoints (median run of each):");
  console.log(`  Bun:     ${formatNumber(bunTotal)} requests`);
  console.log(`  Fastify: ${formatNumber(fastifyTotal)} requests`);
  console.log(`  Express: ${formatNumber(expressTotal)} requests`);

  const vsExpress = relativeTo(bunTotal, expressTotal > 0 ? expressTotal : null);
  const vsFastify = relativeTo(bunTotal, fastifyTotal > 0 ? fastifyTotal : null);

  console.log(
    vsExpress === null
      ? "\nNo Express baseline was recorded - no comparison is possible."
      : `\nBun vs Express (aggregate): ${formatRelative(vsExpress)}`
  );
  console.log(
    vsFastify === null
      ? "No Fastify baseline was recorded - no comparison is possible."
      : `Bun vs Fastify (aggregate): ${formatRelative(vsFastify)}`
  );

  console.log("\n" + RULE);
}

async function main(): Promise<void> {
  if (RUNS < 1) throw new Error("BENCH_RUNS must be at least 1");
  if (BENCHMARK_DURATION < 1) throw new Error("BENCH_DURATION must be at least 1");

  console.log("NestJS Adapter Benchmark Suite");
  console.log("==============================\n");
  console.log("Configuration:");
  console.log(`  - Warmup duration:     ${WARMUP_DURATION}s per endpoint`);
  console.log(`  - Measurement runs:    ${RUNS} x ${BENCHMARK_DURATION}s per endpoint`);
  console.log(`  - Connections:         ${CONNECTIONS}`);
  console.log(`  - Pipelining:          ${PIPELINING}`);
  console.log(`  - autocannon workers:  ${WORKERS}`);
  console.log(`  - Boot timeout:        ${BOOT_TIMEOUT_MS}ms`);
  console.log(`  - Node:                ${process.version}`);
  console.log(`  - Platform:            ${process.platform}/${process.arch} (${cpus().length} CPUs)`);
  console.log(`  - Date:                ${new Date().toISOString()}`);
  console.log("");

  const results: BenchmarkResult[] = [];
  const failures: string[] = [];
  const expectedResultCount = adapters.length * endpoints.length;

  for (const adapter of adapters) {
    console.log(`\nStarting ${adapter.name} server on port ${adapter.port}...`);

    const server = startServer(adapter);
    const bootError = await waitForServer(adapter.port, BOOT_TIMEOUT_MS);

    if (bootError) {
      failures.push(`${adapter.name} server failed to start: ${bootError}`);
      console.error(`FAILED to start ${adapter.name}: ${bootError}`);
      await stopServer(server, adapter.port);
      continue;
    }

    console.log(`${adapter.name} server is ready`);

    // Correctness gate: never benchmark an endpoint whose response is wrong.
    const problems = await validateEndpoints(adapter.name, adapter.port, endpoints);
    if (problems.length > 0) {
      failures.push(...problems);
      for (const problem of problems) console.error(`  INVALID RESPONSE: ${problem}`);
      await stopServer(server, adapter.port);
      continue;
    }
    console.log(`  All ${endpoints.length} endpoints returned the expected responses`);

    for (const spec of endpoints) {
      process.stdout.write(`  Benchmarking ${spec.name}...`);

      await warmup(adapter.port, spec);

      const samples: RunSample[] = [];
      for (let run = 0; run < RUNS; run++) {
        const result = await runAutocannon(`http://localhost:${adapter.port}${spec.path}`, spec, LOAD);
        samples.push(toSample(result));
      }

      const reqPerSecs = samples.map((s) => s.reqPerSec);
      const med = medianSample(samples);
      const medValue = median(reqPerSecs);
      const spreadPct = medValue > 0 ? ((Math.max(...reqPerSecs) - Math.min(...reqPerSecs)) / medValue) * 100 : 0;

      const totalNon2xx = samples.reduce((sum, s) => sum + s.non2xx, 0);
      const totalErrors = samples.reduce((sum, s) => sum + s.errors, 0);
      const totalTimeouts = samples.reduce((sum, s) => sum + s.timeouts, 0);

      console.log(
        ` ${formatNumber(med.reqPerSec)} req/s` +
          ` (spread ${spreadPct.toFixed(1)}%, non-2xx ${totalNon2xx}, errors ${totalErrors}, timeouts ${totalTimeouts})`
      );

      // All three counters, not just non2xx. A connection that was reset or that
      // timed out never produces a status code, so non2xx alone stays 0 while
      // the requests that did complete inflate the median req/s.
      const failure = describeFailures({
        non2xx: totalNon2xx,
        errors: totalErrors,
        timeouts: totalTimeouts,
      });
      if (failure) {
        failures.push(
          `${adapter.name} ${spec.method} ${spec.path}: ${failure} during measurement - the numbers are not comparable`
        );
      }

      results.push({ adapter: adapter.name, endpoint: spec.name, samples, median: med, spreadPct });
    }

    console.log(`  Stopping ${adapter.name} server...`);
    await stopServer(server, adapter.port);
  }

  if (results.length > 0) printResults(results);

  if (results.length !== expectedResultCount) {
    failures.push(
      `Only ${results.length} of ${expectedResultCount} adapter/endpoint measurements completed - the comparison is incomplete`
    );
  }

  if (failures.length > 0) {
    console.error("\n" + RULE);
    console.error("BENCHMARK FAILED");
    console.error(RULE);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("");
    process.exitCode = 1;
    return;
  }

  console.log("\nAll adapters measured successfully.");
}

main().catch((err) => {
  console.error("Benchmark harness crashed:", err);
  process.exit(1);
});
