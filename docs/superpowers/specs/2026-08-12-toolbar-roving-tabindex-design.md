# The rich-text toolbar keyboard contract — closing §144(a)

> Written against **0.235.0 "Lackey"** (`1d84bd7e`). Closes `docs/open-followups.md` §144(a),
> which closes §144 entirely — (b) landed 2026-08-12.
> **User-visible: version bump + CHANGELOG entry.**

---

## 0. Where this sits

Slice 2 of the Option-1 sequencing agreed 2026-08-12:

| # | Slice | State |
|---|---|---|
| 1 | §143 — sink argument | HALF CLOSED on main by branded constants; the equivalent-mutant finding is filed |
| **2** | **§144(a) — the toolbar keyboard contract** | **this document** |
| 3 | §140 — the attribute boundary (task list · alignment · value allow-list · `ALLOW_DATA_ATTR: false`, closes §115) | next; own security review |
| 4 | §28 — CSV/MD/Turso load boundary | |
| 5 | §141 — export fidelity + repair | |
| 6 | S3b — documents editor (inherits alignment from §140) | |
| 7 | S3c — documents images | |

★ §144(a) precedes §140 deliberately: §140 adds controls to this row, and they should land on
a keyboard contract that already exists rather than have one retrofitted around them.

---

## 1. The problem

`unify-rich-text-s1` shipped a fifteen-control toolbar — twelve `ToolbarButton`s (`MARKS` +
`BLOCKS`), Insert link, Remove link, and the heading menu trigger. **Every one is its own tab
stop**, so a keyboard user crosses fifteen of them to reach the text.

`change-edit-modal.tsx` mounts up to three editors. At the DEFAULT `advanced` tier that is
**45 toolbar tab stops before the form's own controls**, with no bypass. In simple mode it is
30 — the impact editor is gated by `isVisible("impact")` and `modal-fields.ts` tiers that field
`advanced`.

★★★ **The row's refusal of `role="toolbar"` is CORRECT and this slice does not "fix" it by
adding the role.** The APG toolbar pattern is a keyboard CONTRACT — one tab stop, roving
`tabindex`, Left/Right moving focus. The row implements none of it, and declaring a role whose
interaction the widget does not honour tells an AT user to press arrow keys that do nothing.
`rich-text-toolbar.test.tsx` pins the absence precisely so the role cannot arrive without the
behaviour. **This slice builds the behaviour, and the role follows it.** That order is the whole
design.

---

## 2. Measurements this design rests on

All taken 2026-08-12 against `1d84bd7e`.

### 2a. No existing roving primitive can be reused, and the reason is correctness

The repo has three roving implementations. None fits, and the mismatch is behavioural:

| implementation | pattern | activation |
|---|---|---|
| `useTablistRoving` | `role="tablist"` | **automatic** — ends in `target.click()`, selection follows focus |
| `SegmentedControl` | `role="radiogroup"` | **automatic** — an arrow in a radiogroup IS a selection |
| `band-roving.ts` | calendar band, 2-D lane/date | focus only, but the arithmetic is lane-major over a sparse grid |

Both automatic-activation models are APG-correct for their own pattern. **A toolbar is the one
pattern where activation must NOT follow focus** — reusing either would run Bold, Italic or
Quote on every arrow keypress, mutating the user's content.

★★ So this is a genuine exception to the standing "never hand-roll a control a primitive
covers" rule, and the exception is recorded rather than assumed. What IS reused is
`band-roving.ts`'s **shape**: a pure, i18n-free, DOM-free engine plus a thin React caller.

★ A shared movement engine for tablist + toolbar (both 1-D wrap + Home/End) is a real
opportunity and is deliberately NOT taken here — it refactors two working consumers as a rider
on an a11y slice. Note it as a follow-up.

### 2b. The unnamed-toolbar branch is unreachable in production

`RichTextEditor`'s `label` prop is already required (`label: string`, no `?`), all twelve real
mounts pass one, and `RichTextToolbar` has no other mounter. So the existing
`role={named ? "group" : undefined}` gate needs **one word changed**, not a new naming policy.
The unnamed branch stays a defensive, test-only path.

### 2c. No control is ever disabled

The only `disabled` mention in `rich-text-toolbar.tsx` is a comment recording that an
`isActive("link")` disabled state for Unlink was deliberately left out. `ToolbarButton` supports
`disabled`, but no control in this row passes it.

★ This removes skip-disabled from the design entirely. §6 turns the absence into a pinned
invariant instead, so a future disabled control forces the decision rather than silently
breaking the order.

### 2d. `PopoverPanel` portals to `document.body`

The heading menu is a portaled `role="dialog"` whose menu items are `tabIndex={-1}`. React
synthetic events bubble the **React** tree, not the DOM tree, so a keydown inside the open menu
still reaches the toolbar's `onKeyDown`. This needs a deliberate guard (§3c), not luck.

### 2e. What is NOT measured

* Whether any modal's focus trap interacts badly with a single-tab-stop row. jsdom models tab
  order only approximately; the browser check is §5.
* Screen-reader announcement of the new role. Out of scope for an automated slice; the e2e
  proves the keyboard contract, not the speech.

---

## 3. The design

### 3a. `toolbar-roving.ts` — a pure engine

Mirrors `band-roving.ts`: pure, i18n-free, DOM-free, unit-testable without a render.

```ts
/** Next focus index for `key`, or null when the key is not part of this model
 *  (the caller must then NOT preventDefault). */
export function moveToolbarFocus(
  count: number,
  index: number,
  key: string,
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): number | null
```

* **Left / Right** move and **wrap**.
* **Home / End** jump to first / last.
* **Up / Down are NOT handled.** The row is horizontal; swallowing them would eat page scroll
  for no gain. They fall through untouched.
* **Chords return `null`** — `band-roving.ts`'s precedent: Alt+Left must stay browser Back, and
  swallowing it from a toolbar control breaks navigation for keyboard users.
* A handled bare key always returns an index (clamped), so the caller can `preventDefault`
  unconditionally for handled keys and the page never scrolls out from under a row that had
  nowhere to go.

### 3b. The contract in `rich-text-toolbar.tsx`

| key | behaviour |
|---|---|
| **Tab** | ONE stop for the whole row, then out to the editor content — 15 → 1, and 45 → 3 in the change modal at the default tier |
| **Left / Right** | move focus between controls, wrapping |
| **Home / End** | first / last control |
| **Enter / Space** | activate the focused control — **focus alone never activates** |

`role="group"` → `role="toolbar"` under the existing `named` gate; `aria-label` unchanged.

★★ **The 14 inactive controls MUST carry `tabIndex={-1}`.** `<button>` is natively tabbable, so
marking one control `tabIndex={0}` does nothing on its own — every other control stays reachable
and the tab-stop count is unchanged. This is the single line the whole slice's user-visible claim
rests on.

★★★ **The tab-stop index is component state initialised to 0, NOT "last clicked".** Every control
carries `preventFocusSteal`, which suppresses the mousedown default so the click cannot pull focus
off the editor and collapse the selection the command applies to. A click therefore never focuses a
button, the roving index can only move by keyboard, and clicking Bold still leaves focus in the
editor exactly as it does today. This makes the state model simpler than a textbook roving one, and
it is written down because it otherwise reads as a missing feature.

★ The handler drives `e.currentTarget`, like `useTablistRoving`, so one implementation serves the
three rows `change-edit-modal.tsx` mounts and each row's arrows resolve inside its own row.

### 3c. The portal guard

Before moving, resolve `document.activeElement` against **this** row's controls. Index `-1` →
return **without** `preventDefault`.

That one line covers §2d: with the heading menu open, focus is on a `tabIndex={-1}` menu item in a
panel portaled to `document.body`, and its keydown still bubbles the React tree into this handler.
Without the guard, arrowing inside the menu would silently rove the toolbar underneath it while the
menu appeared to ignore the key.

★ `useTablistRoving` carries the same guard for the same reason. It is wanted here deliberately and
pinned by a test (§4), not inherited by accident.

---

## 4. Testing

### 4a. `toolbar-roving.test.ts` — pure

Wrap in both directions · Home / End · unhandled key → `null` · chord → `null` · `count === 0` →
`null` · stale-index clamping. Plus one fast-check property: for any handled bare key, the result
is a valid index in `[0, count)`.

★ `fc.date()` and the `/s` regex flag are the two fast-check traps this repo records; neither
applies here, but run `npx tsc --noEmit` after writing the property — vitest never typechecks.

### 4b. `rich-text-toolbar.test.tsx` — five pins, each for a distinct failure

| pin | catches |
|---|---|
| `userEvent.tab()` reaches control 1; a **SECOND** Tab leaves the row | the actual one-tab-stop claim |
| ArrowRight moves focus **and the editor command spy is NOT called** | auto-activation — i.e. exactly what reusing `useTablistRoving` would have shipped |
| `getByRole("toolbar", { name })`; still no role when unnamed | the inverted pin, both branches |
| two mounted rows: arrowing in row A never moves focus in row B | the multi-editor case |
| heading menu open + ArrowRight → toolbar focus unchanged | the §3c portal guard |

★★★ **Two vacuity traps, both of which yield a green suite over a broken contract.**

1. **Counting `tabIndex` attributes proves nothing.** `<button>` is natively tabbable, so a DOM
   with one `tabIndex={0}` and fourteen unset attributes has fifteen tab stops and passes an
   attribute count. Only `userEvent.tab()` demonstrates the result. `.focus()` never proves
   focusability, and proves nothing whatever about tab ORDER.
2. **The first Tab is not the assertion.** A single Tab lands on control 1 whether or not the fix
   works. The pin is deliberately the SECOND Tab, which must leave the row.

★★ A single-toolbar fixture cannot see the multi-row failure — the same trap
`rich-text-toolbar.test.tsx`'s existing group-naming test already documents in place. Mount two.

Record the mutation COUNT in the implementing commit, never the phrase "mutation-proved".

### 4c. Existing pins to invert or extend

* `rich-text-toolbar.test.tsx`'s "does not claim the toolbar role, whose keyboard contract it does
  not honour" — inverts. Keep the reasoning in the comment and rewrite it to say the contract now
  exists; do not delete the paragraph.
* The existing "does not steal focus from the editor surface" / "does not steal focus from the link
  controls either" tests — extend to cover the whole row, since §3b's state model depends on
  `preventFocusSteal` holding at every control.

---

## 5. The eye-verify §144 owes — now cheap, because of (b)

§144 states (a) "is its own slice with its own eye-verify." §144(b) has just made a toolbar
browser-reachable: `e2e/a11y.spec.ts` seeds a task, DOM-clicks its notes badge on Open Points to
open the floating notes window, and scans it.

Reuse that exact path for a small **permanent** Playwright spec: Tab into the row, assert one more
Tab exits it, arrow across it, assert the document content is unchanged. Permanent rather than
throwaway because it is the only browser-level proof of the contract and jsdom models tab order
approximately. It does not join the 90-scan axe matrix; the e2e job grows by one test.

★ Run e2e selections at `--workers=1`. `playwright.config.ts` sets `workers: CI ? 1 : undefined`,
so local runs go at CPU count and over-subscription produces `Test timeout` failures that name no
rule and are NOT violations.

---

## 6. Risks

★★★ **This changes what Tab does inside every modal in the app.** AGENTS.md is explicit that
`docs/AGENTS/ui-shell.md` owns the Escape/Tab protocol and must be read before touching any modal,
popover or panel — and `Modal` STACKS. Reading it is a required input to the implementation, not a
courtesy.

| risk | handling |
|---|---|
| focus-trap interaction across 12 mounts in 8 files | read `ui-shell.md` FIRST; §5's e2e is the cross-check jsdom cannot give |
| a `preventFocusSteal` regression desyncs the roving index from state | §4c extends the existing focus-steal tests to the whole row |
| a future **disabled** control silently breaks the roving order | no control is disabled today (§2c), so implementing skip-disabled now is speculative generality. Pin the INVARIANT instead — a test asserting no control renders disabled — so adding one goes red and forces the decision, the play §142 just made with `labelSuffix` |
| a fourth roving implementation joins three others | the arithmetic is ~8 lines and the activation models genuinely differ (§2a); record the shared-engine follow-up, do not refactor two working consumers here |
| the heading menu's own keyboard/dismissal protocol regresses | §3c's guard plus the §4b pin; `PopoverPanel` dismissal is unchanged by this slice |

**Non-goals.** Task list and alignment controls (§140 — they need the attribute boundary). Reaching
the other eleven unscanned editor mounts (§144(b) closed what it promised; the rest is its own
question). Generalising the three existing roving implementations.

---

## 7. Docs owed in the implementing commit

★★★ **`AGENTS.md`'s ★★★ "`group` AND NOT `toolbar`" paragraph becomes FALSE and must be REWRITTEN,
not deleted.** It currently argues the role must never arrive without the behaviour and cites the
pinned-null test as its guard. After this slice the behaviour exists. Record that the refusal WAS
correct, what it cost (the tab-stop count), and that the null pin is now an assertion of the
opposite. Deleting the paragraph loses the reasoning; leaving it as-is instructs the next reader to
revert this slice.

Also: `docs/AGENTS/ui-shell.md` (focus/keyboard), `rich-text-toolbar.tsx`'s header comment, and
`docs/open-followups.md` §144 → fully CLOSED, carrying (a)'s measurement.

---

## 8. Release

User-visible — keyboard behaviour changes in every editor. Version bump + `CHANGELOG.md` entry
describing the tab-stop reduction and the arrow-key navigation. Per the release checklist, the bump
touches `src/app/version.ts`, `package.json`, `package-lock.json` (two occurrences), the README
shields badge, and the five `docs/CODEMAPS/*.md` headers — none of which is gated.

---

## 9. Definition of done

1. `toolbar-roving.ts` exists, pure and DOM-free, with §4a's tests including the property.
2. The row is one tab stop: `tabIndex={-1}` on every inactive control, state-driven active index.
3. `role="toolbar"` under the existing `named` gate; `aria-label` unchanged.
4. Left/Right wrap, Home/End, Enter/Space activate, Up/Down and chords fall through.
5. §3c's portal guard present and pinned.
6. §4b's five pins green, with the SECOND-Tab assertion and the command-not-called assertion;
   mutation count recorded.
7. §4c's inverted and extended pins done.
8. §5's Playwright spec passes in a real browser at `--workers=1`.
9. `docs/AGENTS/ui-shell.md` read before implementation; §7's docs updated in the same commit.
10. All gates green, each read UNPIPED: `tsc --noEmit`, `test:run`, `test:shuffle`,
    `eslint --max-warnings=0 src/app`, `test:coverage`, `dup:check`, `size:check`,
    `docs:symbols:check`, `docs:claims:check`.
11. §144 closed; version bumped in all six places; CHANGELOG entry added.
