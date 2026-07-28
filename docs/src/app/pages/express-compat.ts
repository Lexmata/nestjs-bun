import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-express-compat',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Express Compatibility</h1>
      <p class="text-text-secondary text-lg mb-8">
        Use your existing Express middleware with the Bun adapter.
      </p>

      <!-- Overview -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Overview</h2>
        <p class="text-text-secondary mb-4">
          The adapter provides Express-shaped <code>req</code> and <code>res</code> objects so that
          Express middleware can run unchanged — provided it sticks to the property and method
          surface documented below.
        </p>
        <div class="p-4 mb-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>✓ Works:</strong> middleware that only reads request properties and calls
            <code>setHeader</code>/<code>getHeader</code>/<code>status</code>/<code>json</code>/<code>send</code>
            and <code>next()</code>. <code>helmet</code> and <code>cors</code> are good examples.
          </p>
        </div>
        <div class="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>⚠ Does not work:</strong> middleware that treats the response as a Node
            stream or <code>EventEmitter</code>. The response object is a plain shim — it has no
            <code>write</code>, <code>on</code>, <code>once</code>, <code>emit</code>,
            <code>writeHead</code> or <code>flush</code>. <code>compression</code> is the common
            casualty: it patches <code>res.write</code>/<code>res.end</code> and installs
            <code>on-headers</code>, none of which exist here.
          </p>
        </div>
      </section>

      <!-- Using Middleware -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Using Express Middleware</h2>

        <div class="space-y-6">
          <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
            <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
              <span class="text-text-muted text-sm">main.ts</span>
            </div>
            <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;lexmata/nestjs-platform-bun'</span>;
<span class="token-keyword">import</span> helmet <span class="token-keyword">from</span> <span class="token-string">'helmet'</span>;

<span class="token-keyword">async function</span> <span class="token-function">bootstrap</span>() &#123;
  <span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule);

  <span class="token-comment">// Security headers — only touches setHeader(), so it works</span>
  app.<span class="token-function">use</span>(<span class="token-function">helmet</span>());

  <span class="token-comment">// Custom logging middleware</span>
  app.<span class="token-function">use</span>((req, res, next) => &#123;
    console.<span class="token-function">log</span>(<span class="token-string">\`[\$&#123;new Date().toISOString()&#125;] \$&#123;req.method&#125; \$&#123;req.url&#125;\`</span>);
    <span class="token-function">next</span>();
  &#125;);

  <span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);
&#125;

<span class="token-function">bootstrap</span>();</code></pre>
          </div>
        </div>
      </section>

      <!-- Known-incompatible middleware -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Middleware Compatibility</h2>
        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-bg-tertiary border-b border-border">
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Middleware</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Status</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                @for (row of middlewareStatus; track row.name) {
                  <tr class="border-b border-border last:border-0">
                    <td class="px-4 py-3 font-mono text-nest-red whitespace-nowrap">{{ row.name }}</td>
                    <td class="px-4 py-3 whitespace-nowrap"
                        [class.text-green-400]="row.status === '✓'"
                        [class.text-yellow-400]="row.status !== '✓'">
                      {{ row.status }} {{ row.label }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">{{ row.notes }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Request Object -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Request Object</h2>
        <p class="text-text-secondary mb-4">
          The Express-compatible request object provides familiar properties and methods:
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

      <!-- Response Object -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Response Object</h2>
        <p class="text-text-secondary mb-4">
          The Express-compatible response object provides familiar methods:
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
              @for (method of responseMethods; track method.name) {
                <tr class="border-b border-border last:border-0">
                  <td class="px-4 py-3 font-mono text-nest-red">{{ method.name }}</td>
                  <td class="px-4 py-3 text-text-secondary">{{ method.description }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Error Middleware -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Error Middleware</h2>
        <p class="text-text-secondary mb-4">
          Express-style error middleware (4 arguments) is fully supported:
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-comment">// Error handling middleware</span>
app.<span class="token-function">use</span>((err, req, res, next) => &#123;
  console.<span class="token-function">error</span>(<span class="token-string">'Error:'</span>, err.message);

  res.<span class="token-function">status</span>(err.status ?? <span class="token-number">500</span>).<span class="token-function">json</span>(&#123;
    error: err.message,
    stack: process.env.NODE_ENV === <span class="token-string">'development'</span> ? err.stack : <span class="token-keyword">undefined</span>
  &#125;);
&#125;);</code></pre>
        </div>
      </section>

      <!-- Cookies -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Cookies</h2>
        <p class="text-text-secondary mb-4">
          Plain cookie handling is built in — the <code>Cookie</code> header is parsed into
          <code>req.cookies</code>, and <code>res.cookie()</code> appends <code>Set-Cookie</code>.
          <strong>Signed cookies are not supported</strong>: there is no secret to sign with, so
          there is no <code>req.signedCookies</code> and no <code>signed</code> option.
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-comment">// Reading cookies</span>
app.<span class="token-function">use</span>((req, res, next) => &#123;
  <span class="token-keyword">const</span> sessionId = req.cookies.session;
  <span class="token-keyword">const</span> userId = req.cookies.userId;
  <span class="token-function">next</span>();
&#125;);

<span class="token-comment">// Setting cookies</span>
res.<span class="token-function">cookie</span>(<span class="token-string">'session'</span>, <span class="token-string">'abc123'</span>, &#123;
  httpOnly: <span class="token-keyword">true</span>,
  secure: <span class="token-keyword">true</span>,
  sameSite: <span class="token-string">'strict'</span>,
  maxAge: <span class="token-number">86400</span> * <span class="token-number">1000</span> <span class="token-comment">// milliseconds — 1 day</span>
&#125;);

<span class="token-comment">// Clearing cookies</span>
res.<span class="token-function">clearCookie</span>(<span class="token-string">'session'</span>);</code></pre>
        </div>

        <div class="p-4 mt-4 bg-bg-tertiary border border-border rounded-lg">
          <p class="text-text-secondary text-sm">
            <code>maxAge</code> is in <strong>milliseconds</strong>, exactly like Express — it is
            divided by 1000 when written to <code>Max-Age</code>, and also sets a matching
            <code>Expires</code> for older clients.
          </p>
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
export class ExpressCompatComponent {
  requestProps = [
    { name: 'raw', type: 'Request', description: "The underlying Bun Request — your escape hatch for anything the shim doesn't cover" },
    { name: 'method', type: 'string', description: 'HTTP method (GET, POST, etc.)' },
    { name: 'url', type: 'string', description: 'Path with query string' },
    { name: 'originalUrl', type: 'string', description: 'Same as url — the adapter does not rewrite paths' },
    { name: 'path', type: 'string', description: 'URL path without query string' },
    { name: 'params', type: 'object', description: 'Route parameters' },
    { name: 'query', type: 'object', description: 'Parsed query string (last value wins for repeated keys)' },
    { name: 'body', type: 'any', description: 'Parsed request body — see Configuration for the per-Content-Type shape' },
    { name: 'headers', type: 'object', description: 'Request headers, lowercase keys' },
    { name: 'cookies', type: 'object', description: 'Parsed cookies' },
    { name: 'ip / ips', type: 'string / string[]', description: 'Client address. X-Forwarded-* headers are ignored unless trustProxy is enabled, so ips is empty by default' },
    { name: 'hostname', type: 'string', description: 'Request hostname' },
    { name: 'protocol / secure', type: 'string / boolean', description: 'Request scheme and whether it is https' },
    { name: 'subdomains', type: 'string[]', description: 'Hostname labels below the registrable domain, reversed' },
    { name: 'xhr', type: 'boolean', description: 'True when X-Requested-With is XMLHttpRequest' },
    { name: 'get(field) / header(field)', type: 'method', description: 'Read a request header' },
    { name: 'accepts(type)', type: 'method', description: 'Simple substring probe of the Accept header, in the order you pass types. No q-value ranking. Also acceptsCharsets, acceptsEncodings and acceptsLanguages' },
    { name: 'is(type)', type: 'method', description: 'Substring test against the request Content-Type. Returns null when the header is absent. No wildcards' },
    { name: 'range(size, opts?)', type: 'method', description: 'Not implemented — always returns undefined. Read the header yourself with req.get("range")' },
  ];

  responseMethods = [
    { name: 'status(code)', description: 'Set HTTP status code' },
    { name: 'sendStatus(code)', description: 'Set the status and send its standard reason phrase as the body' },
    { name: 'json(data)', description: 'Send a JSON response' },
    { name: 'send(data)', description: 'Send a response. Strings become text/html, Buffers become octet-stream, other objects are JSON-serialised' },
    { name: 'end(data?)', description: 'End the response' },
    { name: 'set(field, value) / header(...)', description: 'Set a response header (also accepts an object)' },
    { name: 'setHeader(field, value)', description: 'Node-style alias for set()' },
    { name: 'get(field) / getHeader(field)', description: 'Read a header already set on the response' },
    { name: 'removeHeader(field)', description: 'Delete a response header' },
    { name: 'append(field, value)', description: 'Append a value to a repeatable header' },
    { name: 'type(t) / contentType(t)', description: 'Set Content-Type from an extension or full MIME type' },
    { name: 'format(obj)', description: 'Calls obj.default only. Accept-header negotiation is not implemented' },
    { name: 'attachment(filename?)', description: 'Set Content-Disposition and infer Content-Type from the extension' },
    { name: 'cookie(name, value, opts)', description: 'Append a Set-Cookie header' },
    { name: 'clearCookie(name)', description: 'Expire a cookie' },
    { name: 'redirect(url) / redirect(status, url)', description: 'Set Location and a 3xx status' },
    { name: 'location(url)', description: 'Set the Location header without changing the status' },
    { name: 'links(obj)', description: 'Set the Link header' },
    { name: 'vary(field)', description: 'Append to the Vary header' },
    { name: 'locals', description: 'Per-request scratch object shared across middleware' },
  ];

  middlewareStatus = [
    {
      name: 'helmet',
      status: '✓',
      label: 'works',
      notes: 'Only calls setHeader() and next().',
    },
    {
      name: 'cors',
      status: '✓',
      label: 'works',
      notes: 'Header-only. The adapter also has a built-in enableCors() you can use instead.',
    },
    {
      name: 'compression',
      status: '⚠',
      label: 'incompatible',
      notes: 'Patches res.write/res.end and registers on-headers via res.on(). The response shim is not a stream or an EventEmitter, so none of that exists. Compress at your reverse proxy or CDN instead.',
    },
    {
      name: 'express.json() / body-parser',
      status: '⚠',
      label: 'redundant',
      notes: 'The adapter parses bodies out of band before middleware runs, so req.body is already populated. Registering a parser is at best a no-op.',
    },
    {
      name: 'cookie-parser',
      status: '⚠',
      label: 'partly redundant',
      notes: 'req.cookies is already populated. Signed-cookie support is not available — there is no secret plumbing.',
    },
    {
      name: 'morgan / pino-http',
      status: '⚠',
      label: 'untested',
      notes: 'Loggers that hook res.on("finish") will not fire. Roll a small logging middleware around next() instead.',
    },
  ];

  compatibilityNotes = [
    { text: 'Express middleware works when it stays within the request and response surface listed above', supported: true },
    { text: 'Body parsing (JSON, URL-encoded, multipart, text) happens automatically before middleware runs', supported: true },
    { text: 'Cookie reading and writing', supported: true },
    { text: 'Error middleware (4-argument functions)', supported: true },
    { text: 'Path-scoped middleware via app.use(path, fn)', supported: true },
    { text: 'This is an integration shim, not a reimplementation of Express: it exists so existing middleware runs on Bun, and covers the surface middleware actually touches', supported: true },
    { text: 'Content negotiation is approximate: req.accepts() and res.format() do not rank by q-value', supported: false },
    { text: 'req.range() is not implemented and always returns undefined', supported: false },
    { text: 'Signed cookies are not supported — no req.signedCookies, no signed option', supported: false },
    { text: 'req.ip and req.ips do not trust X-Forwarded-* headers unless trustProxy is enabled', supported: false },
    { text: 'The response object is not a Node stream or EventEmitter: no write, on, once, emit, writeHead or flush', supported: false },
    { text: 'There is no res.sendFile() — open the file with Bun.file() and pass it to res.send()', supported: false },
    { text: 'View engines and @Render() are not supported', supported: false },
  ];
}
