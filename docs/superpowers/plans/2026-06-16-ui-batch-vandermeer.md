# UI/Data Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 12-item UI/data batch (sample-data scaling, Action Center polish, Influence/Interest fixes, dashboard tweaks, settings IA) folded into the `feat-calendar-writeback` branch.

**Architecture:** Mostly surface-side React + small pure helpers (`scaleWorkspace`, source-icon map). i18n keys front-loaded so each UI task stays tsc-green. No new persisted `Workspace` field.

**Tech Stack:** TypeScript, React 19, Next.js (forked), Vitest + Testing Library, Playwright (axe gate).

**Spec:** `docs/superpowers/specs/2026-06-16-ui-batch-vandermeer-design.md` (committed `6569df1`).

**Branch:** `feat-calendar-writeback` (already checked out).

**Engineer context (read once):** `Lang` has no `"en"` (use `"en-US"`); `t(lang, key, ...params)` → 0-based `{0}`. `i18n.de.ts` is CRLF + Edit-corrupts-umlauts → node UTF-8 write. CI `--max-warnings=0` (unused = FATAL). `Date.now()`/`new Date()` argless banned in render/useMemo → lazy `useState(()=>…)` or effects. Palette: AIPM tokens only, NO shadow/gradient. Axe gate: every new control labeled + keyboard-operable. `action.score` IS on `SuggestedAction`.

---

## Task 1: i18n keys for the whole batch (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

Front-load every new key so later tasks reference existing keys (parity stays green per task).

- [ ] **Step 1: EN keys** — add to `i18n.ts`:
```
wizardStorageTursoRecommended: "Turso recommended — richer features, a more complete data model, and more automation than file storage.",
commTemplateCancelEdit: "Cancel editing",
actionScoreTooltip: "Score: {0}",
actionLearningPrefix: "Learning is",
actionLearningOn: "ON",
actionLearningOff: "OFF",
actionLearningGoToSettings: "Open Next-actions settings",
stakeholderNeedsComms: "Needs communication — open in the Action Center",
dashboardShowTrends: "Show trends",
dashboardHideTrends: "Hide trends",
versionHighlightUiBatchVm: "Influence/Interest, Action Center, and dashboard polish, plus scalable sample datasets.",
```
- [ ] **Step 2: DE keys** — via a temporary node UTF-8 CRLF script (insert after an existing anchor, e.g. `versionHighlightCalendarPush:`). Real umlauts:
```
wizardStorageTursoRecommended: "Turso empfohlen — mehr Funktionen, ein vollständigeres Datenmodell und mehr Automatisierung als Dateispeicher."
commTemplateCancelEdit: "Bearbeitung abbrechen"
actionScoreTooltip: "Bewertung: {0}"
actionLearningPrefix: "Lernen ist"
actionLearningOn: "EIN"
actionLearningOff: "AUS"
actionLearningGoToSettings: "Einstellungen für nächste Aktionen öffnen"
stakeholderNeedsComms: "Kommunikation nötig — im Aktionscenter öffnen"
dashboardShowTrends: "Trends anzeigen"
dashboardHideTrends: "Trends ausblenden"
versionHighlightUiBatchVm: "Verbesserungen an Einfluss/Interesse, Aktionscenter und Dashboard sowie skalierbare Beispieldaten."
```
Delete the temp script.
- [ ] **Step 3: Verify** — `npx tsc --noEmit` (parity) + `npm run test:run -- i18n-encoding` → green; visually confirm umlauts (vollständigeres, nötig, für).
- [ ] **Step 4: Commit** — `git add src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat: i18n keys for the UI batch (EN/DE)"`

---

## Task 2: Pure `scaleWorkspace(ws, factor)`

**Files:** Create `src/app/scale-workspace.ts`, `src/app/scale-workspace.test.ts`.

**Context:** Replicate every entity `factor` times with id-offset + FK remap so big/huge datasets keep referential integrity. Read `src/app/types.ts` for the `Workspace` shape + every entity's id and id-array fields BEFORE implementing.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/scale-workspace.test.ts
import { describe, it, expect } from "vitest";
import { scaleWorkspace } from "./scale-workspace";
import type { Workspace } from "./workspace";

function tinyWs(): Workspace {
  // Minimal but FK-linked: 1 task, 1 raid linking the task + a stakeholder, 1 milestone linking the task, 1 stakeholder.
  // Build from emptyWorkspace() + push entities; read workspace.ts emptyWorkspace() for the shape.
  // (The implementer fills this from the real Workspace shape.)
  return {} as Workspace;
}

describe("scaleWorkspace", () => {
  it("factor 1 preserves entity counts", () => {
    const ws = tinyWs();
    const out = scaleWorkspace(ws, 1);
    expect(out.tasks.length).toBe(ws.tasks.length);
  });
  it("factor 3 triples every entity", () => {
    const ws = tinyWs();
    const out = scaleWorkspace(ws, 3);
    expect(out.tasks.length).toBe(ws.tasks.length * 3);
    expect(out.raid.length).toBe(ws.raid.length * 3);
    expect(out.milestones.length).toBe(ws.milestones.length * 3);
    expect(out.stakeholders.length).toBe(ws.stakeholders.length * 3);
  });
  it("remaps FKs so no replica references the original ids (no dangling refs)", () => {
    const ws = tinyWs();
    const out = scaleWorkspace(ws, 2);
    const taskIds = new Set(out.tasks.map((t) => t.id));
    for (const r of out.raid) for (const id of r.linkedTaskIds ?? []) expect(taskIds.has(id)).toBe(true);
    const stkIds = new Set(out.stakeholders.map((s) => s.id));
    for (const r of out.raid) for (const id of r.stakeholderIds ?? []) expect(stkIds.has(id)).toBe(true);
    // ids unique across all replicas
    expect(new Set(out.tasks.map((t) => t.id)).size).toBe(out.tasks.length);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm run test:run -- src/app/scale-workspace.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/app/scale-workspace.ts`. Pattern: for replica `k` in `0..factor-1`, offset = `k * OFFSET` (`const OFFSET = 100000`). Deep-clone each entity, add `offset` to its `id` and to every id-array FK field, and to scalar FK fields. Enumerate the real fields from `types.ts` — at minimum: `Task` (id, linkedTaskIds, predecessors/dependencies if present, resourceId? — leave resourceId remapped only if resources are also scaled; scale resources too), `RaidItem` (id, parentId/childIds if present, linkedTaskIds, stakeholderIds), `ChangeItem` (id, stakeholderIds, linked raid id), `Milestone` (id, linkedTaskIds, RACI entries keyed by stakeholderId×milestoneId), `Stakeholder` (id), resources/roles/absences/shifts/budgets (ids + any person FK). Append ` (k+1)` to a `name`/`title` where present (skip replica 0 to keep the originals pristine, or suffix all replicas k≥1). `factor===1` → structural clone, unchanged. Keep `ws.project`/`plan`/settings-like singletons as-is (only the first copy). Provide an explicit per-entity remap so a missing field can't silently drop.

- [ ] **Step 4: Run to verify pass** — green. Add a round-trip assertion (`jsonToWorkspace(workspaceToJson(scaleWorkspace(ws,3)))` preserves counts) if quick.
- [ ] **Step 5: Lint + typecheck** — clean.
- [ ] **Step 6: Commit** — `git add src/app/scale-workspace.ts src/app/scale-workspace.test.ts && git commit -m "feat: pure scaleWorkspace (id-offset + FK remap)"`

---

## Task 3: Rename sample-workspace → `-small` + generate big/huge

**Files:** Rename `sample-workspace.{json,csv,md,sqlite3}` → `-small.*`; modify `golden-workspace.test.ts`, `scripts/generate-sample-workspace.ts`, `README.md`, any other referencer; create `sample-workspace-big.{json,sqlite3}` + `sample-workspace-huge.{json,sqlite3}`.

- [ ] **Step 1: Find all references** — `grep -rn "sample-workspace" src scripts README.md docs --include=*.ts --include=*.tsx --include=*.md | grep -v node_modules`. Note each.
- [ ] **Step 2: Rename the 4 files** (git mv):
```bash
git mv sample-workspace.json sample-workspace-small.json
git mv sample-workspace.csv sample-workspace-small.csv
git mv sample-workspace.md sample-workspace-small.md
git mv sample-workspace.sqlite3 sample-workspace-small.sqlite3
```
- [ ] **Step 3: Update every reference** — point `golden-workspace.test.ts` at `sample-workspace-small.json` (the golden source) — the `__fixtures__/golden-*` comparison is unchanged (same bytes, only the input path moved). Update `generate-sample-workspace.ts` (reads `-small.md`, writes `-small.json`/`-small.sqlite3`). Update `README.md` Sample-Workspace table to the `-small` names + add big/huge rows. Update any test that loads `sample-workspace*`.
- [ ] **Step 4: Run the golden + sample tests** — `npm run test:run -- golden-workspace sample` → green (only paths changed; bytes identical).
- [ ] **Step 5: Generate big/huge** — extend `generate-sample-workspace.ts` (or a sibling `generate-sample-scaled.ts`): load the small workspace (`markdownToWorkspace(read("-small.md"))` or `jsonToWorkspace(read("-small.json"))`), `scaleWorkspace(ws, 3)` → write `sample-workspace-big.json` (`workspaceToJson`) + `sample-workspace-big.sqlite3` (reuse the existing tenant-sqlite emit pipeline), and `scaleWorkspace(ws, 10)` → `-huge.{json,sqlite3}`. Run `npx vite-node scripts/generate-sample-workspace.ts`. Confirm the 4 new files exist and the json parses + has 3×/10× counts.
- [ ] **Step 6: Lint + typecheck + full serialization suite** — `npm run lint && npx tsc --noEmit && npm run test:run -- golden-workspace storage-serialization csv-codecs markdown-codecs sample` → green.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: rename sample data to -small; add generated -big (3x) and -huge (10x)"`

---

## Task 4: New-project wizard — Turso-recommended note

**Files:** Modify `src/app/create-project-wizard.tsx` (or `create-project-form.tsx` where the storage selector renders). Test: the wizard's test.

- [ ] **Step 1: Failing test** — assert the storage step renders the recommendation text (`getByText(/Turso recommended/i)`). Run → FAIL.
- [ ] **Step 2: Implement** — near the `storage` selector (`create-project-wizard.tsx:125` area / wherever the file/turso radio renders), add an informational `<p className="text-xs text-muted-foreground">{t(lang, "wizardStorageTursoRecommended")}</p>` (or an info-tinted box using a palette token). No behavior change; default stays `"file"`. Labeled text, no shadow.
- [ ] **Step 3: Run** test → PASS. Lint + tsc → clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: Turso-recommended note in the new-project wizard"`

---

## Task 5: Comm-template editor — Cancel button

**Files:** Modify `src/app/settings-sections/comm-templates-section.tsx`. Test: its test file.

**Context:** body persists on editor-group blur (lines 220-227 guard); `bodyDraft` state (42); `selectTemplate` loads `tpl.body` (69). A restore flow already remounts the editor via a key/nonce — reuse that pattern.

- [ ] **Step 1: Failing test** — select a template, change `bodyDraft` (simulate editor onChange), click "Cancel editing"; assert `bodyDraft` reverts to the stored `selected.body` and `props.onSaveBody` is NOT called. Run → FAIL.
- [ ] **Step 2: Implement** — add a `commTemplateCancelEdit` button inside the blur-guarded editor toolbar (so its click does not trigger the group's blur-save). On click: `setBodyDraft(selected.body)` and bump the editor remount key/nonce (mirror the restore flow's `restoreNonce` so the rich editor reloads the reverted content). Labeled; palette tokens; no shadow.
- [ ] **Step 3: Run** test → PASS. Lint + tsc → clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: Cancel-editing button in the comm-template editor"`

---

## Task 6: Settings IA — fold Storage+Appearance into General; Comm-Templates Expert-only below Templates

**Files:** Modify `src/app/settings-view.tsx`. Test: `settings-view`/`settings-menu` test.

**Context:** `RAIL` (55-70), `EXPERT_IDS` (73), `STORAGE_ID`/`FLOWS_ID`/`INTEGRATION_IDS` consts, `mainEntries` filter + alpha sort (92-99), `renderRailButton`, the `active === "x"` render switch. Appearance + Storage are currently rail entries with their own render branches.

- [ ] **Step 1: Failing tests** — (a) opening General renders the Appearance + Storage sub-sections with dividers; (b) "Storage" and "Appearance" are NOT in the rail; (c) Comm Templates appears in the rail directly below Templates in Expert mode and is absent in non-expert mode. Run → FAIL.
- [ ] **Step 2: Implement**
  - **Fold:** remove `"appearance"` and `"storage"` from the rail-building filters (exclude them from `mainEntries` like storage already is; drop `appearance` from the alpha list). In the render switch, when `active === "general"`, render `<GeneralSection/>` then a divider then the Appearance section component then a divider then the Storage section component (compose the three existing section components; keep their i18n labels as in-page `<h_>` subheadings). Remove the standalone `active === "appearance"` / `active === "storage"` branches (or redirect them to general). If `active` could be set to `"appearance"`/`"storage"` elsewhere, coerce to `"general"` on entry (guard in the render or a normalizing effect). Also fix the `toggleExpert` fallback (line ~108) which sets `setActive("appearance")` — change to `"general"` (appearance is no longer a rail target).
  - **Comm Templates:** add `"commTemplates"` to `EXPERT_IDS`. To force it **directly below Templates** despite the alpha sort, include it in the main list (remove the `r.id !== "commTemplates"` exclusion) but give the rail an explicit ordering for the templates+commTemplates pair: after the alpha sort, splice `commTemplates` to immediately follow `templates` (e.g. build `mainEntries`, then reorder so `commTemplates` sits right after `templates`). Keep the existing `props.commTemplatesEnabled` gate (only show when enabled) AND the expert gate.
- [ ] **Step 3: Run** tests → PASS. Lint + tsc → clean. `npm run test:run -- settings` → green.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: settings IA — General hosts Appearance+Storage; Comm Templates expert-only below Templates"`

---

## Task 7: Action rows — per-source icon + score tooltip

**Files:** Create `src/app/action-source-icon.tsx`; modify `src/app/action-row.tsx` (+ test).

**Context:** the source label renders at action-row.tsx ~97 inside a flex row; `ACTION_SOURCE_LABEL` maps source→label key; `action.score` is available. `InfoTooltip` exists (`./info-tooltip`).

- [ ] **Step 1: Implement the icon map** — `src/app/action-source-icon.tsx`: `export const ACTION_SOURCE_ICON: Record<ActionSource, ReactNode>` — a small inline `<svg aria-hidden className="h-3.5 w-3.5">` per source (task-due, raid, change-pending, milestone, budget, stakeholder-comms, schedule, workload). Use simple palette-token-colored glyphs (`currentColor`); distinct shapes are enough. Import `ActionSource` from `./next-actions/types`.
- [ ] **Step 2: Failing test** — in `action-row.test.tsx`: a row renders the source icon (a wrapper with a known test id / the tooltip), and the InfoTooltip text contains the score (e.g. `Score: 42`). Run → FAIL.
- [ ] **Step 3: Wire into action-row** — before the source-label `<span>` (line ~97), render `<InfoTooltip text={t(lang, "actionScoreTooltip", action.score)}>{ACTION_SOURCE_ICON[action.source]}</InfoTooltip>` (or wrap the icon + label; the InfoTooltip provides the accessible hint for the decorative svg). Confirm InfoTooltip accepts children/trigger; if it only takes `text`, render the icon + an adjacent `<InfoTooltip text=...>` info dot, OR a `title`-bearing wrapper — mirror how InfoTooltip is used elsewhere. Palette tokens; no shadow.
- [ ] **Step 4: Run** → PASS. Lint + tsc → clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: per-source icon + score tooltip on action rows"`

---

## Task 8: Soon tier — sort by score desc

**Files:** Modify `src/app/actions-panel.tsx` (+ test).

- [ ] **Step 1: Failing test** — render the panel with soon-tier actions in non-descending score order; assert the rendered order is score-desc. Run → FAIL.
- [ ] **Step 2: Implement** — where `const rows = actions.filter((a) => a.tier === tier)` (line ~45), append a stable sort: `.slice().sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))`. Apply to all tiers (cheap, consistent) so soon (and the others) are deterministically highest→lowest.
- [ ] **Step 3: Run** → PASS. Lint + tsc → clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: sort action tiers by score desc"`

---

## Task 9: Influence/Interest — contrast fix

**Files:** Modify `src/app/influence-interest-matrix.tsx` (+ test if present).

**Context:** `cellTint` (20-24) faint alpha tints; cell text `text-AIPM-dark-blue dark:text-foreground` (64). Decouple text contrast from the tint.

- [ ] **Step 1: Implement** — wrap each cell's stakeholder labels/markers in a solid chip: `bg-surface text-foreground` (rounded, small padding) so the text contrast no longer depends on the quadrant tint. Demote the quadrant `cellTint` to a thin accent — e.g. keep the tint as a subtle cell background but ensure the LABELS sit on the solid chip; or change the tint to a left-accent `border-l-2 border-AIPM-green/…`. Keep axis labels `text-muted-foreground`. Palette tokens only, no shadow.
- [ ] **Step 2: Component test** — assert the cell renders the solid-chip label wrapper (a class/test id). The real contract is the e2e axe gate.
- [ ] **Step 3: Verify contrast** — `npm run lint && npx tsc --noEmit`; run the a11y e2e locally if feasible (`npm run e2e` — the 12-view axe gate must pass the stakeholders view). If you can't run e2e, eyeball both themes.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "fix: readable text contrast in the Influence/Interest matrix"`

---

## Task 10: Influence/Interest — needs-communication icon → jump to Action Center

**Files:** Modify `src/app/influence-interest-matrix.tsx` (props + icon), and the parent that renders it + computes next-actions (likely `task-manager.tsx`/the stakeholders view host). Test: matrix test.

**Context:** the `stakeholder-comms` next-actions source produces actions referencing a stakeholder. Resolve the action→stakeholder id mapping (read the stakeholder-comms provider + the action `cta`/id format). Navigation = `setActiveTab("open-points")` (the Action Center view).

- [ ] **Step 1: Thread the data** — add matrix props `commsPendingStakeholderIds: ReadonlySet<number>` and `onJumpToComms?: (stakeholderId: number) => void`. In the parent, derive the set from the computed `nextActions` filtered to `source === "stakeholder-comms"`, mapping each to its stakeholder id (resolve the id from the action — grep the stakeholder-comms provider for how the stakeholder id is encoded in the action id/cta). Provide `onJumpToComms = (id) => setActiveTab("open-points")` (gated `!isPopout`).
- [ ] **Step 2: Failing test** — a stakeholder in `commsPendingStakeholderIds` renders a labeled "needs communication" button; clicking calls `onJumpToComms` with that id; a stakeholder not in the set shows no icon. Run → FAIL.
- [ ] **Step 3: Implement the icon** — for a stakeholder whose id ∈ the set, render a small labeled button (svg + `aria-label={t(lang,"stakeholderNeedsComms")}`) on/next to the marker; `onClick` → `onJumpToComms(id)` (stopPropagation if inside a clickable cell). Palette tokens; no shadow.
- [ ] **Step 4: Run** → PASS. Lint + tsc → clean. Full suite for the touched parent.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: needs-communication marker on Influence/Interest → jump to Action Center"`

---

## Task 11: Action Center — "Learning is ON/OFF" status pill (Expert-only)

**Files:** Modify `src/app/actions-panel.tsx` (header) + the parent threading `learningEnabled`/`expertMode`/an open-settings handler (`task-manager.tsx`). Test: panel test.

**Context:** `settings.nextActionsLearning?.enabled` + `settings.expertMode`. A settings-navigation handler exists (the learning-insights/open-settings wiring from the learning slice — reuse `setActiveTab("settings")` + select the `nextActions` section, or the existing `onOpenInsights`-style handler).

- [ ] **Step 1: Thread props** — add `learningEnabled?: boolean`, `expertMode?: boolean`, `onOpenLearningSettings?: () => void` to the actions-panel props; in `task-manager.tsx` pass `learningEnabled = settings.nextActionsLearning?.enabled ?? false`, `expertMode = settings.expertMode === true`, and `onOpenLearningSettings = () => { setActiveTab("settings"); /* + select nextActions section if the settings view exposes it */ }`.
- [ ] **Step 2: Failing test** — Expert + enabled → renders "Learning is ON" with an `ON` pill (green); Expert + disabled → "Learning is OFF" (muted pill); non-expert → not rendered; clicking → `onOpenLearningSettings`. Run → FAIL.
- [ ] **Step 3: Implement** — in the actions-panel header (the top row with the title), add a right-aligned button (only when `expertMode`): `t(lang,"actionLearningPrefix")` + a pill `<span>` styled `bg-AIPM-green text-white` for ON (`actionLearningOn`) or `bg-surface-muted text-muted-foreground` for OFF (`actionLearningOff`). The whole thing is a `<button onClick={onOpenLearningSettings} aria-label={t(lang,"actionLearningGoToSettings")}>`. Keyboard-operable; palette tokens; no shadow.
- [ ] **Step 4: Run** → PASS. Lint + tsc → clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Learning ON/OFF status pill in the Action Center (expert-only)"`

---

## Task 12: Dashboard — Trends toggle to the top toolbar

**Files:** Modify `src/app/dashboard-panel.tsx` (+ test).

**Context:** the Show/Hide-Trends button is inside the trends widget (373-399). Find the dashboard's top header/toolbar region (read the top of the panel's JSX) + any print affordance.

- [ ] **Step 1: Failing test** — assert a "Show trends"/"Hide trends" toggle renders in the dashboard's top toolbar (not inside the trends widget), and toggling calls `onToggleTrends`. Run → FAIL.
- [ ] **Step 2: Implement** — move the toggle out of the trends widget into the dashboard top toolbar, to the LEFT of the print control (if a print button exists there; else into the toolbar's right cluster). Label = `t(lang, showTrends ? "dashboardHideTrends" : "dashboardShowTrends")`; `onClick={() => props.onToggleTrends?.(!showTrends)}`; `print:hidden`. Remove the in-widget toggle buttons (373-399 show/hide) so it's not duplicated; the widget still shows/hides based on `showTrends`.
- [ ] **Step 3: Run** → PASS. Lint + tsc → clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: move dashboard Trends toggle to the top toolbar"`

---

## Task 13: Dashboard status summary — buttons below + autogrow textarea

**Files:** Modify `src/app/dashboard-panel.tsx` (+ test).

**Context:** textarea (`min-h-24`) + Save/Clear near it (208-242).

- [ ] **Step 1: Failing test** — assert Save+Clear render in a `justify-end` row BELOW the textarea; entering multi-line content grows the textarea height (assert the input handler sets height to scrollHeight, or that the element has the autogrow handler). Run → FAIL.
- [ ] **Step 2: Implement**
  - Restructure: textarea first, then a `<div className="mt-2 flex justify-end gap-2 print:hidden">` containing Save then Clear (keep Save's disabled-when-unchanged + Clear behavior + the timestamp below or beside).
  - Autogrow: add `onInput` (or onChange) handler `(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }` and apply the same sizing on mount/value-change via a ref + effect (resize when `draftNarrative` changes). Keep `min-h-24`, drop a fixed height. No library.
- [ ] **Step 3: Run** → PASS. Lint + tsc → clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: dashboard status-summary buttons below + autogrow textarea"`

---

## Task 14: Budget burn — show CPI

**Files:** Modify `src/app/dashboard-panel.tsx` (+ test).

**Context:** budget-burn section (268-302); `model.evm.cpi` already computed (shown in the EVM block at 288).

- [ ] **Step 1: Failing test** — assert the budget-burn section shows the CPI value when `model.evm.cpi` is present (e.g. `CPI 0.95`), and `—` when null. Run → FAIL.
- [ ] **Step 2: Implement** — in the burn section/tile (around 269-281), add a `CPI` line: `model.evm.cpi != null ? model.evm.cpi.toFixed(2) : "—"` with a `t(lang, …)` or the existing CPI label key already used at line 288 (reuse it). Match the surrounding tile markup + print behavior.
- [ ] **Step 3: Run** → PASS. Lint + tsc → clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: show CPI in the dashboard budget-burn section"`

---

## Task 15: Release + full gate

**Files:** `src/app/version.ts`, `CHANGELOG.md`; then verify.

- [ ] **Step 1: version.ts** — the calendar-write-back release already set 0.96.0 "VanderMeer" on this branch. This batch ships in the same MR, so EITHER keep 0.96.0 and just append the batch highlight, OR bump to 0.97.0 with a new codename. Decision: **keep 0.96.0 "VanderMeer"** (one MR, one release) and append `"versionHighlightUiBatchVm"` to `APP_HIGHLIGHT_KEYS`. Update the 0.96.0 CHANGELOG entry to also list the batch items (or add a sub-section).
- [ ] **Step 2: Verify** — `npx tsc --noEmit && npm run test:run -- version` → green.
- [ ] **Step 3: Full gate** — `npm run lint && npx tsc --noEmit && npm run test:run && npm run build` → all green. Confirm `git diff --stat main...HEAD -- src/proxy.ts` empty (no CSP change) and the golden fixtures changed only as Task 3 intends.
- [ ] **Step 4: Commit** — `git add src/app/version.ts CHANGELOG.md && git commit -m "chore: changelog + highlight for the UI batch (0.96.0)"`

---

## Self-Review (plan author)

**Spec coverage:** item1→Tasks 2+3; item2→Task 4; item3→Task 5; item4→Task 6; item5→Task 9; item6→Task 7; item7→Task 8; item8→Task 10; item9→Task 11; item10→Task 12; item11→Task 13; item12→Task 14; i18n→Task 1; release→Task 15. All 12 + cross-cutting covered.

**Placeholder scan:** the only deferred specifics are concrete impl-time reads with grep guidance (the `Workspace` entity field list for `scaleWorkspace`, the InfoTooltip children API, the dashboard toolbar/print location, the stakeholder-comms action→id mapping, the settings render-switch shape). Each has a "read X / grep Y" instruction. The `tinyWs()` test fixture is explicitly left for the implementer to fill from the real `Workspace` shape (flagged). No vague "handle errors".

**Type consistency:** `scaleWorkspace(ws, factor)`, `ACTION_SOURCE_ICON: Record<ActionSource, ReactNode>`, the matrix props `commsPendingStakeholderIds`/`onJumpToComms`, panel props `learningEnabled`/`expertMode`/`onOpenLearningSettings`, i18n keys — consistent across tasks.

**Ordering / parallelism:** Task 1 (i18n) MUST precede every UI task (they reference the keys). Task 2 (scaleWorkspace) precedes Task 3. The UI tasks (4,5,6,7,8,9,10,11,12,13,14) are largely file-disjoint and may be executed in parallel waves by the controller (7 touches action-row+new file; 8 touches actions-panel; 11 touches actions-panel+task-manager — 8 and 11 both touch actions-panel, so serialize those two; 9/10 both touch influence-interest-matrix, serialize; 12/13/14 all touch dashboard-panel, serialize). Release (15) last.
