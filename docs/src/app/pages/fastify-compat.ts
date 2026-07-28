import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-fastify-compat',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Fastify Compatibility</h1>
      <p class="text-text-secondary text-lg mb-8">
        Use Fastify hooks and plugins with the Bun adapter.
      </p>

      <!-- Overview -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Overview</h2>
        <p class="text-text-secondary mb-4">
          The adapter offers a Fastify-shaped surface for hooks, plugins and decorators. It is a
          reimplementation of the patterns, not of Fastify — a subset of the lifecycle is
          available and there is no encapsulation model.
        </p>
        <div class="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>⚠ Subset only.</strong>
            Seven hook points are implemented, and registering any other name throws. Plugin
            encapsulation, route-level schema validation and <code>opts.prefix</code> are not
            implemented at all. Real Fastify plugins that rely on those will not work unmodified.
          </p>
        </div>
      </section>

      <!-- Hooks -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Lifecycle Hooks</h2>
        <p class="text-text-secondary mb-4">
          Register hooks on the adapter instance:
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden mb-6">
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory, BunAdapter &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;

<span class="token-keyword">async function</span> <span class="token-function">bootstrap</span>() &#123;
  <span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule);
  <span class="token-keyword">const</span> adapter = app.<span class="token-function">getHttpAdapter</span>() <span class="token-keyword">as</span> BunAdapter;

  <span class="token-comment">// onRequest hook - runs before routing</span>
  adapter.<span class="token-function">addHook</span>(<span class="token-string">'onRequest'</span>, <span class="token-keyword">async</span> (request, reply, done) => &#123;
    console.<span class="token-function">log</span>(<span class="token-string">'Request received:'</span>, request.url);
    <span class="token-function">done</span>();
  &#125;);

  <span class="token-comment">// preHandler hook - runs before the handler</span>
  adapter.<span class="token-function">addHook</span>(<span class="token-string">'preHandler'</span>, <span class="token-keyword">async</span> (request, reply, done) => &#123;
    <span class="token-comment">// Authentication check</span>
    <span class="token-keyword">if</span> (!request.headers.authorization) &#123;
      reply.<span class="token-function">code</span>(<span class="token-number">401</span>).<span class="token-function">send</span>(&#123; error: <span class="token-string">'Unauthorized'</span> &#125;);
      <span class="token-keyword">return</span>;
    &#125;
    <span class="token-function">done</span>();
  &#125;);

  <span class="token-comment">// onSend hook - may rewrite the payload before it is sent</span>
  adapter.<span class="token-function">addHook</span>(<span class="token-string">'onSend'</span>, <span class="token-keyword">async</span> (request, reply, payload, done) => &#123;
    <span class="token-comment">// payload is the serialised body: a string for JSON responses,</span>
    <span class="token-comment">// not the object you returned from the handler.</span>
    <span class="token-keyword">if</span> (<span class="token-keyword">typeof</span> payload === <span class="token-string">'string'</span>) &#123;
      <span class="token-keyword">const</span> parsed = JSON.<span class="token-function">parse</span>(payload);
      <span class="token-function">done</span>(<span class="token-keyword">null</span>, JSON.<span class="token-function">stringify</span>(&#123; ...parsed, timestamp: Date.<span class="token-function">now</span>() &#125;));
      <span class="token-keyword">return</span>;
    &#125;
    <span class="token-function">done</span>(<span class="token-keyword">null</span>, payload);
  &#125;);

  <span class="token-comment">// onResponse hook - runs after response sent</span>
  adapter.<span class="token-function">addHook</span>(<span class="token-string">'onResponse'</span>, <span class="token-keyword">async</span> (request, reply, done) => &#123;
    console.<span class="token-function">log</span>(<span class="token-string">'Response time:'</span>, reply.<span class="token-function">getResponseTime</span>(), <span class="token-string">'ms'</span>);
    <span class="token-function">done</span>();
  &#125;);

  <span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);
&#125;</code></pre>
        </div>

        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-bg-tertiary border-b border-border">
                <th class="px-4 py-3 text-left text-text-muted font-medium">Hook</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              @for (hook of hooks; track hook.name) {
                <tr class="border-b border-border last:border-0">
                  <td class="px-4 py-3 font-mono text-nest-red">{{ hook.name }}</td>
                  <td class="px-4 py-3 text-text-secondary">{{ hook.description }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="p-4 mt-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>⚠ Unsupported hook names throw.</strong>
            Those seven are the whole list. Fastify's <code>preParsing</code>,
            <code>onTimeout</code>, <code>onClose</code>, <code>onReady</code> and
            <code>onListen</code> have no execution stage here, so
            <code>addHook()</code> throws rather than accepting them and silently never
            running them.
          </p>
        </div>
      </section>

      <!-- Decorators -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Decorators</h2>
        <p class="text-text-secondary mb-4">
          Add custom properties to request and reply objects:
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">const</span> adapter = app.<span class="token-function">getHttpAdapter</span>() <span class="token-keyword">as</span> BunAdapter;

<span class="token-comment">// Decorate request with user data</span>
adapter.<span class="token-function">decorateRequest</span>(<span class="token-string">'user'</span>, <span class="token-keyword">null</span>);

<span class="token-comment">// Decorate reply with custom method</span>
adapter.<span class="token-function">decorateReply</span>(<span class="token-string">'sendError'</span>, <span class="token-keyword">function</span>(code, message) &#123;
  <span class="token-keyword">this</span>.<span class="token-function">code</span>(code).<span class="token-function">send</span>(&#123; error: message &#125;);
&#125;);

<span class="token-comment">// Check if decorator exists</span>
<span class="token-keyword">if</span> (adapter.<span class="token-function">hasRequestDecorator</span>(<span class="token-string">'user'</span>)) &#123;
  console.<span class="token-function">log</span>(<span class="token-string">'User decorator is available'</span>);
&#125;</code></pre>
        </div>

        <div class="p-4 mt-4 bg-bg-tertiary border border-border rounded-lg">
          <p class="text-text-secondary text-sm">
            Function values are attached <strong>as-is</strong>, so they become real methods and
            <code>this</code> binds to the request or reply at call time — use
            <code>function () &#123; ... &#125;</code>, not an arrow function, if you need
            <code>this</code>. Non-function values are assigned directly and shared by every
            request; treat them as defaults to overwrite in a hook, not as per-request state.
          </p>
        </div>
      </section>

      <!-- Plugins -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Plugins</h2>
        <p class="text-text-secondary mb-4">
          <code>register()</code> accepts a plugin function and runs it once, just before the
          server starts listening.
        </p>
        <div class="bg-bg-code rounded-lg border border-border overflow-hidden mb-4">
          <pre class="p-4 overflow-x-auto"><code class="text-sm">adapter.<span class="token-function">register</span>(<span class="token-keyword">async</span> (instance, opts) => &#123;
  instance.<span class="token-function">decorateRequest</span>(<span class="token-string">'requestId'</span>, <span class="token-keyword">null</span>);

  instance.<span class="token-function">addHook</span>(<span class="token-string">'onRequest'</span>, <span class="token-keyword">async</span> (request, reply, done) => &#123;
    request.requestId = crypto.<span class="token-function">randomUUID</span>();
    <span class="token-function">done</span>();
  &#125;);
&#125;);</code></pre>
        </div>
        <div class="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>⚠ No encapsulation.</strong>
            Every plugin receives the same shared instance, so hooks, decorators and routes
            registered inside a plugin apply to the entire application — there is no plugin
            scope. Because prefixing depends on encapsulation,
            <code>register(plugin, &#123; prefix &#125;)</code> <strong>throws</strong> rather than
            accepting a prefix it cannot honour. Most real Fastify plugins assume encapsulation
            and will not port cleanly.
          </p>
        </div>
      </section>

      <!-- Reply Object -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Reply Object</h2>
        <p class="text-text-secondary mb-4">
          The Fastify-compatible reply object:
        </p>

        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-bg-tertiary border-b border-border">
                <th class="px-4 py-3 text-left text-text-muted font-medium">Method</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              @for (method of replyMethods; track method.name) {
                <tr class="border-b border-border last:border-0">
                  <td class="px-4 py-3 font-mono text-nest-red">{{ method.name }}</td>
                  <td class="px-4 py-3 text-text-secondary">{{ method.description }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Request Object -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Request Object</h2>
        <p class="text-text-secondary mb-4">
          The Fastify-compatible request object:
        </p>

        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-bg-tertiary border-b border-border">
                <th class="px-4 py-3 text-left text-text-muted font-medium">Property</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Type</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              @for (prop of requestProps; track prop.name) {
                <tr class="border-b border-border last:border-0">
                  <td class="px-4 py-3 font-mono text-nest-red">{{ prop.name }}</td>
                  <td class="px-4 py-3 text-text-secondary font-mono text-xs">{{ prop.type }}</td>
                  <td class="px-4 py-3 text-text-secondary">{{ prop.description }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Compatibility Notes -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Compatibility Notes</h2>
        <div class="space-y-3">
          @for (note of compatibilityNotes; track note.text) {
            <div class="flex items-start gap-3">
              <span [class]="note.supported ? 'text-green-400' : 'text-yellow-400'">
                {{ note.supported ? '✓' : '⚠' }}
              </span>
              <span class="text-text-secondary">{{ note.text }}</span>
            </div>
          }
        </div>
      </section>
    </article>
  `,
})
export class FastifyCompatComponent {
  hooks = [
    { name: 'onRequest', description: 'Start of the request, before the handler runs' },
    { name: 'preValidation', description: 'After the body has been parsed, before the handler' },
    { name: 'preHandler', description: 'Immediately before handler execution' },
    { name: 'preSerialization', description: 'After the handler returns, before the payload is serialised' },
    { name: 'onSend', description: 'Before the response is sent — may rewrite the payload' },
    { name: 'onResponse', description: 'After the response has been built' },
    { name: 'onError', description: 'When an error escapes the handler. Observability only — it cannot replace the reply' },
  ];

  replyMethods = [
    { name: 'code(statusCode)', description: 'Set HTTP status code' },
    { name: 'status(statusCode)', description: 'Alias for code()' },
    { name: 'header(key, value)', description: 'Set a response header' },
    { name: 'headers(obj)', description: 'Set multiple headers at once' },
    { name: 'getHeader(key) / getHeaders()', description: 'Read headers already set on the reply' },
    { name: 'hasHeader(key)', description: 'Test whether a header is set' },
    { name: 'removeHeader(key)', description: 'Delete a response header' },
    { name: 'type(contentType)', description: 'Set Content-Type' },
    { name: 'serializer(fn)', description: 'Override how the payload is serialised for this reply' },
    { name: 'send(payload)', description: 'Send the response. Throws FST_ERR_REP_ALREADY_SENT if called twice' },
    { name: 'redirect(url) / redirect(status, url)', description: 'Redirect, preserving headers already set' },
    { name: 'callNotFound()', description: 'Hand the request to the not-found handler' },
    { name: 'getResponseTime() / elapsedTime', description: 'Elapsed time in ms since the reply was created' },
    { name: 'sent', description: 'Whether the reply has already been sent (read-only)' },
  ];

  requestProps = [
    { name: 'raw', type: 'Request', description: 'The underlying Bun Request' },
    { name: 'id', type: 'string', description: 'Unique request ID' },
    { name: 'params', type: 'object', description: 'Route parameters' },
    { name: 'query', type: 'object', description: 'Query string parameters. Repeated keys collapse last-wins — read raw.url for all values' },
    { name: 'body', type: 'any', description: 'Parsed request body' },
    { name: 'headers', type: 'object', description: 'Request headers' },
    { name: 'method', type: 'string', description: 'HTTP method' },
    { name: 'url', type: 'string', description: 'Request URL' },
    { name: 'routerPath / routerMethod', type: 'string', description: 'The matched route pattern and method — the low-cardinality key to use for metrics' },
    { name: 'ip', type: 'string', description: 'Remote address. Proxy headers are only consulted when trustProxy is enabled' },
    { name: 'ips', type: 'string[]', description: 'Forwarded address chain. Empty unless trustProxy is enabled, matching Fastify\'s default' },
    { name: 'hostname', type: 'string', description: 'Request hostname' },
    { name: 'protocol', type: "'http' | 'https'", description: 'Request scheme' },
    { name: 'is404', type: 'boolean', description: 'Whether the request failed to match a route' },
  ];

  compatibilityNotes = [
    { text: 'Seven lifecycle hooks: onRequest, preValidation, preHandler, preSerialization, onSend, onResponse, onError', supported: true },
    { text: 'Request and reply decorators, attached as real methods so `this` binds correctly', supported: true },
    { text: 'onSend hooks can rewrite the outgoing payload', supported: true },
    { text: 'Response time tracking via getResponseTime() and elapsedTime', supported: true },
    { text: 'Per-reply custom serializers via reply.serializer()', supported: true },
    { text: 'Redirects preserve headers already set on the reply', supported: true },
    { text: 'Hook names outside the supported seven throw instead of being silently ignored', supported: false },
    { text: 'Schema validation is not implemented — request.getValidationFunction(), request.compileValidationSchema() and request.validateInput() all throw. Use a NestJS ValidationPipe or DTO validator instead', supported: false },
    { text: 'Plugins have no encapsulation: everything a plugin registers applies application-wide, and register(plugin, { prefix }) throws', supported: false },
    { text: 'ip and ips ignore proxy headers unless trustProxy is enabled', supported: false },
  ];
}
