import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: true,
  // tsup 8 rewrites `node:events` to `events` by default. Bare builtin
  // specifiers are also real npm packages, so a consumer bundling for a
  // non-node platform resolves them to browserify shims and inlines ~20 KB.
  // `node:`-prefixed specifiers are unconditionally externalized instead.
  removeNodeProtocol: false,
  // Minification renames locals, and NestJS surfaces adapter and class names in
  // its own error messages. Keeping names costs ~0.5 KB and keeps those readable.
  keepNames: true,
  external: ["@nestjs/common", "@nestjs/core", "bun"],
  esbuildOptions(options) {
    // Ship the sources once via `files: ["src", ...]` in package.json rather
    // than embedding a byte-identical copy in each of the two sourcemaps. The
    // maps already carry relative `sources` paths, so both Node and Bun read
    // the original TypeScript off disk and stack traces still resolve.
    options.sourcesContent = false;
  },
});
