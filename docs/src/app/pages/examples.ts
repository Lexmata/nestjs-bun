import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { repoTree } from '../site';

@Component({
  selector: 'app-examples',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Examples</h1>
      <p class="text-text-secondary text-lg mb-8">
        Real-world examples to help you get started with @lexmata/nestjs-platform-bun.
      </p>

      <!-- Basic REST API -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Basic REST API</h2>
        <p class="text-text-secondary mb-4">
          A simple CRUD API with in-memory storage.
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
            <span class="text-text-muted text-sm">app.module.ts</span>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; Module, Controller, Get, Post, Put, Delete, Body, Param &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;nestjs/common'</span>;

<span class="token-keyword">interface</span> <span class="token-variable">Task</span> &#123;
  id: <span class="token-variable">string</span>;
  title: <span class="token-variable">string</span>;
  completed: <span class="token-variable">boolean</span>;
&#125;

<span class="token-keyword">const</span> tasks: <span class="token-variable">Task</span>[] = [];

&#64;<span class="token-function">Controller</span>(<span class="token-string">'tasks'</span>)
<span class="token-keyword">class</span> <span class="token-variable">TasksController</span> &#123;
  &#64;<span class="token-function">Get</span>()
  <span class="token-function">findAll</span>() &#123;
    <span class="token-keyword">return</span> tasks;
  &#125;

  &#64;<span class="token-function">Get</span>(<span class="token-string">':id'</span>)
  <span class="token-function">findOne</span>(&#64;<span class="token-function">Param</span>(<span class="token-string">'id'</span>) id: <span class="token-variable">string</span>) &#123;
    <span class="token-keyword">return</span> tasks.<span class="token-function">find</span>(t => t.id === id);
  &#125;

  &#64;<span class="token-function">Post</span>()
  <span class="token-function">create</span>(&#64;<span class="token-function">Body</span>() body: &#123; title: <span class="token-variable">string</span> &#125;) &#123;
    <span class="token-keyword">const</span> task: <span class="token-variable">Task</span> = &#123;
      id: crypto.<span class="token-function">randomUUID</span>(),
      title: body.title,
      completed: <span class="token-keyword">false</span>
    &#125;;
    tasks.<span class="token-function">push</span>(task);
    <span class="token-keyword">return</span> task;
  &#125;

  &#64;<span class="token-function">Put</span>(<span class="token-string">':id'</span>)
  <span class="token-function">update</span>(&#64;<span class="token-function">Param</span>(<span class="token-string">'id'</span>) id: <span class="token-variable">string</span>, &#64;<span class="token-function">Body</span>() body: <span class="token-variable">Partial</span>&#60;<span class="token-variable">Task</span>&#62;) &#123;
    <span class="token-keyword">const</span> task = tasks.<span class="token-function">find</span>(t => t.id === id);
    <span class="token-keyword">if</span> (task) Object.<span class="token-function">assign</span>(task, body);
    <span class="token-keyword">return</span> task;
  &#125;

  &#64;<span class="token-function">Delete</span>(<span class="token-string">':id'</span>)
  <span class="token-function">remove</span>(&#64;<span class="token-function">Param</span>(<span class="token-string">'id'</span>) id: <span class="token-variable">string</span>) &#123;
    <span class="token-keyword">const</span> index = tasks.<span class="token-function">findIndex</span>(t => t.id === id);
    <span class="token-keyword">if</span> (index > -1) tasks.<span class="token-function">splice</span>(index, 1);
    <span class="token-keyword">return</span> &#123; deleted: <span class="token-keyword">true</span> &#125;;
  &#125;
&#125;

&#64;<span class="token-function">Module</span>(&#123; controllers: [TasksController] &#125;)
<span class="token-keyword">export class</span> <span class="token-variable">AppModule</span> &#123;&#125;</code></pre>
        </div>
      </section>

      <!-- With Middleware -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Authentication Middleware</h2>
        <p class="text-text-secondary mb-4">
          Example using Express-style middleware for authentication.
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
            <span class="text-text-muted text-sm">main.ts</span>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> <span class="token-string">'reflect-metadata'</span>;
<span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;
<span class="token-keyword">import</span> &#123; AppModule &#125; <span class="token-keyword">from</span> <span class="token-string">'./app.module'</span>;

<span class="token-comment">// Simple auth middleware</span>
<span class="token-keyword">const</span> <span class="token-function">authMiddleware</span> = (req, res, next) => &#123;
  <span class="token-keyword">const</span> token = req.headers.authorization;

  <span class="token-keyword">if</span> (!token || !token.<span class="token-function">startsWith</span>(<span class="token-string">'Bearer '</span>)) &#123;
    res.<span class="token-function">status</span>(<span class="token-number">401</span>).<span class="token-function">json</span>(&#123; error: <span class="token-string">'Unauthorized'</span> &#125;);
    <span class="token-keyword">return</span>;
  &#125;

  <span class="token-comment">// Verify token (simplified)</span>
  req.user = &#123; id: <span class="token-string">'user-123'</span>, role: <span class="token-string">'admin'</span> &#125;;
  <span class="token-function">next</span>();
&#125;;

<span class="token-keyword">async function</span> <span class="token-function">bootstrap</span>() &#123;
  <span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule);

  <span class="token-comment">// Apply auth to /api routes</span>
  app.<span class="token-function">use</span>(<span class="token-string">'/api'</span>, authMiddleware);

  <span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);
&#125;

<span class="token-function">bootstrap</span>();</code></pre>
        </div>
      </section>

      <!-- File Upload -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">File Uploads</h2>
        <p class="text-text-secondary mb-4">
          Handling file uploads with the Bun adapter.
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
            <span class="text-text-muted text-sm">upload.controller.ts</span>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; Controller, Post, Body &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;nestjs/common'</span>;

&#64;<span class="token-function">Controller</span>(<span class="token-string">'upload'</span>)
<span class="token-keyword">export class</span> <span class="token-variable">UploadController</span> &#123;
  &#64;<span class="token-function">Post</span>()
  <span class="token-keyword">async</span> <span class="token-function">uploadFile</span>(&#64;<span class="token-function">Body</span>() body: <span class="token-variable">Record</span>&#60;<span class="token-variable">string</span>, <span class="token-variable">unknown</span>&#62;) &#123;
    <span class="token-comment">// multipart/form-data is parsed into a PLAIN OBJECT keyed by field</span>
    <span class="token-comment">// name — it is not a FormData, so use body.file, not body.get('file').</span>
    <span class="token-keyword">const</span> file = body.file;

    <span class="token-keyword">if</span> (!(file <span class="token-keyword">instanceof</span> File)) &#123;
      <span class="token-keyword">return</span> &#123; error: <span class="token-string">'No file uploaded'</span> &#125;;
    &#125;

    <span class="token-comment">// Save the file using Bun's file API</span>
    <span class="token-keyword">await</span> Bun.<span class="token-function">write</span>(<span class="token-string">\`./uploads/\$&#123;file.name&#125;\`</span>, file);

    <span class="token-keyword">return</span> &#123;
      filename: file.name,
      size: file.size,
      type: file.type
    &#125;;
  &#125;
&#125;</code></pre>
        </div>

        <div class="p-4 mt-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>⚠ Repeated field names collapse.</strong>
            The parser assigns each field into a plain object, so a form posting
            <code>file</code> more than once keeps only the last one. Read
            <code>req.raw.formData()</code> yourself when you need multi-file uploads —
            <code>req.raw</code> is the underlying Bun <code>Request</code>.
          </p>
        </div>
      </section>

      <!-- With CORS -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">CORS Configuration</h2>
        <p class="text-text-secondary mb-4">
          Configure CORS for cross-origin requests.
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;

<span class="token-keyword">async function</span> <span class="token-function">bootstrap</span>() &#123;
  <span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule);

  <span class="token-comment">// Enable CORS with custom options</span>
  app.<span class="token-function">enableCors</span>(&#123;
    origin: [<span class="token-string">'https://example.com'</span>, <span class="token-string">'https://app.example.com'</span>],
    methods: [<span class="token-string">'GET'</span>, <span class="token-string">'POST'</span>, <span class="token-string">'PUT'</span>, <span class="token-string">'DELETE'</span>, <span class="token-string">'PATCH'</span>],
    credentials: <span class="token-keyword">true</span>,
    allowedHeaders: [<span class="token-string">'Content-Type'</span>, <span class="token-string">'Authorization'</span>],
    maxAge: <span class="token-number">86400</span>, <span class="token-comment">// 24 hours</span>
  &#125;);

  <span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);
&#125;

<span class="token-function">bootstrap</span>();</code></pre>
        </div>
      </section>

      <!-- More Examples -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Runnable Sample Apps</h2>
        <p class="text-text-secondary mb-4">
          The <code>examples/</code> directory is a single Bun workspace — one
          <code>pnpm install</code> covers all five. Each depends on the package by name
          (<code>file:..</code>), so they run against the built artifact you would install
          from npm:
        </p>
        <div class="space-y-3">
          @for (example of examples; track example.title) {
            <a
              [href]="example.link"
              target="_blank"
              class="flex items-center justify-between p-4 bg-bg-tertiary rounded-lg
                     hover:bg-bg-card transition-colors group"
            >
              <div>
                <h3 class="font-semibold text-text-primary group-hover:text-nest-red transition-colors">
                  {{ example.title }}
                </h3>
                <p class="text-text-secondary text-sm">{{ example.description }}</p>
              </div>
              <svg class="w-5 h-5 text-text-muted group-hover:text-nest-red transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
              </svg>
            </a>
          }
        </div>
      </section>
    </article>
  `,
})
export class ExamplesComponent {
  examples = [
    {
      title: 'examples/01-basic',
      description:
        'NestBunFactory bootstrap: @Get, @Post, a @Param() route and a @Header() response — pnpm start:basic',
      link: repoTree('examples/01-basic'),
    },
    {
      title: 'examples/02-express-middleware',
      description:
        'Express middleware on the Bun server: synchronous, asynchronous next(), path-scoped and 4-argument error middleware — pnpm start:express-middleware',
      link: repoTree('examples/02-express-middleware'),
    },
    {
      title: 'examples/03-fastify-hooks',
      description:
        'All seven supported Fastify hooks registered through a plugin, with onSend rewriting the response payload — pnpm start:fastify-hooks',
      link: repoTree('examples/03-fastify-hooks'),
    },
    {
      title: 'examples/04-tls',
      description:
        'HTTPS via serverOptions.tls passed through to Bun.serve, with a script to generate a local certificate — pnpm start:tls',
      link: repoTree('examples/04-tls'),
    },
    {
      title: 'examples/05-raw-body-webhook',
      description:
        'rawBody: true and HMAC signature verification over the exact request bytes — pnpm start:webhook',
      link: repoTree('examples/05-raw-body-webhook'),
    },
  ];
}
