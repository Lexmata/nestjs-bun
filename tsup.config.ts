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
  // `sourcesContent` is left at its default (true) so each sourcemap embeds the
  // TypeScript it maps to. The package ships `dist` only, so a map carrying
  // bare relative `sources` paths would resolve to nothing on a consumer's disk
  // and minified stack traces would not symbolicate.
});
