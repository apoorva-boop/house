import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH lets CI build for GitHub Pages (served under /house/) while local dev
// and the Playwright harness both use the same "/house/" root by default — see
// playwright.config.ts's baseURL.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/house/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
