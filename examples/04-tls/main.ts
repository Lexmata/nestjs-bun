import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestBunFactory } from "@lexmata/nestjs-platform-bun";

@Controller()
class AppController {
  @Get()
  root(): object {
    return { secure: true, message: "served over TLS" };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const here = new URL(".", import.meta.url).pathname;
const keyFile = Bun.file(`${here}key.pem`);
const certFile = Bun.file(`${here}cert.pem`);

if (!(await keyFile.exists()) || !(await certFile.exists())) {
  console.error(
    "Missing key.pem / cert.pem. Generate a self-signed pair first:\n" +
      "  ./04-tls/generate-cert.sh\n" +
      "Certificates are gitignored and never committed."
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 3443);

// serverOptions is passed straight through to Bun.serve(), so `tls` here is
// Bun's own TLS config. This used to be dropped silently, leaving the server on
// plaintext HTTP while the app believed it was serving HTTPS.
const app = await NestBunFactory.create(AppModule, {
  serverOptions: {
    tls: {
      key: await keyFile.text(),
      cert: await certFile.text(),
    },
  },
});

await app.listen(PORT);
console.log(`04-tls listening on https://localhost:${PORT}`);

// curl -k https://localhost:3443/
