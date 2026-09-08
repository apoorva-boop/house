import { shade } from "./layout.js";

export interface CharacterProps {
  readonly tier: number;
}

/** The five drawn exhaustion steps `fairness()` returns (mirrored here, no domain import). */
const TIER_STEPS: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8];

interface Pose {
  readonly lean: number; // degrees the whole figure leans forward
  readonly armDroop: number; // degrees each arm hangs down from a raised rest position
  readonly mouth: number; // viewBox px the mouth's control point sits below (+) or above (-) its ends
  readonly browTilt: number; // degrees the eyebrows angle down toward the nose
  readonly eyesOpen: boolean;
  readonly sweat: boolean;
}

const POSES: readonly Pose[] = [
  { lean: 0, armDroop: 0, mouth: 4, browTilt: 0, eyesOpen: true, sweat: false }, // tier 0 — fresh
  { lean: 2, armDroop: 4, mouth: 2, browTilt: 3, eyesOpen: true, sweat: false }, // tier 0.2
  { lean: 5, armDroop: 10, mouth: 0, browTilt: 8, eyesOpen: true, sweat: false }, // tier 0.4
  { lean: 9, armDroop: 20, mouth: -2, browTilt: 14, eyesOpen: false, sweat: true }, // tier 0.6
  { lean: 14, armDroop: 30, mouth: -4, browTilt: 20, eyesOpen: false, sweat: true }, // tier 0.8 — worn out
];

function poseFor(tier: number): Pose {
  let bestIdx = 0;
  let bestDist = Infinity;
  TIER_STEPS.forEach((t, i) => {
    const d = Math.abs(t - tier);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  });
  return POSES[bestIdx] ?? POSES[0]!;
}

const SKIN = "#e8b98f";
const SHIRT = "#c9603f";
const PANTS = "#3a3a3a";

/**
 * A small standalone person, front-on. Characters sit outside the map's `<svg>`
 * (contract section 2), so this renders its own inline `<svg>` with a fixed viewBox
 * and lets CSS size it — never a fragment meant to be pasted into the map.
 *
 * Posture (lean, arm droop) and expression (brows, eyes, mouth) carry all five
 * tiredness steps; colour never does the work alone.
 */
export function Character({ tier }: CharacterProps) {
  const pose = poseFor(tier);
  const shoulderL = { x: 27, y: 46 };
  const shoulderR = { x: 53, y: 46 };
  const eyeY = 22 - pose.lean * 0.15;

  return (
    <svg viewBox="0 0 80 120" width="100%" height="100%" role="img" aria-hidden="true">
      <g transform={`rotate(${pose.lean} 40 70)`}>
        {/* Arms, pivoted at the shoulder so they visibly droop as tiredness rises */}
        <g transform={`rotate(${pose.armDroop} ${shoulderL.x} ${shoulderL.y})`}>
          <rect x={shoulderL.x - 5} y={shoulderL.y} width={9} height={26} rx={4} fill={shade(SHIRT, "dark")} />
        </g>
        <g transform={`rotate(${-pose.armDroop} ${shoulderR.x} ${shoulderR.y})`}>
          <rect x={shoulderR.x - 4} y={shoulderR.y} width={9} height={26} rx={4} fill={shade(SHIRT, "mid")} />
        </g>

        {/* Legs */}
        <rect x={28} y={82} width={10} height={30} rx={3} fill={PANTS} />
        <rect x={42} y={82} width={10} height={30} rx={3} fill={shade(PANTS, "mid")} />

        {/* Torso, split into a lit and shaded half for the same light direction as the scene */}
        <path d="M 26 44 h 14 v 40 h -14 a 8 8 0 0 1 -8 -8 v -24 a 8 8 0 0 1 8 -8 Z" fill={shade(SHIRT, "mid")} />
        <path d="M 40 44 h 14 a 8 8 0 0 1 8 8 v 24 a 8 8 0 0 1 -8 8 h -14 Z" fill={shade(SHIRT, "dark")} />

        {/* Head */}
        <circle cx={40} cy={24} r={14} fill={SKIN} />

        {/* Brows: level and neutral when fresh, angled down toward the nose when worn out */}
        <line x1={30} y1={eyeY - 5} x2={36} y2={eyeY - 5 + pose.browTilt * 0.12} stroke="#4a3324" strokeWidth={1.6} strokeLinecap="round" />
        <line x1={50} y1={eyeY - 5} x2={44} y2={eyeY - 5 + pose.browTilt * 0.12} stroke="#4a3324" strokeWidth={1.6} strokeLinecap="round" />

        {/* Eyes: open circles when fresh, half-closed lines once tiredness passes the midpoint */}
        {pose.eyesOpen ? (
          <>
            <circle cx={35} cy={eyeY} r={1.8} fill="#2a2a2a" />
            <circle cx={45} cy={eyeY} r={1.8} fill="#2a2a2a" />
          </>
        ) : (
          <>
            <line x1={33} y1={eyeY} x2={37} y2={eyeY} stroke="#2a2a2a" strokeWidth={1.6} strokeLinecap="round" />
            <line x1={43} y1={eyeY} x2={47} y2={eyeY} stroke="#2a2a2a" strokeWidth={1.6} strokeLinecap="round" />
          </>
        )}

        {/* Mouth: a smile that flattens and then turns down as the tier climbs */}
        <path
          d={`M 34 ${30 + eyeY - 22} Q 40 ${30 + eyeY - 22 + pose.mouth} 46 ${30 + eyeY - 22}`}
          fill="none"
          stroke="#7a3c2a"
          strokeWidth={1.6}
          strokeLinecap="round"
        />

        {/* A bead of sweat once exhaustion sets in, tiers 0.6 and 0.8 only */}
        {pose.sweat && <path d="M 54 18 q 3 4 0 7 q -3 -1 -3 -3.5 q 0 -2.5 3 -3.5 Z" fill="#8ec9e8" />}
      </g>
    </svg>
  );
}
