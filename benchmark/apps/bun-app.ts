import "reflect-metadata";
// Import through the package name (linked via `"@lexmata/nestjs-platform-bun":
// "file:.."`) rather than ../../src, so the benchmark measures the *built*
// package - the thing users actually install - and not untranspiled TypeScript.
import { NestBunFactory } from "@lexmata/nestjs-platform-bun";
import { BenchmarkModule } from "./shared.module";

const PORT = parseInt(process.env.PORT ?? "4003", 10);

async function bootstrap() {
  const app = await NestBunFactory.create(BenchmarkModule, {
    logger: false, // Disable logging for benchmark accuracy
  });

  await app.listen(PORT);
  console.log(`Bun app listening on port ${PORT}`);
}

bootstrap().catch(console.error);
