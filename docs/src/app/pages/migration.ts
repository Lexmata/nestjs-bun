import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-migration',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Migration Guide</h1>
      <p class="text-text-secondary text-lg mb-8">
        Migrate your existing NestJS application from Express or Fastify to the Bun adapter.
      </p>

      <!-- Prerequisites -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Prerequisites</h2>
        <div class="space-y-4">
          <div class="p-4 bg-bg-secondary rounded-lg border border-border">
            <h3 class="font-semibold text-text-primary mb-2">1. Install Bun</h3>
            <p class="text-text-secondary text-sm mb-3">
              Make sure you have Bun installed on your system.
            </p>
            <div class="bg-bg-code rounded-lg border border-border p-3">
              <code class="text-sm">curl -fsSL https://bun.sh/install | bash</code>
            </div>
          </div>
          <div class="p-4 bg-bg-secondary rounded-lg border border-border">
            <h3 class="font-semibold text-text-primary mb-2">2. Verify NestJS Version</h3>
            <p class="text-text-secondary text-sm">
              Ensure you're using NestJS 10.x or 11.x. Check your <code>package.json</code>.
            </p>
          </div>
        </div>
      </section>

      <!-- From Express -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Migrating from Express</h2>

        <div class="space-y-6">
          <div>
            <h3 class="text-lg font-semibold mb-3 flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-nest-red text-white flex items-center justify-center text-sm">1</span>
              Update Dependencies
            </h3>
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="text-text-muted"># Remove Express adapter</span>
pnpm remove &#64;nestjs/platform-express

<span class="text-text-muted"># Install Bun adapter</span>
pnpm add @lexmata/nestjs-platform-bun</code></pre>
            </div>
          </div>

          <div>
            <h3 class="text-lg font-semibold mb-3 flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-nest-red text-white flex items-center justify-center text-sm">2</span>
              Update main.ts
            </h3>
            <div class="grid md:grid-cols-2 gap-4">
              <div>
                <div class="text-sm text-text-muted mb-2">Before (Express)</div>
                <div class="bg-bg-code rounded-lg border border-red-500/20 p-4 overflow-x-auto">
                  <pre><code class="text-sm"><span class="token-keyword">import</span> &#123; NestFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;nestjs/core'</span>;

<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestFactory
  .<span class="token-function">create</span>(AppModule);

<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);</code></pre>
                </div>
              </div>
              <div>
                <div class="text-sm text-text-muted mb-2">After (Bun)</div>
                <div class="bg-bg-code rounded-lg border border-green-500/20 p-4 overflow-x-auto">
                  <pre><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;

<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory
  .<span class="token-function">create</span>(AppModule);

<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);</code></pre>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 class="text-lg font-semibold mb-3 flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-nest-red text-white flex items-center justify-center text-sm">3</span>
              Run with Bun
            </h3>
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="text-text-muted"># Instead of</span>
node dist/main.js

<span class="text-text-muted"># Use</span>
bun run src/main.ts</code></pre>
            </div>
            <div class="p-4 mt-4 bg-bun-orange/10 border border-bun-orange/20 rounded-lg">
              <p class="text-text-primary text-sm">
                <strong>🥟 This step is mandatory.</strong>
                Bun is not an optional optimisation here — the adapter calls
                <code>Bun.serve()</code> directly and cannot run under Node.js. Update your
                Dockerfile, process manager and CI to invoke <code>bun</code>.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- From Fastify -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Migrating from Fastify</h2>

        <div class="space-y-6">
          <div>
            <h3 class="text-lg font-semibold mb-3">Update Dependencies</h3>
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="text-text-muted"># Remove Fastify adapter</span>
pnpm remove &#64;nestjs/platform-fastify

<span class="text-text-muted"># Install Bun adapter</span>
pnpm add @lexmata/nestjs-platform-bun</code></pre>
            </div>
          </div>

          <div>
            <h3 class="text-lg font-semibold mb-3">Update main.ts</h3>
            <div class="grid md:grid-cols-2 gap-4">
              <div>
                <div class="text-sm text-text-muted mb-2">Before (Fastify)</div>
                <div class="bg-bg-code rounded-lg border border-red-500/20 p-4 overflow-x-auto">
                  <pre><code class="text-sm"><span class="token-keyword">import</span> &#123; NestFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;nestjs/core'</span>;
<span class="token-keyword">import</span> &#123; FastifyAdapter &#125; <span class="token-keyword">from</span>
  <span class="token-string">'&#64;nestjs/platform-fastify'</span>;

<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestFactory.<span class="token-function">create</span>(
  AppModule,
  <span class="token-keyword">new</span> <span class="token-function">FastifyAdapter</span>()
);</code></pre>
                </div>
              </div>
              <div>
                <div class="text-sm text-text-muted mb-2">After (Bun)</div>
                <div class="bg-bg-code rounded-lg border border-green-500/20 p-4 overflow-x-auto">
                  <pre><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span>
  <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;


<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory
  .<span class="token-function">create</span>(AppModule);
</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Compatibility Checklist -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Compatibility Checklist</h2>
        <p class="text-text-secondary text-sm mb-4">
          ✓ means covered by this repository's test suite. ⚠ means untested or unsupported —
          verify it against your own application before committing to the migration.
        </p>
        <div class="space-y-3">
          @for (item of checklist; track item.text) {
            <div class="flex items-start gap-3">
              <span [class]="item.supported ? 'text-green-400' : 'text-yellow-400'">
                {{ item.supported ? '✓' : '⚠' }}
              </span>
              <span class="text-text-secondary">{{ item.text }}</span>
            </div>
          }
        </div>
      </section>
    </article>
  `,
})
export class MigrationComponent {
  checklist = [
    { text: 'Controllers, modules and routing decorators work unchanged', supported: true },
    { text: 'Express middleware compatibility layer (documented subset)', supported: true },
    { text: 'Fastify hooks and decorators compatibility layer (documented subset)', supported: true },
    { text: 'Guards, interceptors and pipes — expected to work (they sit above the HTTP layer) but untested against this adapter', supported: false },
    { text: 'Swagger / OpenAPI — untested. @nestjs/swagger serves its UI through the adapter, so verify before relying on it', supported: false },
    { text: 'GraphQL — untested. Neither Apollo nor Mercurius integration is exercised anywhere in this repo', supported: false },
    { text: 'WebSocket gateways — untested and likely to need adjustment', supported: false },
    { text: 'View engines and @Render() are NOT supported — setViewEngine() and render() throw', supported: false },
    { text: 'compression and other middleware that treats res as a Node stream will not work', supported: false },
    { text: 'Signed cookies are not supported', supported: false },
  ];
}
