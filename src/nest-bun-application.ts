import type { Server } from "bun";
import { NestFactory } from "@nestjs/core";
import type { INestApplication, Type } from "@nestjs/common";
import { BunAdapter } from "./bun-adapter";
import type { NestBunApplication, NestBunApplicationOptions } from "./interfaces";

/**
 * Factory class for creating NestJS applications with Bun HTTP adapter
 */
export class NestBunFactory {
  /**
   * Create a new NestJS application using Bun as the HTTP server
   *
   * @param module - The root module of the application
   * @param options - Optional configuration options. `serverOptions` is passed
   *   through to `Bun.serve()`, so TLS, unix sockets and body-size limits are
   *   configured there.
   * @returns A NestJS application configured for Bun
   *
   * @example
   * ```typescript
   * import { NestBunFactory } from '@lexmata/nestjs-platform-bun';
   * import { AppModule } from './app.module';
   *
   * async function bootstrap() {
   *   const app = await NestBunFactory.create(AppModule, {
   *     serverOptions: { maxRequestBodySize: 10 * 1024 * 1024 },
   *   });
   *   await app.listen(3000);
   *   console.log('Application is running on: http://localhost:3000');
   * }
   *
   * bootstrap();
   * ```
   */
  public static async create<T extends INestApplication = NestBunApplication>(
    module: Type<unknown>,
    options?: NestBunApplicationOptions
  ): Promise<T> {
    const adapter = new BunAdapter(undefined, options?.serverOptions);

    const app = await NestFactory.create(module, adapter, {
      ...options,
      // Bun parses request bodies natively in the adapter, so NestJS's own
      // parser middleware is redundant. `NestBunApplicationOptions` omits
      // `bodyParser` for this reason - it is not a user-settable option.
      bodyParser: false,
    });

    return app as T;
  }

  /**
   * Create a new NestJS application that serves through an existing Bun server.
   *
   * The supplied server is re-pointed at this application's request handler via
   * `server.reload()`, and `app.listen()` becomes a no-op for it - the server is
   * already listening on whatever port it was created with.
   *
   * @param module - The root module of the application
   * @param server - An existing Bun server instance
   * @param options - Optional configuration options
   * @returns A NestJS application configured for Bun
   */
  public static async createWithServer<T extends INestApplication = NestBunApplication>(
    module: Type<unknown>,
    server: Server<unknown>,
    options?: NestBunApplicationOptions
  ): Promise<T> {
    const adapter = new BunAdapter(server, options?.serverOptions);

    const app = await NestFactory.create(module, adapter, {
      ...options,
      bodyParser: false,
    });

    return app as T;
  }
}
