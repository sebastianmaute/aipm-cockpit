// Shared interaction-state class atoms. Pure (no React, i18n-free) so every
// surface composes the SAME hover/focus/press/transition behavior instead of
// re-inventing it per control. Palette-safe by construction: no color, gradient,
// or shadow utilities live here — only motion + the canonical brand focus ring.

/** Canonical keyboard focus ring — the app-wide standard (matches the ~95
 *  existing call sites). Append to every interactive control so focus is
 *  uniformly visible. Pairs `outline-none` with a 2px ui-green ring. */
export const FOCUS_RING = "focus:outline-none focus:ring-2 focus:ring-ui-green";

/** §757 — room for that ring inside a SCROLL container. A scrolling box clips everything outside its padding
 *  box, and `FOCUS_RING` draws 2px OUTSIDE the control, so a control flush with the box's edge lost its ring on
 *  that side ("Draft with AI" in a status report). 2px of padding cancelled by 2px of negative margin leaves the
 *  content where it was and the clip edge 2px further out. Append it to the scroll container, not the control.
 *  ★ Useless where the container's own parent clips at the same edge (the sidebar at the window edge): draw that
 *  ring inset instead. */
export const RING_ROOM = "-m-0.5 p-0.5";

/** Subtle physical press feedback. Transform-only → palette-irrelevant and
 *  GPU-cheap; `translate-y` (not `scale`) avoids the layout reflow that scaling
 *  causes inside flex/grid rows. */
export const PRESS = "active:translate-y-px";

/** Standard 150ms color transition for hover/focus state changes. Mirrors the
 *  existing `transition-colors` usage; animates color only, so it never touches
 *  layout or the palette. */
export const TRANSITION = "transition-colors duration-150";

/** Interaction bundle for most controls: smooth color transition + canonical
 *  focus ring + press feedback. Compose AFTER the control's own color classes
 *  (which define the hover background/text) so this only adds behavior. */
export const INTERACTIVE = `${TRANSITION} ${FOCUS_RING} ${PRESS}`;
