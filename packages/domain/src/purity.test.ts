import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Structural guard on the plan's hardest constraint. The domain layer is the native-port
// insurance: the moment React, a browser global or an implicit clock gets in, the rules
// stop being independently testable and the port stops being cheap.
//
// Note for phase 5: this is a static check. It cannot produce a meaningful RED2 with the
// implementation removed, so it is recorded as structurally exempt rather than claiming
// a red it cannot produce.

const ROOT = join(import.meta.dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/** Comments talk *about* the banned constructs, so strip them before matching. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const BANNED: ReadonlyArray<[RegExp, string]> = [
  [/\bfrom\s+["']react["']/, "imports React"],
  [/\bDate\.now\s*\(/, "calls Date.now() — take the time from DomainCtx instead"],
  [/\bnew Date\s*\(\s*\)/, "constructs an implicit now — take it from DomainCtx instead"],
  [/\b(window|document|localStorage|indexedDB|navigator|fetch)\b/, "touches a browser global"],
  [/\b(SpreadsheetApp|CalendarApp|UrlFetchApp|Utilities)\b/, "touches an Apps Script global"],
];

describe("packages/domain purity", () => {
  const files = sourceFiles(ROOT);

  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("has no dependencies declared", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "..", "package.json"), "utf8"));
    expect(pkg.dependencies).toEqual({});
  });

  it.each(BANNED)("no domain file %s", (pattern, why) => {
    const offenders = files.filter((f) => pattern.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders, `${offenders.join(", ")} ${why}`).toEqual([]);
  });
});
