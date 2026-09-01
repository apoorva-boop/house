import { describe, expect, it } from "vitest";
import { advanceOnCompletion, nextDueFrom } from "./recurrence.js";
import type { Chore } from "../model/Chore.js";
import type { DomainCtx } from "../ctx.js";

const ctx: DomainCtx = { now: Date.parse("2026-09-01T09:00:00+12:00"), timeZone: "Pacific/Auckland" };

function chore(over: Partial<Chore> = {}): Chore {
  return {
    id: "c1", title: "t", assetId: "house",
    weight: { time: 2, effort: 2, priority: 2 },
    recurrence: { kind: "interval", unit: "month", n: 1 },
    deadlineDate: null, leadTimeDays: null, urgencyCurve: null,
    ...over,
  };
}

describe("nextDueFrom", () => {
  it("clamps 31 Jan + 1 month to 28 Feb in a common year", () => {
    const next = nextDueFrom(ctx, Date.parse("2026-01-31T09:00:00+13:00"), chore());
    expect(new Date(next).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("clamps 31 Jan + 1 month to 29 Feb in a leap year", () => {
    const next = nextDueFrom(ctx, Date.parse("2028-01-31T09:00:00+13:00"), chore());
    expect(new Date(next).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("splits 4 times a year into 3-month steps", () => {
    const next = nextDueFrom(ctx, Date.parse("2026-01-15T09:00:00+13:00"),
      chore({ recurrence: { kind: "timesPerYear", timesPerYear: 4 } }));
    expect(new Date(next).toISOString().slice(0, 10)).toBe("2026-04-15");
  });

  it("keeps the same local time-of-day across a Pacific/Auckland DST boundary", () => {
    // NZ leaves daylight saving in early April. A monthly chore due 09:00 local in March
    // must still be due 09:00 local in April, not 08:00 or 10:00.
    const next = nextDueFrom(ctx, Date.parse("2026-03-15T09:00:00+13:00"), chore());
    const local = new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(next));
    expect(local).toBe("09:00");
  });
});

describe("advanceOnCompletion", () => {
  it("advances the recurrence from completion and leaves the deadline fixed", () => {
    const wof = chore({
      recurrence: { kind: "interval", unit: "year", n: 1 },
      deadlineDate: "2026-11-30", leadTimeDays: 30, urgencyCurve: "steep",
    });
    const advanced = advanceOnCompletion(ctx, wof, Date.parse("2026-09-01T09:00:00+12:00"));
    expect(advanced.deadlineDate).toBe("2026-11-30");
    expect(advanced).not.toBe(wof);
  });
});
