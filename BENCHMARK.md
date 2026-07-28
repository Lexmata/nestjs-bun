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

**Do not treat the tables below as a specification.** Each is one run, on one machine, under the conditions recorded with it. Re-run on your own hardware before relying on any of it.

Two runs are kept, because the comparison between them is itself informative — and cautionary. The 2026-07-27 run predates the request-hot-path optimisation; the 2026-07-28 run is the same suite, same machine and same dependency versions after it.

### Run 1 — 2026-07-27 (before the hot-path optimisation)

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

#### What run 1 says

- **Fastify was fastest on every endpoint.** The Bun adapter did not beat it anywhere, and trailed it by 27–76%.
- **Against Express the picture is mixed**: Bun lost on the four cheap endpoints and won substantially on the two expensive ones (`/cpu/light` +92%, `POST /items` +299%), where Express's per-request overhead dominates. Aggregate came out +17.7%.
- Throughput in MB/s was consistently lowest for Bun, which is at least partly a response-size difference rather than a speed difference — the adapters do not serialise identical bytes.

### Run 2 — 2026-07-28 (after the hot-path optimisation)

Same suite, same machine, same dependency versions (NestJS 11.1.11, autocannon 8, `benchmark/pnpm-lock.yaml` unchanged). The adapter was rebuilt from the working tree immediately before the run, and the sources were verified byte-identical across the whole measurement window.

| | |
|---|---|
| Date | 2026-07-28 |
| Machine | 13th Gen Intel Core i9-13900K, 32 logical CPUs, 62 GB RAM |
| OS | Arch Linux, kernel 7.1.4 |
| Bun | 1.3.14 |
| Node (Express/Fastify apps and load generator) | v26.5.0 |
| NestJS | 11.1.11 |
| Method | median of 3 x 5s runs, 100 connections, pipelining 10, 4 autocannon workers |
| Host load average during the run | **31.4–41.9** (1-minute, sampled every 15s, on 32 CPUs) |

Requests/sec (higher is better), median run:

| Endpoint | Express | Fastify | Bun | Bun vs Express | Bun vs Fastify | Bun vs run 1 |
|---|---:|---:|---:|---:|---:|---:|
| `GET /` | 52,394 | **84,563** | 20,898 | −60.1% | −75.3% | +15.4% |
| `GET /json` | 59,811 | **85,664** | 20,533 | −65.7% | −76.0% | +7.7% |
| `GET /users/:id` | 49,117 | **79,434** | 18,638 | −62.1% | −76.5% | +4.0% |
| `GET /health` | 47,038 | **56,995** | 19,452 | −58.6% | −65.9% | +11.6% |
| `GET /cpu/light` | 10,854 | **16,226** | 11,438 | +5.4% | −29.5% | +2.1% |
| `POST /items` | 25,331 | **49,814** | 36,846 | +45.5% | −26.0% | +12.9% |
| **Aggregate requests** | 1,222,739 | **1,863,476** | 638,966 | **−47.7%** | **−65.7%** | — |

Run-to-run spread reported by the harness for this run: Bun 5.4–25.1%; Express 6.2–55.0%; Fastify 7.7–**70.7%**.

#### What run 2 says

- **The Bun adapter did get faster, modestly.** Every endpoint improved against run 1, by **+2.1% to +15.4%** — and it did so while the host was carrying between two and three times run 1's load. Improving under materially worse conditions makes this the *conservative* reading of the change: it is consistent with the hot-path work being a real improvement, and if anything understates it.
- **The larger figure the change was credited with is real, but at a different load shape.** `GET /json` rising ~35,840 → ~51,792 req/s (+44%) was measured at **10 connections, pipelining 1** — not at this suite's default of 100 connections, pipelining 10. Both are reproducible on the same build in one sitting: `GET /json` measures **50,648** req/s unpipelined and **20,935** at the suite default, and the suite's own 20,533 agrees with the latter. The two numbers answer different questions and neither disproves the other.

  The reason the gap is so wide is the same one this file records elsewhere: under heavy pipelining Bun's HTTP server is the bottleneck, not the adapter — raw `Bun.serve` with a one-line handler manages ~24,400 req/s at 100/10 against Fastify-on-Node's ~60,000. Removing per-request JavaScript work cannot help where JavaScript is not the constraint. Quote the unpipelined figure only alongside its load shape; **most real traffic through browsers and load balancers is not pipelined**, so measuring only at pipelining 10 answers the case users are least likely to have.
- **The Express and Fastify baselines measured 2–2.4x faster than in run 1**, despite the heavier load, and this is *not explained*. With baseline spreads reaching 55% (Express) and 70.7% (Fastify) on this host, the baseline figures are not trustworthy to better than roughly a factor of two between runs. This is the single most important caveat on the page: **run-1-to-run-2 comparisons are only meaningful within the same column**, and the Bun column is the only one whose spread (5.4–25.1%) is small enough to support one.

### Caveats that materially affect these numbers

1. **The host was not idle for either run, and was far busier for run 2.** Run 1 ran at a load average of roughly 14 on 32 CPUs; run 2 ran at 31.4–41.9 (sampled every 15s throughout) — i.e. run 2 was measured on a host that was *oversubscribed*, with more runnable work than cores. Load fell back to ~13 within 25 minutes of the run finishing, so the excess was other work on the box, not the benchmark. Run 1's spread reached 58% on `/health` (Fastify) and 66% on `POST /items` (Express); run 2's reached 70.7% on `/health` (Fastify) and 55.0% on `/health` (Express). Anything under roughly 20% relative difference is inside the noise here.
2. **The load generator shares the host with the server under test.** autocannon runs with worker threads to reduce the chance of being the bottleneck, but on a single box it still competes for the same cores.
3. **Three runs is enough to see a median, not enough for a confidence interval.** No statistical test is applied.
4. **One machine, one OS, one Bun version.** Bun's relative position varies significantly with kernel, hardware and version.
5. **The two runs are not a controlled A/B.** Only the adapter under test changed deliberately between them, but the ambient load did too, and by more than the effect being measured on some endpoints. The Bun-column comparison survives this because Bun's spread was small in both runs; the Express and Fastify columns do not.

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

| Variable | Harness default | **Value CI actually sets** | Meaning |
|---|---|---|---|
| `VERIFY_MIN_RATIO_EXPRESS` | `1.0` | **`0.28`** | minimum Bun ÷ Express req/s per endpoint |
| `VERIFY_MIN_RATIO_FASTIFY` | `1.0` | **`0.18`** | minimum Bun ÷ Fastify req/s per endpoint |

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) is the source of truth for the enforced values; the `1.0` defaults apply only when the variables are unset. To reproduce the gate exactly as CI runs it:

```bash
pnpm build && cd benchmark && pnpm install
VERIFY_MIN_RATIO_EXPRESS=0.28 VERIFY_MIN_RATIO_FASTIFY=0.18 pnpm verify
```

> **Known state:** at the `1.0` defaults this gate **fails** on the endpoints where the adapter trails, which the measured results show is most of them. That is intentional — the gate reports the real state rather than passing vacuously. Prior to this rewrite it could not fail at all: if a baseline server failed to boot, the script skipped it, the comparison guards saw no baseline to compare against, and it printed "Performance verification PASSED!" and exited 0.

### How the enforced floors were derived

`0.28` (Express) and `0.18` (Fastify) were derived on 2026-07-28 from **`pnpm verify` itself** — the command the gate runs — after an earlier attempt using `pnpm bench` was abandoned as unsound.

**Method.** Five `pnpm verify` runs: three on all 32 cores, and two pinned to two cores with `taskset -c 0,1` to approximate the 2-core GitHub-hosted runner. Worst per-endpoint ratio in each configuration (Health Check in every run):

| Configuration | Worst Bun ÷ Express | Worst Bun ÷ Fastify |
|---|---:|---:|
| 32 cores, 3 runs | **0.35** | **0.23** |
| 2 cores (`taskset`), 2 runs | 0.39 | 0.26 |
| **Floor = 32-core worst − 20%** | **0.28** | **0.18** |

Run-to-run spread on the minima was ~8%, so the 20% band is roughly 2.5x the observed noise.

**Why the 32-core figures set the floor.** The 2-core runs measured *better*, not worse — constraining parallelism did not disadvantage this adapter relative to the Node-based baselines. The 32-core worst case is therefore the conservative choice and is safe to enforce on the smaller runner. This also resolves the "not scale-invariant" concern raised when the floors could not previously be derived: it was measured rather than assumed.

**These are lower than the values they replace (`0.65` / `0.19`), and that is not a silenced gate.** The old numbers were derived from `pnpm bench`, which uses a different load shape (100 connections / pipelining 10 against verify's 50 / 5) and yields materially different ratios. `0.65` was never a valid floor for this step and was failing four of six endpoints in every local run — the gate was red for a measurement artefact, not a regression. Replacing an invalid floor with one derived from the right command is a correction, not a relaxation.

**The gate was verified falsifiable.** At `0.28`/`0.18` it exits 0 with 12 passing checks; at a deliberately unreachable `0.50` it exits 1 with `Performance verification FAILED`. A floor that cannot go red is not a gate.

**Ratchet these up as the adapter improves.** A drop below them is a real finding. Never lower them to make a red run pass without first recording here what regressed and why it is acceptable.

### What the ratio gate cannot catch

Every floor above is a **ratio against the other adapters measured on the same host in the same run**. That makes it robust to the thing it was designed for — a noisy or differently-sized CI machine moves all three adapters together, so the ratio stays put where an absolute number would swing wildly.

It also makes one whole class of regression invisible **by construction**: a change that slows this adapter and the Express and Fastify baselines *equally* leaves every ratio unchanged and the gate green. That is not hypothetical — a dependency bump, a Node or Bun release, or a slower runner image all move the baselines too.

The complement would be an **absolute req/s floor** for the Bun adapter, checked alongside the ratios: a lower bound on `Bun` req/s per endpoint, generous enough to absorb runner variance, that fails when throughput collapses in absolute terms no matter what the baselines did. It is **recommended, and deliberately not implemented here** — a defensible absolute floor needs a distribution of runs from the CI runner class that will enforce it, not an extrapolation from one developer machine, and gathering that is its own piece of work. Until it exists, read a green benchmark job as "did not regress *relative to* Express and Fastify", which is a strictly weaker claim than "did not regress".

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
