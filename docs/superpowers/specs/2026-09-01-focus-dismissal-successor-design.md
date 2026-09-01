# Focus and dismissal successor — design

Closes `docs/open-followups.md` **§8** and **§318**. Roadmap slice 9
(`docs/superpowers/specs/2026-08-31-followup-slice-roadmap.md`), the successor slice to §100 · §297 ·
§124, which landed in 0.270.0 and left these two deliberately open so they could be closed on top of a
merged `kind: "modal"`.

Every claim below was read out of the source on 2026-09-01 against `fb66aeec` (0.273.0 "Goonan").

---

## 1. What is actually wrong

Three defects, and the third is the one that decides the shape of the fix. Only the first two are
filed; the third was found while checking whether the filed fix for §8 would work.

### §318 — the trap is invisible to every reader that reasons about Tab

`use-focus-trap.ts` gates its two halves on different conditions:

- the **stack push** is `if (!active || !hasEscape) return;`
- the **keydown listener** is `if (!active) return;`

`inline-ai-edit-popover.tsx` calls `useFocusTrap(ref, true, undefined, inputRef)` — no `onEscape` —
so it runs a live, unconditional Tab trap while never appearing in the dismissal stack at all.
`modal.tsx` and `popover-panel.tsx` both decide whether to trap Tab by asking
`isTopmostOfKind(token, "modal")`, and neither can see this trap.

★ **The gate itself is right and is not being undone.** The hook's comment gives the reason: an
entry that always claims Escape while holding no handler swallows the key and leaves every layer
beneath unclosable. That rule stands.

### §8 — `tour-overlay` announces containment it does not implement

`tour-overlay.tsx` renders its card as `role="dialog"` + `aria-modal="true"`, and traps nothing. It
pushes `kind: "layer"`, which is the honest tag for a surface with no trap and is what stops it
taking Tab away from a co-open `Modal` — but it does nothing about the tour's own missing
containment. Shift+Tab from the card walks into the app behind the dimmed backdrop.

### The unfiled third: `use-focus-trap` has no containment branch

Its entire Tab body compares `document.activeElement` against its own `first` and `last` and
nothing else:

```ts
if (e.shiftKey && activeEl === first) { … } else if (!e.shiftKey && activeEl === last) { … }
```

`modal.tsx` carries `active === last || !container.contains(active)` and the mirror of it under
`shiftKey`; `use-focus-trap.ts` carries no equivalent. Focus that is inside the container but on
neither edge is fine either way. Focus **outside** the container matches neither arm, so the trap
declines to act and Tab leaves. §318 already records this as the mechanism by which a portaled
element makes the trap go inert rather than fight.

★★★ **This is what makes the obvious §8 fix a no-op, and it is the reason this slice touches the
hook at all.** The tour focuses its CARD on every step (`cardRef.current?.focus()`, keyed on the
step index), and the card is `tabIndex={-1}`, which
`FOCUSABLE_SELECTOR`'s `[tabindex]:not([tabindex="-1"])` clause excludes by construction. So at the
moment the overlay opens, `document.activeElement` is a node that is inside the container and
absent from `items` — the exact state both arms miss. Dropping `useFocusTrap` into `tour-overlay`
and stopping there would ship a green test suite over a trap that is inert on the first keypress,
which is the only keypress that matters.

---

## 2. The fix

Three changes, in dependency order. The first two are one commit — see the ordering hazard.

### C1 — `useFocusTrap` always joins the stack, and declines Escape instead of staying out

Push whenever `active`, and pass the stack the `claims` predicate it already supports:

```ts
useEffect(() => {
  if (!active) return;
  const token = tokenRef.current;
  pushDismissal(token, "modal", () => hasEscape);
  return () => popDismissal(token);
}, [active, hasEscape]);
```

`dismissal-stack.ts` documents `claims` as "Return false to pass this Escape down", and
`escapeOwner()` walks past a declining entry to the one beneath. So the property the old gate
existed to protect is preserved exactly — a handler-less trap still never swallows Escape — while
the entry becomes visible to `isTopmostOfKind`.

★ `hasEscape` is a boolean and is already in the deps, so the closure is current and the identity
of `onEscape` still never reaches the deps. The landmine that bit `modal.tsx` twice (an unstable
handler in the deps re-pushing the token to the top) is untouched.

### C2 — the Tab branch gates on the stack and gains a containment branch

```ts
if (e.key !== "Tab") return;
if (!isTopmostOfKind(tokenRef.current, "modal")) return;
const items = focusables();
if (items.length === 0) return;
const first = items[0];
const last = items[items.length - 1];
const activeEl = document.activeElement;
const outside = !container.contains(activeEl);
if (e.shiftKey && (activeEl === first || outside)) { e.preventDefault(); last.focus(); }
else if (!e.shiftKey && (activeEl === last || outside)) { e.preventDefault(); first.focus(); }
```

★★★ **THE `outside` TERM ABOVE IS WRONG AND THE SNIPPET IS KEPT ONLY AS THE RECORD OF IT.**
`Node.contains` is REFLEXIVE — `card.contains(card)` is `true` — so when focus rests on the
container itself, which is the entire case this slice exists to fix, `outside` is `false` and both
arms still decline. Measured inside the real render by the C3 implementer, not reasoned: with
`useFocusTrap(cardRef, …, cardRef)` in place and the containment term shipped, both new tour tests
failed with `defaultPrevented === false`, `document.activeElement === card` and
`card.contains(card) === true`.

The correct term is MEMBERSHIP in the trap's own focusables, not containment:

```ts
const untrapped = activeEl === null || !items.includes(activeEl);
```

It strictly subsumes `outside` — every member of `items` is a container descendant — leaves a
non-edge focusable alone, and yanks exactly when focus sits on nothing the trap cycles.

★★ This one is worth more than its fix. The containment spelling was copied from `modal.tsx`,
where it is correct, and it was justified in a comment naming the very case it does not cover — a
`tabIndex={-1}` card focused for AT. A false claim that names its own blind spot is worse than
silence: it tells the next reader the case is handled. `modal.tsx` is NOT defective for the same
reason, and the reason is a different guard, not this term: it focuses the dialog root only when
there is no focusable content at all, and its Tab branch special-cases that state separately.

Two independent changes with one shared justification: the hook stops being an exception to the
arbiter and starts obeying the same rule as the other two traps.

- **The gate** is what `isTopmostOfKind`'s own docstring already prescribes — "a `modal` entry
  layered above another `modal` DOES take Tab from it, because the one above contains focus
  itself." Nothing could previously ask this hook to stand down; now a `Modal` or `PopoverPanel`
  opened above it takes containment cleanly instead of two `document` listeners correcting each
  other in registration order.
- **The containment branch** mirrors `modal.tsx`. It is what makes the trap act when focus sits on
  a container node that is not itself focusable — the tour's card — and when focus has escaped to
  a portal.

★★★ **C1 AND C2 MUST LAND IN ONE COMMIT, IN THAT ORDER.** Gating Tab on `isTopmostOfKind` before
the push is unconditional turns the trap **completely dead** for `inline-ai-edit-popover`, whose
token is not in the stack at all, so the gate returns `false` for every keypress. The intermediate
state is strictly worse than either end.

### C3 — `tour-overlay` gets the real trap and the matching kind

Replace the `useDismissable({ open: step !== undefined, kind: "layer", onDismiss: onSkip })` call
with `useFocusTrap(cardRef, step !== undefined, onSkipStable, cardRef)`.

- `useFocusTrap` pushes `kind: "modal"` itself, so the kind flips in the same commit as the trap
  appears — the rule `dismissal-stack.ts` and `docs/AGENTS/ui-shell.md` both state.
- Passing `cardRef` as **both** container and `initialFocusRef` preserves today's behaviour of
  focusing the card rather than its first button, which is what makes AT announce the dialog and
  its `aria-label`. The per-step re-focus effect keyed on `[i]` stays as it is; the hook's own
  effect is not keyed on the step.
- `onSkip` must be stable at the call site, or the keydown effect re-runs on every parent render
  and re-focuses the card. The hook's docstring already demands this; `use-tour.ts` / the
  `task-manager.tsx` call site is where it has to hold.
- The single stack entry stays single: `useDismissable` is REMOVED, not kept alongside. Calling
  both would push two tokens for one surface.

★ The overlay keeps `role="dialog"` and `aria-modal="true"`. The alternative close — dropping the
`aria-modal` lie and leaving an honest non-modal overlay — was considered and rejected on a
measurement: the backdrop is `fixed inset-0 bg-ui-dark-blue/40` with **no** `pointer-events-none`,
so it already swallows every click on the app behind it. The surface is mouse-modal today. Removing
the containment claim would leave keyboard users able to reach and activate controls that mouse
users cannot, which is a worse asymmetry than the one being fixed and would still fail WCAG 2.4.3
on the same overlay.

---

## 3. What must be tested, and the shapes that do not work

★★ **A dismissal-stack test asserting on FINAL focus is structurally blind to the C2 gate.** Both
traps are `document` keydown listeners firing in registration order, so whichever surface opened
last silently corrects the other. The only shape that kills the mutant is a **non-edge Tab inside
the layered-above modal** — the shape `dismissal-integration.test.tsx` already uses for the
`PopoverPanel` gate. Copy that shape; do not invent a new one.

Required:

1. `use-focus-trap.test.ts` — a trap with **no** `onEscape` is in the stack (`isTopmostOfKind`
   returns true for its token) and yet does **not** own Escape (`escapeOwner()` returns the token
   of a layer pushed beneath it). This is the whole of C1 and it needs both halves asserted; either
   one alone passes against the unfixed code.
2. `use-focus-trap.test.ts` — Tab with `document.activeElement` **outside** the container yanks to
   `first`, and Shift+Tab to `last`. Mutation: delete the `outside` term and both must go red.
3. `use-focus-trap.test.ts` — a non-edge Tab is left alone while a second `"modal"` entry sits
   above this trap's token.
4. `tour-overlay.test.tsx` — Shift+Tab with the CARD focused (the real open state, not a
   hand-focused button) lands on the last in-card control and does not leave. This is the §8
   assertion, and it is the one that fails against a `useFocusTrap` adopted without C2.
5. `tour-overlay.test.tsx` — the overlay's Escape still calls `onSkip`, and still declines when a
   layer above claims it.

### The existing guard whose premise C3 inverts

★★★ **`dismissal-integration.test.tsx`'s "keeps a modal's Tab trap while the tour overlay is open"
WILL GO RED, and that is the change working.** It renders a real `Modal` and a real `TourOverlay`
as siblings in one commit, focuses the modal's LAST button, dispatches Tab, and asserts both
`tab.defaultPrevented === true` and that focus landed on the modal's FIRST button. Its comment
states the premise in as many words: the tour "implements NO Tab trap, so it registers as `layer`
… Tab containment must never be waivable by a layer that contains nothing."

After C3 the tour registers `"modal"` and does contain something, so the premise is retired. The
tour pushes second and is topmost, the `Modal` correctly stands down, and the tour's own containment
branch pulls the Tab into the card — `defaultPrevented` stays true, `activeElement` becomes the
tour's Skip button rather than the modal's first.

**Rewrite it; do not delete it, and do not "fix" it by keeping the tour a `layer`.** The defect it
guards — focus walking out of BOTH surfaces into the page behind — is still worth a guard, and the
assertion that catches it is now "focus is contained by the topmost trap and did not leave either
surface." Rewrite the comment to say what the test now pins and why the old assertion was correct
for its own code, in the same commit. This is the same flip
`e2e/seed-content.spec.ts` went through when §126 was fixed.

★ Production cannot reach this state: the tour and the empty-state modal are mutually exclusive
`if/else` branches in `task-manager.tsx`. The test is a statement about the stack, not about a
reachable screen, and its rewrite should say so.

### Two things C3 changes that neither register entry mentions

- **The tour gains focus restoration it never had.** Nothing in `use-tour.ts` → `TourOverlay` →
  `useDismissable` records the pre-open `activeElement` today, so closing the tour drops focus to
  `<body>`. `useFocusTrap`'s teardown calls `prevFocus?.focus?.()`, so adopting it restores focus to
  whatever held it before the tour opened. This is an improvement and it is in scope, but it is a
  behaviour change and belongs in the commit message.
- **The push/keydown asymmetry moves into this hook.** After C1 the push rides `active` while the
  keydown effect additionally requires a non-null container, so the hook can hold the top `"modal"`
  slot across a window in which it traps nothing — the same latent asymmetry
  `docs/AGENTS/ui-shell.md` already records for `PopoverPanel` (push on `open`, cycle on
  `rendered`). Not reachable at either call site: `modern-shell`'s drawer ref and the tour's card
  ref are both non-null whenever their `active` is true. Record it beside the push rather than
  fixing it — a ref is not reactive, so the push cannot gate on one.

★ Every one of these is a jsdom-visible Tab/stack assertion. The cross-engine hazard recorded for
§297 (Chromium's synchronous `focusout` with a null `relatedTarget` on removal) is **not** in scope
— nothing here touches focus-restore-on-unmount. `npm run e2e:crossengine` is not required for this
slice, and saying so is part of the record.

★★ `tour-overlay` is not in `A11Y_VIEWS`, and axe has no rule for "`aria-modal` without a focus
trap" — it passed the gate before this change and will pass it after. The unit tests above are the
only detector that will ever exist here.

---

## 4. Blast radius

| Call site | Change in behaviour |
|---|---|
| `inline-ai-edit-popover.tsx` | Now occupies a `"modal"` stack slot while open (it did not before). Escape behaviour unchanged — it has no handler and its entry declines. Tab now stands down if a `Modal`/`PopoverPanel` opens above it, and now yanks focus back when focus is outside the container. |
| `modern-shell.tsx` (drawer) | Was already in the stack. Tab now stands down to a layer above, and yanks from outside. |
| `tour-overlay.tsx` | Gains containment; its stack kind goes `"layer"` → `"modal"`. A `Modal` open at the same time now defers to the tour for Tab — correct, because the tour now contains focus. |

★★ The tour and the empty-state modal are mutually exclusive `if/else` branches in
`task-manager.tsx`, which is what keeps `use-tour.ts`'s render-time auto-launch — the one push site
in the app that is not a user gesture — from violating the stack's open-order-equals-nesting-order
precondition. That precondition is ASSERTED, NOT DETECTED, and flipping the tour to `"modal"` does
not change it; re-check it if the launch conditions ever change.

---

## 5. Prose that becomes false and must move in the same commit

Not optional and not a follow-up. Each of these currently states the defect as live:

- `docs/AGENTS/ui-shell.md`, dismissal section — the ★★★ "ONE EXCEPTION, and it is invisible to
  every stack-consulting reader" paragraph, the "★★ STANDING GAP … `tour-overlay` has NO Tab trap
  at all" paragraph, and rule (3) of the THREE LOAD-BEARING RULES, which cites
  `inline-ai-edit-popover` passing no `onEscape` as the reason the push is gated on a boolean. The
  reason survives; the mechanism it describes does not.
- `use-focus-trap.ts`'s own two comments — the "Register ONLY when there is an `onEscape`" block
  and the "★★ Tab is UNCHANGED: containment … never consults the stack" line inside the handler.
- `tour-overlay.tsx`'s long `kind: "layer"` comment, which ends "If this overlay ever grows a real
  focus trap, change this to `modal` in the SAME commit" — that is now the history of this change,
  not an instruction.
- `dismissal-stack.ts`'s `isTopmostOfKind` docstring names `PopoverPanel` as the example of a
  surface that flipped its kind on gaining a trap. A second example now exists.
- `docs/open-followups.md` §8 and §318 — each a FOUR-place edit (heading marker, summary-table
  STATUS cell, summary-table ANCHOR, and the `**Status:**` witness).

★★ The AGENTS.md summary of the dismissal stack does not restate any of the above, so it needs no
edit — verify that with a grep rather than trusting this line.
