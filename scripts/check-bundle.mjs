// Fails if `apps-script/build/` was not built from the source tree as it stands NOW.
//
// ---------------------------------------------------------------------------
// The failure this catches
// ---------------------------------------------------------------------------
// `pnpm clasp:push` rebuilds first, so it is safe. `npx clasp push` is not: clasp is a
// devDependency and `.clasp.json` persists, so anyone can run it directly and upload
// whatever happens to be sitting in `apps-script/build/`. That has already shipped one
// real bug — `weight` landed in `packages/domain`, the bundle still held the stub, and
// the deployed server returned the clamp floor for every chore.
//
// This script is the half of the defence that can see the working tree: it recomputes
// the fingerprint of `packages/domain/src` and compares it to the stamps the last build
// left behind. It therefore catches the wholly-stale case — nothing rebuilt at all —
// which nothing running on Apps Script can possibly detect, because the deployed server
// has never seen the source files.
//
// The other half is `assertDomainBundleFresh_` in `apps-script/src/Config.ts`. That one
// compares the two build artefacts against each other and runs on the server, so it
// survives a hand-run push by somebody who never ran this script.
//
// Run by `pnpm check:bundle`, by `pnpm clasp:push` before it uploads, and by CI after
// `pnpm build` (where it also proves the stamping machinery itself still works).

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { STAMP_PREFIX, domainSourceHash, readStamp, repoRoot } from "./domain-hash.mjs";

const buildDir = resolve(repoRoot, "apps-script/build");
const artefacts = [resolve(buildDir, "domain.js"), resolve(buildDir, "BundleStamp.js")];

const expected = await domainSourceHash();
const problems = [];

for (const file of artefacts) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    problems.push(`${relative(repoRoot, file)} is missing.`);
    continue;
  }
  const found = readStamp(text);
  if (found === null) {
    problems.push(
      `${relative(repoRoot, file)} carries no "${STAMP_PREFIX.trim()}" line. It predates the ` +
        "freshness stamp, so it was built by an older toolchain.",
    );
  } else if (found !== expected) {
    problems.push(
      `${relative(repoRoot, file)} was built from domain sources ${found.slice(0, 12)}, but ` +
        `packages/domain/src is now ${expected.slice(0, 12)}.`,
    );
  }
}

if (problems.length > 0) {
  console.error("apps-script/build/ is STALE. Do not push it.\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nRun `pnpm build` (or `pnpm clasp:push`, which builds first).");
  process.exit(1);
}

console.log(`apps-script/build/ is current with packages/domain/src (${expected.slice(0, 12)}).`);
