# UI/Data Batch — Influence·Interest + Action Center + Dashboard + Sample Data

**Date:** 2026-06-16
**Status:** Approved (brainstorm) — ready for implementation plan
**Folds into:** branch `feat-calendar-writeback` (atop the calendar write-back feature).

A 12-item UI/UX + sample-data batch. Each item is independent; grouped here as one batch slice
(like prior `ui-batch-*` slices). No new persisted `Workspace` fields. The e2e axe a11y gate +
palette-sweep apply to every new control.

---

## Item 1 — Sample-data: rename to `-small` + add `-big` (3×) and `-huge` (10×)

**Current:** `sample-workspace.{json,csv,md,sqlite3}` (repo root). `golden-workspace.test.ts:38-39`
serializes `sample-workspace.json` and byte-compares vs `src/app/__fixtures__/golden-workspace.{csv,md}`.
`scripts/generate-sample-workspace.ts` parses the curated `.md` → emits `.json` + `.sqlite3`
(never overwrites `.md`/`.csv`).

**Change:**
- **Rename** `sample-workspace.{json,csv,md,sqlite3}` → `sample-workspace-small.{json,csv,md,sqlite3}`.
  Update every reference: `golden-workspace.test.ts`, `generate-sample-workspace.ts`, `README.md`
  (Sample Workspace section), any test that loads `sample-workspace*`, docs. `__fixtures__/golden-*`
  still compare against `-small.json` (the golden source is now `-small`).
- **Add** `sample-workspace-big.{json,sqlite3}` (3×) and `sample-workspace-huge.{json,sqlite3}` (10×),
  generated — **`.json` + `.sqlite3` only** (the importable formats; no md/csv for big/huge; **not**
  golden-byte-pinned — only `-small` keeps the byte-stability test).
- **New pure `scaleWorkspace(ws, factor)`** (`src/app/scale-workspace.ts`, i18n-free, unit-tested):
  returns a workspace with every entity replicated `factor` times. Replica `k` (k≥1) offsets all
  entity ids by `k * OFFSET` (OFFSET large enough to avoid collisions, e.g. 100000) and **remaps every
  intra-entity FK** by the same offset — `Task.linkedTaskIds`, `Task.id`/dependencies, `RaidItem`
  parent/child + `stakeholderIds` + `linkedTaskIds`, `ChangeItem.stakeholderIds`/raid link,
  `Milestone.linkedTaskIds` + RACI (`stakeholderId`×`milestoneId`), `Stakeholder.id`, resources,
  budgets, shifts, absences — anything carrying an id or id-array. Names get a ` (k)` suffix where a
  name exists, to keep them visually distinct. `factor === 1` returns a structural clone unchanged.
  The plan enumerates the exact id/FK fields per entity from `types.ts`.
- **Extend `generate-sample-workspace.ts`** (or a sibling script) to also emit big/huge: load the
  small workspace → `scaleWorkspace(ws, 3)` / `scaleWorkspace(ws, 10)` → `workspaceToJson` +
  the tenant-sqlite emit (reuse the existing sqlite pipeline). Document the command.

**Landmine:** renaming ripples widely — grep `sample-workspace` everywhere and update. The curated
`-small.md`/`.csv` stay hand-authored (never serializer-emit them). Big/huge are 100% machine-generated.

**Testing:** `scale-workspace.test.ts` — id offset + FK remap integrity (no dangling FK after scaling;
counts = factor × original; `factor:1` ≈ identity). `golden-workspace.test` still green against
`-small.json` (only the path changed). A smoke test that `scaleWorkspace(small, 3)` round-trips through
`workspaceToJson`/`jsonToWorkspace` without FK loss.

---

## Item 2 — New-project wizard: Turso-preferred info note

**Current:** `create-project-wizard.tsx:125` holds `storage: "file" | "turso"`; the selector is in the
wizard.

**Change:** Add an informational note adjacent to the storage selector:
"**Turso recommended** — richer features, a more complete data model, and more automation
possibilities than file storage." i18n key `wizardStorageTursoRecommended`. Palette-token styled
(`text-muted-foreground` / an info tint), labeled, no shadow. Purely informational (does not change
the default).

**Testing:** wizard test asserts the note renders on the storage step.

---

## Item 3 — Comm-template editor: Cancel button

**Current:** `comm-templates-section.tsx` — body persists via `onBlur` of the editor group (lines
220-227 blur-guard keeps focus on toolbar clicks); `bodyDraft` state (line 42); `selectTemplate`
loads `tpl.body` into the draft (line 69).

**Change:** Add a **"Cancel editing"** button in the editor toolbar (inside the blur-guarded region so
clicking it does NOT trigger the blur-save). On click: reset `bodyDraft` to the template's last-saved
body (`selected.body` from the store) and remount the editor (bump a `key`/nonce like the restore
flow) so the rich editor reloads the reverted content — discarding in-progress unsaved edits. (It
cannot undo edits already blurred-and-saved.) i18n `commTemplateCancelEdit`. Labeled; palette tokens.

**Testing:** editing the body then clicking Cancel reverts the draft to the stored body and does NOT
call `onSaveBody`.

---

## Item 4 — Settings IA: fold Storage+Appearance into General; move Comm-Templates (Expert-only)

**Current:** `settings-view.tsx` — `SectionId` (lines 50-53), `RAIL` (55-70),
`EXPERT_IDS = ["nextActions","notifications","templates","mode","export"]` (73); storage/integrations/
flows/commTemplates excluded from the main alpha-sorted list (92-99); render via `active === "x"`.

**Change:**
- **Fold Appearance + Storage into General:** when `active === "general"`, render the General section
  **followed by a divider + the Appearance section + a divider + the Storage section** (compose the
  three existing section components in one page). Remove `"appearance"` and `"storage"` from the rail
  (drop their `RAIL` entries + their standalone render branches; keep the section components,
  now rendered inside General). Keep their i18n labels as in-page subheadings.
- **Comm Templates rail entry:** position it **directly below Templates** in the rail order and make it
  **Expert-mode-only** (add `"commTemplates"` to `EXPERT_IDS`; insert it after `"templates"` in the
  rail ordering — note the main list is alpha-sorted by label, so to force "below Templates" either
  give it an explicit order or group it with templates; the plan pins the exact ordering mechanism).

**Landmine:** the rail is alpha-sorted by label (92-99) — "below Templates" needs an explicit
order/group, not alpha. Storage was its own divider group (line 77) — that grouping is removed.
Removing rail entries must not break deep-links to those sections (if `active` can be set to
`"storage"`/`"appearance"` from elsewhere, redirect to `"general"`).

**Testing:** General section renders all three sub-sections with dividers; Storage/Appearance no longer
in the rail; Comm Templates appears below Templates only in Expert mode; non-expert hides it.

---

## Item 5 — Influence/Interest contrast fix

**Current:** `influence-interest-matrix.tsx` — `cellTint` (20-24) applies faint alpha tints
(`bg-AIPM-green/30|20`, `bg-AIPM-purple/15`, `bg-surface-muted/30`); cell text `text-AIPM-dark-blue
dark:text-foreground` (64). The alpha tints flip mid-tone in dark mode → text fails AA.

**Change:** Decouple text contrast from the quadrant tint. Render each cell's **stakeholder
labels/markers inside a solid `bg-surface` chip with `text-foreground`** (AA in both themes), and
demote the quadrant tint to a **thin accent** (e.g. a left border `border-l-2` or a small corner swatch
on the cell), not a full fill behind the text. Axis labels keep `text-muted-foreground` (already on
plain bg). Palette tokens only (no new colors, no shadow). The e2e axe gate (12-view contrast scan)
must pass.

**Testing:** the axe a11y gate (e2e) is the contract; a component test asserts the cell renders the
solid-chip label wrapper.

---

## Item 6 — Action rows: per-source icon + score tooltip

**Current:** `action-row.tsx` renders a tier dot (93) + `ACTION_SOURCE_LABEL[action.source]` text
(97) + title (99) + why (101). `action.score` IS on the `SuggestedAction` (engine-set).

**Change:** Add a **new `ACTION_SOURCE_ICON` map** (`src/app/action-source-icon.tsx` — a small inline
SVG per `ActionSource`: task-due, raid, change-pending, milestone, budget, stakeholder-comms,
schedule, workload). Render the icon **before the source label**, wrapped in an `InfoTooltip` whose
text is `t(lang, "actionScoreTooltip", action.score)` ("Score: {0}"). `aria-hidden` on the decorative
svg but the tooltip provides the accessible hint. Palette tokens (`text-muted-foreground` / source
color), no shadow.

**Testing:** a row renders the source icon; hovering shows "Score: <n>"; each ActionSource maps to an
icon (no missing-key crash).

---

## Item 7 — Soon tier: sort by score desc

**Current:** `actions-panel.tsx` filters actions per tier; relies on the engine's global score-desc
order. **Change:** explicitly sort the **soon** tier list by `score` desc (then id asc tiebreak, like
the engine) before render, so it is deterministically highest→lowest regardless of upstream order.
(Apply the same explicit sort to now/monitor too for consistency — cheap, harmless.)

**Testing:** a soon-tier list with out-of-order scores renders highest-first.

---

## Item 8 — Influence/Interest: "needs communication" icon → jump to Action Center

**Current:** the `stakeholder-comms` next-actions source produces actions referencing a stakeholder;
the matrix has stakeholders positioned by influence/interest.

**Change:** Pass the matrix a **`commsPendingStakeholderIds: ReadonlySet<number>`** (derived from the
computed next-actions where `source === "stakeholder-comms"`, mapping the action's entity id →
stakeholder) and an **`onJumpToComms?: (stakeholderId: number) => void`** handler. For each stakeholder
in that set, render a small **"needs communication" icon** (a distinct svg, labeled) on/next to the
stakeholder marker; clicking it calls `onJumpToComms`, which **navigates to the Action Center view**
(open-points / the action center) — highlighting the specific action row if a lightweight highlight
mechanism exists, otherwise just navigating. Gated `!isPopout`. Labeled (axe).

**Scope note:** row-level highlight is best-effort; navigating to the Action Center view is the
committed behavior. The plan resolves the stakeholder↔action id mapping (the stakeholder-comms action
id format) and the navigation handler (reuse `setActiveTab("open-points")` / `requestOpen`).

**Testing:** a stakeholder with a pending comms action shows the icon; clicking calls `onJumpToComms`
with the right id; a stakeholder without one shows no icon.

---

## Item 9 — Action Center: "Learning is ON/OFF" status pill (Expert-only)

**Current:** `settings.nextActionsLearning?.enabled` drives the learning layer; `settings.expertMode`
gates expert UI.

**Change:** At the **right end of the Action Center header**, render a status flag
"**Learning is `ON`/`OFF`**" where `ON`/`OFF` is a styled pill/label (green pill for ON,
muted/grey pill for OFF — palette tokens). **Visible only in Expert mode.** Clicking it navigates to
**Settings → Next-actions** (the learning controls). i18n `actionLearningStatusOn`/`...Off` (or a base
key + the ON/OFF label). Keyboard-operable button (axe). Reuses the settings-navigation handler used
by item 9's sibling controls (open settings to the `nextActions` section).

**Testing:** Expert mode + learning enabled → "Learning is ON" (green); disabled → "Learning is OFF";
non-expert → not rendered; click → navigates to settings/nextActions.

---

## Item 10 — Dashboard: Trends toggle → top toolbar

**Current:** `dashboard-panel.tsx` — the Show/Hide-Trends button lives inside the trends widget
(373-399). There is a print affordance (CSS `print:hidden`; a print control in the dashboard
header/toolbar area).

**Change:** Move the **Show/Hide-Trends toggle** into the dashboard's **top toolbar, to the LEFT of the
print control**. It still calls `onToggleTrends(!showTrends)`; label reflects state (Show Trends /
Hide Trends). If no explicit print button exists in the toolbar, place the toggle at the toolbar's
right cluster where print actions sit. `print:hidden` on the toggle. Labeled.

**Testing:** the toggle renders in the top toolbar (not inside the trends widget); toggling flips
`showTrends`.

---

## Item 11 — Dashboard status summary: buttons below + autogrow textarea

**Current:** `dashboard-panel.tsx:208-242` — textarea (`min-h-24`) + Save/Clear buttons near it +
timestamp.

**Change:**
- Move **Save + Clear below the textarea, right-aligned** (a flex row `justify-end` under the
  textarea). Keep Save disabled-when-unchanged + Clear behavior + the timestamp.
- **Auto-grow** the textarea with content: on input, set `el.style.height = "auto"; el.style.height =
  el.scrollHeight + "px"` (and on mount/value-change), keeping a sensible `min-h`. Pure DOM resize,
  no library. (`field-sizing: content` is not relied upon — use the JS handler for cross-browser.)

**Testing:** buttons render below the textarea right-aligned; entering multi-line text grows the
textarea height (assert the resize handler runs / height grows with content).

---

## Item 12 — Budget burn: show CPI

**Current:** `dashboard-panel.tsx` budget-burn section (268-302) shows consumed-vs-budgeted; CPI
(`model.evm.cpi`) is already computed and shown in a separate EVM block (288).

**Change:** Surface **CPI in the budget-burn tile/section** too (e.g. a "CPI {value}" line in the burn
area), using the existing `model.evm.cpi` (`toFixed(2)`, `—` when null). No new computation. Print
behavior matches the surrounding tiles.

**Testing:** the burn section shows the CPI value when `model.evm.cpi` is present; `—` when null.

---

## Cross-cutting

- **Release:** bump `version.ts` (next codename), CHANGELOG entry, a `versionHighlight*` for the batch
  (+ EN/DE). This batch ships within the `feat-calendar-writeback` MR (it folds in), so the release is
  the combined calendar-write-back + this batch — bump once, list both in the changelog.
- **i18n:** all new strings EN + DE (real umlauts; `i18n.de.ts` via node CRLF write).
- **a11y/palette:** every new control labeled + keyboard-operable; AIPM tokens only; no shadows.
- **No new persisted `Workspace` field** — no six-write-path work (the sample-data scaling is
  build-time, not a runtime persisted field).

## Out of scope

- Auto-generating md/csv for big/huge; golden-pinning big/huge.
- Row-level scroll-highlight in the Action Center beyond best-effort (navigation is the contract for
  item 8).
- Changing the comm-template editor's auto-save-on-blur model (Cancel reverts the draft within it).
