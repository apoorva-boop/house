import { defineConfig, devices } from "@playwright/test";
import { devServerPort } from "./e2e/support/devServerPort";

// One port per worktree, and never a borrowed server. Both halves of the reasoning
// live in e2e/support/devServerPort.ts. Keyed on this file's own directory -- the
// worktree root -- not on process.cwd(), which `pnpm exec playwright test` leaves at
// whatever subdirectory it was run from.
const port = devServerPort(import.meta.dirname);
const origin = `http://127.0.0.1:${port}`;

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
    baseURL: `${origin}/house/`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Host and strictPort live on apps/web/vite.config.ts's `server` option; the port
    // is handed over here so the suite and the server it starts always agree.
    command: "pnpm --filter @house/web run dev",
    url: `${origin}/house/`,
    env: { HOUSE_WEB_PORT: String(port) },
    // Always our own server. Reusing one meant attaching to whatever checkout had the
    // port, and this suite has tested the wrong worktree's code in both directions.
    reuseExistingServer: false,
  },
});
