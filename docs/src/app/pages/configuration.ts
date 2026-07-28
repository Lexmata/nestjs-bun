import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface OptionRow {
  name: string;
  type: string;
  default: string;
  description: string;
}

@Component({
  selector: 'app-configuration',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">Configuration</h1>
      <p class="text-text-secondary text-lg mb-8">
        Everything you can pass to <code>NestBunFactory.create()</code>, and what the adapter
        does with it.
      </p>

      <!-- Shape -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">NestBunApplicationOptions</h2>
        <p class="text-text-secondary mb-4">
          <code>NestBunApplicationOptions</code> extends NestJS's
          <code>NestApplicationOptions</code> and adds a single Bun-specific member,
          <code>serverOptions</code>.
        </p>

        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto mb-6">
          <pre><code class="text-sm"><span class="token-keyword">interface</span> <span class="token-variable">NestBunApplicationOptions</span> <span class="token-keyword">extends</span> <span class="token-variable">NestApplicationOptions</span> &#123;
  <span class="token-comment">/** Bun-specific server options */</span>
  serverOptions?: <span class="token-variable">BunServerOptions</span>;
&#125;</code></pre>
        </div>

        <h3 class="text-lg font-semibold mb-3">Inherited NestJS options</h3>
        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden mb-4">
          <div class="overflow-x-auto">
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
                @for (option of nestOptions; track option.name) {
                  <tr class="border-b border-border last:border-0">
                    <td class="px-4 py-3 font-mono text-nest-red whitespace-nowrap">{{ option.name }}</td>
                    <td class="px-4 py-3 text-text-secondary font-mono text-xs">{{ option.type }}</td>
                    <td class="px-4 py-3 text-text-muted">{{ option.default }}</td>
                    <td class="px-4 py-3 text-text-secondary">{{ option.description }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Ignored options -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Options the Adapter Ignores</h2>
        <p class="text-text-secondary mb-4">
          These members exist on <code>NestApplicationOptions</code> but have no effect here.
          Setting them is harmless and silently does nothing — do not rely on them.
        </p>
        <div class="space-y-3">
          @for (item of ignoredOptions; track item.name) {
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

      <!-- BunServerOptions -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">BunServerOptions</h2>
        <p class="text-text-secondary mb-4">
          Bun-specific settings, forwarded to <code>Bun.serve()</code> when the application
          starts listening.
        </p>

        <div class="p-4 mb-6 bg-bg-tertiary border border-border rounded-lg">
          <p class="text-text-secondary text-sm">
            Most fields below are read in <code>listen()</code> and passed through to
            <code>Bun.serve()</code>; the ones marked <em>adapter-level</em> change how the
            adapter itself behaves and never reach <code>Bun.serve()</code>. Fields you leave
            undefined are omitted entirely, so Bun's own defaults apply. Note that there is no
            <code>port</code> or <code>hostname</code> here — the address comes from
            <code>app.listen()</code>, and <code>unix</code> is the only thing that overrides it.
          </p>
        </div>

        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden mb-6">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-bg-tertiary border-b border-border">
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Field</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Type</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Default</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                @for (field of serverOptionFields; track field.name) {
                  <tr class="border-b border-border last:border-0">
                    <td class="px-4 py-3 font-mono text-nest-red whitespace-nowrap">{{ field.name }}</td>
                    <td class="px-4 py-3 text-text-secondary font-mono text-xs">{{ field.type }}</td>
                    <td class="px-4 py-3 text-text-muted whitespace-nowrap">{{ field.default }}</td>
                    <td class="px-4 py-3 text-text-secondary">{{ field.description }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <h3 class="text-lg font-semibold mb-3">TLS</h3>
        <p class="text-text-secondary mb-4">
          The <code>tls</code> object mirrors Bun's TLS configuration:
        </p>
        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto mb-4">
          <pre><code class="text-sm">tls?: &#123;
  key?: <span class="token-variable">string</span> | <span class="token-variable">Buffer</span> | <span class="token-variable">Array</span>&#60;<span class="token-variable">string</span> | <span class="token-variable">Buffer</span>&#62;;
  cert?: <span class="token-variable">string</span> | <span class="token-variable">Buffer</span> | <span class="token-variable">Array</span>&#60;<span class="token-variable">string</span> | <span class="token-variable">Buffer</span>&#62;;
  ca?: <span class="token-variable">string</span> | <span class="token-variable">Buffer</span> | <span class="token-variable">Array</span>&#60;<span class="token-variable">string</span> | <span class="token-variable">Buffer</span>&#62;;
  passphrase?: <span class="token-variable">string</span>;
&#125;;</code></pre>
        </div>
        <p class="text-text-secondary mb-4">
          You can configure it either through <code>serverOptions.tls</code> or through NestJS's
          standard <code>httpsOptions</code> — the adapter maps the latter onto the former.
          <code>serverOptions.tls</code> wins if both are present, and <code>httpsOptions</code>
          is only used when it supplies at least a <code>key</code> or a <code>cert</code>.
        </p>
        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto mb-6">
          <pre><code class="text-sm"><span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  serverOptions: &#123;
    tls: &#123;
      key: <span class="token-keyword">await</span> Bun.<span class="token-function">file</span>(<span class="token-string">'./certs/key.pem'</span>).<span class="token-function">text</span>(),
      cert: <span class="token-keyword">await</span> Bun.<span class="token-function">file</span>(<span class="token-string">'./certs/cert.pem'</span>).<span class="token-function">text</span>(),
    &#125;,
  &#125;,
&#125;);

<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">443</span>);</code></pre>
        </div>

        <h3 class="text-lg font-semibold mb-3">Unix sockets</h3>
        <p class="text-text-secondary mb-4">
          Setting <code>unix</code> replaces the TCP binding entirely — the port and hostname
          passed to <code>listen()</code> are ignored:
        </p>
        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
          <pre><code class="text-sm"><span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  serverOptions: &#123; unix: <span class="token-string">'/tmp/app.sock'</span> &#125;,
&#125;);

<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">0</span>); <span class="token-comment">// port is ignored</span></code></pre>
        </div>

        <h3 class="text-lg font-semibold mt-8 mb-3">trustProxy</h3>
        <p class="text-text-secondary mb-4">
          <code>trustProxy</code> decides whether <code>X-Forwarded-For</code>,
          <code>X-Forwarded-Proto</code> and <code>X-Forwarded-Host</code> are honoured when the
          adapter derives <code>req.ip</code>, <code>req.ips</code>, <code>req.protocol</code>
          and <code>req.hostname</code>. It defaults to <code>false</code>.
        </p>

        <div class="p-4 mb-6 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p class="text-text-primary text-sm">
            <strong>⚠ Enabling this means trusting a client-supplied header.</strong>
            <code>X-Forwarded-*</code> is just a request header: anything that can open a
            connection can set it to whatever it likes. Turn <code>trustProxy</code> on only when
            a proxy you control sits in front of the app and <em>overwrites</em> these headers on
            every request. Switch it on with the app directly reachable and any caller can choose
            its own <code>req.ip</code> — which is exactly the value rate limiters, audit logs and
            IP allow-lists are usually built on.
          </p>
        </div>

        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden mb-4">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-bg-tertiary border-b border-border">
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Value</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Behaviour</th>
                </tr>
              </thead>
              <tbody>
                @for (mode of trustProxyModes; track mode.value) {
                  <tr class="border-b border-border last:border-0">
                    <td class="px-4 py-3 font-mono text-nest-red whitespace-nowrap">{{ mode.value }}</td>
                    <td class="px-4 py-3 text-text-secondary">{{ mode.behaviour }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <p class="text-text-secondary mb-4">
          Prefer the numeric form. It matches Express's numeric <code>trust proxy</code>
          semantics: you state how many proxies of your own are in front of the app, and the
          adapter counts in from the right — past exactly those hops — instead of believing the
          left-most entry, which is the one the client wrote.
        </p>

        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
          <pre><code class="text-sm"><span class="token-comment">// One proxy in front (an ALB, say) that appends the real client address.</span>
<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  serverOptions: &#123; trustProxy: <span class="token-number">1</span> &#125;,
&#125;);</code></pre>
        </div>
      </section>

      <!-- Port and hostname -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Port and Hostname</h2>
        <p class="text-text-secondary mb-4">
          Port and hostname are taken from <code>app.listen()</code>, and from nowhere else. The
          hostname defaults to <code>0.0.0.0</code> when omitted. There is deliberately no
          <code>serverOptions.port</code> or <code>serverOptions.hostname</code>: an option that
          <code>listen()</code> never reads would look like a fallback and silently not be one.
        </p>
        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
          <pre><code class="text-sm"><span class="token-comment">// Port only — binds 0.0.0.0</span>
<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>);

<span class="token-comment">// Explicit hostname</span>
<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>, <span class="token-string">'127.0.0.1'</span>);

<span class="token-comment">// With a callback</span>
<span class="token-keyword">await</span> app.<span class="token-function">listen</span>(<span class="token-number">3000</span>, () => &#123;
  console.<span class="token-function">log</span>(<span class="token-string">'listening'</span>);
&#125;);</code></pre>
        </div>
      </section>

      <!-- Body parsing -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Body Parsing</h2>
        <p class="text-text-secondary mb-4">
          There is nothing to configure. The adapter reads and parses the request body natively
          from Bun's <code>Request</code> on every request that has one, dispatching on
          <code>Content-Type</code>:
        </p>
        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden mb-4">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-bg-tertiary border-b border-border">
                  <th class="px-4 py-3 text-left text-text-muted font-medium">Content-Type</th>
                  <th class="px-4 py-3 text-left text-text-muted font-medium">req.body becomes</th>
                </tr>
              </thead>
              <tbody>
                @for (row of bodyTypes; track row.contentType) {
                  <tr class="border-b border-border last:border-0">
                    <td class="px-4 py-3 font-mono text-nest-red text-xs">{{ row.contentType }}</td>
                    <td class="px-4 py-3 text-text-secondary">{{ row.result }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <p class="text-text-secondary text-sm">
          <code>NestBunFactory</code> always passes <code>bodyParser: false</code> to
          <code>NestFactory</code> so that NestJS does not try to install its own
          <code>body-parser</code> middleware on top. Registering
          <code>express.json()</code> yourself is redundant — see the
          Express Compatibility page.
        </p>
      </section>

      <!-- Example -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Full Example</h2>
        <div class="bg-bg-code rounded-lg border border-border overflow-hidden">
          <div class="flex items-center px-4 py-2 bg-bg-secondary border-b border-border">
            <span class="text-text-muted text-sm">main.ts</span>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm"><span class="token-keyword">import</span> <span class="token-string">'reflect-metadata'</span>;
<span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'&#64;lexmata/nestjs-platform-bun'</span>;
<span class="token-keyword">import</span> &#123; AppModule &#125; <span class="token-keyword">from</span> <span class="token-string">'./app.module'</span>;

<span class="token-keyword">async function</span> <span class="token-function">bootstrap</span>() &#123;
  <span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
    logger: [<span class="token-string">'error'</span>, <span class="token-string">'warn'</span>, <span class="token-string">'log'</span>],
    cors: <span class="token-keyword">true</span>,
    abortOnError: <span class="token-keyword">false</span>,
  &#125;);

  app.<span class="token-function">setGlobalPrefix</span>(<span class="token-string">'api'</span>);

  <span class="token-keyword">await</span> app.<span class="token-function">listen</span>(process.env.PORT ?? <span class="token-number">3000</span>, <span class="token-string">'0.0.0.0'</span>);
&#125;

<span class="token-function">bootstrap</span>();</code></pre>
        </div>
      </section>

      <!-- Runtime -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Runtime Requirement</h2>
        <p class="text-text-secondary text-sm">
          This adapter calls <code>Bun.serve()</code> and <code>Bun.file()</code> directly. It
          runs on Bun and only on Bun — the package declares
          <code>"engines": &#123; "bun": "&gt;=1.0.0" &#125;</code> and there is no Node.js fallback.
          Start your application with <code>bun run</code>, never <code>node</code>.
        </p>
      </section>
    </article>
  `,
})
export class ConfigurationComponent {
  nestOptions: OptionRow[] = [
    {
      name: 'logger',
      type: 'LogLevel[] | false | LoggerService',
      default: 'all levels',
      description: 'Standard NestJS logger configuration. Handled entirely by NestJS core.',
    },
    {
      name: 'cors',
      type: 'boolean | CorsOptions',
      default: 'false',
      description:
        'When set, NestJS calls the adapter\'s enableCors(), which installs a CORS middleware handling origin, methods, allowed/exposed headers, credentials, max-age and preflight.',
    },
    {
      name: 'abortOnError',
      type: 'boolean',
      default: 'true',
      description: 'Throw instead of exiting when bootstrap fails. Handled by NestJS core.',
    },
    {
      name: 'rawBody',
      type: 'boolean',
      default: 'false',
      description:
        'Keep the untouched request bytes on req.rawBody (a Buffer) alongside the parsed req.body. Costs a clone of every request that has a body — enable it only where you need it, such as webhook signature verification.',
    },
    {
      name: 'serverOptions',
      type: 'BunServerOptions',
      default: 'undefined',
      description: 'Bun-specific server settings, forwarded to Bun.serve(). See below.',
    },
    {
      name: 'httpsOptions',
      type: '{ key, cert, ca?, passphrase? }',
      default: 'undefined',
      description:
        "Standard NestJS TLS configuration. The adapter maps it onto Bun's tls option, so it works as documented by NestJS. serverOptions.tls takes precedence if both are given.",
    },
  ];

  ignoredOptions = [
    {
      name: 'bodyParser',
      reason:
        'NestBunFactory always overrides this to false after spreading your options, and the adapter parses bodies natively regardless of the value. Body parsing cannot be turned off.',
    },
  ];

  serverOptionFields: OptionRow[] = [
    { name: 'unix', type: 'string', default: 'undefined', description: 'Unix socket path. When set it replaces port and hostname entirely — the port passed to listen() is ignored.' },
    { name: 'development', type: 'boolean', default: "Bun's default", description: "Enable Bun's development mode for more verbose error pages." },
    { name: 'maxRequestBodySize', type: 'number', default: "Bun's default", description: 'Maximum accepted request body size, in bytes.' },
    { name: 'tls', type: 'object', default: 'undefined', description: 'TLS key/cert/ca/passphrase for serving HTTPS directly. Takes precedence over httpsOptions.' },
    { name: 'lowMemoryMode', type: 'boolean', default: "Bun's default", description: "Trade throughput for a smaller memory footprint in Bun's server." },
    {
      name: 'trustProxy',
      type: 'boolean | number',
      default: 'false',
      description:
        'Whether to honour X-Forwarded-For, X-Forwarded-Proto and X-Forwarded-Host when deriving req.ip, req.ips, req.protocol and req.hostname. These headers are supplied by the client, so enabling this means trusting what the caller sends. See the note below before turning it on. Adapter-level — not passed to Bun.serve().',
    },
    {
      name: 'middlewareTimeout',
      type: 'number',
      default: '30000',
      description:
        'How long, in milliseconds, a single Express middleware may run without calling next() or ending the response before the request fails with a 500. Express waits forever; this bounds it. Adapter-level — not passed to Bun.serve().',
    },
  ];

  trustProxyModes = [
    {
      value: 'false',
      behaviour:
        'The default. Proxy headers are ignored entirely — req.ip is the real socket address, req.ips is empty, and req.protocol/req.hostname come from the connection itself.',
    },
    {
      value: 'true',
      behaviour:
        'Trust the whole chain and take the left-most entry of X-Forwarded-For. That entry is whatever the original caller wrote, so any client on a direct connection can forge it. Prefer a hop count.',
    },
    {
      value: 'n (a positive integer)',
      behaviour:
        'Trust the last n entries as your own proxies and take the n-th entry counting from the right — the address the outermost proxy you control actually saw. 1 selects the right-most entry. Matches Express\'s numeric trust proxy setting.',
    },
  ];

  bodyTypes = [
    { contentType: 'application/json', result: 'the parsed JSON value' },
    { contentType: 'application/x-www-form-urlencoded', result: 'a plain object of decoded field/value pairs' },
    {
      contentType: 'multipart/form-data',
      result: 'a plain object keyed by field name — values are strings or File instances. Note this is an object, not a FormData: use body.file, not body.get("file"). Repeated field names collapse to the last value.',
    },
    { contentType: 'text/*', result: 'the body as a string' },
    { contentType: 'anything else (or no Content-Type)', result: 'undefined — read req.raw yourself for binary payloads' },
  ];
}
