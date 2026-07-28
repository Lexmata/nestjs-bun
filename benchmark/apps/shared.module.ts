import { Module, Controller, Get, Post, Body, Param, Injectable, Inject } from "@nestjs/common";

/**
 * Simple service for benchmark testing
 */
@Injectable()
export class BenchmarkService {
  private items: Map<string, { id: string; name: string; value: number }> = new Map();

  getHello(): string {
    return "Hello World!";
  }

  getJson(): object {
    return {
      message: "Hello World!",
      timestamp: Date.now(),
      nested: {
        foo: "bar",
        numbers: [1, 2, 3, 4, 5],
      },
    };
  }

  getItems(): object[] {
    return Array.from(this.items.values());
  }

  getItem(id: string): object | null {
    return this.items.get(id) ?? null;
  }

  createItem(data: { name: string; value: number }): object {
    const id = Math.random().toString(36).substring(2, 9);
    const item = { id, ...data };
    this.items.set(id, item);
    return item;
  }

  // CPU-intensive operation for stress testing
  fibonacci(n: number): number {
    if (n <= 1) return n;
    return this.fibonacci(n - 1) + this.fibonacci(n - 2);
  }

  // Memory allocation test
  allocateMemory(size: number): number[] {
    return new Array(size).fill(0).map((_, i) => i * 2);
  }
}

/**
 * Main benchmark controller
 */
@Controller()
export class BenchmarkController {
  // The token is stated explicitly rather than inferred from `design:paramtypes`.
  //
  // The Express and Fastify apps run under tsx, and esbuild (which tsx uses)
  // does not implement `emitDecoratorMetadata` - so type-inferred DI silently
  // resolves to `undefined` and every service-backed route returns HTTP 500.
  // Bun's transpiler *does* emit the metadata, so relying on inference would
  // compare a working Bun app against two permanently broken baselines.
  // Explicit injection makes all three adapters behave identically.
  constructor(@Inject(BenchmarkService) private readonly service: BenchmarkService) {}

  // Simple text response
  @Get()
  getHello(): string {
    return this.service.getHello();
  }

  // JSON response
  @Get("json")
  getJson(): object {
    return this.service.getJson();
  }

  // Path parameter
  @Get("users/:id")
  getUser(@Param("id") id: string): object {
    return { id, name: `User ${id}`, email: `user${id}@example.com` };
  }

  // POST with body
  @Post("items")
  createItem(@Body() body: { name: string; value: number }): object {
    return this.service.createItem(body);
  }

  // List items
  @Get("items")
  getItems(): object[] {
    return this.service.getItems();
  }

  // Get single item
  @Get("items/:id")
  getItem(@Param("id") id: string): object | null {
    return this.service.getItem(id);
  }

  // CPU stress test (light)
  @Get("cpu/light")
  cpuLight(): object {
    const result = this.service.fibonacci(20);
    return { result, operation: "fibonacci(20)" };
  }

  // CPU stress test (medium)
  @Get("cpu/medium")
  cpuMedium(): object {
    const result = this.service.fibonacci(30);
    return { result, operation: "fibonacci(30)" };
  }

  // Memory allocation test
  @Get("memory/:size")
  memoryTest(@Param("size") size: string): object {
    const numSize = parseInt(size, 10) || 1000;
    const data = this.service.allocateMemory(numSize);
    return { allocated: data.length, sum: data.reduce((a, b) => a + b, 0) };
  }

  // Health check
  @Get("health")
  health(): object {
    return { status: "ok", timestamp: Date.now() };
  }
}

/**
 * Shared benchmark module
 */
@Module({
  controllers: [BenchmarkController],
  providers: [BenchmarkService],
})
export class BenchmarkModule {}
