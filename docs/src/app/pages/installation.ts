import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-installation',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Installation</h1>
      <p class="text-text-secondary text-lg mb-8">
        Get started with @lexmata/nestjs-platform-bun in just a few steps.
      </p>

      <!-- Prerequisites -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Prerequisites</h2>
        <p class="text-text-secondary mb-4">Before you begin, ensure you have the following installed:</p>

        <div class="space-y-4">
          <div class="flex items-start gap-4 p-4 bg-bg-secondary rounded-lg border border-border">
            <div class="w-10 h-10 rounded-lg bg-bun-brown flex items-center justify-center shrink-0">
              <span class="text-2xl">🥟</span>
            </div>
            <div>
              <h3 class="font-semibold text-text-primary">Bun v1.0+ — required</h3>
              <p class="text-text-secondary text-sm mt-1">
                This adapter calls <code>Bun.serve()</code> and <code>Bun.file()</code> directly
                and has no Node.js fallback. Your application must be started with
                <code>bun run</code>; running it under <code>node</code> will fail.
                <a href="https://bun.sh" target="_blank" rel="noopener" class="text-nest-red hover:underline ml-1">Install Bun →</a>
              </p>
            </div>
          </div>

          <div class="flex items-start gap-4 p-4 bg-bg-secondary rounded-lg border border-border">
            <div class="w-10 h-10 rounded-lg bg-nest-red/10 flex items-center justify-center shrink-0">
              <svg class="w-6 h-6 text-nest-red" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <h3 class="font-semibold text-text-primary">NestJS v10+ or v11+</h3>
              <p class="text-text-secondary text-sm mt-1">
                This adapter supports both NestJS 10 and 11.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Installation -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Install the Package</h2>
        <p class="text-text-secondary mb-4">
          Install with whichever package manager you use — only the <em>runtime</em> has to be
          Bun:
        </p>

        <div class="space-y-4">
          @for (pkg of packageManagers; track pkg.name) {
            <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
              <div class="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border">
                <span class="text-text-muted text-sm">{{ pkg.name }}</span>
                <button
                  class="text-text-muted hover:text-text-primary transition-colors"
                  (click)="copyCommand(pkg.command)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                </button>
              </div>
              <pre class="p-4 overflow-x-auto"><code class="text-sm">{{ pkg.command }}</code></pre>
            </div>
          }
        </div>
      </section>

      <!-- Peer Dependencies -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Peer Dependencies</h2>
        <p class="text-text-secondary mb-4">
          This package requires the following peer dependencies:
        </p>

        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
          <pre><code class="text-sm"><span class="token-string">"peerDependencies"</span>: &#123;
  <span class="token-string">"&#64;nestjs/common"</span>: <span class="token-string">"^10.0.0 || ^11.0.0"</span>,
  <span class="token-string">"&#64;nestjs/core"</span>: <span class="token-string">"^10.0.0 || ^11.0.0"</span>
&#125;</code></pre>
        </div>

        <p class="text-text-secondary mt-4">
          If you're starting a new project, you'll also need:
        </p>

        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto mt-4">
          <pre><code class="text-sm">pnpm add &#64;nestjs/common &#64;nestjs/core reflect-metadata rxjs</code></pre>
        </div>
      </section>

      <!-- TypeScript Configuration -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">TypeScript Configuration</h2>
        <p class="text-text-secondary mb-4">
          Ensure your <code>tsconfig.json</code> has the following settings:
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
            <span class="text-text-muted text-sm">tsconfig.json</span>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm">&#123;
  <span class="token-string">"compilerOptions"</span>: &#123;
    <span class="token-string">"target"</span>: <span class="token-string">"ES2022"</span>,
    <span class="token-string">"module"</span>: <span class="token-string">"ESNext"</span>,
    <span class="token-string">"moduleResolution"</span>: <span class="token-string">"bundler"</span>,
    <span class="token-string">"experimentalDecorators"</span>: <span class="token-keyword">true</span>,
    <span class="token-string">"emitDecoratorMetadata"</span>: <span class="token-keyword">true</span>,
    <span class="token-string">"strict"</span>: <span class="token-keyword">true</span>,
    <span class="token-string">"esModuleInterop"</span>: <span class="token-keyword">true</span>,
    <span class="token-string">"skipLibCheck"</span>: <span class="token-keyword">true</span>
  &#125;
&#125;</code></pre>
        </div>
      </section>

      <!-- Verify Installation -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Verify Installation</h2>
        <p class="text-text-secondary mb-4">
          Create a simple test file to verify everything is working:
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
            <span class="text-text-muted text-sm">test.ts</span>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;
<span class="token-keyword">import</span> &#123; Module, Controller, Get &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;nestjs/common'</span>;

&#64;<span class="token-function">Controller</span>()
<span class="token-keyword">class</span> <span class="token-variable">AppController</span> &#123;
  &#64;<span class="token-function">Get</span>()
  <span class="token-function">hello</span>() &#123;
    <span class="token-keyword">return</span> <span class="token-string">'Hello from Bun!'</span>;
  &#125;
&#125;

&#64;<span class="token-function">Module</span>(&#123; controllers: [AppController] &#125;)
<span class="token-keyword">class</span> <span class="token-variable">AppModule</span> &#123;&#125;

<span class="token-keyword">async function</span> <span class="token-function">bootstrap</span>() &#123;
  <span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule);
  <span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);
  console.<span class="token-function">log</span>(<span class="token-string">'Server running on http://localhost:3000'</span>);
&#125;

<span class="token-function">bootstrap</span>();</code></pre>
        </div>

        <p class="text-text-secondary mt-4">Run with Bun:</p>

        <div class="bg-bg-code rounded-lg border border-border p-4 mt-2">
          <code class="text-sm">bun run test.ts</code>
        </div>
      </section>

      <!-- Next Steps -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Next Steps</h2>
        <div class="grid sm:grid-cols-2 gap-4">
          <a routerLink="/quick-start" class="flex items-center gap-3 p-4 bg-bg-tertiary rounded-lg
                                              hover:bg-bg-card transition-colors group">
            <div class="w-10 h-10 rounded-lg bg-nest-red/10 flex items-center justify-center
                        group-hover:bg-nest-red/20 transition-colors">
              <svg class="w-5 h-5 text-nest-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <div>
              <h3 class="font-semibold text-text-primary">Quick Start</h3>
              <p class="text-text-secondary text-sm">Build your first app</p>
            </div>
          </a>
          <a routerLink="/adapter" class="flex items-center gap-3 p-4 bg-bg-tertiary rounded-lg
                                          hover:bg-bg-card transition-colors group">
            <div class="w-10 h-10 rounded-lg bg-nest-red/10 flex items-center justify-center
                        group-hover:bg-nest-red/20 transition-colors">
              <svg class="w-5 h-5 text-nest-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/>
              </svg>
            </div>
            <div>
              <h3 class="font-semibold text-text-primary">Bun Adapter</h3>
              <p class="text-text-secondary text-sm">Learn the core concepts</p>
            </div>
          </a>
        </div>
      </section>
    </article>
  `
})
export class InstallationComponent {
  packageManagers = [
    { name: 'pnpm (recommended)', command: 'pnpm add @lexmata/nestjs-platform-bun' },
    { name: 'npm', command: 'npm install @lexmata/nestjs-platform-bun' },
    { name: 'yarn', command: 'yarn add @lexmata/nestjs-platform-bun' },
    { name: 'bun', command: 'bun add @lexmata/nestjs-platform-bun' }
  ];

  copyCommand(command: string) {
    navigator.clipboard.writeText(command);
  }
}
