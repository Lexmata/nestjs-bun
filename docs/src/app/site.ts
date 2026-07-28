/**
 * Single source of truth for project identity used across the documentation site.
 *
 * Keep these in sync with the root `package.json` (`version`, `repository.url`,
 * `author`) and `LICENSE`. Nothing here is generated: `VERSION` in particular
 * has to be bumped by hand alongside `package.json`, which is exactly why it
 * lives here once instead of being retyped in the sidebar, the hero badge and
 * the feature grid.
 */

/** GitHub org/repo slug — matches the project's git remote. */
export const REPO_SLUG = 'quinnjr/nestjs-bun';

/** Canonical repository URL. */
export const REPO_URL = `https://github.com/${REPO_SLUG}`;

/** Convenience builder for links into the repository tree on the default branch. */
export function repoTree(path: string): string {
  return `${REPO_URL}/tree/main/${path.replace(/^\/+/, '')}`;
}

/** Published npm package name. */
export const PACKAGE_NAME = '@lexmata/nestjs-platform-bun';

/**
 * Released package version, without a leading `v`.
 *
 * Must match `version` in the root `package.json`. Render it through
 * {@link VERSION_LABEL} rather than prefixing `v` at each call site.
 */
export const VERSION = '0.2.0';

/** `VERSION` with the conventional `v` prefix, for display. */
export const VERSION_LABEL = `v${VERSION}`;

/** Maintaining organisation. */
export const ORGANISATION = 'Lexmata';

/**
 * Footer copyright line. The year is derived at runtime so the footer cannot go
 * stale on 1 January — a hardcoded year is the one part of a site nobody
 * remembers to update.
 */
export const COPYRIGHT = `© ${new Date().getFullYear()} ${ORGANISATION}. MIT Licensed.`;
