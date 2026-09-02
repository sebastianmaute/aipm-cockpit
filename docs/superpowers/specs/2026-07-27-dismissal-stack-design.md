# Dismissal stack — design

**Date:** 2026-07-27
**Target release:** 0.203.0
**Supersedes:** the capture-phase arrangement shipped in 0.202.4

## Problem

Escape is a dismissal. Exactly one layer should act on it. The app has no
arbiter, so every closer has had to infer, locally, whether the keypress is
its own — and each one infers differently.

0.202.3 established the mark-and-defer protocol: a widget that dismisses on
Escape calls `preventDefault()`, and the shared `Modal` bails on
`e.defaultPrevented` before acting. Without both halves, one keypress
dismisses two layers — a combobox dropdown *and* the edit modal around it,
discarding the user's draft.

0.202.4 found that the mark alone is not enough for a document-level closer.
Native listeners on one node fire in registration order, and a modal opens
before a popover inside it, so a bubble-phase `preventDefault` lands after the
modal has already closed. Three surfaces (`popover-panel` /
`use-popover-dismiss`, `notes-window`) moved to **capture** phase, which runs
on the way down and therefore reaches the popover before the modal.

Capture bought precedence over `Modal` but not over peers, because capture
listeners are also registration-ordered. It also introduced a new hazard,
found while grounding this design: React delegates `onKeyDown` at *bubble*, so
the four capture-phase document closers now run **before** any combobox's own
handler. A combobox open inside a `PopoverPanel` loses its dropdown *and* the
popover to one keypress — the original two-layer bug, re-created at a
different seam.

Phase ordering is the wrong instrument. The question "which layer owns this
Escape?" is about nesting, and nesting is knowable directly.

## Ground truth before the change

Document-level closers, all registered on `document`:

| Surface | Phase | checks `defaultPrevented` | marks `preventDefault` |
|---|---|---|---|
| `Modal` | bubble | yes (Escape only) | yes — owns a private `modalStack` |
| `use-popover-dismiss` (7 consumers) | capture | yes | yes |
| `popover-panel` (11 consumers) | capture | yes | yes |
| `notes-window` | capture | yes | yes, behind a focus gate |
| `use-focus-trap` (2 consumers) | capture | no | only when `onEscape` given |
| `help-menu` | bubble | no | no |
| `raci-chip-picker` | bubble | no | no |
| `tour-overlay` | bubble | no | yes — but `Modal` already ran, so it does nothing |
| `chat-panel` | bubble | no | no — Escape *aborts an AI call*, gated by an ad-hoc `querySelector('[aria-modal="true"]')` plus a focus check |

> ★★ **One row of the table above has since moved, and this note is here rather than in the table
> because the table is a dated 2026-07-27 baseline that must stay as recorded.** `raci-chip-picker` is
> no longer a document-level closer of its own at all: on 2026-09-02 it adopted `PopoverPanel`
> (`docs/open-followups.md` §334), so it registers no `useDismissable` and inherits the primitive's
> capture-phase behaviour — and it DOES trap Tab. See the note under the Migration table below.

Element-scoped React `onKeyDown` handlers, bound to their own input rather
than to `document`: `entity-link-picker`, `resource-picker`, `combo-input`,
`labels-input`, `stakeholder-recipient-input`, and `global-search-box`.

Note that `global-search-box` belongs in that second group. AGENTS.md
currently describes it as "a bare `onClose()` from a BUBBLE-phase document
listener"; it is not. Its document listener is the ⌘K / `/` focus shortcut,
and its Escape lives on the input's own handler.

## Architecture

Two new files.

### `src/app/dismissal-stack.ts` — pure, React-free, i18n-free

```ts
export type DismissalKind = "modal" | "layer";

pushDismissal(token: symbol, kind: DismissalKind, claims?: () => boolean): void
popDismissal(token: symbol): void
isTopmostOfKind(token: symbol, kind: DismissalKind): boolean
escapeOwner(): symbol | null
claimsEscape(e: KeyboardEvent, token: symbol): boolean
```

A module-level array of entries in open order. `escapeOwner()` walks it
top-down and returns the first entry whose `claims()` returns true; an absent
predicate means the entry always claims.

`claimsEscape` is the single guard every handler calls, and folds the whole
protocol into one place:

```ts
if (e.key !== "Escape") return false;
if (e.defaultPrevented) return false;                  // element-scoped handler took it
if (e.isComposing || e.keyCode === 229) return false;  // IME composition owns Escape
return escapeOwner() === token;
```

A `claims()` predicate that throws is treated as **declining**, not as fatal.
That is the failure direction which keeps Escape working for the layers
beneath rather than killing dismissal app-wide.

### `src/app/use-dismissable.ts` — the React wrapper

```ts
useDismissable({ open, kind, onDismiss, claims? }): void
```

Pushes the entry and registers one **bubble-phase** `document` keydown
listener that runs `claimsEscape` → `preventDefault()` → `onDismiss()`.
No-op while `open` is false: nothing is pushed and no listener is attached.

Exports `claimsWhenFocusWithin(ref)`, the predicate builder shared by
`notes-window` and `help-menu`. One copy, because the duplication gate is
blocking. Both panels already expose a `panelRef` wrapping their panel
element, so neither needs new plumbing to use it.

**Who uses which.** The six simple surfaces — `use-popover-dismiss`,
`popover-panel`, `notes-window`, `help-menu`, `raci-chip-picker`,
`tour-overlay` — use the hook. `Modal` and `use-focus-trap` call the pure
module directly: both also own Tab, and both need their own effect-dependency
discipline that the hook does not impose.

### Two kinds, two questions

`Modal`'s existing `modalStack` gates both Escape and Tab. Those need
different questions after this change:

- **Escape** must defer to a popover sitting on top of the modal →
  `claimsEscape(e, token)`.
- **Tab** must not. Containment is WCAG 2.4.3, and a popover traps nothing, so
  a modal keeps trapping Tab regardless of what is layered above it →
  `isTopmostOfKind(token, "modal")`.

One ordered list answers both. It also makes "is a modal open above me" a
first-class query, which is what `chat-panel`'s `querySelector` guard is
approximating today.

## Three load-bearing rules

Each restates an existing landmine.

1. **Push/pop effect deps are `[open]` alone.** `onDismiss` and `claims` go
   through refs. An unstable `onDismiss` identity re-running the effect would
   re-push the token to the top of the stack and make the wrong layer topmost
   — the exact bug `modal.tsx` documents and guards against today, which bit
   twice before it was understood.

2. **`claims()` is read at event time, not push time.** It must be a live DOM
   read (`document.activeElement`, a ref), never a captured state value.

3. **A surface registers only when it can act.** `useFocusTrap` with no
   `onEscape` must not push an entry at all. An always-claiming entry that
   does nothing swallows Escape and blocks every layer beneath it. This is
   0.202.4's "only consume when you have a handler to hand it to", re-expressed
   as "only register when you can act".

## The precondition everything rests on

Stack order is open order, and open order equals nesting order **because a
layer opens in response to a user action, never in the same commit as its
parent**.

If a parent and child ever pushed in one commit, React runs child effects
before parent effects and the parent would end up topmost — inverted. AGENTS.md
already asserts this for nested modals; this design extends the same assertion
to modal↔popover.

This is stated as a precondition in the module header rather than detected,
because the obvious detection (DOM containment) is defeated by portals, and
`PopoverPanel` is a portal.

Verified: `inline-ai-edit-popover` is the only component using both hooks, and
it passes no `onEscape`, so under rule 3 it contributes exactly one entry. No
same-commit double-push exists today.

## Migration

| Surface | kind | `claims` | change |
|---|---|---|---|
| `Modal` | `modal` | — | `modalStack` → shared stack. Escape → `claimsEscape`; Tab → `isTopmostOfKind`. Tab check moves after the key branch |
| `use-popover-dismiss` (7) | `layer` | — | keeps its own `mousedown` effect; Escape half delegates to `useDismissable`; capture → bubble |
| `popover-panel` (11) | `layer` | — | same |
| `notes-window` | `layer` | `claimsWhenFocusWithin(panelRef)` | gate moves out of the handler into `claims` |
| `use-focus-trap` (2) | `modal` | — | registers only when `onEscape` given; Tab containment stays unconditional and un-gated |
| `help-menu` | `layer` | `claimsWhenFocusWithin(panelRef)` | gains both the protocol and the focus gate |
| `raci-chip-picker` | `layer` | — | gains the protocol; stays transient (still closes on scroll) |
| `tour-overlay` | `modal` | — | its `preventDefault` currently does nothing; now it wins |

> ★★★ **SUPERSEDED 2026-09-02 FOR ONE ROW — `raci-chip-picker`. Left as written, because this table is
> the dated record of what the migration planned; read this note, not the row, for today's behaviour.**
> The row says `layer` / "gains the protocol; stays transient". That was implemented and has since been
> replaced: the picker adopted `PopoverPanel` (`docs/open-followups.md` §334) and now registers **no
> `useDismissable` of its own** — the primitive pushes for it, as **`kind: "modal"`**, and it therefore
> **traps Tab**. That flip obeys this spec's own rule that a surface gaining a real trap flips its kind
> in the SAME commit; it is not a third independent flip but a consumer of the `popover-panel` row
> above. Verify with `grep -n "PopoverPanel\|useDismissable" src/app/raci-chip-picker.tsx`.

**Deliberately not in the stack:** `global-search-box`, the five combobox
inputs, and `chat-panel`. The first six are element-scoped and bound to their
own input — focus location is a stronger signal than open order for a widget
that only exists while its field has focus, and React's boot-registered
delegation already runs them before any effect listener. `chat-panel`'s Escape
cancels an operation rather than dismissing a layer; folding it in would
conflate the two. Its `querySelector` guard stays for now.

`help-menu` gets the focus gate because it is the same shape as
`notes-window`: a persistent draggable floating panel. Without one, opening
help, then opening a task editor, then pressing Escape while typing in the
editor closes help instead of the editor.

## Testing

The ordering logic lives in the pure module, so it is testable without React.

**`dismissal-stack.test.ts`:** push/pop order; `popDismissal` removes the last
occurrence and no-ops on an unknown token; `escapeOwner` walks past declining
entries and returns `null` when all decline; `isTopmostOfKind` ignores the
other kind; `claimsEscape` rejects a non-Escape key, `defaultPrevented`,
`isComposing`, and `keyCode 229`; a throwing predicate declines without
killing the walk.

**React tests** must obey the three topology traps AGENTS.md records — all
three cost real bugs in this line:

- Assert `event.defaultPrevented`, a property of the event. Never "some other
  listener did not fire", which is a property of RTL's div-under-body topology
  and lies about the real app, where the root *is* `document`.
- Dispatch from a focused element. `document.dispatchEvent` is an at-target
  dispatch where capture and bubble both fire in plain registration order, so
  it cannot distinguish a phase fix from a no-op.
- jsdom reports every rect as zero, so a positioned popover never renders.
  Host those tests on the hook.

**Four integration cases**, each a bug that exists or would exist:

1. Popover inside modal → Escape closes the popover only; a second Escape
   closes the modal. *(the 0.202.4 fix; must stay green)*
2. Combobox inside `PopoverPanel` → Escape closes only the dropdown. *(the
   hazard capture introduced; broken today)*
3. `notes-window` open, modal open, focus in the modal → Escape closes the
   modal. *(proves the claims walk: the gate makes notes decline, and without
   the walk nobody would act)*
4. Nested modals → unchanged.

Every new test is mutation-checked: revert the guard it covers, confirm the
test fails. A test that passes both ways proves nothing, and this repo has
shipped several.

## Risks

- `popover-panel` (11 consumers) and `use-popover-dismiss` (7) mean **18 call
  sites inherit this without an edit of their own**. That is the efficiency
  and the danger: one regression in the hook is app-wide.
- `Modal`'s Tab path is WCAG 2.4.3. Its shape changes even though its
  semantics hold. Highest-consequence lines in the diff.
- Returning to bubble inverts precedence between a capture-phase closer and a
  combobox. The inversion is believed correct — the inner widget should win —
  but it is a real behaviour change at 18 sites, not a pure refactor. It
  should be reviewed as such.

## Release

0.203.0. Bump `src/app/version.ts` (APP_VERSION + milestone line), add the
`CHANGELOG.md` entry, add a new `versionHighlight` key to `APP_HIGHLIGHT_KEYS`
with EN and DE strings.

AGENTS.md's Escape-protocol block needs its third rewrite: it currently
documents capture phase as load-bearing, and this removes that. The rewritten
block should lead with the stack as the arbiter, keep the `preventDefault`
mark as the boundary with element-scoped handlers, and record the open-order
precondition above.

## Rejected alternatives

- **Keep the gate inside `notes-window`'s handler.** Not viable. A declining
  topmost entry blocks every lower one, because each lower handler asks "am I
  topmost?" and gets `false`. Escape becomes a no-op.
- **Two stacks** (`modalStack` for Tab, a new one for Escape). Zero risk to
  shipped Tab behaviour, but two orderings that must not drift.
- **Everything in the stack, including comboboxes.** One uniform rule, but six
  more push/pop effects on hot input components, and open order can disagree
  with focus location for a widget bound to its own field.
- **Pure module only, no hook.** Smallest diff, but leaves the listener
  registration boilerplate duplicated eight times against a blocking
  duplication gate.
