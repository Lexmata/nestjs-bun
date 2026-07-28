import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { REPO_URL } from '../site';

@Component({
  selector: 'app-benchmarks',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Benchmarks</h1>
      <p class="text-text-secondary text-lg mb-8">
        A reproducible benchmark suite comparing the Bun adapter against the Express and
        Fastify adapters for NestJS.
      </p>

      <!-- Honesty callout -->
      <div class="p-4 mb-12 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
        <p class="text-text-primary text-sm">
          <strong>⚠ No published numbers.</strong>
          This project does not publish benchmark results. Throughput and latency depend
          heavily on hardware, kernel, Bun version and application shape, so any figure we
          printed here would be misleading for your machine. The suite below is checked into
          the repository — run it yourself and measure on the hardware you actually deploy to.
        </p>
      </div>

      <!-- What the suite covers -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">What the Suite Measures</h2>
        <p class="text-text-secondary mb-4">
          Each adapter serves an identical NestJS module
          (<code>benchmark/apps/shared.module.ts</code>) across these endpoints:
        </p>
        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-bg-tertiary border-b border-border">
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Endpoint</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Exercises</th>
                </tr>
              </thead>
              <tbody>
                @for (endpoint of endpoints; track endpoint.route) {
                  <tr class="border-b border-border last:border-0">
                    <td class="px-4 py-3 font-mono text-nest-red whitespace-nowrap">{{ endpoint.route }}</td>
                    <td class="px-4 py-3 text-text-secondary">{{ endpoint.description }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <p class="text-text-secondary text-sm mt-4">
          Metrics recorded per run: requests/sec, average latency, P99 latency and throughput.
          Memory usage is <strong>not</strong> measured by this suite.
        </p>
      </section>

      <!-- Test Configuration -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Test Configuration</h2>
        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <table class="w-full text-sm">
            <tbody>
              @for (config of testConfig; track config.key) {
                <tr class="border-b border-border last:border-0">
                  <td class="px-4 py-3 text-text-secondary">{{ config.key }}</td>
                  <td class="px-4 py-3 text-text-primary font-mono">{{ config.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Run Benchmarks -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Run Them Yourself</h2>
        <p class="text-text-secondary mb-4">
          The suite lives in the <code>benchmark/</code> workspace and has its own dependencies:
        </p>
        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
          <pre><code class="text-sm"><span class="text-text-muted"># Clone and build the adapter</span>
git clone {{ repoUrl }}
cd nestjs-bun
pnpm install
pnpm build

<span class="text-text-muted"># Install the benchmark workspace and run the full suite</span>
cd benchmark
pnpm install
pnpm bench

<span class="text-text-muted"># Or start a single server and drive it manually</span>
pnpm start:express   <span class="text-text-muted"># port 4001</span>
pnpm start:fastify   <span class="text-text-muted"># port 4002</span>
pnpm start:bun       <span class="text-text-muted"># port 4003</span></code></pre>
        </div>
        <p class="text-text-secondary text-sm mt-4">
          <code>pnpm verify</code> runs the same suite and asserts the Bun adapter is not slower
          than the Express and Fastify adapters. CI runs this on every pull request — it is a
          regression gate, not a source of published figures.
        </p>
      </section>

      <!-- Why Bun is Faster -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Why We Expect Bun to Win</h2>
        <p class="text-text-secondary mb-4">
          These are architectural reasons to expect an advantage, not measurements:
        </p>
        <div class="grid md:grid-cols-2 gap-4">
          @for (reason of reasons; track reason.title) {
            <div class="p-4 bg-bg-secondary rounded-lg border border-border">
              <h3 class="font-semibold text-text-primary mb-2">{{ reason.title }}</h3>
              <p class="text-text-secondary text-sm">{{ reason.description }}</p>
            </div>
          }
        </div>
      </section>

      <!-- Caveats -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Reading Your Own Results</h2>
        <ul class="space-y-3 text-text-secondary text-sm">
          <li class="flex items-start gap-3">
            <span class="text-text-muted">•</span>
            <span>Run on the hardware and OS you deploy to. Results from a laptop rarely transfer to a container with a CPU quota.</span>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-text-muted">•</span>
            <span>The benchmark apps do almost no work per request, so they measure adapter overhead. Real applications dominated by database or network I/O will see a far smaller difference.</span>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-text-muted">•</span>
            <span>Express and Fastify are driven under Node, the Bun adapter under Bun. You are comparing runtimes as much as adapters.</span>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-text-muted">•</span>
            <span>Run each configuration several times. Single runs are noisy, especially on shared CI runners.</span>
          </li>
        </ul>
      </section>
    </article>
  `,
})
export class BenchmarksComponent {
  protected readonly repoUrl = REPO_URL;

  endpoints = [
    { route: 'GET /', description: 'Hello World — plain text response' },
    { route: 'GET /json', description: 'JSON serialisation of a nested object' },
    { route: 'GET /users/123', description: 'Path parameter extraction and routing' },
    { route: 'GET /health', description: 'Minimal health-check handler' },
    { route: 'GET /cpu/light', description: 'CPU-bound work (fibonacci(20))' },
    { route: 'POST /items', description: 'Request body parsing' },
  ];

  testConfig = [
    { key: 'Warmup', value: '3s per endpoint (BENCH_WARMUP)' },
    { key: 'Measurement runs', value: '3 per endpoint (BENCH_RUNS)' },
    { key: 'Duration', value: '5s per run (BENCH_DURATION)' },
    { key: 'Reported value', value: 'median of the runs' },
    { key: 'Connections', value: '100 concurrent (BENCH_CONNECTIONS)' },
    { key: 'Pipelining', value: '10 requests (BENCH_PIPELINING)' },
    { key: 'Tool', value: 'autocannon' },
    { key: 'Adapters compared', value: 'Bun, Fastify, Express' },
  ];

  reasons = [
    {
      title: 'Native HTTP Server',
      description: "Bun's HTTP server is implemented in Zig and handles the socket and parsing layers outside JavaScript.",
    },
    {
      title: 'No Framework in the Path',
      description: 'Requests go from Bun.serve() straight into the NestJS pipeline — there is no Express or Fastify layer in between.',
    },
    {
      title: 'Native Body Parsing',
      description: "Bodies are read through Bun's Request APIs rather than a JavaScript stream-and-concatenate middleware.",
    },
    {
      title: 'JavaScriptCore Engine',
      description: 'Bun runs on JavaScriptCore, which has different — and for short-lived request handlers, often favourable — JIT characteristics to V8.',
    },
  ];
}
