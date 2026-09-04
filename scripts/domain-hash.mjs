// One content hash over the domain sources that end up inside `apps-script/build/domain.js`.
//
// ---------------------------------------------------------------------------
// Why a hash and not a timestamp
// ---------------------------------------------------------------------------
// The failure this exists to catch has already happened once: `weight` was implemented
// in `packages/domain`, the bundle in `apps-script/build/` was never rebuilt, and the
// deployed server went on calling the stub. Points came back as the clamp floor and
// four integration tests were the only thing that noticed.
//
// mtime cannot detect that reliably. `git checkout`, `git clone` and `pnpm install`
// all rewrite file times with no relation to content, so a fresh clone looks stale and
// a `touch` on an unchanged file looks fresh. A hand-bumped version constant cannot
// detect it either: the failure WAS a human forgetting a step, and a constant adds one
// more step to forget. A content hash is derived from the bytes that were actually
// bundled, so it is right in every one of those cases and needs nobody to remember it.
//
// ---------------------------------------------------------------------------
// What is hashed
// ---------------------------------------------------------------------------
// Every `.ts` under `packages/domain/src` EXCEPT `*.test.ts`. The tests are not
// reachable from `src/index.ts`, so they are not in the bundle; hashing them would
// report a stale bundle every time a test changed and train people to ignore the check.
//
// Path and content both go in, so a rename with identical content still changes the
// hash. Paths are joined with "/" whatever the platform separator is, and the list is
// sorted, so the same tree hashes the same on macOS, Linux and CI.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const domainSrc = resolve(repoRoot, "packages/domain/src");

/**
 * The marker line both build artefacts carry. `scripts/check-bundle.mjs` reads it back
 * out of them, so it must stay a single line and must stay exactly this shape.
 */
export const STAMP_PREFIX = "// DOMAIN_SOURCE_HASH ";

/** `<hex>` from the first stamp line in `text`, or null if there is none. */
export function readStamp(text) {
  const match = new RegExp(`^${STAMP_PREFIX}([0-9a-f]{64})$`, "m").exec(text);
  return match === null ? match : match[1];
}

async function tsFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await tsFiles(full)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

/** SHA-256 over every bundled domain source, as a 64-character lowercase hex string. */
export async function domainSourceHash() {
  const files = (await tsFiles(domainSrc)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(domainSrc, file).split(/[\\/]/).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
