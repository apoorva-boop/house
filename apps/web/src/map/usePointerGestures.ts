import { useEffect, useRef, useState } from "react";
import type { MapPresenter } from "../presenters/MapPresenter.js";

/**
 * Pan, pinch and double-tap for the map, all through Pointer Events — one code path
 * for touch, mouse and Playwright's synthesized touch input alike. There is
 * deliberately no `touchstart`/`touchmove`/`touchend` handler anywhere: Pointer Events
 * already unify them, and a second, parallel touch path would be a second place for
 * the two to disagree.
 *
 * Listeners are attached to `window`, not just the `<svg>`, and this is deliberate
 * rather than a convenience: a pinch's fingers can land — legitimately, for a
 * wide-enough pinch on a small viewport — at a screen point outside the map's own
 * element bounds. Chrome still dispatches that pointerdown (globally, on whatever
 * element happens to be under it), but it would never reach a handler attached only to
 * the `<svg>`, since that element is never an ancestor of the actual event target. A
 * brand-new gesture is still gated against landing on an actual control (see
 * `startsOnControl`) so a tap on the zoom or nav buttons is never mistaken for the
 * start of a pan.
 *
 * `svgRef` is used only to convert `clientX`/`clientY` into the `<svg>`'s own local
 * coordinate space (it has no `viewBox` rescale, so that's a plain offset
 * subtraction) — never to read layout for its own sake.
 */

interface PointerSample {
  readonly x: number;
  readonly y: number;
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;
const TAP_MOVE_SLOP_PX = 10;

function distance(a: PointerSample, b: PointerSample): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: PointerSample, b: PointerSample): PointerSample {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export interface PointerGestureState {
  /** True while at least one pointer is down — the view uses this to zero out the
   *  camera's CSS transition so a drag never lags behind the finger. */
  readonly isPointerActive: boolean;
}

export function usePointerGestures(
  map: MapPresenter,
  svgRef: { readonly current: SVGSVGElement | null },
): PointerGestureState {
  const [isPointerActive, setPointerActive] = useState(false);

  // Mutable gesture bookkeeping. None of this is render state — it changes on every
  // pointermove, far too often to push through React's state queue.
  const pointers = useRef(new Map<number, PointerSample>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef<{ assetId: string; time: number; x: number; y: number } | null>(null);
  /** Where the current single-pointer gesture began — total movement is measured from
   *  here, not step-to-step, so a slow drag made of many small moves still cancels a
   *  pending double-tap once it has gone far enough in total. */
  const gestureOrigin = useRef<PointerSample | null>(null);

  useEffect(() => {
    function localPoint(e: PointerEvent): PointerSample {
      const svg = svgRef.current;
      const rect = svg !== null ? svg.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function assetIdFor(e: PointerEvent): string | null {
      const el = (e.target as Element | null)?.closest("[data-asset-id]") ?? null;
      return el instanceof Element ? el.getAttribute("data-asset-id") : null;
    }

    /**
     * A brand-new gesture (no pointer down yet) is rejected only when it starts on an
     * actual `<button>` (zoom, nav, a character overlay) — so a tap there is never
     * read as the start of a pan, and its own `onClick` handles it undisturbed.
     *
     * This is deliberately *not* "must start inside the `<svg>`": a wide pinch on a
     * narrow viewport can have both starting touches land outside the map's own
     * element bounds (the two fingers are equidistant from a centre point, so a big
     * enough starting distance pushes both past the screen edge) while still being a
     * completely legitimate gesture on the map. A real touch can never land outside
     * the device's own screen, but the coordinates a pinch is defined by very much
     * can once projected onto a small viewport — this is that case, not a stray touch
     * elsewhere in the app.
     */
    function startsOnControl(e: PointerEvent): boolean {
      return e.target instanceof Element && e.target.closest("button") !== null;
    }

    function onPointerDown(e: PointerEvent): void {
      if (pointers.current.size === 0 && startsOnControl(e)) return;

      const point = localPoint(e);
      pointers.current.set(e.pointerId, point);
      setPointerActive(true);
      const svg = svgRef.current;
      // Only capture when this pointer's own hit-test actually resolved inside the
      // `<svg>` — capturing a pointer to an element outside its real hit-test chain
      // (which is exactly what a pinch finger landing outside the map's own bounds,
      // per this function's top comment, would be) makes Chrome cancel the touch
      // outright rather than continue delivering its moves.
      if (svg !== null && e.target instanceof Node && svg.contains(e.target)) {
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          // Capture is a best-effort nicety here (this listener is already global on
          // `window`, so events keep arriving without it) — never worth failing over.
        }
      }

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        if (a !== undefined && b !== undefined) {
          pinchStart.current = { distance: Math.max(1, distance(a, b)), scale: map.state.camera.scale };
        }
      } else if (pointers.current.size === 1) {
        pinchStart.current = null;
        gestureOrigin.current = point;
        const assetId = assetIdFor(e);
        const now = Date.now();
        const prior = lastTap.current;
        if (
          assetId !== null &&
          prior !== null &&
          prior.assetId === assetId &&
          now - prior.time <= DOUBLE_TAP_MS &&
          distance(prior, point) <= DOUBLE_TAP_SLOP_PX
        ) {
          map.fitAsset(assetId);
          lastTap.current = null;
        } else if (assetId !== null) {
          lastTap.current = { assetId, time: now, x: point.x, y: point.y };
        } else {
          lastTap.current = null;
        }
      }
    }

    function onPointerMove(e: PointerEvent): void {
      if (!pointers.current.has(e.pointerId)) return;
      const point = localPoint(e);
      const previous = pointers.current.get(e.pointerId);
      pointers.current.set(e.pointerId, point);

      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        if (a !== undefined && b !== undefined && pinchStart.current !== null) {
          const currentDistance = Math.max(1, distance(a, b));
          const nextScale = pinchStart.current.scale * (currentDistance / pinchStart.current.distance);
          map.zoomToScale(nextScale, midpoint(a, b));
        }
        return;
      }

      if (previous !== undefined) {
        map.panBy(point.x - previous.x, point.y - previous.y);
        // A pan that moves further than a tap's slop (measured from where this
        // pointer went down, not step-to-step) cancels any pending double-tap — a
        // drag that happens to end on the same asset twice must not read as one.
        const origin = gestureOrigin.current;
        if (origin !== null && distance(point, origin) > TAP_MOVE_SLOP_PX) {
          lastTap.current = null;
        }
      }
    }

    function endPointer(e: PointerEvent): void {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinchStart.current = null;
      if (pointers.current.size === 0) setPointerActive(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
    };
  }, [map, svgRef]);

  return { isPointerActive };
}
