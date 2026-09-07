import { defineConfig, devices } from "@playwright/test";

// Chromium only: this project has no cross-browser requirement yet.
export default defineConfig({
  testDir: "e2e",
  // apps/web/src/**/*.test.ts are vitest's unit tests. testDir already keeps
  // Playwright out of apps/web; this documents the boundary explicitly.
  // e2e/.tsbuild is tsc's compiled output (from `pnpm typecheck`) and would otherwise
  // be picked up a second time as plain .spec.js files.
  testIgnore: ["**/*.test.ts", "**/.tsbuild/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173/house/",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Port and strictPort live on apps/web/vite.config.ts's `server` option.
    command: "pnpm --filter @house/web run dev",
    url: "http://127.0.0.1:5173/house/",
    reuseExistingServer: !process.env.CI,
  },
});
