# Documentation site

The documentation site for [`@lexmata/nestjs-platform-bun`](https://github.com/Lexmata/nestjs-bun) —
a NestJS HTTP adapter that runs on Bun's native server.

It is a standalone Angular 21 application with its own `package.json` and lockfile, so it is
**not** part of the root workspace. Install and build it from this directory.

## Prerequisites

- Node.js 20+ — the Angular CLI toolchain runs on Node. The *adapter* requires Bun; building
  these docs does not.
- pnpm — the project pins `pnpm@10.26.2` via `packageManager`.

## Setup

```bash
cd docs
pnpm install
```

## Development server

```bash
pnpm start
```

Serves on <http://localhost:4200/> with hot reload.

## Build

```bash
pnpm build
```

Emits the production bundle to `dist/`. This is what CI and any deploy step should run. It
type-checks every component template, so it is also the fastest way to catch a broken binding.

```bash
pnpm watch    # development build, rebuilding on change
```

## Tests

```bash
pnpm test
```

Runs unit tests under Vitest. There is no end-to-end suite — no e2e builder is configured, so
`ng e2e` will fail.

## Structure

| Path | Contents |
| --- | --- |
| `src/app/app.routes.ts` | Route table. Every page is lazily loaded. |
| `src/app/components/layout.ts` | Shell: sidebar navigation, header, router outlet. |
| `src/app/pages/` | One standalone component per documentation page, each with an inline template. |
| `src/app/site.ts` | Project identity constants — repository URL, package name, copyright. |
| `src/styles.css` | Tailwind 4 entry point and the `@theme` colour tokens. |
| `src/index.html` | Document shell and page metadata. |

## Adding a page

1. Add a standalone component under `src/app/pages/`.
2. Register a lazy route for it in `src/app/app.routes.ts`.
3. Add a nav entry to `navSections` in `src/app/components/layout.ts`.
4. Run `pnpm build` to confirm the template compiles.

## Editing guidance

These pages document the real behaviour of the adapter in `../src`. Before describing an
option, method or middleware as supported, check it against the implementation — parts of the
Express and Fastify compatibility layers are deliberately partial, and the pages call out what
is unsupported. Keep those caveats accurate rather than aspirational.

Repository URLs and the copyright line live in `src/app/site.ts`. Change them there rather than
in individual templates, and keep them in sync with the root `package.json` and `LICENSE`.
