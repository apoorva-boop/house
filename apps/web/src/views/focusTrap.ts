/**
 * Focusable, visible descendants of `container`, in DOM order — the Tab cycle a
 * focus-trapped panel wraps around (map contract section 3). "Visible" is measured by
 * `getClientRects().length > 0` rather than the more common `offsetParent !== null`
 * check: `offsetParent` is null for `position: fixed` elements in most browsers, which
 * is exactly what every panel control here is, so that check would report a fully
 * visible, on-screen button as hidden.
 */
export function focusableElements(container: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button, input, select, textarea, [tabindex]';
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return candidates.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) < 0) return false;
    return el.getClientRects().length > 0;
  });
}
