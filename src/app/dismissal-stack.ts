// The app's single arbiter for Escape.
//
// Escape is a DISMISSAL: exactly one layer should act on it. Before this
// module, every closer inferred locally whether the keypress was its own, and
// the inference was phase ordering — which fails, because native listeners on
// one node fire in REGISTRATION order and a modal opens before a popover
// inside it. Capture phase papered over that for Modal specifically but not
// for peers (capture listeners are registration-ordered too), and it broke
// element-scoped handlers, which React delegates at BUBBLE: a capture-phase
// closer ran before a combobox's own handler and took both layers down.
//
// Nesting is knowable directly, so this module knows it. Every document-level
// closer registers while open and asks `claimsEscape` before acting. Phase no
// longer matters; every caller is back on bubble.
//
// ★★ PRECONDITION: stack order is OPEN order, and open order equals NESTING
// order, because a layer opens in response to a user action and never in the
// same commit as its parent. If a parent and child ever pushed in one commit,
// React runs child effects BEFORE parent effects and the parent would end up
// topmost — inverted. This is asserted, not detected: the obvious detection is
// DOM containment, and `PopoverPanel` is a portal, which defeats it.

/** `modal` traps Tab; `layer` does not. Both compete equally for Escape. */
export type DismissalKind = "modal" | "layer";

interface DismissalEntry {
  token: symbol;
  kind: DismissalKind;
  /** Return false to pass this Escape down. Absent means "always claims". */
  claims?: () => boolean;
}

const stack: DismissalEntry[] = [];

/** Register an open layer. Call from an `[open]`-keyed effect ONLY — see the
 *  note on `popDismissal`. */
export function pushDismissal(
  token: symbol,
  kind: DismissalKind,
  claims?: () => boolean,
): void {
  stack.push({ token, kind, claims });
}

/** Deregister. Removes the LAST occurrence, so a token pushed twice (which a
 *  correctly-written caller never does) unwinds in the right order.
 *  ★★ The push/pop effect's deps must be `[open]` alone: re-running it moves
 *  the token to the TOP of the stack, making the wrong layer topmost. That bug
 *  bit `modal.tsx` twice via an unstable `onClose` identity before it was
 *  understood — pass handlers through refs, never through deps. */
export function popDismissal(token: symbol): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].token === token) {
      stack.splice(i, 1);
      return;
    }
  }
}

/** Topmost entry of `kind`. This is the TAB question; `escapeOwner` is the
 *  Escape one, and the two answer differently on purpose.
 *  ★★ `kind` MEANS "traps Tab" (see `DismissalKind` above), so asking for the
 *  topmost `"modal"` is asking "is anything above me running a trap of its
 *  own?". A `"modal"` entry layered above another `"modal"` DOES take Tab from
 *  it — the one beneath defers because the one above contains focus itself. A
 *  `"layer"` never takes Tab from anything: it traps nothing, so deferring to
 *  one would strand focus outside every trap (WCAG 2.4.3).
 *  ★ `PopoverPanel` pushes `"modal"` precisely because it runs its own Tab
 *  cycle over its portaled content, and `modal.tsx` deferring to it is the
 *  §100 fix. A surface gaining a real trap flips its kind in the SAME commit. */
export function isTopmostOfKind(token: symbol, kind: DismissalKind): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === kind) return stack[i].token === token;
  }
  return false;
}

/** The one entry that owns the next Escape, or null if nobody claims it.
 *  ★ A predicate that throws DECLINES. That is the failure direction which
 *  keeps Escape working for the layers beneath, rather than killing dismissal
 *  app-wide because one panel's focus check hit a detached node. */
export function escapeOwner(): symbol | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (!entry.claims) return entry.token;
    let claimed: boolean;
    try {
      claimed = entry.claims() === true;
    } catch {
      claimed = false;
    }
    if (claimed) return entry.token;
  }
  return null;
}

/** The single guard every dismissal handler calls. */
export function claimsEscape(e: KeyboardEvent, token: symbol): boolean {
  if (e.key !== "Escape") return false;
  // ★ An element-scoped handler (the combobox pickers, global search) marked
  // this handled. Those stay OUT of the stack on purpose: focus location is a
  // stronger signal than open order for a widget that only exists while its
  // own field has focus, and React's boot-registered delegation already runs
  // them before any effect listener.
  if (e.defaultPrevented) return false;
  // ★ Escape during IME composition cancels the composition, not a layer.
  if (e.isComposing || e.keyCode === 229) return false;
  return escapeOwner() === token;
}

/** TEST ONLY. Empties the stack so one test's leaked entry cannot alter the
 *  next test's ordering. Never call this from app code — it would strand every
 *  open layer's handler, which then silently stops responding. */
export function resetDismissalStack(): void {
  stack.length = 0;
}
