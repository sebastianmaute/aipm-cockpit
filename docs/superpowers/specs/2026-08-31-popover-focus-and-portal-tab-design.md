# Popover focus and portal Tab — design

**Date:** 2026-08-31
**Closes:** open-followups §100, §297, §124
**Branch:** `fix/popover-focus-and-portal-tab`
**Target version:** 0.270.0 (0.269.0 "Due" is reserved by a concurrent unmerged branch)
**Mint new register numbers from 316** — 304, 305 and 308–315 are reserved on that same branch and are not yet on `origin/main`.

## Goal

Three keyboard and focus defects in the popover/modal subsystem, all the same shape: behaviour that
belongs to the `PopoverPanel` and `Modal` primitives was left to call sites, and the call sites do
not do it. Fix all three inside the primitives.

## Required reading before any edit

`docs/AGENTS/ui-shell.md`, the dismissal section — AGENTS.md flags it as owning the Escape/Tab
protocol. Its rules are load-bearing for two of the three fixes below.

## The three defects

### §100 — Tab ejects focus from a portaled popover opened inside a modal

Measured in Chromium 2026-08-06. Open any edit modal, open the field-visibility popover in its
header, press Tab once: focus lands back on the trigger while the popover stays open. Same from a
checkbox inside the popover. The checkbox list and the Reset button therefore have **no keyboard
path at all** — WCAG 2.1.1.

Cause: `Modal`'s Tab handler collects focusables from its dialog container and guards on
`container.contains(active)`. `PopoverPanel` renders through `createPortal` into `document.body`, so
`contains` is false for **every** element inside the popover, not merely at the boundary. The first
Tab satisfies the "focus escaped" branch unconditionally and re-focuses the modal's own first or last
focusable.

The dismissal stack is not at fault. A popover pushes `kind: "layer"`, which deliberately traps
nothing so the modal keeps Tab. The gap is that the modal's trap cannot see portaled layer content,
so it does not deliver on that stated intent.

Reproduce the shape:
`grep -n "container.contains(active)" src/app/modal.tsx`

### §297 — focus falls to `document.body` when a menu item is activated

`PopoverPanel` has `closeRestoringFocus`, wired at exactly one place —
`useDismissable({ open, kind: "layer", onDismiss: closeRestoringFocus })`. Every other close path
calls the raw `onClose`: the outside-`mousedown` listener, the ancestor-`scroll` listener, the
width-`resize` listener, and — the case this entry is about — consumers that close the panel from an
item's own handler in order to act.

Measured population: **15 ACTIVATE sites across 8 of the 16 consumer files**, of which 2 are already
correct in `undo-control`, leaving **13 sites in 7 files**. A further 8 sites sit one hop out in
child components reached through a forwarded `onClose` (`dashboard-tile-menu`, and the escalate /
rebaseline / reschedule trio behind `action-popover-trigger`), giving a widest reading of 17 sites in
10 files.

Enumerate the consumers:
`grep -rln "<PopoverPanel" src/app --include=*.tsx | grep -v "\.test\."`

### §124 — a popover opened by a click that also scrolls its ancestor never mounts

One effect in `popover-panel.tsx` does two jobs: it measures the anchor and calls `setPos`, and in
the same pass registers a capture-phase window `scroll` listener whose handler calls `onClose` for
any scroll outside the panel. Render is gated on `open && pos`. A click that focuses a trigger inside
a horizontally scrollable container makes the browser scroll that container to reveal the trigger;
that scroll is dispatched after the click handler and its effects, so it lands on the freshly
registered listener and closes a panel that has never been in the DOM. `aria-expanded` goes back to
`false`.

The `autoFocus` effect already passes `preventScroll` for exactly this reason — so the *programmatic*
focus case was closed and the *click-driven* reveal-scroll was not.

## Design

### §100 — `PopoverPanel` owns Tab while open, and its `kind` becomes `"modal"`

`PopoverPanel` gains a Tab cycle over `panelRef` (Tab from the last focusable wraps to the first,
Shift+Tab from the first wraps to the last, and a Tab arriving while focus is outside the panel pulls
it to the first). Escape and outside-click remain the exits, unchanged.

Its dismissal entry flips from `kind: "layer"` to `kind: "modal"` **in the same commit**. This is not
optional bookkeeping: `docs/AGENTS/ui-shell.md` states that `kind` MEANS "traps Tab", not "looks like
a dialog", and that a surface gaining a real trap must flip its `kind` in the same commit. The flip
is also the mechanism that makes the fix correct — `Modal`'s Tab branch consults
`isTopmostOfKind(token, "modal")`, which goes false while a popover is open above it, so the modal
defers instead of competing.

**The new Tab cycle is itself gated on `isTopmostOfKind`**, symmetric with `Modal`. This handles the
inverse nesting that exists today: `version-menu`'s `VersionInfo` child opens a `Modal` from *inside*
the popover, so the popover must stand down when a modal is layered above it. Making the rule uniform
— every Tab trap consults the stack — is what keeps this from becoming a second competing trap.

**Blast radius.** Only two of the sixteen consumers ever mount inside a `Modal`:
`modal-field-controls` (via `budget-bucket-modal`, `edit-modal-chrome`, `task-form-modal`) and
`rich-text-toolbar` (via `rich-text-editor` in four edit modals). No other consumer changes
behaviour, because outside a modal there was no competing trap to defer to.

**Rejected — teach `Modal`'s trap to include the DOM of any open layer above it.** This requires
`DismissalEntry` to carry a DOM node, and the stack's precondition closed that deliberately: the
membership is ASSERTED, NOT DETECTED, because the obvious detection is DOM containment and
`PopoverPanel` is a portal, which defeats it. Reopening a closed design decision to fix two panels is
the wrong trade.

**Rejected — Tab closes the popover and returns focus to the trigger.** This pattern already ships
for one portaled popover (the collapsed-rail nav flyout, where Tab must `preventDefault` and re-focus
the trigger because the panel is portaled to the end of `document.body` and simply closing would let
sequential navigation resume outside the app). It does not transfer: that flyout's items are all
`tabIndex={-1}` and arrow-navigated, so Tab-closes costs nothing there. The field-visibility
popover's checkbox list has no arrow-key fallback, so Tab-closes would leave it exactly as
unreachable as it is today — it would fix the WCAG 2.4.3 symptom and not the WCAG 2.1.1 defect §100
is filed for.

**Known risk — RESOLVED 2026-08-31 before implementation: NOT REACHABLE.** `use-focus-trap.ts` also
pushes `kind: "modal"` but its Tab branch never consults the stack, so a `PopoverPanel` open inside a
surface using that hook would be a second uncoordinated trap. Both call sites were traced and neither
can contain one today, so **`use-focus-trap.ts` is not modified by this slice**:

- `modern-shell`'s narrow-viewport drawer renders the sidebar through `renderSidebar` with a
  hardcoded `false` for `collapsed`, and `CollapsedNavFlyout` — the only `PopoverPanel` in that
  subtree — is gated on `collapsed`. The exclusion is that single literal, NOT a viewport invariant:
  `SIDEBAR_NARROW_QUERY` is `(max-width: 1023px)` and narrow does default to collapsed; the drawer
  deliberately overrides it to render the sidebar expanded.
- `inline-ai-edit-popover` renders no `PopoverPanel` anywhere in its transitive closure and takes no
  `ReactNode` prop through which one could arrive.

**The failure mode is not the one this risk was originally written against, and the guard comment
must say so.** `PopoverPanel` portals to `document.body` while `useFocusTrap` enumerates
`container.querySelectorAll(FOCUSABLE_SELECTOR)`. A popover inside the drawer would therefore not
produce two symmetric traps competing — its DOM is invisible to the drawer's focusables list, so the
drawer trap would yank focus back OUT of the popover on every Tab. That is §100's own defect one
layer up.

**Two single-token regressions would make it reachable**, both in files this slice does not otherwise
touch, which is why the guard comment is anchored at the literal rather than only in the primitive:
`renderSidebar`'s hardcoded `false` becoming `collapsed`, or anything under `sidebar-footer.tsx`
gaining a `PopoverPanel` — the `footer` slot renders inside the drawer ungated, and because it
arrives as a prop no import-closure check over `sidebar.tsx` can ever see it.

**Filed separately, not fixed here:** `use-focus-trap`'s Tab branch is gated on `active` alone while
its stack push is gated on `active && hasEscape`, so `inline-ai-edit-popover` — which passes no
`onEscape` — runs a live Tab trap while never joining the stack, invisible to any stack-consulting
logic. Register entry minted from 316.

Verify the current asymmetry:
`grep -rn "isTopmostOfKind" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`

### §297 — restore focus in the primitive, on unmount

When `PopoverPanel` unmounts, if `document.activeElement` is still inside `panelRef`, focus the
anchor. The check runs in effect cleanup, while the panel's DOM is still attached.

**Why not thread `closeRestoringFocus` out to consumers.** Two measured reasons, either of which is
sufficient:

1. Several ACTIVATE sites close with a **raw `setOpen(false)`** rather than the memoised `close` —
   `export-menu`'s `pick`, both `template-menus` `submit` handlers, `action-cta-controls`' shared
   `item` helper, and all three `task-row` menu items. A fix that rewires the `close` identifier
   misses every one of them, silently and with no gate able to see it.
2. Three consumers already restore focus, with deliberately different semantics that a shared helper
   would regress. `undo-control` uses a **wider** condition than `closeRestoringFocus` does — it also
   catches focus already lost to `body` — and carries `armExitFocus` for the case where its own
   caret unmounts. `dashboard-panel` deliberately focuses a **different** element from the anchor,
   because the tile moved and its old anchor is stale. `sidebar-nav` restores on Escape and Tab
   already, leaving only its nav-item click unfixed.

The unmount guard resolves both without a per-site audit. A consumer that has already moved focus has
moved it *out of the panel*, so the containment check reads false and the primitive stands down. No
opt-out prop is needed and no consumer file is edited.

The 13-sites-in-7-files figure above is the **population of the defect**, not an edit list. This
design changes one file to fix all of them; the count is what a per-consumer fix would have had to
touch, and is recorded so the test population can be drawn from it.

**`closeRestoringFocus` stays, and the two compose.** It is not made redundant: it focuses the anchor
*before* calling `onClose`, which avoids a frame in which `document.activeElement` is `body`, and
that ordering is worth keeping on the Escape path. With both in place the Escape path restores first,
which moves focus out of the panel, so the unmount guard then reads false and does nothing. Removing
either would work; keeping both is the smaller change and is idempotent by construction. This must be
stated in the code, or the next reader will delete one as dead.

**Deliberate behaviour change, taken knowingly.** This also restores focus on scroll- and
resize-driven dismissal, which the primitive's current comment excludes. That exclusion is being
changed, not overlooked. Its stated reason — that restoring from all four paths would yank the user
back to the trigger after they deliberately clicked somewhere else — is an argument about
outside-**click**, where focus is elsewhere and the containment guard already declines. When focus is
*inside* the panel and the panel unmounts, the alternative to restoring is not "leave the user where
they were"; it is `document.body`. The comment must be rewritten to state the new rule and why it
changed, not merely edited around.

`document-block-gutter`'s `close` also clears its pending insert position, and `dashboard-panel`'s
`closeMenu` nulls the state that owns the anchor's lifetime. Neither is affected — this design adds
no new call to any consumer's `close`.

### §124 — arm the listeners only once the panel is rendered

Split the effect in `popover-panel.tsx`. Measurement (`setPos`) stays gated on `open`. The `scroll`
and `resize` listeners move to a second effect gated on `open && pos` — the same condition the render
is gated on, so a listener cannot exist while the panel does not.

This applies a rule the subsystem already states: `usePanelInitialFocus`'s flag means "the panel is
RENDERED", not "open". §124 is that rule un-applied to these two listeners. The existing inline
comment reasons about render only ("stale pos is harmless — the panel is gated on `open && pos`") and
not about the listeners it sits beside.

**Gate on a boolean, not on `pos` itself.** `pos` is a fresh object and the post-paint clamp effect
rewrites it, so a dep array carrying `pos` would tear down and re-register both window listeners on
every clamp pass. The second effect depends on `open`, `onClose` and a derived `pos !== null`, so it
registers once when the panel becomes rendered and not again while it stays rendered.

## Testing

**The existing guard is false-green and must not be trusted.** `modal.test.tsx`'s "keeps Tab
containment when a popover layers above it" pushes a bare `Symbol` with no DOM and asserts with focus
on the modal's own buttons. It stays green under every direction considered here, including the one
chosen. It is not deleted — it pins a real property — but it cannot detect this defect class and a
new test must.

New coverage, in `dismissal-integration.test.tsx`, which today has no Tab case at all:

1. **§100** — a popover opened from a trigger inside a real `Modal`; Tab from the last control inside
   the popover reaches the first control inside the popover, not the modal's. Shift+Tab from the
   first reaches the last. The popover stays open throughout.
2. **§100 inverse** — a `Modal` opened from inside a popover traps Tab; the popover beneath does not.
3. **§297** — activating an item that closes the panel with a raw `setOpen(false)` returns focus to
   the anchor. The raw spelling is the point: a test written against the memoised `close` passes
   against a fix that misses four real sites.
4. **§297 non-regression** — a consumer that already moved focus keeps it; the primitive does not
   steal it back.
5. **§124** — a scroll dispatched between open and paint does not close the panel.

**Test-topology constraints, from the subsystem doc.** jsdom reports every rect as zero, so a
positioned popover never renders — a §100 test cannot simply declare `PopoverPanel` open, it must be
driven from a trigger click the way `ModalWithPopover` in `dismissal-integration.test.tsx` already
does. A harness that renders a popover as a child of an already-open modal in one commit inverts
Escape. `document.dispatchEvent` is AT-TARGET and cannot distinguish capture from bubble — fire from
a focused element instead.

Every new assertion is mutation-checked. §297's mutation must specifically kill a raw-`setOpen(false)`
site, since that is the case the obvious fix misses.

## Out of scope

- Repositioning the panel on ancestor scroll instead of closing it. Better product behaviour, and it
  addresses §124's stated cause rather than its symptom, but it is a third change to a primitive this
  slice already changes twice.
- The three consumers with no test file at all (`action-cta-controls`, `action-popover-trigger`,
  `version-menu`). Noted by §100; not created here.
- §296, §128, §148, §120 — all being closed on the concurrent branch.

## In scope but easy to forget

- **`docs/AGENTS/ui-shell.md`'s claim that only the topmost modal contains Tab is false today** —
  `use-focus-trap` pushes `kind: "modal"` and traps unconditionally. Since the drawer case is NOT
  reachable, the hook is left alone and **the doc gains the exception** rather than the claim becoming
  true. Leaving the sentence as-is is not an option, because this slice adds a second stack-consulting
  trap that reasons from it.

## Two supporting API changes, both forced by the design

- **`useDismissable` must return its token.** It returns `void` today and seals the token in a ref, so
  `PopoverPanel` has no way to ask `isTopmostOfKind(token, "modal")` — which §100's inverse-nesting
  gate requires. The change is `return tokenRef.current`, typed `symbol`. Purely additive: all six
  existing consumers ignore the return and none changes behaviour.
- **`FOCUSABLE_SELECTOR` moves to a shared module.** It is already copy-pasted three times — in
  `modal.tsx`, `use-focus-trap.ts` and `undo/undo-control.tsx` — and the Tab cycle needs a fourth.
  The three differ only in whitespace after the commas, which a CSS selector list ignores, so
  extracting them to one exported constant is behaviour-preserving. Taken rather than dodged because
  the alternative is shipping the fourth copy; it is the only part of this slice that touches
  `use-focus-trap.ts` or `undo/undo-control.tsx`, and it touches them by import line only.
- **The `kind` flip is a documented protocol change**, so the dismissal section's description of what
  `PopoverPanel` pushes must move with it.
- **`closeRestoringFocus`'s comment currently states a rule this slice changes** (Escape-only
  restoration). It is rewritten, not edited around.
