import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-adapter',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Bun Adapter</h1>
      <p class="text-text-secondary text-lg mb-8">
        The core adapter that bridges NestJS with Bun's native HTTP server.
      </p>

      <!-- Overview -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Overview</h2>
        <p class="text-text-secondary mb-4">
          The <code>BunAdapter</code> extends NestJS's <code>AbstractHttpAdapter</code> and serves
          every request from <code>Bun.serve()</code>. It owns routing, the request/response
          lifecycle and middleware execution itself — there is no Express or Fastify instance
          underneath.
        </p>
        <div class="p-4 mb-4 bg-bun-orange/10 border border-bun-orange/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>🥟 Bun only.</strong>
            The adapter calls <code>Bun.serve()</code> and <code>Bun.file()</code> directly and has
            no Node.js fallback. Start your app with <code>bun run</code>.
          </p>
        </div>
        <div class="p-4 bg-nest-red/10 border border-nest-red/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>Note:</strong> Because the adapter reimplements the HTTP layer rather than
            wrapping Express, compatibility with Express and Fastify middleware is limited to the
            surface documented on the compatibility pages. Anything reaching for Node stream or
            <code>EventEmitter</code> APIs on <code>req</code>/<code>res</code> will not work.
          </p>
        </div>
      </section>

      <!-- NestBunFactory -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">NestBunFactory</h2>
        <p class="text-text-secondary mb-4">
          The factory class for creating NestJS applications with the Bun adapter.
        </p>

        <h3 class="text-lg font-semibold mb-3">create()</h3>
        <div class="bg-bg-code rounded-lg border border-border overflow-hidden mb-4">
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;

<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  logger: [<span class="token-string">'error'</span>, <span class="token-string">'warn'</span>],  <span class="token-comment">// Logging levels</span>
  cors: <span class="token-keyword">true</span>,                    <span class="token-comment">// Enable CORS</span>
&#125;);</code></pre>
        </div>

        <div class="p-4 mb-4 bg-nest-red/10 border border-nest-red/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>Body parsing is not configurable.</strong>
            The adapter always parses request bodies natively from Bun's <code>Request</code>,
            and <code>NestBunFactory</code> always passes <code>bodyParser: false</code> down to
            <code>NestFactory</code> so NestJS does not stack its own parser on top. The
            <code>bodyParser</code> option therefore has no effect. Set <code>rawBody: true</code>
            if you also need the untouched bytes on <code>req.rawBody</code>.
          </p>
        </div>

        <h3 class="text-lg font-semibold mb-3">Options</h3>
        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-bg-tertiary border-b border-border">
                <th class="px-4 py-3 text-left text-text-muted font-medium">Option</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Type</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Default</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-border">
                <td class="px-4 py-3 font-mono text-nest-red">logger</td>
                <td class="px-4 py-3 text-text-secondary">LogLevel[] | false</td>
                <td class="px-4 py-3 text-text-muted">true</td>
                <td class="px-4 py-3 text-text-secondary">Configure logging</td>
              </tr>
              <tr class="border-b border-border">
                <td class="px-4 py-3 font-mono text-nest-red">cors</td>
                <td class="px-4 py-3 text-text-secondary">boolean | CorsOptions</td>
                <td class="px-4 py-3 text-text-muted">false</td>
                <td class="px-4 py-3 text-text-secondary">CORS configuration</td>
              </tr>
              <tr class="border-b border-border">
                <td class="px-4 py-3 font-mono text-nest-red">abortOnError</td>
                <td class="px-4 py-3 text-text-secondary">boolean</td>
                <td class="px-4 py-3 text-text-muted">true</td>
                <td class="px-4 py-3 text-text-secondary">Throw instead of exiting when bootstrap fails</td>
              </tr>
              <tr class="border-b border-border">
                <td class="px-4 py-3 font-mono text-nest-red">httpsOptions</td>
                <td class="px-4 py-3 text-text-secondary">TlsOptions</td>
                <td class="px-4 py-3 text-text-muted">undefined</td>
                <td class="px-4 py-3 text-text-secondary">TLS key/cert, mapped onto Bun's tls option</td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-mono text-nest-red">serverOptions</td>
                <td class="px-4 py-3 text-text-secondary">BunServerOptions</td>
                <td class="px-4 py-3 text-text-muted">undefined</td>
                <td class="px-4 py-3 text-text-secondary">
                  Bun-specific settings forwarded to <code>Bun.serve()</code> — TLS, unix socket,
                  body size limits, development mode
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="text-text-secondary text-sm mt-4">
          See the
          <a routerLink="/api/config" class="text-nest-red hover:underline">Configuration</a>
          page for every <code>BunServerOptions</code> field and worked TLS and unix-socket
          examples.
        </p>
      </section>

      <!-- Application Methods -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Application Methods</h2>

        <div class="space-y-6">
          <!-- listen -->
          <div class="bg-bg-secondary rounded-xl border border-border p-6">
            <h3 class="text-lg font-semibold mb-2 font-mono text-nest-red">listen(port, hostname?)</h3>
            <p class="text-text-secondary mb-4">Starts the HTTP server on the specified port.</p>
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="token-comment">// Listen on port 3000</span>
<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);

<span class="token-comment">// Listen on specific hostname</span>
<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>, <span class="token-string">'0.0.0.0'</span>);

<span class="token-comment">// Listen with callback</span>
<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>, () => &#123;
  console.<span class="token-function">log</span>(<span class="token-string">'Server started'</span>);
&#125;);</code></pre>
            </div>
          </div>

          <!-- enableCors -->
          <div class="bg-bg-secondary rounded-xl border border-border p-6">
            <h3 class="text-lg font-semibold mb-2 font-mono text-nest-red">enableCors(options?)</h3>
            <p class="text-text-secondary mb-4">Enables CORS with optional configuration.</p>
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="token-comment">// Enable with defaults</span>
app.<span class="token-function">enableCors</span>();

<span class="token-comment">// Custom configuration</span>
app.<span class="token-function">enableCors</span>(&#123;
  origin: <span class="token-string">'https://example.com'</span>,
  methods: [<span class="token-string">'GET'</span>, <span class="token-string">'POST'</span>],
  credentials: <span class="token-keyword">true</span>,
  maxAge: <span class="token-number">86400</span>
&#125;);</code></pre>
            </div>
          </div>

          <!-- setGlobalPrefix -->
          <div class="bg-bg-secondary rounded-xl border border-border p-6">
            <h3 class="text-lg font-semibold mb-2 font-mono text-nest-red">setGlobalPrefix(prefix)</h3>
            <p class="text-text-secondary mb-4">Sets a global prefix for all routes.</p>
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="token-comment">// All routes will be prefixed with /api</span>
app.<span class="token-function">setGlobalPrefix</span>(<span class="token-string">'api'</span>);

<span class="token-comment">// /users becomes /api/users</span></code></pre>
            </div>
          </div>

          <!-- use -->
          <div class="bg-bg-secondary rounded-xl border border-border p-6">
            <h3 class="text-lg font-semibold mb-2 font-mono text-nest-red">use(middleware)</h3>
            <p class="text-text-secondary mb-4">Registers global middleware.</p>
            <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
              <pre><code class="text-sm"><span class="token-comment">// Global middleware</span>
app.<span class="token-function">use</span>((req, res, next) => &#123;
  console.<span class="token-function">log</span>(<span class="token-string">\`\$&#123;req.method&#125; \$&#123;req.path&#125;\`</span>);
  <span class="token-function">next</span>();
&#125;);

<span class="token-comment">// Path-specific middleware</span>
app.<span class="token-function">use</span>(<span class="token-string">'/api'</span>, authMiddleware);</code></pre>
            </div>
          </div>
        </div>
      </section>

      <!-- Request/Response -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Request & Response</h2>
        <p class="text-text-secondary mb-4">
          The adapter provides Express-compatible request and response objects.
        </p>

        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
            <span class="text-text-muted text-sm">Controller Example</span>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm">&#64;<span class="token-function">Controller</span>(<span class="token-string">'users'</span>)
<span class="token-keyword">export class</span> <span class="token-variable">UsersController</span> &#123;
  &#64;<span class="token-function">Get</span>(<span class="token-string">':id'</span>)
  <span class="token-function">getUser</span>(
    &#64;<span class="token-function">Param</span>(<span class="token-string">'id'</span>) id: <span class="token-variable">string</span>,
    &#64;<span class="token-function">Query</span>(<span class="token-string">'include'</span>) include?: <span class="token-variable">string</span>,
    &#64;<span class="token-function">Headers</span>(<span class="token-string">'authorization'</span>) auth?: <span class="token-variable">string</span>
  ) &#123;
    <span class="token-keyword">return</span> &#123; id, include, auth &#125;;
  &#125;

  &#64;<span class="token-function">Post</span>()
  <span class="token-function">createUser</span>(
    &#64;<span class="token-function">Body</span>() body: CreateUserDto,
    &#64;<span class="token-function">Ip</span>() ip: <span class="token-variable">string</span>
  ) &#123;
    <span class="token-keyword">return</span> &#123; ...body, ip &#125;;
  &#125;

  &#64;<span class="token-function">Get</span>(<span class="token-string">'download'</span>)
  <span class="token-function">downloadFile</span>(&#64;<span class="token-function">Res</span>() res: ExpressResponse) &#123;
    <span class="token-comment">// Sets Content-Disposition and infers Content-Type from the extension</span>
    res.<span class="token-function">attachment</span>(<span class="token-string">'report.pdf'</span>);

    <span class="token-comment">// Bun.file() returns a Blob, which send() streams as-is</span>
    res.<span class="token-function">send</span>(Bun.<span class="token-function">file</span>(<span class="token-string">'/path/to/report.pdf'</span>));
  &#125;
&#125;</code></pre>
        </div>

        <div class="p-4 mt-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>⚠ There is no <code>res.sendFile()</code>.</strong>
            The response shim implements the subset listed on the
            <a routerLink="/express-compat" class="text-nest-red hover:underline">Express Compatibility</a>
            page; path-resolving file helpers are not part of it. Open the file yourself with
            <code>Bun.file()</code> as above — <code>res.send()</code> accepts
            <code>Blob</code>, <code>ArrayBuffer</code>, typed arrays and
            <code>ReadableStream</code> directly. Note that nothing here validates the path, so
            never interpolate user input into it.
          </p>
        </div>
      </section>

      <!-- Not supported -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Not Supported</h2>
        <p class="text-text-secondary mb-4">
          These parts of the NestJS HTTP surface are not implemented by this adapter:
        </p>
        <div class="space-y-3">
          @for (item of unsupported; track item.name) {
            <div class="p-4 bg-bg-secondary rounded-lg border border-border">
              <div class="flex items-start gap-3">
                <span class="text-yellow-400 mt-0.5">⚠</span>
                <div>
                  <code class="text-nest-red font-mono text-sm">{{ item.name }}</code>
                  <p class="text-text-secondary text-sm mt-1">{{ item.reason }}</p>
                </div>
              </div>
            </div>
          }
        </div>
      </section>

      <!-- Lifecycle -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Server Lifecycle</h2>
        <div class="space-y-4">
          <div class="flex items-center gap-4">
            <div class="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-sm font-bold">1</div>
            <div>
              <div class="font-semibold text-text-primary">Create Application</div>
              <div class="text-text-secondary text-sm">NestBunFactory.create() initializes the adapter</div>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <div class="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-bold">2</div>
            <div>
              <div class="font-semibold text-text-primary">Configure</div>
              <div class="text-text-secondary text-sm">Set up CORS, middleware, prefix, etc.</div>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <div class="w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-sm font-bold">3</div>
            <div>
              <div class="font-semibold text-text-primary">Listen</div>
              <div class="text-text-secondary text-sm">app.listen() starts Bun's HTTP server</div>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <div class="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-sm font-bold">4</div>
            <div>
              <div class="font-semibold text-text-primary">Handle Requests</div>
              <div class="text-text-secondary text-sm">Adapter routes requests through NestJS pipeline</div>
            </div>
          </div>
        </div>
      </section>
    </article>
  `,
})
export class AdapterComponent {
  unsupported = [
    {
      name: 'View engines / @Render()',
      reason:
        'setViewEngine() and render() throw. Server-side templating is not available — return data and render on the client, or put a templating service in front. This also rules out anything that depends on server-rendered views, and it means a @Render() route or a setViewEngine() call fails loudly at bootstrap rather than silently serving nothing.',
    },
    {
      name: 'res.sendFile()',
      reason:
        'Not part of the response shim. Use res.attachment(name) plus res.send(Bun.file(path)) — send() accepts Blob, ArrayBuffer, typed arrays and ReadableStream directly.',
    },
    {
      name: 'bodyParser',
      reason:
        'Inert. Bodies are always parsed natively and parsing cannot be disabled. (rawBody, by contrast, does work — it populates req.rawBody with a Buffer.)',
    },
    {
      name: 'Node stream and EventEmitter APIs on req/res',
      reason:
        'The shims expose no write(), on(), once(), emit(), writeHead() or flush(). Middleware that patches the response stream — compression is the common example — cannot work.',
    },
  ];
}
