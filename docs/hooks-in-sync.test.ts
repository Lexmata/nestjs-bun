/**
 * Guard against the documentation site drifting from `src/`.
 *
 * The Fastify Compatibility page hand-maintains a table of lifecycle hooks and a
 * prose callout naming the hooks that are *not* supported. Both are plain
 * literals in an Angular component, so nothing links them to the adapter; twice
 * now they have been left behind by a change to `src/fastify-compat.ts` and told
 * readers something that was false the day it was written.
 *
 * This test closes that loop by reading the page's own source and comparing the
 * names it renders against the exported {@link SUPPORTED_FASTIFY_HOOKS}.
 *
 * ## Why this file lives at `docs/`, not `docs/src/`
 *
 * `docs/tsconfig.app.json` includes `src/**\/*.ts` and excludes only
 * `src/**\/*.spec.ts`, so a `.test.ts` under `docs/src/` would be pulled into
 * `ng build` — where importing `bun:test` and a module outside the docs project
 * breaks the site build. Keeping it one level up puts it outside both
 * `tsconfig.app.json` and `tsconfig.spec.json` while leaving it inside the
 * default `bun test` glob at the repository root.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SUPPORTED_FASTIFY_HOOKS } from "../src/fastify-compat";

const PAGE_PATH = new URL("./src/app/pages/fastify-compat.ts", import.meta.url);
const page = readFileSync(PAGE_PATH, "utf8");

/** Number words the page uses to state how many hooks exist. */
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

/**
 * Pull a balanced `<name> = [ ... ];` array literal out of the component source.
 *
 * A regex over the whole file would happily stop at the first `];` inside a
 * nested literal, so the closing bracket is found by counting depth.
 */
function extractArrayLiteral(source: string, property: string): string {
  const start = source.indexOf(`${property} = [`);
  if (start === -1) {
    throw new Error(
      `Could not find a "${property} = [" literal in the Fastify Compatibility page. ` +
        `If the property was renamed, update this test rather than deleting it.`
    );
  }

  let depth = 0;
  for (let i = source.indexOf("[", start); i < source.length; i++) {
    const char = source[i];
    if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error(`Unterminated "${property}" array literal in the Fastify Compatibility page`);
}

/** Every `name: '...'` value inside an array literal, in source order. */
function extractNames(literal: string): string[] {
  return [...literal.matchAll(/name:\s*'([^']*)'/g)].map((match) => match[1]!);
}

/**
 * The set of supported hooks, sorted.
 *
 * Membership is compared rather than order on purpose.
 * `SUPPORTED_FASTIFY_HOOKS` is the name-validation list, not an execution
 * order — `onError` is not on the linear request path at all — so the page is
 * free to present the hooks in the order they actually run and append
 * `onError`. What must never differ is *which* names appear.
 */
const EXPECTED_HOOKS = [...SUPPORTED_FASTIFY_HOOKS].sort();

describe("docs: Fastify Compatibility page stays in sync with src/fastify-compat.ts", () => {
  it("renders exactly the supported hooks in its lifecycle table", () => {
    const rendered = extractNames(extractArrayLiteral(page, "hooks"));

    expect(new Set(rendered).size, "The hooks table lists a name twice").toBe(rendered.length);
    expect([...rendered].sort()).toEqual(EXPECTED_HOOKS);
  });

  it("gives every hook a description", () => {
    const literal = extractArrayLiteral(page, "hooks");
    const descriptions = [...literal.matchAll(/description:\s*'([^']*)'/g)].map((m) => m[1]!);

    expect(descriptions).toHaveLength(SUPPORTED_FASTIFY_HOOKS.length);
    for (const description of descriptions) {
      expect(description.trim().length).toBeGreaterThan(0);
    }
  });

  it("lists the same hooks in the compatibility notes", () => {
    const notes = extractArrayLiteral(page, "compatibilityNotes");
    const hookNote = [...notes.matchAll(/text:\s*'([^']*)'/g)]
      .map((match) => match[1]!)
      .find((text) => /lifecycle hooks:/i.test(text));

    expect(
      hookNote,
      'Expected a compatibility note of the form "<N> lifecycle hooks: <names>"'
    ).toBeDefined();

    const listed = hookNote!
      .slice(hookNote!.indexOf(":") + 1)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    expect([...listed].sort()).toEqual(EXPECTED_HOOKS);
  });

  it("states the hook count correctly wherever it is spelled out in prose", () => {
    const expected = NUMBER_WORDS[SUPPORTED_FASTIFY_HOOKS.length];
    expect(expected, `No number word for ${SUPPORTED_FASTIFY_HOOKS.length} hooks`).toBeDefined();

    // Any number word immediately preceding "hook"/"hooks" must be the real
    // count - this is the sentence that said "Seven" while the table listed five.
    const claims = [...page.matchAll(/\b([A-Za-z]+)\s+(?:lifecycle\s+)?hooks?\b/g)]
      .map((match) => match[1]!.toLowerCase())
      .filter((word) => (NUMBER_WORDS as readonly string[]).includes(word));

    expect(claims.length, "Expected the page to state the hook count in prose").toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim).toBe(expected);
    }

    // "Those seven are the whole list" - the bare number word, no noun.
    const bareClaims = [...page.matchAll(/\b(?:Those|those)\s+([a-z]+)\b/g)]
      .map((match) => match[1]!)
      .filter((word) => (NUMBER_WORDS as readonly string[]).includes(word));
    for (const claim of bareClaims) {
      expect(claim).toBe(expected);
    }
  });

  it("only names genuinely unsupported hooks in the 'unsupported hook names throw' callout", () => {
    const calloutStart = page.indexOf("Unsupported hook names throw");
    expect(calloutStart, "Could not find the unsupported-hooks callout").toBeGreaterThan(-1);

    const callout = page.slice(calloutStart, page.indexOf("</div>", calloutStart));
    const named = [...callout.matchAll(/<code>([A-Za-z]+)<\/code>/g)]
      .map((match) => match[1]!)
      .filter((name) => name !== "addHook");

    expect(named.length, "Expected the callout to name some unsupported hooks").toBeGreaterThan(0);

    // The reverse drift: implementing preParsing without updating this callout
    // would leave the page claiming addHook('preParsing') throws.
    for (const name of named) {
      expect(
        (SUPPORTED_FASTIFY_HOOKS as readonly string[]).includes(name),
        `The callout says addHook('${name}') throws, but ${name} is in SUPPORTED_FASTIFY_HOOKS`
      ).toBe(false);
    }
  });
});
