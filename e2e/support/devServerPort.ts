import { createHash } from "node:crypto";

/**
 * Which port Playwright's Vite dev server listens on, for THIS checkout.
 *
 * Every git worktree of this repo used to share 5173, and `reuseExistingServer` let
 * Playwright attach to whichever checkout had got there first. The testing sub-plan's
 * ledger records both ways that goes wrong: a false green with this checkout's code
 * reverted (PR 3's RED₂ notes), and a false red with this checkout's code correct
 * (`13 failed of 14` on 2026-09-08). Two fixes together close it:
 *
 * - **A port per worktree.** Derived from the checkout's absolute path, so it is stable
 *   across runs and different for every sibling worktree. Two checkouts can run their
 *   browser suites at the same time.
 * - **Never a borrowed server.** `playwright.config.ts` sets `reuseExistingServer:
 *   false`. Playwright always starts its own Vite, and Vite's `strictPort` means a port
 *   already taken is a loud failure, never a quiet run against someone else's code.
 *
 * The range 5200–5999 deliberately excludes 5173, so a `pnpm dev` started by hand and
 * a browser suite never compete for a port either.
 *
 * `E2E_PORT` pins the port explicitly, for a scratch run on a known port.
 */

/** The port a hand-started `pnpm dev` uses -- apps/web/vite.config.ts's default. */
export const HUMAN_DEV_PORT = 5173;

const RANGE_START = 5200;
const RANGE_SIZE = 800;

export interface PortEnv {
  readonly E2E_PORT?: string | undefined;
}

export function devServerPort(worktreePath: string, env: PortEnv = process.env): number {
  const override = env.E2E_PORT;
  if (override !== undefined && override !== "") {
    const port = Number(override);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`E2E_PORT must be a port number between 1024 and 65535, got "${override}"`);
    }
    return port;
  }
  const digest = createHash("sha256").update(worktreePath).digest();
  return RANGE_START + (digest.readUInt32BE(0) % RANGE_SIZE);
}
