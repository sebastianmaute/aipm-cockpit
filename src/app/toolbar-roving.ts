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

// ★★★ THE ELEMENT TYPE IS LOAD-BEARING — do NOT relax it to `Set<string>`.
// This set and the `HandledKey` union have to be tied together or the guard
// below is a LIE. Typed `Set<string>`, adding "PageDown" here without adding it
// to HandledKey compiles clean (measured: TSC_EXIT=0), `isHandledKey` returns
// true for a key the switch has no `case` for, and the switch falls off its end
// returning `undefined` — which is not `null`, so the caller's `=== null` bail
// does NOT catch it. It then calls preventDefault, sets activeIndex to
// undefined, and EVERY control's `activeIndex === N ? 0 : -1` yields -1: the
// whole row silently drops out of the tab order, with a green typecheck and a
// green suite. Typed `Set<HandledKey>`, the same edit fails at the literal.
const HANDLED = new Set<HandledKey>(["ArrowLeft", "ArrowRight", "Home", "End"]);

// ★★ The switch below has NO `default` ON PURPOSE. Narrowed to HandledKey, tsc
// makes it exhaustive, so widening HandledKey without adding its `case` fails
// the typecheck (TS2366 — the function stops returning on every path). A
// `default: return null` arm would be unreachable and would silently swallow
// exactly that drift instead of catching it.
// ★ The cast is what lets a `string` be looked up in a `Set<HandledKey>`; it is
// narrowing-only and cannot admit an unlisted key.
function isHandledKey(key: string): key is HandledKey {
  return (HANDLED as ReadonlySet<string>).has(key);
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
