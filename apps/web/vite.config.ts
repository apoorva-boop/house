import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH lets CI build for GitHub Pages (served under /house/) while local dev
// and the Playwright harness both use the same "/house/" root by default — see
// playwright.config.ts's baseURL.
//
// 5173 is for a `pnpm dev` started by hand. Playwright hands each worktree its own
// port through HOUSE_WEB_PORT (e2e/support/devServerPort.ts), so two checkouts can run
// their browser suites at once and a suite never reaches a server another checkout
// started.
const port = Number(process.env.HOUSE_WEB_PORT ?? 5173);
if (!Number.isInteger(port)) {
  throw new Error(`HOUSE_WEB_PORT must be a port number, got "${process.env.HOUSE_WEB_PORT}"`);
}

export default defineConfig({
  base: process.env.BASE_PATH ?? "/house/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    // Pinned to the IPv4 loopback, not left to default to "localhost". Node resolves
    // `localhost` verbatim, so on a machine that answers ::1 first Vite binds IPv6 only
    // and `http://127.0.0.1:<port>` - which is what playwright.config.ts's baseURL and
    // webServer.url both use - refuses the connection. The suite then dies on
    // "Timed out waiting 60000ms from config.webServer" with a dev server that is
    // demonstrably up, which is a miserable hour to spend. Both halves now name the
    // same address.
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
});
