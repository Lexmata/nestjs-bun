import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Global ignores. Everything not listed here IS linted - including
    // benchmark/ and test/, which were previously invisible to the linter.
    // That blind spot is how a permanently-dead `typeof x === "string"` branch
    // survived in the benchmark reporter.
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "**/node_modules/**",
      // The docs site is a self-contained Angular app with its own toolchain.
      "docs/**",
      // Tool scratch directory - fully gitignored (.remember/.gitignore is `*`)
      // and holds generated scratch files, not source. Named explicitly rather
      // than via a `**/.*/**` glob so .github/ and .husky/ stay linted.
      ".remember/**",
      // The two tool-config files in the repo. They are plain CommonJS-era JS
      // rather than product source, and linting them adds nothing.
      //
      // Named individually on purpose. This used to be `**/*.js`, `**/*.mjs`,
      // `**/*.cjs` and `**/.*/**`, which is a far bigger blind spot than the
      // two files it was written for: it hid every dotfile directory (.github/,
      // .husky/) and pre-emptively excused any build or release script anyone
      // might add later. If a third config file appears, add it here - do not
      // widen this back into a glob.
      "eslint.config.js",
      "commitlint.config.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type-aware linting for the published source only: it is the only tree
    // covered by ./tsconfig.json.
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // Require explicit accessibility modifiers on class members
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        {
          accessibility: "explicit",
          overrides: {
            constructors: "no-public", // Constructors don't need 'public' keyword
            accessors: "explicit",
            methods: "explicit",
            properties: "explicit",
            parameterProperties: "explicit",
          },
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Relaxed rules for test files (unit and e2e). Tests build partial mocks
    // and probe private members, so unused bindings and missing accessibility
    // modifiers are noise there.
    //
    // `no-explicit-any` is deliberately NOT relaxed. There is no `any` in
    // src/ or test/ today - the suites already reach for `as unknown as T`,
    // which keeps the cast visible and checked at the point of use. Turning
    // the rule off would be a pre-authorised escape hatch for a problem the
    // codebase does not have, and the first `any` to appear would arrive
    // unremarked.
    files: ["src/**/*.test.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/explicit-member-accessibility": "off",
    },
  },
  {
    // The benchmark harness and its NestJS fixture apps, plus the runnable
    // examples. Both are NestJS applications rather than library source, and
    // both rely on unused-but-required parameters: an Express error middleware
    // is only recognised by its 4-argument arity, so the trailing `_next` must
    // stay in the signature.
    files: ["benchmark/**/*.ts", "examples/**/*.ts"],
    rules: {
      // Fixture controllers/services follow the NestJS docs' default style.
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  }
);
