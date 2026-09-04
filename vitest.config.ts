import { defineConfig } from "vitest/config";

// Two projects, because they have different prerequisites.
// `unit` is pure and runs anywhere. `integration` talks to a real Google Sheet and a
// real Calendar, and is skipped unless SHEETS_TEST_ID and CALENDAR_TEST_ID are set —
// a suite that silently passes because its backend is missing proves nothing.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "apps/web/src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["apps-script/**/*.test.ts", "relay/**/*.test.ts"],
          environment: "node",
          // These 6 files must run serially: they all target the same Google
          // spreadsheet and every one calls clearAll() in beforeEach, so parallel
          // workers wipe each other's fixtures mid-test. `fileParallelism` can't be
          // set here — vitest 3.2.7 excludes it from per-project config, it's
          // root/CLI-only — so `--no-file-parallelism` lives on the
          // `test:integration` script in package.json instead. Don't "optimise"
          // this project back to parallel, and don't add fileParallelism here
          // expecting it to do anything (it's silently dropped from ProjectConfig).
        },
      },
    ],
  },
});
