# Slice C — Timelog: clear affordance, picker persistence, apply-bar sizing

_Design, 2026-07-27. Target release **0.204.0 "Benford"** (Gregory Benford — verified absent from the
~230 codenames in `CHANGELOG.md`). Roadmap: `2026-07-27-ux-batch-roadmap-design.md`, slice 1 of 8._

Three items, all inside the Time-bookings view. Two are affordance fixes; one is a real bug.

---

## 1. `ClearableSearchInput` — shared ✕ affordance

### Problem

The two timelog filter fields are inconsistent **with each other**, and one is additionally
inconsistent across browsers:

| Field | Markup | Today |
|---|---|---|
| Customer (`timelog-customer-scope.tsx:34`) | `<Input type="search" size="xs">` | Chrome/Safari draw their **own** ✕ (not keyboard-reachable); Firefox draws **none** |
| Project (`timelog-project-scope.tsx:62`) | `<Input type="text" role="searchbox" size="xs">` | **No ✕ in any browser** |

So this is not simply "add a ✕": one field needs its native control replaced with a reachable one,
the other has no control at all. ★ The project field keeps `role="searchbox"` — it is a deliberate
a11y choice on a `type="text"` input and must survive the change.

`TableFilter` (`report-table.tsx:84`) already solves exactly this, and its comments record why each
piece is the way it is:

- `[&::-webkit-search-cancel-button]:appearance-none` suppresses the native ✕;
- the button is absolutely positioned **over** the field (a sibling button read as *two* clears in
  Chrome and *one* in Firefox);
- `h-6 w-6` = 24px, the WCAG 2.2 SC 2.5.8 target floor (the icon is 14px; padding alone left ~20px);
- `FOCUS_RING` + `TRANSITION`, deliberately **not** the full `INTERACTIVE` atom — that bundles
  `PRESS` (`active:translate-y-px`), which writes the same `--tw-translate-y` as the `-translate-y-1/2`
  centring and made the ✕ jump out of centre for the duration of every press;
- `pr-8` **only while the ✕ renders**, so the empty-state placeholder keeps its full width.

`dup:check` is a blocking gate, so copying that block into timelog is not an option.

### Decision

The two sites use **different field shells**: `TableFilter` renders a raw `<input>` with bespoke
classes; timelog uses the `Input` DS primitive at `size="xs"`. Unifying them would change
`TableFilter`'s rendered bytes across its 7 consumers (budget · budget-report · change-report ·
raid-report · reports-tables · resources-panel · resources-report), several axe-scanned and covered by
visual-regression specs — a re-baseline for no user-visible gain.

**Extract the ✕ overlay only.** New presentational `clearable-search-input.tsx` owning the
`relative` wrapper and the button; each caller supplies its own `<input>`/`<Input>` and its own
`pr-8`-when-set. This dedupes the part jscpd would flag while leaving every existing pixel intact.

Follows the `EntityLinkPicker` convention: **no `lang`, no `t()`** — the caller passes an
already-translated `clearLabel`.

Applied at both timelog sites (`timelog-customer-scope.tsx`, `timelog-project-scope.tsx`).
`TableFilter` migrates to it in **slice D**, alongside the rest of the app-wide audit — deferring it
past a release boundary would leave two ✕ implementations in-tree and trip the dup gate, so D must
consume this primitive, not re-solve it.

---

## 2. Picker-scope persistence

### Problem

`handleFetchBookings` is the **sole** writer of the persisted scope — its own comment says
*"Persists customer + project scope so the selection survives a reload."* Pick a customer and
projects, then reload or navigate away **without clicking Fetch**, and nothing was ever written.

The existing design is not careless. The persisted scope lives in `Workspace.timelogLinks`, which is
**workspace data** — writing it on every dropdown change would dirty the workspace and fire an
autosave (a network write under Turso) per twiddle. And `handleRefreshBookings` depends on
`timelogLinks` meaning *last-fetched*, explicitly: *"Refresh re-fetches the LAST-FETCHED (persisted)
scope, independent of the live picker."*

So *currently picked* and *last fetched* are two genuinely different things sharing one slot.

### Decision

New **per-device** store, leaving `timelogLinks` to keep meaning *last fetched*.

`timelog-picker-store.ts`, built on the `device-store.ts` envelope
(`readDeviceJson`/`writeDeviceJson`):

- key `aipm-cockpit:timelog-picker`;
- shape `{ [projectKey]: { customerId?: number; projectIds?: number[] } }`;
- capped at the **50** most-recently-touched projects, mirroring `landing-state.ts`;
- validated on load, never throws;
- `aipm-cockpit:`-prefixed, so `clearAppConfig`'s sweep clears it with no extra wiring;
- **out of** exports, Turso, and recovery `CONFIG_KEYS`.

Written on customer-select change, project toggle, select-all, and clear. **Not** on filter text —
that is transient search state, and `projectChanged` already resets it.

Zero new backend write paths. No golden-fixture regen.

### ★ Key selection — the trap

The panel's `projectId` local is `ws.project?.code ?? "default"`, and it **already keys
`useTimelogSync` → the per-device actuals cache**. Re-pointing it at `portfolioCurrentId` would
silently orphan every existing user's cached actuals: they would open Time bookings and find their
fetched data gone.

So the new store gets a **separate** `projectKey` prop, threaded from workspace-section's
`portfolioCurrentId ?? "default"` — matching every other per-device per-project store
(`landing-state`, project-appearance) and avoiding the user-editable project *code*, which a rename
would orphan. `projectId` is left exactly as it is.

This leaves two per-device timelog stores keyed differently. That is a knowingly-accepted
inconsistency: re-keying the actuals cache is a migration with real data-loss surface and belongs in
its own change. **Log it to `docs/open-followups.md`** rather than fixing it silently here.

---

## 3. Seeding precedence + mismatch hint

Adding the picker store makes **three** competing seed sources in the render-time reconcile block,
which today is a guarded one-shot ladder (`userPicked` → `linksSeeded` → `autoResolved`, all reset by
`seenProjectId`/`projectChanged`, with a documented "do not seed on the reset render" guard because
the reset `setState`s are not yet visible in that render's locals).

### Decision

Extract the decision into a **pure, i18n-free** module:

```ts
resolveInitialScope({ picker, links, customers, customerName })
  → { customerId: number | ""; projectIds: number[]; source: "picker" | "links" | "auto" | "none" }
```

Keeps the delicate reconcile thin and makes every ladder branch unit-testable without mounting the
panel. The reconcile gains a fourth one-shot flag `pickerSeeded`; order is **picker → links → auto**;
all four flags reset on `projectChanged`, preserving the existing guard.

An explicit user pick still wins over everything (`userPicked`), unchanged.

### Mismatch hint

Precedence means the picker can show customer **X** while the loaded People table came from a fetch
of customer **Y**. Rather than let that read as a lie, surface it: when the picker scope and the
last-fetched scope disagree **and** bookings are loaded, show

> Showing bookings for **{Y}**. Fetch to load **{X}**.

One new i18n key, EN + DE. ★ The DE edit goes through a node utf8 write, not the Edit tool
(`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts) — then grep-verify.

---

## 4. Apply-confirm sizing

`timelog-apply-confirm.tsx` caps its diff list at `max-h-40` (10rem) with its own scroller, inside a
`flex items-center` card. `describeApplyRows` emits one row per bucket·line·period, so a real apply
routinely exceeds that and the card shows a cramped 10rem window.

- list `max-h-40` → `max-h-[50vh]`;
- card `items-center` → `items-start`.

Viewport-relative, so 5–20 rows render fully with no scrollbar — genuinely scaling with content —
while remaining **bounded**. Unbounded growth is rejected deliberately: this card gates a *financial*
write into `actualHours` (a user-editable field), so the Apply and Cancel buttons must never be
pushed out of reach.

---

## 5. Testing

Pure modules are coverage-gated, so both get real tests rather than a `coverage.exclude` entry.

| Target | Cases |
|---|---|
| `timelog-picker-store.ts` | round-trip; cap eviction; malformed/partial JSON → fallback, never throws; SSR (no `window`); per-`projectKey` isolation |
| `resolveInitialScope` | each of the four `source` branches; picker-beats-links; links-beats-auto; auto only when nothing persisted; picker/links disagreement reported |
| `clearable-search-input.tsx` | ✕ absent when empty, present when non-empty; click clears; accessible name present; native-✕ suppression class applied |
| `timelog-apply-confirm.tsx` | asserts the cap moved off `max-h-40` |

★ Run `npx tsc --noEmit` after touching any test — `next build` does not typecheck `*.test.tsx` and
vitest never typechecks, so a test-only type error passes both and fails CI.

★ Time bookings **is** in `A11Y_VIEWS`. Verify with
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Time bookings"` before pushing — the
unit suite never runs Playwright.

---

## 6. Acceptance

1. Both timelog filters show exactly **one** ✕, keyboard-reachable, in Chrome **and** Firefox; it
   appears only when the field is non-empty and clears on click.
2. Selecting a customer and projects **without fetching**, then reloading or navigating away and
   back, restores that selection.
3. Restoring a picker selection that differs from the last-fetched scope shows the mismatch hint;
   agreeing scopes show nothing.
4. Switching project in place re-seeds the picker for the new project and never leaks the previous
   one's selection.
5. The existing actuals cache still resolves for existing users — `projectId` is untouched.
6. Refresh still re-fetches the last-fetched scope, independent of the live picker.
7. The apply-confirm list grows with content up to 50vh; Apply/Cancel stay reachable at any row count.
8. No new backend write path, no golden-fixture regen, nothing added to exports or Turso.

## 7. Out of scope

- Re-keying the timelog **actuals** cache off the project code (own change; logged to
  `docs/open-followups.md`).
- Migrating `TableFilter` onto the new primitive (**slice D**).
- Persisting filter *text* — transient by design.
