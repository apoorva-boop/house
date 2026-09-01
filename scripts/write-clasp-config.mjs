// Writes `.clasp.json` from `.env`. Never commit either file — the repo is public.
//
// The script ID is not a secret in the cryptographic sense, but it names Apoorva's
// personal Apps Script project, so it is treated like the sheet, calendar and token
// IDs: it lives in `.env` (gitignored) and nowhere else. `.clasp.json` is gitignored
// too, so it is generated on demand rather than checked in with a placeholder that
// someone would inevitably fill in and commit.
//
// This script prints only which variable it used and where it wrote — never the
// value.
//
//   pnpm clasp:config     writes .clasp.json
//   pnpm clasp:push       builds, then pushes (the lead runs this, not an agent:
//                         the first push triggers the OAuth consent screen, and the
//                         manifest in apps-script/appsscript.json must be read first)

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(repoRoot, ".env");
const outPath = resolve(repoRoot, ".clasp.json");

/** Same tolerant parser as apps-script/src/testkit.ts, so one `.env` serves both. */
function parseDotEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fromFile = existsSync(envPath) ? parseDotEnv(await readFile(envPath, "utf8")) : {};

/** Process env wins, so CI can supply the id without a file. */
const CANDIDATES = ["APPS_SCRIPT_ID", "SCRIPT_ID"];
let usedName = null;
let scriptId = null;
for (const name of CANDIDATES) {
  const value = process.env[name] || fromFile[name];
  if (value) {
    usedName = name;
    scriptId = value;
    break;
  }
}

if (!scriptId) {
  console.error(
    [
      "Cannot write .clasp.json: no script id found.",
      `Set one of ${CANDIDATES.join(" or ")} in ${envPath} (gitignored) or in the environment.`,
      "It is the id in https://script.google.com/home/projects/<SCRIPT_ID>/edit",
    ].join("\n"),
  );
  process.exit(1);
}

await writeFile(
  outPath,
  `${JSON.stringify(
    {
      scriptId,
      // Apps Script cannot run TypeScript. Push the built output, never src/.
      rootDir: "apps-script/build",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`wrote ${outPath} (scriptId from ${usedName}, rootDir apps-script/build)`);

// Not everything a deployment needs lives in `.env`, and the parts that do not are the
// parts people forget. Printed here rather than left in a comment because this is the
// command someone runs while they are setting the project up, which is the only moment
// the reminder is useful. Values, never printed — only which knob and where it lives.
console.log(
  [
    "",
    "Per-deployment configuration lives OUTSIDE .env. Set it once per Apps Script project.",
    "",
    "  Script properties (Project Settings -> Script Properties in the editor. Neither",
    "  clasp nor the Apps Script API can write these, so a human has to):",
    "    TEST_TOKEN    the value of APPS_SCRIPT_TEST_TOKEN. Authorises the test.* ops.",
    "    TEST_MODE     exactly \"true\" to enable the test.* ops at all. NEVER set this on",
    "                  a production deployment: test.clear wipes every tab and deletes",
    "                  every event on the calendar.",
    "    CALENDAR_ID   the notification calendar's id. Fallback only - see below.",
    "",
    "  The bound spreadsheet's Meta tab (preferred: the API can write these, so the test",
    "  suite and a setup script can, and a fresh sheet needs no editor visit):",
    "    { key: \"calendarId\", value: \"<calendar id>\" }",
    "    { key: \"timeZone\",   value: \"Pacific/Auckland\" }",
    "",
    "  calendarId is read from Meta first and from the CALENDAR_ID property second. With",
    "  neither set the server refuses to send rather than guessing a calendar - writing",
    "  chore reminders into somebody's real diary is the worst thing this code could do.",
    "  test.clear deliberately preserves the Meta calendarId row for the same reason.",
  ].join("\n"),
);
