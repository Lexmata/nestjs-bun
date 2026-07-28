# Benchmark Results

This document describes the benchmark suite that compares the `@lexmata/nestjs-platform-bun` adapter against the Express and Fastify adapters for NestJS, and records the numbers measured on one machine.

> **Read the numbers, not the marketing.** An earlier revision of this file carried a "Sample Benchmark Output" table that had never been produced by the harness (its column layout, number formatting and arithmetic were all inconsistent with the code), alongside a claim that the adapter is "designed to **always be faster**". Both have been removed. What follows is what the harness actually printed.

## What the benchmark measures

Three NestJS applications built from the **same** module (`benchmark/apps/shared.module.ts`), each served by a different HTTP adapter, benchmarked with [autocannon](https://github.com/mcollina/autocannon).

| Endpoint | Description |
|----------|-------------|
| `GET /` | Hello World (text response) |
| `GET /json` | JSON response with nested objects |
| `GET /users/:id` | Path parameter extraction |
| `GET /health` | Health check endpoint |
| `GET /cpu/light` | CPU-bound work (fibonacci(20)) |
| `POST /items` | POST with JSON body parsing |

The Bun app imports the package **by name** (`@lexmata/nestjs-platform-bun`, linked with `file:..`), so the suite measures the built artifact that users install rather than untranspiled TypeScript out of `src/`.

### Correctness gating

Before any measurement, the harness issues one request per endpoint per adapter and asserts the status **and** the response body — `/cpu/light` must actually return `6765`, `POST /items` must echo the posted body back, and so on. Any mismatch aborts that adapter with a non-zero exit.

This is not ceremony. A 404 is far cheaper to serve than `fibonacci(20)`, so without the assertion a broken route scores as the *fastest* adapter. The gate caught exactly that on first run: `tsx` (which uses esbuild) does not implement `emitDecoratorMetadata`, so constructor-injected dependencies resolved to `undefined` and every service-backed route in the Express and Fastify apps returned **HTTP 500**. Bun's transpiler does emit the metadata, so the previous harness had been comparing a working Bun app against two permanently broken baselines — and counting those 500s as successful responses. The fixture now uses explicit `@Inject()` so all three adapters behave identically.

Each run also fails if autocannon reports any non-2xx response during measurement.

## Configuration

Defaults, all overridable by environment variable:

```
Warmup:       3s per endpoint, using the same method/body/headers as the measurement
Measurement:  3 runs x 5s per endpoint; the median run is reported
Connections:  100 concurrent
Pipelining:   10 requests per connection
Workers:      autocannon worker threads (half the CPUs, clamped to 2..4)
Tool:         autocannon 8
```

| Variable | Default | Meaning |
|---|---|---|
| `BENCH_RUNS` | `3` | measurement runs per endpoint |
| `BENCH_DURATION` | `5` | seconds per measurement run |
| `BENCH_WARMUP` | `3` | seconds of warmup per endpoint |
| `BENCH_CONNECTIONS` | `100` | concurrent connections |
| `BENCH_PIPELINING` | `10` | pipelined requests per connection |
| `BENCH_WORKERS` | CPUs/2, 2..4 | autocannon worker threads |
| `BENCH_BOOT_TIMEOUT_MS` | `60000` | how long to wait for a server to answer `/health` |

## Running the benchmarks

```bash
# From the repository root (builds the package first, then runs the suite)
pnpm bench

# Or directly
cd benchmark
pnpm install
pnpm bench

# Individual servers, for manual poking
pnpm start:express   # Port 4001
pnpm start:fastify   # Port 4002
pnpm start:bun       # Port 4003
```

## Measured results

**Do not treat the table below as a specification.** It is one run, on one machine, under the conditions recorded here. Re-run it on your own hardware before relying on any of it.

| | |
|---|---|
| Date | 2026-07-27 |
| Machine | 13th Gen Intel Core i9-13900K, 32 logical CPUs, 62 GB RAM |
| OS | Arch Linux, kernel 7.1.4 |
| Bun | 1.3.14 |
| Node (Express/Fastify apps and load generator) | v26.5.0 |
| NestJS | 11.1.11 |
| Method | median of 3 x 5s runs, 100 connections, pipelining 10, 4 autocannon workers |

Requests/sec (higher is better), median run:

| Endpoint | Express | Fastify | Bun | Bun vs Express | Bun vs Fastify |
|---|---:|---:|---:|---:|---:|
| `GET /` | 22,104 | **33,670** | 18,115 | −18.0% | −46.2% |
| `GET /json` | 22,523 | **30,850** | 19,070 | −15.3% | −38.2% |
| `GET /users/:id` | 19,113 | **24,594** | 17,914 | −6.3% | −27.2% |
| `GET /health` | 21,080 | **72,822** | 17,434 | −17.3% | −76.1% |
| `GET /cpu/light` | 5,841 | **17,411** | 11,204 | +91.8% | −35.7% |
| `POST /items` | 8,173 | **50,363** | 32,630 | +299.2% | −35.2% |
| **Aggregate requests** | 494,176 | **1,148,517** | 581,818 | **+17.7%** | **−49.3%** |

### What this run says

- **Fastify was fastest on every endpoint.** The Bun adapter did not beat it anywhere, and trailed it by 27–76%.
- **Against Express the picture is mixed**: Bun lost on the four cheap endpoints and won substantially on the two expensive ones (`/cpu/light` +92%, `POST /items` +299%), where Express's per-request overhead dominates. Aggregate came out +17.7%.
- Throughput in MB/s was consistently lowest for Bun, which is at least partly a response-size difference rather than a speed difference — the adapters do not serialise identical bytes.

### Caveats that materially affect these numbers

1. **The host was not idle.** Several other processes were competing for CPU during this run. Run-to-run spread reached 58% on `/health` (Fastify) and 66% on `POST /items` (Express); anything under roughly 20% relative difference is inside the noise here.
2. **The load generator shares the host with the server under test.** autocannon runs with worker threads to reduce the chance of being the bottleneck, but on a single box it still competes for the same cores.
3. **Three runs is enough to see a median, not enough for a confidence interval.** No statistical test is applied.
4. **One machine, one OS, one Bun version.** Bun's relative position varies significantly with kernel, hardware and version.

Given (1) and (3), the honest summary is: *on this hardware, under this load, the Bun adapter did not outperform Fastify on any benchmarked endpoint, and beat Express only on the two CPU/body-heavy ones.* Reproducing this on a quiet, dedicated machine before drawing conclusions is strongly recommended.

## CI verification

CI runs a **reduced** variant of the suite, not the full one: `benchmark/verify-benchmarks.ts`, invoked as `pnpm verify` from the `benchmark` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

```yaml
- name: Install benchmark dependencies
  run: cd benchmark && pnpm install

- name: Typecheck benchmark harness
  run: cd benchmark && pnpm typecheck

- name: Verify Bun adapter performance
  run: cd benchmark && pnpm verify
  timeout-minutes: 15
```

Differences from `pnpm bench`:

- 5s per endpoint, 50 connections, pipelining 5, 2 workers, **one** measurement run (no median, no spread).
- All six endpoints are covered, and all three adapters must boot and pass the same response assertions.
- It fails if any adapter fails to start, if any response is wrong, if any non-2xx is recorded, or if fewer than 18 (3 adapters × 6 endpoints) measurements complete.

The required speed ratios are configurable so the gate can be tightened as the adapter improves:

| Variable | Default | Meaning |
|---|---|---|
| `VERIFY_MIN_RATIO_EXPRESS` | `1.0` | minimum Bun ÷ Express req/s per endpoint |
| `VERIFY_MIN_RATIO_FASTIFY` | `1.0` | minimum Bun ÷ Fastify req/s per endpoint |

> **Known state:** at the defaults above this gate **fails** on the endpoints where the adapter currently trails, which the measured results show is most of them. That is intentional — the gate reports the real state rather than passing vacuously. Prior to this rewrite it could not fail at all: if a baseline server failed to boot, the script skipped it, the comparison guards saw no baseline to compare against, and it printed "Performance verification PASSED!" and exited 0.

## Why Bun *could* be faster

Design-level reasons the adapter has headroom, none of which are a substitute for a measurement:

1. **Native HTTP server**: `Bun.serve()` is implemented in Zig rather than layered on Node's `http` module.
2. **Fewer copies**: Bun's request parsing avoids some intermediate buffers.
3. **JavaScriptCore**: a different JIT with a different performance profile from V8.
4. **Less middleware indirection**: routing maps more directly onto the runtime's primitives.

Whether those translate into wins for *this* adapter on *your* workload is an empirical question. Right now, on the hardware above, they largely do not.

## Notes

- Results vary with hardware, OS, kernel, Bun version and NestJS version.
- Production performance is dominated by application code, not adapter overhead, for all but the thinnest handlers.
- For CPU-bound handlers the adapter's relative position improves, because per-request overhead is a smaller share of the total.

## Contributing

Performance reports are welcome, in either direction. If you find a scenario where the Bun adapter is unexpectedly slow — or unexpectedly fast — please open an issue with:

1. Reproduction steps (ideally a `pnpm bench` invocation with the environment variables you used)
2. Environment details (OS, kernel, Bun version, NestJS version, hardware, whether the host was idle)
3. The full harness output, including the spread column
