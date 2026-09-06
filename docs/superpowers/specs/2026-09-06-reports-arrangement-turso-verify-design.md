# Reports arrangement + a confirmed-connection gate on Move-to-Turso — design

**Date:** 2026-09-06
**Base:** `origin/main` at `3aef0e01` (0.288.0 "Duchamp")
**Branch:** `feat/reports-arrangement-turso-verify`

---

## Why this slice is small

A backlog of thirteen UI asks was checked against the tree before any design work. **Eleven were
already shipped**, most of them in 0.288.0 and its predecessors. This slice is the remainder.

Already done, verified by reading the tree and confirming each commit is an ancestor of
`origin/main` — recorded here so nobody re-opens them:

| Ask | Where it landed |
|---|---|
| Projects: Load-from-Turso disabled when unconfigured | `disabled={!tursoConfigured}`, both surfaces (`78313fb4`, `122d5b1d`) |
| Projects: Move-to-Turso disabled when unconfigured | `projects-panel.tsx`, same expression |
| Documents: image name click opens the preview | `asset-library.tsx`, same `setPreviewIndex` as the button (`57a6d8c7`) |
| Documents: re-click open document's name collapses the body | `documents-panel.tsx` `handleSelect` (`ede67ddd`, `3f59c5a2`, `16237df9`) |
| "Referenced by" reads a count, not the R/A/I/D mix | `task-raid-badge.tsx`, mix moved to `title` (`178b2aa9`) |
| Ask Claude row icon no longer clips over the checkbox | `97ded2c2` — a `w-7` cell carried `px-4` |
| Knowledge "Attach to" is a searchable combobox with `*` | `SingleEntityPicker` + `wildcardMatcher` |
| Knowledge "Search tasks to link" ditto | `TaskLinkPicker` → `EntityLinkPicker` |
| Task modal: Status & Notes at position 3 | `task-form-fields.tsx` |
| Task modal: dictate mic beside the Task-name heading | `captionAction={titleMic}` |
| Task modal: predecessors/successors share one row | omitted `sm:col-span-2` inside a `sm:grid-cols-2` grid |
| Task modal: Jira-style Time tracking modal off the progress bar | `task-time-tracking-modal.tsx` + `duration.ts` |
| Task modal: Budget bucket in Effort & Classification, between the rows | `[estimate\|tracking] [bucket\|—] [group\|labels]` |

**Deferred, not in scope:** the per-window/per-modal help icon. Filed as
`docs/open-followups.md` §418, because it is blocked on a UX decision (see that entry) rather
than on effort.

**Owed from the already-done set:** the Ask-Claude clipping fix asserts a class, not geometry —
jsdom has no layout — so its browser eye-verify is still outstanding (`docs/open-followups.md`
§414).

---

## Scope

Two independent parts. Neither adds a persisted `Workspace` field, so neither touches the six
write paths.

1. **A3** — Settings → Integrations: Move-to-Turso is gated on a *confirmed* connection test.
2. **F** — Reports gains full Dashboard-parity arrangement: drag-reorder, hide/restore, per-block
   resize, and a reset-layout button.

---

## Part 1 — A3: a confirmed-connection gate

### Today

`integrations-section.tsx` computes `tursoConfigured = !!getTursoConfig(turso.databaseUrl,
turso.authToken)` and `canMoveToTurso = !!onMigrateToTurso && !onTurso && tursoConfigured`. That
value is a **render gate** — the button carries no `disabled=` at all.

The Test-connection result is not wired into it in any way. `tursoTestResult` is a
`string | null` holding a **translated display string** ("Connected." / "Verbindung
fehlgeschlagen."), written in the try and catch branches and read only to render a
`role="status"` paragraph. Success is therefore not representable: reading it would mean
string-comparing against a localized literal.

### Change

Replace the bare string with a fingerprinted record:

★ **The two blocks below are AS SHIPPED**, re-synced after implementation. The draft they replace
had one `message: string` field instead of the discriminated union, derived confirmation through a
`?.`, and gave the button a single hint id with an unconditionally rendered `sr-only` node. Each of
those was changed for a reason recorded at the code, and a reader who takes the sketch as current
gets exactly the shape that was removed.

```ts
const [tursoTest, setTursoTest] = useState<
  | { kind: "ok"; url: string | undefined; token: string | undefined }
  | { kind: "fail"; reason: "auth" | "unreachable" | "generic";
      url: string | undefined; token: string | undefined }
  | null
>(null);

const tursoTestFresh =
  tursoTest !== null &&
  tursoTest.url === turso.databaseUrl &&
  tursoTest.token === turso.authToken;
const tursoTestConfirmed = tursoTestFresh && tursoTest.kind === "ok";
```

`runTursoTest` writes an i18n KEY's discriminator, never a rendered string — a verdict outlives the
probe, so a message frozen at probe time leaves an English sentence in a German panel. `reason`
lives on the fail arm alone; the result paragraph translates at RENDER time and only while the
fingerprint matches, so a stale "Connected." cannot sit under an edited URL. Note there is no `?.`
in `tursoTestConfirmed`: `tursoTestFresh` opens with `tursoTest !== null` and TS narrows through the
aliased const, so an optional chain would only paper over a broken invariant by rendering the gate
closed instead of failing.

The button becomes:

```tsx
<span className={`inline-flex${tursoTestConfirmed ? "" : " cursor-not-allowed"}`}
      title={tursoTestConfirmed ? undefined : t(lang, "integrationsTursoMoveNeedsTest")}>
  <Button size="sm" disabled={!tursoTestConfirmed} onClick={onMigrateToTurso}
          aria-describedby={tursoTestConfirmed ? tursoMoveHintId : tursoMoveNeedsTestId}
          className="disabled:pointer-events-none">
    {t(lang, "projectMigrateToTurso")}
  </Button>
  {!tursoTestConfirmed && (
    <span id={tursoMoveNeedsTestId} className="sr-only">
      {t(lang, "integrationsTursoMoveNeedsTest")}
    </span>
  )}
</span>
<FieldHint id={tursoMoveHintId} className="mt-1">{t(lang, "projectMigrateToTursoHint")}</FieldHint>
```

`canMoveToTurso` stays the render gate (nothing to migrate when already on Turso); `disabled`
carries the new condition. **Every channel is gated-state-only**, which is the correction the draft
missed: the confirmed state already has the visible `FieldHint`, so pointing `aria-describedby` at
a hidden copy, rendering that copy at all, or leaving a `title` on the wrapper each announce the
same sentence twice — `title` included, because it is INHERITED for tooltip purposes and therefore
still fires on the enabled button.

### Two decisions worth stating

**Invalidation is derived, never written.** No `onChange` clears the flag; the fingerprint simply
stops matching. A written invalidation can be forgotten by a future edit path — including one
that changes the fields without passing through this component — and nothing would report it.
Deriving makes the stale-verified state unrepresentable.

**The disabled control must not be the only route to its own explanation.** A `disabled` element
dispatches no mouse events, so a hint revealed by interacting with the button is unreachable
(`memory/disabled-control-dispatches-no-events.md`). The `cursor-not-allowed` wrapper carries
`title` for pointer users and an `sr-only` node satisfies `aria-describedby` — the same shape
`projects-panel.tsx` already uses for its disabled Turso buttons. ★ What shipped narrows all three
channels to the GATED state — see the code block above. `projects-panel.tsx` needs no such
narrowing because its wrapper hint has no VISIBLE twin; here it does, so anything left on in the
confirmed state is a second copy of the `FieldHint` rather than the only route to it.

**Deliberate asymmetry, disclosed.** The *Projects* tab's Move-to-Turso keeps its
`tursoConfigured`-only gate. That surface has no Test-connection button, so a confirm-gate there
would be permanently unsatisfiable. The consequence is that one label now means two different
things on two surfaces; this is accepted, not overlooked.

### i18n

**ONE** new key (EN + DE, real umlauts, added last because a peer session also writes the
dictionaries). An earlier revision of this heading said three while the list below it named two;
what shipped is one:

- `integrationsTursoMoveNeedsTest` — the hint when unconfirmed.
- The confirmed state REUSES the existing `projectMigrateToTursoHint`. An earlier draft of this
  section called for a second key, `integrationsTursoMoveReady`; the approved plan dropped it and
  it was never added (verify: `grep -rn "integrationsTursoMoveReady" src/` returns nothing).
  **Do not re-add it.** The confirmed hint would have said exactly what `projectMigrateToTursoHint`
  already says, and a dead i18n key is invisible to every gate in this repo — nothing goes red when
  one stops being read, so a duplicate that drifted out of use would survive indefinitely.
- No key is removed; `integrationsTursoTestOk` and the three failure keys keep their current use
  as the *message* half of the record.

---

## Part 2 — F: Reports arrangement at Dashboard parity

### Approach: extract a neutral core, both surfaces become adapters

The **drag** layer is already generic and already shared — `list-reorder.ts`
(`reorderIds`/`dropEdgeFor`), `use-list-reorder-dnd.ts` and `DragHandle` are used by the Dashboard
*and* by `reports.tsx` today for its extra-report cards. Only the **layout** layer is welded to
the Dashboard.

The rejected alternatives, for the record:

- *Generalise in place* — same blast radius, but four files named `dashboard-*` would then serve
  two surfaces. This repo has repeatedly paid for names that stopped describing their contents.
- *A Reports-specific parallel* — zero Dashboard risk, but duplicates roughly 500 lines against a
  **blocking** `dup:check` comparing total duplicated-line percentage to 1.75 (currently ~1.19%).
  Raising the threshold to pass would defeat the gate.

### File structure

| New file | Extracted from | Generic over |
|---|---|---|
| `arrangement-layout.ts` | `dashboard-layout.ts` | `<Id extends string>`; catalogue is a **parameter** |
| `arrangement-store.ts` | `dashboard-layout-store.ts` | storage key injected |
| `use-arrangement.ts` | `use-dashboard-layout.ts` | `{catalogue, storageKey, defaultLayout, projectId, isPopout}` |
| `arrangement-tile.tsx` | `dashboard-tile.tsx` | `id: string`, `testIdPrefix` |
| `arrangement-grid.tsx` | `dashboard-grid.tsx` | `rowClass` / `gapClass` injected |
| `report-blocks.ts` | *new* | the Reports catalogue |
| `reports-blocks.tsx` | split out of `reports.tsx` | presentational block bodies |

| Kept as a thin adapter | Contract |
|---|---|
| `dashboard-layout.ts` | re-exports the concrete `DashboardLayout`, `DEFAULT_LAYOUT`, mutators bound to `DASHBOARD_TILES` |
| `dashboard-layout-store.ts` | `loadLayout(projectId)` / `saveLayout(projectId, l)` bound to `DASHBOARD_LAYOUT_KEY` |
| `use-dashboard-layout.ts` | `useDashboardLayout({projectId, isPopout})` and `DashboardLayoutApi`, unchanged |
| `dashboard-tile.tsx` | `DashboardTile` with today's props and today's `data-testid` |
| `dashboard-grid.tsx` | `DashboardGrid({dc, children})`, unchanged |

**`dashboard-panel.tsx` is not edited.** Every adapter above preserves its current export
signature, so the Dashboard's own call sites, tests and `data-testid`s are untouched. That is the
primary regression control for this refactor.

### The five welded points, each verified in source

1. **`DEFAULT_LAYOUT` is a module constant**, returned *by reference* from `reconcile(null)` and
   set by `reset()`. It becomes `defaultLayout(catalogue)` — but **each adapter memoizes one
   result into a module `const`**, so the reference identity the no-op checks depend on survives
   per surface.
2. **`DASHBOARD_TILES` is read as a free variable** inside `reconcile` (three reads) and via
   `tileById` inside `restoreTile` and `resizeTile`. All become parameters. `tileById` becomes
   `specById(catalogue, id)`.
3. **`DASHBOARD_LAYOUT_KEY` is hardcoded.** Reports gets `aipm-cockpit:reports-layout` — still
   under the `aipm-cockpit:*` prefix, so `clearAppConfig`'s existing sweep covers it with no
   change to `app-reset.ts`.
4. **Density.** `DashboardGrid` takes `dc: DensityClasses`, a Dashboard-only concept. The generic
   grid takes two class strings; `DashboardGrid` passes `dc.tileRow` / `dc.sectionGap`.
5. **`TileSpec.gate` is Dashboard-shaped** (`(g: TileGateInput) => boolean`). The generic
   `BlockSpec<Id>` carries only the layout-relevant fields — `id`, `labelKey`, `w`, `h`, `minW`,
   `maxW`, `minH`, `maxH` — and each surface's spec type extends it with its own `gate`. The
   engine reads none of them, so a `readonly BlockSpec<Id>[]` parameter accepts either catalogue.
   This preserves the existing rule that **a gate decides what renders, never what is stored**: a
   gated-off block keeps its position.

### Two invariants that must survive the move

- **`W_CLASS` / `H_CLASS` stay whole literal strings.** Tailwind v4 builds its stylesheet by
  scanning source, so an interpolated `col-span-${w}` emits no CSS — and jsdom has no layout, so
  no test can see the result.
- **The grid renders no scroller of its own.** The real scroller is the enclosing `ReportCard`'s
  `contentRef`; a nested one sizes to its content and breaks drag autoscroll. `reports.tsx`
  already passes one `cardsScrollRef` to both the card and the drag hook, which is the required
  shape.

### The Reports catalogue

Thirteen blocks in one catalogue — nine built-ins plus the four addable reports, so an extra
report is just a block that starts hidden.

| id | source | w | minW | maxW | h | minH | maxH |
|---|---|---|---|---|---|---|---|
| `stats` | the four KPI tiles | 4 | 2 | 4 | 1 | 1 | 2 |
| `groupHealth` | `reportsGroupHealth` | 4 | 2 | 4 | 2 | 2 | 4 |
| `openByStatus` | `reportsOpenByStatus` | 2 | 2 | 4 | 2 | 2 | 3 |
| `completionOutcomes` | `reportsCompletionOutcomes` | 2 | 2 | 4 | 2 | 2 | 3 |
| `inquiries` | `reportsInquiries` | 4 | 2 | 4 | 3 | 2 | 4 |
| `byAssignee` | `reportsByAssignee` | 4 | **4** | 4 | 3 | 2 | 4 |
| `byPriority` | `reportsByPriority` | 2 | 1 | 4 | 1 | 1 | 2 |
| `byGroup` | `reportsByGroup` | 4 | **4** | 4 | 3 | 2 | 4 |
| `byLabel` | `reportsByLabel` | 4 | **4** | 4 | 3 | 2 | 4 |
| `raid-report` | `ADDABLE_REPORTS` | 4 | **4** | 4 | 4 | 2 | 4 |
| `budget-report` | `ADDABLE_REPORTS` | 4 | **4** | 4 | 4 | 2 | 4 |
| `resource-report` | `ADDABLE_REPORTS` | 4 | **4** | 4 | 4 | 2 | 4 |
| `stakeholder-report` | `ADDABLE_REPORTS` | 4 | **4** | 4 | 4 | 2 | 4 |

The seven `minW: 4` rows are pinned full width. They carry resizable-column tables or a whole
embedded report panel, and narrowing them to a quarter of a four-column grid is the single most
likely way this ships visibly broken. `minW` is the only thing preventing it and **no test can
check it** — jsdom has no layout.

`labelKey` reuses the existing section-title keys and `ADDABLE_REPORTS[].titleKey`; no new title
keys are needed.

### Row unit

Dashboard's grid row unit is 80px and `TileSpan` caps at 4, which would give an embedded RAID
report a 320px box. Since the row class is now injected, **Reports passes
`auto-rows-[120px]`** — h4 ≈ 480px — and the tile body's existing `overflow-auto` scrolls
anything taller. No type change, and the Dashboard's 80px/72px density classes are untouched.

### Extras migration

`settings.reports.extra` retires as the owner of order and visibility.

On first load `loadLayout` returns `null`. The Reports adapter then seeds a layout in which every
addable report **absent from** `resolveExtraReports(settings.reports?.extra)` starts in `hidden`,
and reconciles that instead of the plain default. The existence of the
`aipm-cockpit:reports-layout` key is itself the migration marker, so it runs exactly once.

Afterwards `settings.reports.extra` is read by nothing. The field stays on the Settings type —
removing it is a separate change with its own storage surface, and this slice does not touch
Settings persistence. A follow-up is filed for the removal.

The ✕ on an extra card becomes **hide**; the add-report control becomes the **restore shelf**,
matching the Dashboard's ⋮ → hide and shelf → restore.

**Accepted cost, already agreed:** arrangement becomes per-device, so which reports a user added
no longer follows them to another machine. This is the same trade the Dashboard already made, and
the reason is the same — an arrangement is a preference, not data, and keeping it out of
`Workspace` means zero backend write paths, no codec change and no golden fixture change.

### Reports panel changes

- `reports.tsx` renders `layout.board` in order inside `ArrangementGrid`, each block wrapped in
  `ArrangementTile` (grip + title + ⋮ menu).
- The existing extra-card `useListReorderDnd` wiring is **removed** — one arrangement mechanism,
  not two.
- `ResetLayoutButton` joins the toolbar. `ReportCard`'s toolbar is **shared** by every report
  panel, so the button goes through `toolbarExtra` rather than into `ReportCard` itself, or every
  consumer inherits it. Order follows the house rule: the trailing group stays
  Print · reset-columns · reset-pane-size, with reset-layout immediately before it, mirroring the
  Dashboard's Print · reset-layout · reset-size.
- The nine block bodies move to a presentational `reports-blocks.tsx`, leaving `reports.tsx` as
  orchestrator — the gantt/reports split convention. `reports.tsx` is 618 lines today and this
  slice grows it; the ratchet limit is 1600, so neither file is near it either way.
- Popout stays read-only: `isPopout` suppresses grips, menus, shelf and persistence, exactly as
  on the Dashboard.

### State that does not move with a block

`byAssignee` owns its column-width and sort state, and `byGroup`/`byLabel` **share** one `byX`
width state. Saved views capture all of it. Reordering does not disturb any of this. Hiding a
block leaves its state orphaned in the panel — the same behaviour the Dashboard's shelf already
has, and acceptable for the same reason: the state is re-adopted on restore.

---

## Non-goals

- No per-window/per-modal help icon (§418).
- No removal of the `settings.reports.extra` field.
- No change to the Projects tab's Move-to-Turso gate.
- No new persisted `Workspace` field, and therefore no six-write-path work.
- No version bump and no release. This slice ships separately, on explicit say.

---

## Testing

**A3**

- A matrix over `{ no test run · test ok · test failed }` × `{ fields unchanged · url edited ·
  token edited }`, asserting `disabled` and whether the message renders.
- The mutation that matters: revert the fingerprint comparison to `tursoTest?.kind === "ok"`
  alone. The url-edited and token-edited rows must go red. A test that only exercises the
  never-tested row passes either way.
- Assert the disabled state directly — `toBeDisabled()` plus the probe `not.toHaveBeenCalled()`.
  Do not write a test that clicks a disabled button and awaits a message: a disabled control
  dispatches no events, so that test times out rather than failing, which reads like a broken
  suite.

**F**

- The Dashboard's existing unit and property tests must stay green **unmodified**. If a
  Dashboard test needs editing, the adapter's contract was not preserved and the extraction is
  wrong.
- New property tests for the generic engine over a synthetic two-block catalogue, mirroring the
  Dashboard's: every block exactly once across `board` + `hidden`; sizes always within their own
  spec's bounds; a new catalogue entry lands after its nearest present predecessor.
- Reconcile tests for the Reports catalogue specifically: an unknown stored id is dropped, a
  duplicate in `hidden` is collapsed, an out-of-range span is clamped per axis.
- Migration: no stored layout + `settings.reports.extra = ["raid-report"]` ⇒ the other three
  addable reports start hidden, `raid-report` does not. Second load reads the stored layout and
  ignores `settings.reports.extra` entirely — assert that by changing the setting between loads
  and observing no effect.
- **Row-unique accessible names.** Thirteen grips and thirteen ⋮ menus. Use
  `src/test/row-unique-names.ts` with `requireCollisionSeed: true`, not a hand-rolled
  enumeration. The axe gate is provably blind to duplicate accessible names in every view at
  every seed size, so this unit test is the only possible detector.

**Gates per task:** `npx tsc --noEmit` (exits 2 on diagnostics) · `npx eslint --max-warnings=0` on
touched files (`npm run lint` exits 1 from gitignored leftovers) · the touched vitest files, then
`npm run test:run` · `npm run test:shuffle` (new tests are added) · `npm run size:check`. Never
two vitest processes at once. Never read a gate's exit code through a pipe — redirect to the
session scratchpad, check the exit code unpiped, then grep the file, and grep for `Errors`
alongside every tally.

---

## Risks

1. **The `minW` table is a taste call no gate can check.** A wrong value ships a broken layout
   silently. Owed: a browser eye-verify at the `xl` breakpoint and below.
2. **Print.** Reports carries `print-root print-landscape`. A dense grid must still print sanely
   and nothing gates it. Owed: a print-preview eye-verify.
3. **The Dashboard refactor is the real regression surface.** Its layout property tests are the
   safety net; they must pass untouched.
4. **Popout read-only must survive the extraction.** A generic hook that lost the `isPopout`
   guard would start persisting from popout windows, cross-writing the main window's
   arrangement.
5. **Two surfaces now share one storage envelope.** Both key into the same
   `{[projectId]: layout}` shape via `readDeviceJson`; the 50-project cap and the
   insertion-order recency rule apply independently per key. The recency rule depends on project
   ids not being integer-like — still true, all are UUIDs or the literal `"default"`.
