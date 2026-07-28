import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-quick-start',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Quick Start</h1>
      <p class="text-text-secondary text-lg mb-8">
        Get your NestJS application running on Bun in under 5 minutes.
      </p>

      <!-- Steps -->
      <div class="space-y-12">
        <!-- Step 1 -->
        <section>
          <div class="flex items-center gap-4 mb-4">
            <div class="w-10 h-10 rounded-full bg-nest-red flex items-center justify-center text-white font-bold">
              1
            </div>
            <h2 class="text-2xl font-bold">Create a New Project</h2>
          </div>
          <p class="text-text-secondary mb-4">
            Create a new directory and initialize your project:
          </p>
          <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
            <pre><code class="text-sm"><span class="text-text-muted"># Create project directory</span>
mkdir my-bun-api && cd my-bun-api

<span class="text-text-muted"># Initialize with pnpm</span>
pnpm init

<span class="text-text-muted"># Install dependencies</span>
pnpm add @lexmata/nestjs-platform-bun &#64;nestjs/common &#64;nestjs/core reflect-metadata rxjs</code></pre>
          </div>
        </section>

        <!-- Step 2 -->
        <section>
          <div class="flex items-center gap-4 mb-4">
            <div class="w-10 h-10 rounded-full bg-nest-red flex items-center justify-center text-white font-bold">
              2
            </div>
            <h2 class="text-2xl font-bold">Create Your Module</h2>
          </div>
          <p class="text-text-secondary mb-4">
            Create <code>app.module.ts</code> with a simple controller:
          </p>
          <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
            <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
              <span class="text-text-muted text-sm">app.module.ts</span>
            </div>
            <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; Module, Controller, Get, Post, Body, Param &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;nestjs/common'</span>;

<span class="token-comment">// Simple in-memory data store</span>
<span class="token-keyword">const</span> users: &#123; id: <span class="token-variable">string</span>; name: <span class="token-variable">string</span> &#125;[] = [];

&#64;<span class="token-function">Controller</span>(<span class="token-string">'users'</span>)
<span class="token-keyword">export class</span> <span class="token-variable">UsersController</span> &#123;
  &#64;<span class="token-function">Get</span>()
  <span class="token-function">findAll</span>() &#123;
    <span class="token-keyword">return</span> users;
  &#125;

  &#64;<span class="token-function">Get</span>(<span class="token-string">':id'</span>)
  <span class="token-function">findOne</span>(&#64;<span class="token-function">Param</span>(<span class="token-string">'id'</span>) id: <span class="token-variable">string</span>) &#123;
    <span class="token-keyword">return</span> users.<span class="token-function">find</span>(u => u.id === id);
  &#125;

  &#64;<span class="token-function">Post</span>()
  <span class="token-function">create</span>(&#64;<span class="token-function">Body</span>() body: &#123; name: <span class="token-variable">string</span> &#125;) &#123;
    <span class="token-keyword">const</span> user = &#123;
      id: crypto.<span class="token-function">randomUUID</span>(),
      name: body.name
    &#125;;
    users.<span class="token-function">push</span>(user);
    <span class="token-keyword">return</span> user;
  &#125;
&#125;

&#64;<span class="token-function">Controller</span>()
<span class="token-keyword">export class</span> <span class="token-variable">AppController</span> &#123;
  &#64;<span class="token-function">Get</span>()
  <span class="token-function">hello</span>() &#123;
    <span class="token-keyword">return</span> &#123;
      message: <span class="token-string">'Welcome to @lexmata/nestjs-platform-bun!'</span>,
      timestamp: <span class="token-keyword">new</span> <span class="token-function">Date</span>().<span class="token-function">toISOString</span>()
    &#125;;
  &#125;

  &#64;<span class="token-function">Get</span>(<span class="token-string">'health'</span>)
  <span class="token-function">health</span>() &#123;
    <span class="token-keyword">return</span> &#123; status: <span class="token-string">'ok'</span> &#125;;
  &#125;
&#125;

&#64;<span class="token-function">Module</span>(&#123;
  controllers: [AppController, UsersController]
&#125;)
<span class="token-keyword">export class</span> <span class="token-variable">AppModule</span> &#123;&#125;</code></pre>
          </div>
        </section>

        <!-- Step 3 -->
        <section>
          <div class="flex items-center gap-4 mb-4">
            <div class="w-10 h-10 rounded-full bg-nest-red flex items-center justify-center text-white font-bold">
              3
            </div>
            <h2 class="text-2xl font-bold">Create the Entry Point</h2>
          </div>
          <p class="text-text-secondary mb-4">
            Create <code>main.ts</code> to bootstrap your application:
          </p>
          <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
            <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
              <span class="text-text-muted text-sm">main.ts</span>
            </div>
            <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> <span class="token-string">'reflect-metadata'</span>;
<span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;
<span class="token-keyword">import</span> &#123; AppModule &#125; <span class="token-keyword">from</span> <span class="token-string">'./app.module'</span>;

<span class="token-keyword">async function</span> <span class="token-function">bootstrap</span>() &#123;
  <span class="token-comment">// Create the application</span>
  <span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule);

  <span class="token-comment">// Enable CORS for frontend access</span>
  app.<span class="token-function">enableCors</span>(&#123;
    origin: <span class="token-string">'*'</span>,
    methods: [<span class="token-string">'GET'</span>, <span class="token-string">'POST'</span>, <span class="token-string">'PUT'</span>, <span class="token-string">'DELETE'</span>]
  &#125;);

  <span class="token-comment">// Set global prefix</span>
  app.<span class="token-function">setGlobalPrefix</span>(<span class="token-string">'api'</span>);

  <span class="token-comment">// Start the server</span>
  <span class="token-keyword">const</span> port = process.env.PORT ?? <span class="token-number">3000</span>;
  <span class="token-keyword">await</span> app.<span class="token-function">listen</span>(port);

  console.<span class="token-function">log</span>(<span class="token-string">\`🚀 Server running on http://localhost:\$&#123;port&#125;\`</span>);
&#125;

<span class="token-function">bootstrap</span>();</code></pre>
          </div>
        </section>

        <!-- Step 4 -->
        <section>
          <div class="flex items-center gap-4 mb-4">
            <div class="w-10 h-10 rounded-full bg-nest-red flex items-center justify-center text-white font-bold">
              4
            </div>
            <h2 class="text-2xl font-bold">Run Your Application</h2>
          </div>
          <p class="text-text-secondary mb-4">
            Start your server with Bun:
          </p>
          <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
            <pre><code class="text-sm">bun run main.ts</code></pre>
          </div>
          <p class="text-text-secondary mt-4">
            You should see:
          </p>
          <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto mt-2">
            <pre><code class="text-sm text-green-400">🚀 Server running on http://localhost:3000</code></pre>
          </div>
        </section>

        <!-- Step 5 -->
        <section>
          <div class="flex items-center gap-4 mb-4">
            <div class="w-10 h-10 rounded-full bg-nest-red flex items-center justify-center text-white font-bold">
              5
            </div>
            <h2 class="text-2xl font-bold">Test Your API</h2>
          </div>
          <p class="text-text-secondary mb-4">
            Use curl or your favorite API client to test:
          </p>
          <div class="space-y-4">
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="text-text-muted"># Get welcome message</span>
curl http://localhost:3000/api

<span class="text-text-muted"># Health check</span>
curl http://localhost:3000/api/health

<span class="text-text-muted"># Create a user</span>
curl -X POST http://localhost:3000/api/users \\
  -H "Content-Type: application/json" \\
  -d '&#123;"name": "John Doe"&#125;'

<span class="text-text-muted"># Get all users</span>
curl http://localhost:3000/api/users</code></pre>
            </div>
          </div>
        </section>
      </div>

      <!-- What's Next -->
      <section class="mt-16 p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">What's Next?</h2>
        <div class="grid sm:grid-cols-3 gap-4">
          <a routerLink="/adapter" class="p-4 bg-bg-tertiary rounded-lg hover:bg-bg-card transition-colors">
            <h3 class="font-semibold text-text-primary mb-1">Bun Adapter</h3>
            <p class="text-text-secondary text-sm">Learn about the adapter API</p>
          </a>
          <a routerLink="/express-compat" class="p-4 bg-bg-tertiary rounded-lg hover:bg-bg-card transition-colors">
            <h3 class="font-semibold text-text-primary mb-1">Express Middleware</h3>
            <p class="text-text-secondary text-sm">Use Express middleware</p>
          </a>
          <a routerLink="/benchmarks" class="p-4 bg-bg-tertiary rounded-lg hover:bg-bg-card transition-colors">
            <h3 class="font-semibold text-text-primary mb-1">Benchmarks</h3>
            <p class="text-text-secondary text-sm">See performance results</p>
          </a>
        </div>
      </section>
    </article>
  `
})
export class QuickStartComponent {}
