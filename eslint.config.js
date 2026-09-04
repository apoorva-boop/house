// ESLint 9 flat config.
//
// The interesting part is the last block. `packages/domain` is the native-port
// insurance: it must stay pure TypeScript with no React, no browser, no Apps Script,
// and no clock of its own. Every rule there takes `ctx: {now, timeZone}` as its first
// argument, so a `Date.now()` anywhere in that package is a bug that unit tests cannot
// catch — the test would still pass, it would just be untestable at a fixed instant.
// These rules are the only thing enforcing that.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "apps-script/build/**",
      "playwright-report/**",
      "test-results/**",
      "*.tsbuildinfo",
    ],
  },

  // TypeScript across every workspace. No type-aware linting: it would need a project
  // service over four tsconfigs, and the rules that matter here are syntactic.
  {
    files: [
      // `.tsx` is listed everywhere `.ts` is. JSX is a parse error in a `.ts` file,
      // so `.tsx` is the only file type where React could actually appear inside
      // packages/domain — which makes it the one extension that must never be
      // missing from a selector here.
      "packages/**/*.ts",
      "packages/**/*.tsx",
      "apps/**/*.ts",
      "apps/**/*.tsx",
      "apps-script/**/*.ts",
      "apps-script/**/*.tsx",
      "relay/**/*.ts",
      "relay/**/*.tsx",
      "e2e/**/*.ts",
      "e2e/**/*.tsx",
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // The Apps Script server files are SCRIPTS, not modules.
  //
  // Apps Script has no module system. Every `.gs` file shares one global scope, and a
  // top-level `function` declaration IS how the platform finds `doPost`, `doGet` and the
  // trigger entry point. `scripts/build-appsscript.mjs` transpiles rather than bundles
  // precisely so that stays true.
  //
  // Told they are modules, ESLint scopes each file to itself and reports every function
  // called from a sibling file — which is most of them — as unused. That is a false
  // report about a real deployment shape, so these files are described accurately
  // instead.
  //
  // `sourceType: "script"` is the accurate description but is not on its own enough:
  // typescript-eslint still reports an unreferenced top-level declaration in a global
  // script, because it cannot see across files either way. So the unused check is
  // additionally relaxed for names ending in `_`, which is the Apps Script convention
  // for "internal to this project" — the underscore is what keeps a function out of the
  // editor's Run menu, and here it also marks the names whose callers live in another
  // file. Anything WITHOUT the underscore is still checked, which is what catches a
  // genuinely orphaned entry point.
  //
  // `testkit.ts` and the `*.test.ts` files next door are excluded: they are genuine ES
  // modules that run under vitest in Node and never reach Apps Script.
  {
    files: ["apps-script/src/**/*.ts"],
    ignores: ["apps-script/src/**/*.test.ts", "apps-script/src/testkit.ts"],
    languageOptions: {
      sourceType: "script",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_|_$" },
      ],
    },
  },

  // The domain package is pure. This is the project's hardest constraint.
  {
    files: ["packages/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/*", "react-dom", "react-dom/*"],
              message:
                "packages/domain is pure TypeScript. React belongs in apps/web.",
            },
            {
              group: ["@house/web", "@house/web/*"],
              message:
                "packages/domain must not depend on the app. The dependency runs the other way.",
            },
          ],
          paths: [
            {
              name: "google-apps-script",
              message:
                "packages/domain must not know it is bundled for Apps Script.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        // Browser
        { name: "window", message: "packages/domain has no browser. Move this to apps/web." },
        { name: "document", message: "packages/domain has no browser. Move this to apps/web." },
        { name: "navigator", message: "packages/domain has no browser. Move this to apps/web." },
        { name: "location", message: "packages/domain has no browser. Move this to apps/web." },
        { name: "localStorage", message: "packages/domain has no browser. Move this to apps/web." },
        { name: "sessionStorage", message: "packages/domain has no browser. Move this to apps/web." },
        { name: "indexedDB", message: "packages/domain has no browser. Move this to apps/web." },
        { name: "fetch", message: "packages/domain does no I/O. Pass the data in." },
        { name: "alert", message: "packages/domain has no browser." },
        { name: "self", message: "packages/domain has no browser." },
        // Apps Script
        { name: "SpreadsheetApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "CalendarApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "LockService", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "PropertiesService", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "UrlFetchApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "ScriptApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "Utilities", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "Logger", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "Session", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "DriveApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "CacheService", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "HtmlService", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "MailApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "GmailApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "DocumentApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "FormApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "SlidesApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "ContactsApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "LanguageApp", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "Charts", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
        { name: "Browser", message: "packages/domain must not touch Apps Script. Move this to apps-script/src." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXElement",
          message: "packages/domain renders nothing. JSX belongs in apps/web/src/views.",
        },
      ],
    },
  },

  // No clock. Production domain code learns the time only from `ctx.now`.
  // Tests are excluded: they build fixtures with `Date.parse("2026-01-31T...")`,
  // which is a literal, not a clock read.
  {
    files: ["packages/domain/**/*.{ts,tsx}"],
    ignores: ["packages/domain/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXElement",
          message: "packages/domain renders nothing. JSX belongs in apps/web/src/views.",
        },
        {
          // Zero-argument only. `new Date(ctx.now)` and `new Date(Date.UTC(...))` are
          // deterministic constructions from a value already in hand; `new Date()`
          // reads the system clock, which is the thing that must not happen here.
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "packages/domain has no clock. `new Date()` reads the system clock — take the time from `ctx.now`, the first argument of every rule.",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "packages/domain has no clock. Take the time from `ctx.now` — the first argument of every rule.",
        },
        {
          selector: "MemberExpression[object.name='performance'][property.name='now']",
          message:
            "packages/domain has no clock. Take the time from `ctx.now` — the first argument of every rule.",
        },
      ],
    },
  },

  // Config and build scripts are Node ESM, not part of a workspace tsconfig.
  {
    files: ["*.config.js", "*.config.ts", "scripts/**/*.mjs"],
    rules: {
      "no-restricted-globals": "off",
    },
  },
);
