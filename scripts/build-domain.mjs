// Bundles packages/domain into a single file Apps Script can load.
//
// clasp cannot resolve a pnpm workspace import, and the Apps Script server needs the
// recurrence and notification rules. So the rules are bundled, not imported.
//
// Apps Script's V8 runtime has no module system a bundle can use: no `require`, no
// `import`, no `export`. The output is therefore an IIFE assigned to one global,
// `Domain`, which the .gs files read as `Domain.nextDueAt(...)`.
//
// Not minified on purpose — the Apps Script editor is the only debugger available for
// deployed code, and stepping through minified output there is not workable.

import { build } from "esbuild";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STAMP_PREFIX, domainSourceHash } from "./domain-hash.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(repoRoot, "packages/domain/src/index.ts");
const outfile = resolve(repoRoot, "apps-script/build/domain.js");
const sourceHash = await domainSourceHash();

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "iife",
  globalName: "Domain",
  target: "es2020",
  platform: "neutral",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  banner: {
    js:
      "// GENERATED FILE - DO NOT EDIT.\n" +
      "// Built from packages/domain by `pnpm build:domain`. Edit the source there.\n",
  },
});

// `globalName` emits `var Domain = (() => { ... })()`. At the top level of an Apps
// Script file that is already a global, but bind it explicitly so the reference works
// the same way whichever file loads first.
//
// `SOURCE_HASH` is stamped on the same object. It is the fingerprint of the domain
// sources this bundle was actually built from, and it is what makes a stale bundle
// detectable rather than silent — see `scripts/domain-hash.mjs` for why it is a hash
// and not an mtime or a hand-bumped version. Two things read it back:
//
//   `scripts/check-bundle.mjs`   compares it to the CURRENT working tree, so a build
//                                that predates an edit to `packages/domain` fails
//                                before anything is pushed.
//   `assertDomainBundleFresh_`   in `apps-script/src/Config.ts`, compares it to the
//                                stamp the server half of the build carries. That one
//                                survives a hand-run `npx clasp push`, which is exactly
//                                how a half-built directory reaches production.
await appendFile(
  outfile,
  "\nglobalThis.Domain = Domain;\n" +
    `Domain.SOURCE_HASH = ${JSON.stringify(sourceHash)};\n` +
    `${STAMP_PREFIX}${sourceHash}\n`,
);

console.log(`built ${outfile} (domain sources ${sourceHash.slice(0, 12)})`);
