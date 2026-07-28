import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-api-factory',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="max-w-4xl mx-auto px-6 py-12 animate-fade-in">
      <h1 class="text-4xl font-bold mb-4">NestBunFactory</h1>
      <p class="text-text-secondary text-lg mb-8">
        The factory class for creating NestJS applications with the Bun HTTP adapter.
      </p>

      <!-- create() -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">create()</h2>
        <p class="text-text-secondary mb-4">
          Creates a new NestJS application instance using the Bun adapter.
        </p>

        <h3 class="text-lg font-semibold mb-3">Signature</h3>
        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto mb-6">
          <pre><code class="text-sm"><span class="token-keyword">static async</span> <span class="token-function">create</span>(
  module: <span class="token-variable">Type</span>&#60;<span class="token-variable">any</span>&#62;,
  options?: <span class="token-variable">NestBunApplicationOptions</span>
): <span class="token-variable">Promise</span>&#60;<span class="token-variable">INestApplication</span>&#62;</code></pre>
        </div>

        <h3 class="text-lg font-semibold mb-3">Parameters</h3>
        <div class="bg-bg-secondary rounded-xl border border-border overflow-hidden mb-6">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-bg-tertiary border-b border-border">
                <th class="px-4 py-3 text-left text-text-muted font-medium">Parameter</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Type</th>
                <th class="px-4 py-3 text-left text-text-muted font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-border">
                <td class="px-4 py-3 font-mono text-nest-red">module</td>
                <td class="px-4 py-3 text-text-secondary font-mono text-xs">Type&#60;any&#62;</td>
                <td class="px-4 py-3 text-text-secondary">The root module of your application</td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-mono text-nest-red">options</td>
                <td class="px-4 py-3 text-text-secondary font-mono text-xs">NestBunApplicationOptions</td>
                <td class="px-4 py-3 text-text-secondary">Optional configuration options</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="text-lg font-semibold mb-3">Example</h3>
        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
          <pre><code class="text-sm"><span class="token-keyword">import</span> &#123; NestBunFactory &#125; <span class="token-keyword">from</span> <span class="token-string">'@lexmata/nestjs-platform-bun'</span>;
<span class="token-keyword">import</span> &#123; AppModule &#125; <span class="token-keyword">from</span> <span class="token-string">'./app.module'</span>;

<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  logger: [<span class="token-string">'log'</span>, <span class="token-string">'error'</span>, <span class="token-string">'warn'</span>],
  cors: <span class="token-keyword">true</span>,
&#125;);</code></pre>
        </div>
      </section>

      <!-- Options -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">NestBunApplicationOptions</h2>
        <p class="text-text-secondary mb-4">
          Configuration options for creating a NestJS Bun application.
        </p>

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
              @for (option of options; track option.name) {
                <tr class="border-b border-border last:border-0">
                  <td class="px-4 py-3 font-mono text-nest-red">{{ option.name }}</td>
                  <td class="px-4 py-3 text-text-secondary font-mono text-xs">{{ option.type }}</td>
                  <td class="px-4 py-3 text-text-muted">{{ option.default }}</td>
                  <td class="px-4 py-3 text-text-secondary">{{ option.description }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <h3 class="text-lg font-semibold mt-8 mb-3">Options with no effect</h3>
        <p class="text-text-secondary mb-4">
          These are accepted by the type but ignored at runtime. Full detail on the
          <a routerLink="/api/config" class="text-nest-red hover:underline">Configuration</a> page.
        </p>
        <div class="space-y-3">
          @for (item of ignoredOptions; track item.name) {
            <div class="p-4 bg-bg-tertiary rounded-lg border border-border">
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

      <!-- Logger Options -->
      <section class="mb-12">
        <h2 class="text-2xl font-bold mb-4">Logger Configuration</h2>
        <p class="text-text-secondary mb-4">
          Configure what log levels are output.
        </p>

        <div class="bg-bg-code rounded-lg border border-border p-4 overflow-x-auto">
          <pre><code class="text-sm"><span class="token-comment">// Disable all logging</span>
<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  logger: <span class="token-keyword">false</span>
&#125;);

<span class="token-comment">// Only errors and warnings</span>
<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  logger: [<span class="token-string">'error'</span>, <span class="token-string">'warn'</span>]
&#125;);

<span class="token-comment">// Custom logger</span>
<span class="token-keyword">const</span> app = <span class="token-keyword">await</span> NestBunFactory.<span class="token-function">create</span>(AppModule, &#123;
  logger: <span class="token-keyword">new</span> <span class="token-function">MyCustomLogger</span>()
&#125;);</code></pre>
        </div>
      </section>

      <!-- Return Value -->
      <section class="p-6 bg-bg-secondary rounded-xl border border-border">
        <h2 class="text-xl font-bold mb-4">Return Value</h2>
        <p class="text-text-secondary mb-4">
          Returns a Promise that resolves to an <code>INestApplication</code> instance with these methods:
        </p>
        <div class="grid sm:grid-cols-2 gap-4">
          @for (method of returnMethods; track method.name) {
            <div class="p-3 bg-bg-tertiary rounded-lg">
              <code class="text-nest-red font-mono text-sm">{{ method.name }}</code>
              <p class="text-text-secondary text-sm mt-1">{{ method.description }}</p>
            </div>
          }
        </div>
      </section>
    </article>
  `,
})
export class ApiFactoryComponent {
  options = [
    { name: 'logger', type: 'LogLevel[] | false | LoggerService', default: 'all levels', description: 'Configure logging behaviour' },
    { name: 'cors', type: 'boolean | CorsOptions', default: 'false', description: 'Enable and configure CORS' },
    { name: 'abortOnError', type: 'boolean', default: 'true', description: 'Abort bootstrap on first error' },
    { name: 'rawBody', type: 'boolean', default: 'false', description: 'Also expose the untouched bytes on req.rawBody as a Buffer' },
    { name: 'httpsOptions', type: 'TlsOptions', default: 'undefined', description: "TLS key/cert, mapped onto Bun's tls option" },
    { name: 'serverOptions', type: 'BunServerOptions', default: 'undefined', description: 'Bun server settings forwarded to Bun.serve()' },
  ];

  ignoredOptions = [
    { name: 'bodyParser', reason: 'Overridden to false by the factory and ignored by the adapter, which always parses bodies natively. Body parsing cannot be disabled.' },
  ];

  returnMethods = [
    { name: 'listen(port)', description: 'Start the HTTP server' },
    { name: 'close()', description: 'Shutdown the server' },
    { name: 'use(middleware)', description: 'Register global middleware' },
    { name: 'enableCors()', description: 'Enable CORS' },
    { name: 'setGlobalPrefix()', description: 'Set route prefix' },
    { name: 'getHttpAdapter()', description: 'Get BunAdapter instance' },
  ];
}
