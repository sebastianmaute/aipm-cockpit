// Keyboard roving for the rich-text toolbar row. Pure, i18n-free and DOM-free:
// the caller owns focus and state, this owns only "which index next".
//
// ★★★ Why this is not `useTablistRoving` or `SegmentedControl`'s radiogroup
// walk: both ACTIVATE on focus (the tablist hook ends in `target.click()`),
// which is APG-correct for tabs and radios and wrong for a toolbar. Arrowing
// across this row must move focus and nothing else — activating on focus would
// run Bold/Italic/Quote and mutate the user's document on every keypress.
//
// ★ Shape follows band-roving.ts: a pure engine plus a thin React caller. A
// shared 1-D movement engine for tablist + toolbar is a real opportunity and is
// deliberately not taken here — it would refactor two working consumers as a
// rider on an a11y slice.

/** Keys this model handles. Anything else is left to bubble untouched — Tab
 *  must still escape the row, Enter/Space must still reach the control, and
 *  Up/Down must still scroll the page (the row is horizontal). */
type HandledKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

const HANDLED = new Set<string>(["ArrowLeft", "ArrowRight", "Home", "End"]);

// ★★ The switch below has NO `default` ON PURPOSE. Narrowed to HandledKey, tsc
// makes it exhaustive, so adding a key to HANDLED without adding its `case`
// fails the typecheck. A `default: return null` arm here would be unreachable
// and would silently swallow exactly that drift instead of catching it.
function isHandledKey(key: string): key is HandledKey {
  return HANDLED.has(key);
}

/**
 * Next focus index for `key`, or `null` when the key is not part of this model
 * (the caller must then NOT preventDefault).
 *
 * A handled bare key on a NON-EMPTY row always returns an index, so the caller
 * can preventDefault whenever this returns non-null. An empty row returns null
 * for every key — see the `count <= 0` guard, pinned by "returns null for an
 * empty row".
 */
export function moveToolbarFocus(
  count: number,
  index: number,
  key: string,
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): number | null {
  if (count <= 0) return null;
  if (!isHandledKey(key)) return null;
  // A chord belongs to the browser or the OS — Alt+Left is Back. (Shift is
  // deliberately absent: it produces no competing default here.)
  if (modifiers?.altKey || modifiers?.ctrlKey || modifiers?.metaKey) return null;
  // Clamped, so a stale index surviving a row that changed under it degrades to
  // a neighbour rather than throwing or returning an out-of-range hit.
  const i = Math.min(Math.max(index, 0), count - 1);

  switch (key) {
    case "Home": return 0;
    case "End": return count - 1;
    case "ArrowRight": return (i + 1) % count;
    case "ArrowLeft": return (i - 1 + count) % count;
  }
}
