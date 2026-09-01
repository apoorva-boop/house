// Produces the directory clasp uploads: `apps-script/build/`.
//
// Apps Script cannot run TypeScript, so `.ts` must never be pushed. `rootDir` in
// `.clasp.json` points at `apps-script/build/`, and this script is what fills it:
//
//   apps-script/build/appsscript.json   copied verbatim from apps-script/
//   apps-script/build/Code.js           transpiled from apps-script/src/Code.ts
//   apps-script/build/domain.js         written by `pnpm build:domain`
//
// Transpile, do NOT bundle. Apps Script's V8 runtime has no module system: a `.gs`
// file's top-level `function` declarations are its globals, and that is how the
// platform finds `doPost`/`doGet`. esbuild's `transform` API only strips the types
// — it never adds an IIFE wrapper and never emits `import`/`export`/`require`.
// (`build({bundle:true})` would wrap the file and hide the entry points.) The
// domain bundle is the opposite case and is built separately: it genuinely bundles
// a workspace package, so it gets `format:"iife"` plus one global, `Domain`.
//
// Not minified, for the same reason as the domain bundle: the Apps Script editor
// is the only debugger deployed code has.
//
// ---------------------------------------------------------------------------
// Why `appsscript.json` asks for the scopes it asks for
// ---------------------------------------------------------------------------
// The manifest lists scopes explicitly so the consent screen is reviewable before
// anyone clicks Allow. Apps Script would otherwise infer a broader set.
//
//   spreadsheets.currentonly   The script's OWN bound spreadsheet, nothing else in
//                              Drive. Sufficient for SpreadsheetApp.getActiveSpreadsheet()
//                              ONLY while the script stays container-bound to that
//                              sheet. A standalone script gets null back and would
//                              need the Drive-wide `spreadsheets` scope instead.
//   calendar                   CalendarApp reaches a secondary calendar through
//                              getCalendarById(), which reads the user's calendar
//                              list — not an events-only operation, so
//                              `calendar.events` does not cover it. This is the
//                              narrowest scope CalendarApp is documented to work
//                              under for a non-primary calendar.
//   script.scriptapp           ScriptApp.newTrigger(), for the time-driven DueSweep.
//
// Deliberately ABSENT: `script.external_request`. UrlFetchApp is only needed for
// the push relay in PR 5. Do not add it before then.

import { transform } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(repoRoot, "apps-script/src");
const outDir = resolve(repoRoot, "apps-script/build");

const BANNER =
  "// GENERATED FILE - DO NOT EDIT.\n" +
  "// Built from apps-script/src by `pnpm build:appsscript`. Edit the source there.\n";

await mkdir(outDir, { recursive: true });

// 1. The manifest. clasp requires it inside rootDir.
await copyFile(resolve(repoRoot, "apps-script/appsscript.json"), resolve(outDir, "appsscript.json"));

// 2. Every server file.
//
//    All of these are SCRIPTS, not modules: no import, no export, one shared global
//    scope. That is why the list is written out by hand rather than globbed — a stray
//    `.ts` in src/ that happened to be a module would be pushed as a broken `.gs`, and
//    the `*.test.ts` files next door must never be pushed at all.
//
//    Order is documentation, not a load order. Apps Script does not promise one, so no
//    file here reads another file's top-level binding at load time; every shared
//    constant is returned from a function for exactly that reason.
const SERVER_FILES = [
  "Config.ts", // schema, script properties, the ambient `Domain` declaration
  "Store.ts", // row access, the script lock, the version counter
  "Records.ts", // spreadsheet row -> domain value
  "CalendarChannel.ts", // NotificationSender, and Calendar as its first implementation
  "DueSweep.ts", // sole owner of instance materialisation
  "Seed.ts", // the default chore list, with its dates computed from the server clock
  "Auth.ts", // person tokens, and the separately-gated test token
  "Ops.ts", // the production ops
  "TestSupport.ts", // the `test.*` namespace, inert unless TEST_MODE is "true"
  "Code.ts", // doPost / doGet and the router
];

for (const file of SERVER_FILES) {
  const source = await readFile(resolve(srcDir, file), "utf8");
  const result = await transform(source, {
    loader: "ts",
    target: "es2020",
    format: undefined, // Preserve top-level statements. No wrapper, no module syntax.
    minify: false,
    sourcemap: false,
    legalComments: "none",
  });
  const outfile = resolve(outDir, file.replace(/\.ts$/, ".js"));
  await writeFile(outfile, BANNER + result.code, "utf8");

  // Apps Script would fail at load on any of these. Fail the build instead.
  if (/^\s*(import|export)\b/m.test(result.code) || /\brequire\(/.test(result.code)) {
    throw new Error(`${outfile} contains module syntax. Apps Script cannot load it.`);
  }
  console.log(`built ${outfile}`);
}

console.log(`built ${resolve(outDir, "appsscript.json")}`);
