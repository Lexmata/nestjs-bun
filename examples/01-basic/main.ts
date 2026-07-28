import "reflect-metadata";
import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
// Imported by package name (linked via `"@lexmata/nestjs-platform-bun": "file:.."`)
// so the example exercises the built artifact users install.
import { NestBunFactory } from "@lexmata/nestjs-platform-bun";

@Controller()
class AppController {
  @Get()
  hello(): string {
    return "Hello from Bun!";
  }

  @Get("users/:id")
  findUser(@Param("id") id: string): object {
    return { id, name: `User ${id}` };
  }

  @Post("echo")
  echo(@Body() body: unknown): object {
    return { received: body };
  }

  // @Header() sets a response header without touching the response object.
  @Get("cached")
  @Header("Cache-Control", "max-age=3600")
  cached(): object {
    return { cached: true };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const PORT = Number(process.env.PORT ?? 3000);

const app = await NestBunFactory.create(AppModule);
await app.listen(PORT);
console.log(`01-basic listening on http://localhost:${PORT}`);

// curl http://localhost:3000/
// curl http://localhost:3000/users/42
// curl -X POST http://localhost:3000/echo -H 'content-type: application/json' -d '{"a":1}'
// curl -i http://localhost:3000/cached   # -> Cache-Control: max-age=3600
