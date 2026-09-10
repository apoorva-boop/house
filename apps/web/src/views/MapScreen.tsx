// Wires the map scene to its two panels. Scene.tsx stays exactly the scene graph the
// map contract's section 2 fixes; everything about opening, closing, trapping focus in
// and returning focus from a panel lives here instead.
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import type { MapPresenter } from "../presenters/MapPresenter.js";
import type { AssetPanelPresenter } from "../presenters/AssetPanelPresenter.js";
import type { PersonPanelPresenter } from "../presenters/PersonPanelPresenter.js";
import { Scene } from "../map/Scene.js";
import { AssetPanelView } from "./AssetPanelView.js";
import { PersonPanelView } from "./PersonPanelView.js";
import { focusableElements } from "./focusTrap.js";

export interface MapScreenProps {
  readonly map: MapPresenter;
  readonly assetPanel: AssetPanelPresenter;
  readonly personPanel: PersonPanelPresenter;
  readonly onNavChores: () => void;
  readonly onNavStats: () => void;
  readonly onAddChore: () => void;
}

/** A pointer drag past this many CSS px, dominantly downward, dismisses the open panel. */
const SWIPE_CLOSE_PX = 80;

/** `document.activeElement`, narrowed to something `.focus()`-able — an asset's own
 *  focusable element is an SVG `<g>`, not an `instanceof HTMLElement`. */
function activeTriggerElement(): HTMLElement | SVGElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement || active instanceof SVGElement) return active;
  return null;
}

export function MapScreen({ map, assetPanel, personPanel, onNavChores, onNavStats, onAddChore }: MapScreenProps) {
  const assetState = useSyncExternalStore(assetPanel.subscribe, assetPanel.snapshot);
  const personState = useSyncExternalStore(personPanel.subscribe, personPanel.snapshot);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The element that opened the panel — the scrim, panel-close, Escape and a downward
  // swipe all return focus here (map contract section 3), never just "somewhere
  // sensible". An asset's own focusable element is an SVG `<g>` (map contract section
  // 2), not an HTMLElement, so this has to be typed and checked for either.
  const triggerRef = useRef<HTMLElement | SVGElement | null>(null);
  const swipeStartY = useRef<number | null>(null);

  const isOpen = assetState.open || personState.open;

  function closePanel(): void {
    assetPanel.close();
    personPanel.close();
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger !== null) trigger.focus();
  }

  // Move focus into the panel the moment it mounts. Note the camera is never touched
  // here: the plan (section 3a) wanted the tapped object scrolled clear of the sheet on
  // open, but a move-on-open plus a restore-on-close would satisfy the frozen "camera
  // preserved" tests without there being any real difference a test could hold honest —
  // that is machinery this view deliberately does not add.
  useEffect(() => {
    if (!isOpen) return;
    const container = panelRef.current;
    if (container === null) return;
    const focusable = focusableElements(container);
    (focusable[0] ?? container).focus();
  }, [isOpen]);

  function handleSelectAsset(assetId: string): void {
    triggerRef.current = activeTriggerElement();
    assetPanel.open(assetId);
  }

  function handleSelectPerson(personId: string): void {
    triggerRef.current = activeTriggerElement();
    personPanel.open(personId);
  }

  function handlePanelKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
      return;
    }
    if (e.key !== "Tab") return;
    const container = panelRef.current;
    if (container === null) return;
    const focusable = focusableElements(container);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    const activeInside = active instanceof Node && container.contains(active);
    if (e.shiftKey) {
      if (!activeInside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!activeInside || active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handlePanelPointerDown(e: PointerEvent<HTMLDivElement>): void {
    swipeStartY.current = e.clientY;
  }

  function handlePanelPointerUp(e: PointerEvent<HTMLDivElement>): void {
    const start = swipeStartY.current;
    swipeStartY.current = null;
    if (start === null) return;
    if (e.clientY - start > SWIPE_CLOSE_PX) closePanel();
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <Scene
        map={map}
        onSelectAsset={handleSelectAsset}
        onSelectPerson={handleSelectPerson}
        onNavChores={onNavChores}
        onNavStats={onNavStats}
        onAddChore={onAddChore}
      />

      {/* Beside the scrim on purpose, not inside <Scene>'s `.map-screen` section. That
          section is position: fixed, which makes it a stacking context of its own, so
          nothing inside it -- whatever its z-index -- can paint above the scrim and the
          sheet rendered below. Flow 58 needs the zoom range reachable with a panel open
          by someone who cannot pinch, so the buttons live here, where their z-index 12
          really does put them above the scrim (10) and the sheet (11). */}
      <div className="map-zoom-controls">
        <button
          type="button"
          data-testid="zoom-in"
          aria-label="Zoom in"
          onClick={() => {
            map.zoomBy(1.25);
          }}
        >
          +
        </button>
        <button
          type="button"
          data-testid="zoom-out"
          aria-label="Zoom out"
          onClick={() => {
            map.zoomBy(0.8);
          }}
        >
          &minus;
        </button>
      </div>

      {isOpen && <div data-testid="panel-scrim" className="panel-scrim" onClick={closePanel} />}

      {assetState.open && (
        <AssetPanelView
          state={assetState}
          onTick={(choreId) => {
            void assetPanel.tick(choreId);
          }}
          onClose={closePanel}
          panelRef={panelRef}
          onKeyDown={handlePanelKeyDown}
          onPointerDown={handlePanelPointerDown}
          onPointerUp={handlePanelPointerUp}
        />
      )}

      {personState.open && (
        <PersonPanelView
          state={personState}
          onClose={closePanel}
          panelRef={panelRef}
          onKeyDown={handlePanelKeyDown}
          onPointerDown={handlePanelPointerDown}
          onPointerUp={handlePanelPointerUp}
        />
      )}
    </div>
  );
}
