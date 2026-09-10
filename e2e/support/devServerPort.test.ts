import { describe, expect, it } from "vitest";
import { devServerPort, HUMAN_DEV_PORT } from "./devServerPort";

// Two checkouts of this repo, the shape `git worktree add` produces. Literal strings,
// not process.cwd(): the point is that the port depends on the PATH and nothing else.
const HERE = "/Users/someone/Projects/house/.claude/worktrees/upbeat-shaw-b81e4e";
const SIBLING = "/Users/someone/Projects/house/.claude/worktrees/hopeful-cori-61d499";

describe("devServerPort", () => {
  it("is the same port every time for the same worktree", () => {
    expect(devServerPort(HERE, {})).toBe(devServerPort(HERE, {}));
  });

  it("gives two worktrees two different ports", () => {
    expect(devServerPort(HERE, {})).not.toBe(devServerPort(SIBLING, {}));
  });

  it("never lands on 5173, the port a hand-started `pnpm dev` uses, and stays in its range", () => {
    for (let i = 0; i < 500; i++) {
      const port = devServerPort(`/w/${i}`, {});
      expect(port).not.toBe(HUMAN_DEV_PORT);
      expect(port).toBeGreaterThanOrEqual(5200);
      expect(port).toBeLessThan(6000);
    }
  });

  it("lets E2E_PORT pin the port explicitly, and rejects a value that is not a port", () => {
    expect(devServerPort(HERE, { E2E_PORT: "5321" })).toBe(5321);
    expect(() => devServerPort(HERE, { E2E_PORT: "eighty" })).toThrow();
    expect(() => devServerPort(HERE, { E2E_PORT: "80" })).toThrow();
  });
});
