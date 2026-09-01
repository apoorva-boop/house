import type { ChoreWeight } from "../model/Chore.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// points = clamp(round(2*time + 2*effort + 3*priority), 5, 35)
// Sliders are integers on a 1-5 domain, so the reachable range is 7-35;
// the lower clamp of 5 is defensive only and is unreachable by design.
export function weight(w: ChoreWeight): number {
  const raw = 2 * w.time + 2 * w.effort + 3 * w.priority;
  return clamp(Math.round(raw), 5, 35);
}
