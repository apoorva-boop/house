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
        },
      },
    ],
  },
});
