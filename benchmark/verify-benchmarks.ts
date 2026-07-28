/**
 * CI performance gate.
 *
 * A reduced version of the full suite (shorter runs, fewer connections, one
 * measurement per endpoint) that fails the build when the Bun adapter stops
 * outperforming the Express and Fastify adapters.
 *
 * The important property here is that this script can only pass by *measuring*
 * all three adapters on all endpoints. A server that fails to boot, an endpoint
 * that returns the wrong body, or any non-2xx response is a hard failure - never
 * a silently absent baseline that makes the comparison vacuously true.
 *
 * Tunables (all optional environment variables):
 *   VERIFY_DURATION          seconds per measurement            (default 5)
 *   VERIFY_CONNECTIONS       concurrent connections             (default 50)
 *   VERIFY_PIPELINING        pipelined requests per connection  (default 5)
 *   VERIFY_WORKERS           autocannon worker threads          (default 2)
 *   VERIFY_BOOT_TIMEOUT_MS   server boot timeout                (default 60000)
 *   VERIFY_MIN_RATIO_EXPRESS minimum Bun/Express req/s ratio    (default 1.0)
 *   VERIFY_MIN_RATIO_FASTIFY minimum Bun/Fastify req/s ratio    (default 1.0)
 */

import {
  buildAdapters,
  describeFailures,
  endpoints,
  envInt,
  formatNumber,
  formatRelative,
  relativeTo,
  runAutocannon,
  startServer,
  stopServer,
  validateEndpoints,
  waitForServer,
} from "./harness";

const BENCHMARK_DURATION = envInt("VERIFY_DURATION", 5);
const CONNECTIONS = envInt("VERIFY_CONNECTIONS", 50);
const PIPELINING = envInt("VERIFY_PIPELINING", 5);
const WORKERS = envInt("VERIFY_WORKERS", 2);
const BOOT_TIMEOUT_MS = envInt("VERIFY_BOOT_TIMEOUT_MS", 60_000);

function envRatio(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}=${raw}: expected a positive number`);
  }
  return parsed;
}

const MIN_RATIO_EXPRESS = envRatio("VERIFY_MIN_RATIO_EXPRESS", 1.0);
const MIN_RATIO_FASTIFY = envRatio("VERIFY_MIN_RATIO_FASTIFY", 1.0);

/** Ports 5001-5003, distinct from the full suite's 4001-4003. */
const adapters = buildAdapters(5000);

const LOAD = {
  duration: BENCHMARK_DURATION,
  connections: CONNECTIONS,
  pipelining: PIPELINING,
  workers: WORKERS,
};

interface Measurement {
  adapter: string;
  endpoint: string;
  reqPerSec: number;
  avgLatency: number;
  non2xx: number;
  errors: number;
  timeouts: number;
}

async function main(): Promise<void> {
  console.log("Verifying Bun adapter performance...\n");
  console.log(`  Duration:    ${BENCHMARK_DURATION}s per endpoint`);
  console.log(`  Connections: ${CONNECTIONS} (pipelining ${PIPELINING}, ${WORKERS} workers)`);
  console.log(`  Endpoints:   ${endpoints.length}`);
  console.log(`  Node:        ${process.version}`);
  console.log("");

  const measurements: Measurement[] = [];
  const failures: string[] = [];
  const expectedCount = adapters.length * endpoints.length;

  for (const adapter of adapters) {
    console.log(`  Testing ${adapter.name}...`);

    const server = startServer(adapter);
    const bootError = await waitForServer(adapter.port, BOOT_TIMEOUT_MS);

    if (bootError) {
      // A server that never booted must not be treated as "nothing to compare".
      failures.push(`${adapter.name} server failed to start: ${bootError}`);
      console.error(`  FAILED to start ${adapter.name}: ${bootError}`);
      await stopServer(server, adapter.port);
      continue;
    }

    const problems = await validateEndpoints(adapter.name, adapter.port, endpoints);
    if (problems.length > 0) {
      failures.push(...problems);
      for (const problem of problems) console.error(`  INVALID RESPONSE: ${problem}`);
      await stopServer(server, adapter.port);
      continue;
    }

    for (const spec of endpoints) {
      const result = await runAutocannon(`http://localhost:${adapter.port}${spec.path}`, spec, LOAD);

      // All three counters, not just non2xx: a reset or hung connection never
      // gets a status code, so gating on non2xx alone lets a run where the
      // adapter dropped half its requests pass with an inflated req/s.
      const failure = describeFailures(result);
      if (failure) {
        failures.push(`${adapter.name} ${spec.method} ${spec.path}: ${failure} during measurement`);
      }

      measurements.push({
        adapter: adapter.name,
        endpoint: spec.name,
        reqPerSec: result.requests.average,
        avgLatency: result.latency.average,
        non2xx: result.non2xx,
        errors: result.errors,
        timeouts: result.timeouts,
      });
    }

    await stopServer(server, adapter.port);
  }

  // Hard gate: every adapter must have produced a measurement for every
  // endpoint. Without this, a missing baseline makes every comparison below
  // vacuously true and the script exits 0 on a completely broken run.
  if (measurements.length !== expectedCount) {
    failures.push(
      `Only ${measurements.length} of ${expectedCount} adapter/endpoint measurements completed - cannot verify performance`
    );
  }

  if (measurements.length > 0) {
    console.log("\nResults (req/sec, higher is better):\n");
    const header = `  ${"Endpoint".padEnd(22)} ${"Express".padStart(12)} ${"Fastify".padStart(12)} ${"Bun".padStart(12)}`;
    console.log(header);
    console.log("  " + "-".repeat(header.length - 2));

    for (const spec of endpoints) {
      const cell = (adapter: string): string => {
        const m = measurements.find((x) => x.adapter === adapter && x.endpoint === spec.name);
        return m ? formatNumber(m.reqPerSec).padStart(12) : "MISSING".padStart(12);
      };
      console.log(`  ${spec.name.padEnd(22)} ${cell("Express")} ${cell("Fastify")} ${cell("Bun")}`);
    }
  }

  // Per-endpoint comparison against each baseline.
  console.log("\nComparisons:\n");

  for (const spec of endpoints) {
    const bun = measurements.find((m) => m.adapter === "Bun" && m.endpoint === spec.name);
    if (!bun) {
      failures.push(`No Bun measurement for ${spec.name}`);
      continue;
    }

    for (const [baselineName, minRatio] of [
      ["Express", MIN_RATIO_EXPRESS],
      ["Fastify", MIN_RATIO_FASTIFY],
    ] as const) {
      const baseline = measurements.find((m) => m.adapter === baselineName && m.endpoint === spec.name);
      if (!baseline) {
        failures.push(`No ${baselineName} measurement for ${spec.name} - comparison impossible`);
        continue;
      }

      const ratio = baseline.reqPerSec > 0 ? bun.reqPerSec / baseline.reqPerSec : Number.NaN;
      const delta = formatRelative(relativeTo(bun.reqPerSec, baseline.reqPerSec));

      if (!Number.isFinite(ratio) || ratio < minRatio) {
        console.error(
          `  FAIL ${spec.name} vs ${baselineName}: Bun ${bun.reqPerSec.toFixed(0)} req/s vs ${baseline.reqPerSec.toFixed(0)} req/s` +
            ` (${delta}, ratio ${Number.isFinite(ratio) ? ratio.toFixed(2) : "n/a"}x, required >= ${minRatio.toFixed(2)}x)`
        );
        failures.push(
          `${spec.name}: Bun is not at least ${minRatio.toFixed(2)}x ${baselineName} (${delta})`
        );
      } else {
        console.log(`  ok   ${spec.name} vs ${baselineName}: ${delta} (${ratio.toFixed(2)}x)`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("\nPerformance verification FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("");
    process.exit(1);
  }

  console.log(`\nPerformance verification PASSED (${measurements.length} measurements across ${endpoints.length} endpoints).`);
}

main().catch((err) => {
  console.error("Verification harness crashed:", err);
  process.exit(1);
});
