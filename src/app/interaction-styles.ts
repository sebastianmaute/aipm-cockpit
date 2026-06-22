// Shared interaction-state class atoms. Pure (no React, i18n-free) so every
// surface composes the SAME hover/focus/press/transition behavior instead of
// re-inventing it per control. Palette-safe by construction: no color, gradient,
// or shadow utilities live here — only motion + the canonical brand focus ring.

/** Canonical keyboard focus ring — the app-wide standard (matches the ~95
 *  existing call sites). Append to every interactive control so focus is
 *  uniformly visible. Pairs `outline-none` with a 2px AIPM-green ring. */
export const FOCUS_RING = "focus:outline-none focus:ring-2 focus:ring-AIPM-green";

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
