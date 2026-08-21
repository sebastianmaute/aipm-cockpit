# Control Tooltips Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the workspace resize-hint tooltip from leaking onto unrelated controls, give every search/filter/sort control (and RAID modal field) a descriptive tooltip, and align the tasks column-header hover to the resources directory.

**Architecture:** The leak is a single `title` on the workspace `<section>` that HTML propagates to title-less descendants — remove it and add an inert corner glyph. Then add ~40 new EN+DE `*Hint` i18n keys and wire them as `title=` on each control; toggles use `SegmentedControl`, which gains an optional `title` prop. Finally, align the shared `SortableTh` header to the resources header (hover shade + `sortBy` tooltip).

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-26-control-tooltips-rework-design.md`

**Verification commands:** single test `npx vitest run src/app/<file>.test.tsx`; full suite `npx vitest run`; typecheck `npx tsc --noEmit`.

**Convention reminder:** attribution is disabled globally — no `Co-Authored-By` trailers. Do NOT edit `eslint.config.mjs` or any config (a hook blocks it). A GateGuard hook may block the first Edit/Write and first Bash, demanding facts in the same message — present them and retry the same call.

---

## Task 1: Add all new i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (the `enUS` object — add before the closing `} as const;`, after `clickToEdit`)
- Modify: `src/app/i18n.de.ts` (the `de` object)

Context: `enUS` is the source of truth; `de` is typed `Record<TranslationKey, string>`, so `tsc` fails until both have every key. `enGB` spreads `enUS` (no edit). These keys are consumed by Tasks 5-9.

- [ ] **Step 1: Add the EN keys to `enUS` in `src/app/i18n.ts`**

Insert these lines just before `} as const;`:

```ts
  priorityFilterHint: "Show only tasks of the selected priority.",
  assigneeFilterHint: "Show only tasks assigned to the selected person.",
  resetFiltersHint: "Clear the search box and all filters to show every item again.",
  ganttSearchHint: "Filter the timeline to tasks whose name, assignee, blockers, or notes match your text.",
  ganttStatusFilterHint: "Show only tasks in the selected status.",
  ganttSortHint: "Choose the order in which task bars are arranged on the timeline.",
  raidSearchHint: "Filter the register to items whose title, owner, or description match your text.",
  raidCategoryFilterHint: "Show only items of the selected category — Risk, Assumption, Issue, or Dependency.",
  raidSeverityFilterHint: "Show only items of the selected severity.",
  raidStatusFilterHint: "Show only items in the selected status.",
  raidFieldCategoryHint: "The kind of entry — Risk, Assumption, Issue, or Dependency. Changing it may reset status and severity.",
  raidFieldStatusHint: "Current lifecycle state of this item; the available options depend on the category.",
  raidFieldTitleHint: "A short, specific summary of the risk, assumption, issue, or dependency.",
  raidFieldDescriptionHint: "Optional background and context for the steering committee.",
  raidFieldSeverityHint: "How serious this item is. For risks it is derived automatically from probability × impact.",
  raidFieldRiskMatrixHint: "Pick probability × impact; the cell you choose sets the risk's severity.",
  raidFieldOwnerHint: "The person accountable for managing this item.",
  raidFieldOwnerEmailHint: "Email of the owner, used for status inquiries.",
  raidFieldRaisedDateHint: "The date this item was first raised.",
  raidFieldTargetDateHint: "Optional date by which this item should be resolved or mitigated.",
  raidFieldMitigationHint: "How this item will be mitigated, resolved, validated, or delivered.",
  raidFieldLinkedTasksHint: "Search by id or name to link tasks affected by or addressing this item.",
  raidFieldCausedByHint: "Search by id or title to record which other RAID items caused this one.",
  raidFieldDeleteHint: "Permanently delete this RAID item. This cannot be undone.",
  directorySearchHint: "Filter the directory to people whose name, title, department, or email match your text.",
  resourcesViewHint: "Switch between Directory, Workload, Calendar, and Planning views.",
  resourcesGranularityHint: "Group the planning grid by week or by month.",
  resourcesPlanStartHint: "First day of the planning window.",
  resourcesPlanEndHint: "Last day of the planning window.",
  resourcesManageRolesHint: "Open the roles & rates editor to manage disciplines, grades, and rate cards.",
  resourcesOpenReportHint: "Open the resource report in its own window.",
  resourcesRollupHint: "Show or hide the read-only capacity and cost rollup.",
  resourcesAddAbsenceHint: "Record a vacation, sick day, training, or other absence for a person.",
  activitySearchHint: "Search the log by text, wildcard (* ?), or regular expression, depending on the mode.",
  activitySearchModeHint: "Choose how the search text is interpreted: literal text, wildcards, or regex.",
  activityGroupFilterHint: "Show only log entries of the selected kind.",
  activityClearHint: "Delete all activity log entries. This cannot be undone.",
  tasksSearchHint: "Filter the table to tasks whose name, assignee, blockers, or notes match your text.",
  tasksGroupFilterHint: "Show only tasks in the selected group.",
  tasksLabelFilterHint: "Show only tasks carrying the selected label.",
```

- [ ] **Step 2: Add the matching DE keys to `de` in `src/app/i18n.de.ts`**

Insert these lines into the `de` object:

```ts
  priorityFilterHint: "Zeigt nur Aufgaben mit der gewählten Priorität.",
  assigneeFilterHint: "Zeigt nur Aufgaben, die der gewählten Person zugewiesen sind.",
  resetFiltersHint: "Setzt Suchfeld und alle Filter zurück, um wieder alle Einträge anzuzeigen.",
  ganttSearchHint: "Filtert die Zeitachse auf Aufgaben, deren Name, Zuständige(r), Blocker oder Notizen zum Text passen.",
  ganttStatusFilterHint: "Zeigt nur Aufgaben mit dem gewählten Status.",
  ganttSortHint: "Legt die Reihenfolge fest, in der die Aufgabenbalken auf der Zeitachse angeordnet werden.",
  raidSearchHint: "Filtert das Register auf Einträge, deren Titel, Verantwortliche(r) oder Beschreibung zum Text passen.",
  raidCategoryFilterHint: "Zeigt nur Einträge der gewählten Kategorie – Risiko, Annahme, Problem oder Abhängigkeit.",
  raidSeverityFilterHint: "Zeigt nur Einträge mit dem gewählten Schweregrad.",
  raidStatusFilterHint: "Zeigt nur Einträge mit dem gewählten Status.",
  raidFieldCategoryHint: "Die Art des Eintrags – Risiko, Annahme, Problem oder Abhängigkeit. Eine Änderung kann Status und Schweregrad zurücksetzen.",
  raidFieldStatusHint: "Aktueller Status dieses Eintrags; die verfügbaren Optionen hängen von der Kategorie ab.",
  raidFieldTitleHint: "Eine kurze, konkrete Zusammenfassung des Risikos, der Annahme, des Problems oder der Abhängigkeit.",
  raidFieldDescriptionHint: "Optionaler Hintergrund und Kontext für das Lenkungsgremium.",
  raidFieldSeverityHint: "Wie schwerwiegend dieser Eintrag ist. Bei Risiken wird er automatisch aus Wahrscheinlichkeit × Auswirkung abgeleitet.",
  raidFieldRiskMatrixHint: "Wahrscheinlichkeit × Auswirkung wählen; die gewählte Zelle bestimmt den Schweregrad des Risikos.",
  raidFieldOwnerHint: "Die für die Bearbeitung dieses Eintrags verantwortliche Person.",
  raidFieldOwnerEmailHint: "E-Mail der verantwortlichen Person, für Statusanfragen verwendet.",
  raidFieldRaisedDateHint: "Das Datum, an dem dieser Eintrag erstmals erfasst wurde.",
  raidFieldTargetDateHint: "Optionales Datum, bis zu dem dieser Eintrag gelöst oder gemildert sein soll.",
  raidFieldMitigationHint: "Wie dieser Eintrag gemildert, gelöst, validiert oder geliefert wird.",
  raidFieldLinkedTasksHint: "Nach ID oder Name suchen, um Aufgaben zu verknüpfen, die von diesem Eintrag betroffen sind oder ihn behandeln.",
  raidFieldCausedByHint: "Nach ID oder Titel suchen, um zu erfassen, welche anderen RAID-Einträge diesen verursacht haben.",
  raidFieldDeleteHint: "Diesen RAID-Eintrag dauerhaft löschen. Dies kann nicht rückgängig gemacht werden.",
  directorySearchHint: "Filtert das Verzeichnis auf Personen, deren Name, Titel, Abteilung oder E-Mail zum Text passen.",
  resourcesViewHint: "Wechselt zwischen den Ansichten Verzeichnis, Auslastung, Kalender und Planung.",
  resourcesGranularityHint: "Gruppiert das Planungsraster nach Woche oder Monat.",
  resourcesPlanStartHint: "Erster Tag des Planungszeitraums.",
  resourcesPlanEndHint: "Letzter Tag des Planungszeitraums.",
  resourcesManageRolesHint: "Öffnet den Editor für Rollen & Sätze, um Disziplinen, Grade und Sätze zu verwalten.",
  resourcesOpenReportHint: "Öffnet den Ressourcenbericht in einem eigenen Fenster.",
  resourcesRollupHint: "Blendet die schreibgeschützte Kapazitäts- und Kostenübersicht ein oder aus.",
  resourcesAddAbsenceHint: "Erfasst Urlaub, Krankheit, Schulung oder eine andere Abwesenheit für eine Person.",
  activitySearchHint: "Durchsucht das Protokoll nach Text, Platzhaltern (* ?) oder regulärem Ausdruck – je nach Modus.",
  activitySearchModeHint: "Legt fest, wie der Suchtext interpretiert wird: wörtlich, Platzhalter oder Regex.",
  activityGroupFilterHint: "Zeigt nur Protokolleinträge der gewählten Art.",
  activityClearHint: "Löscht alle Einträge des Aktivitätsprotokolls. Dies kann nicht rückgängig gemacht werden.",
  tasksSearchHint: "Filtert die Tabelle auf Aufgaben, deren Name, Zuständige(r), Blocker oder Notizen zum Text passen.",
  tasksGroupFilterHint: "Zeigt nur Aufgaben der gewählten Gruppe.",
  tasksLabelFilterHint: "Zeigt nur Aufgaben mit der gewählten Beschriftung.",
```

- [ ] **Step 3: Typecheck (parity gate)**

Run: `npx tsc --noEmit`
Expected: PASS. A missing/misspelled key in either file fails here.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add descriptive search/filter/field tooltip strings (EN + DE)"
```

---

## Task 2: Add an optional `title` prop to `SegmentedControl`

**Files:**
- Modify: `src/app/segmented-control.tsx`
- Test: `src/app/segmented-control.test.tsx`

Context: Several toggle controls (RAID category/status/severity, resources view/granularity, activity search-mode/group filter) are `SegmentedControl`s. To give them tooltips, the component must forward a `title` onto its root `<div role="radiogroup">`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/segmented-control.test.tsx` (add `import { render, screen } from "@testing-library/react";` if not present):

```tsx
  it("applies the title attribute to the radiogroup root", () => {
    render(
      <SegmentedControl
        value="a"
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
        onChange={() => {}}
        ariaLabel="Demo"
        title="Helpful hint"
      />,
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute("title", "Helpful hint");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/segmented-control.test.tsx`
Expected: FAIL — `title` is not a prop / not on the root.

- [ ] **Step 3: Add the prop**

In `src/app/segmented-control.tsx`, add to `SegmentedControlProps`:

```ts
  /** Tooltip text for the whole control (rendered as the radiogroup's title). */
  title?: string;
```

Destructure `title,` in the function signature (next to `ariaLabel`) and add it to the root `<div>`:

```tsx
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      title={title}
      aria-disabled={disabled || undefined}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/segmented-control.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/segmented-control.tsx src/app/segmented-control.test.tsx
git commit -m "feat(ui): SegmentedControl forwards an optional title tooltip"
```

---

## Task 3: Remove the leaking section title; add an inert corner glyph

**Files:**
- Modify: `src/app/workspace-section.tsx:122-137` (and add a glyph child near the closing `</section>`)

Context (root-cause fix): the `<section>` wrapping the whole pane carries `title={t(lang,"workspaceResizeHint")}`, which HTML shows on every title-less descendant. Removing it stops the leak across gantt/RAID/resources/activity (and the RAID modal). Replace with an inert `⠿` glyph (matching `tasks-section.tsx:524-525`) so the resize affordance stays discoverable. This is an attribute-level UI change with no unit harness for the full section; verified by typecheck + the full suite + manual smoke (the controls' own tooltips are tested in later tasks).

- [ ] **Step 1: Remove the `title` from the `<section>`**

In `src/app/workspace-section.tsx`, delete the `title={...}` attribute block (currently lines ~125-129):

```tsx
      title={
        isPopout || workspaceCollapsed
          ? undefined
          : t(lang, "workspaceResizeHint")
      }
```

Add `relative` to the non-collapsed/non-popout className branch so the glyph anchors to the section. That branch currently begins `"mb-10 flex h-[560px] min-h-[420px] w-full min-w-[520px] resize flex-col overflow-hidden rounded-xl …"` — change it to start with `"relative mb-10 flex h-[560px] …"`.

- [ ] **Step 2: Add the inert corner glyph**

As the last child inside the `<section>` (immediately before `</section>`, after the `<div id="workspace-panels">…</div>` block), add:

```tsx
      {!isPopout && !workspaceCollapsed && (
        <span
          aria-hidden={true}
          title={t(lang, "workspaceResizeHint")}
          className="pointer-events-none absolute bottom-1 right-1 select-none text-zinc-300 dark:text-zinc-600"
        >
          ⠿
        </span>
      )}
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit` → expected PASS.
Run: `npx vitest run` → expected: all pass, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/app/workspace-section.tsx
git commit -m "fix(workspace): scope resize hint to a corner glyph so it stops leaking onto controls"
```

---

## Task 4: Align the tasks `SortableTh` to the resources directory header

**Files:**
- Modify: `src/app/task-manager-ui.tsx` (`SortableTh`, lines ~177-210)
- Modify: `src/app/tasks-section.tsx` (the `<SortableTh … />` call sites, lines ~464-470)
- Test: `src/app/task-manager-ui.test.tsx` (new)

Context (Part 3): the resources "Assignee" header is `<button class="hover:text-zinc-800 dark:hover:text-zinc-200" title={t(lang,"sortBy", "Assignee")}>`. Align `SortableTh`: match the hover shade and add the `sortBy` tooltip. `SortableTh` needs `lang` to call `t`.

- [ ] **Step 1: Write the failing test (new file)**

Create `src/app/task-manager-ui.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SortableTh } from "./task-manager-ui";

describe("SortableTh", () => {
  it("shows a 'Sort by <label>' tooltip and the resources-matching hover class", () => {
    render(
      <table><thead><tr>
        <SortableTh label="Task" sortKey="taskName" currentKey="taskName" dir="asc" onClick={vi.fn()} lang="en-US" />
      </tr></thead></table>,
    );
    const btn = screen.getByRole("button", { name: /task/i });
    expect(btn).toHaveAttribute("title", "Sort by Task");
    expect(btn.className).toContain("hover:text-zinc-800");
  });
});
```

(If the `SortKey` union rejects `"taskName"`, use whatever key the exported `SortKey` type accepts — read the type in `task-manager-ui.tsx`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-manager-ui.test.tsx`
Expected: FAIL — `lang` not a prop; no `title`; hover class is `zinc-900`.

- [ ] **Step 3: Update `SortableTh`**

In `src/app/task-manager-ui.tsx`: ensure `t` and `Lang` are imported from `./i18n`. Add `lang: Lang;` to the props type, destructure `lang`, and update the `<button>`:

```tsx
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        title={t(lang, "sortBy", label)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-zinc-800 dark:hover:text-zinc-200 ${isActive ? "text-zinc-900 dark:text-zinc-100" : ""}`}
      >
```

(Only the hover classes change — `zinc-900`→`zinc-800`, `zinc-100`→`zinc-200`; active-state classes unchanged; `title` added.)

- [ ] **Step 4: Pass `lang` at every call site**

In `src/app/tasks-section.tsx`, add `lang={lang}` to each of the seven `<SortableTh … />` usages (lines ~464-470; `lang` is already in scope). Example:

```tsx
<SortableTh label={t(lang, "task")} sortKey="taskName" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskName", e)} lang={lang} />
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/app/task-manager-ui.test.tsx` → PASS.
Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager-ui.tsx src/app/tasks-section.tsx src/app/task-manager-ui.test.tsx
git commit -m "feat(tasks): match column-header hover and sort tooltip to the resources directory"
```

---

## Task 5: Gantt control tooltips

**Files:**
- Modify: `src/app/gantt.tsx` (filter/search/sort toolbar, lines ~1018-1091)

Context: gantt has no unit-test harness (heavy dynamic component), so this task is verified by `tsc` + the full suite + manual smoke. Each control gains a `title={t(lang, <key>)}` (alongside its existing `aria-label`). `lang`/`t` are already used in this file.

- [ ] **Step 1: Add titles to the six controls**

| Element (≈line) | Add |
|---|---|
| search input 1018 | `title={t(lang, "ganttSearchHint")}` |
| status `<select>` 1026 | `title={t(lang, "ganttStatusFilterHint")}` |
| priority `<select>` 1039 | `title={t(lang, "priorityFilterHint")}` |
| assignee `<select>` 1054 | `title={t(lang, "assigneeFilterHint")}` |
| sort `<select>` 1069 | `title={t(lang, "ganttSortHint")}` |
| reset-filters `<button>` 1085 | `title={t(lang, "resetFiltersHint")}` |

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit` → PASS.
Run: `npx vitest run` → PASS (no regressions).

- [ ] **Step 3: Commit**

```bash
git add src/app/gantt.tsx
git commit -m "feat(gantt): descriptive tooltips on search, filters, and sort"
```

---

## Task 6: RAID list + modal tooltips

**Files:**
- Modify: `src/app/raid-panel.tsx` (list toolbar ~314-375; edit modal ~785-1261)
- Test: `src/app/raid-panel.test.tsx`

Context: `raid-panel.test.tsx` exists — add representative `title` assertions. The category/status/severity toggles are `SegmentedControl`s (use the `title` prop from Task 2). `lang`/`t` are in scope.

- [ ] **Step 1: Write a failing representative test**

Add to `src/app/raid-panel.test.tsx`, reusing the file's existing `RaidPanel` render harness:

```tsx
  it("gives the RAID search box a descriptive tooltip", () => {
    // render RaidPanel via the existing harness in this file
    expect(screen.getByPlaceholderText(/search title, owner/i)).toHaveAttribute(
      "title",
      "Filter the register to items whose title, owner, or description match your text.",
    );
  });
```

If the existing tests already open the edit modal, also assert one modal field (e.g. the title input's `title` equals the `raidFieldTitleHint` English string). If opening the modal needs interaction the harness doesn't already do, keep just the list-search assertion and rely on tsc + manual for the modal fields.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/raid-panel.test.tsx`
Expected: FAIL — no `title` yet.

- [ ] **Step 3: Add titles — list toolbar**

| Element (≈line) | Add |
|---|---|
| search input 314 | `title={t(lang, "raidSearchHint")}` |
| category `<select>` 322 | `title={t(lang, "raidCategoryFilterHint")}` |
| severity `<select>` 337 | `title={t(lang, "raidSeverityFilterHint")}` |
| status `<select>` 352 | `title={t(lang, "raidStatusFilterHint")}` |
| reset-filters `<button>` 375 | `title={t(lang, "resetFiltersHint")}` |

- [ ] **Step 4: Add titles — edit modal**

For `SegmentedControl` fields pass the `title` prop; for inputs/textareas/date inputs/buttons add `title={t(lang, …)}`:

| Field (≈line) | Add |
|---|---|
| category SegmentedControl 785 | `title={t(lang, "raidFieldCategoryHint")}` |
| status SegmentedControl 849 | `title={t(lang, "raidFieldStatusHint")}` |
| title input 864 | `title={t(lang, "raidFieldTitleHint")}` |
| description textarea 878 | `title={t(lang, "raidFieldDescriptionHint")}` |
| severity SegmentedControl 913 | `title={t(lang, "raidFieldSeverityHint")}` |
| risk-matrix wrapper 1261 | `title={t(lang, "raidFieldRiskMatrixHint")}` (on the matrix container element) |
| owner input 929 | `title={t(lang, "raidFieldOwnerHint")}` |
| owner email input 943 | `title={t(lang, "raidFieldOwnerEmailHint")}` |
| raised date input 957 | `title={t(lang, "raidFieldRaisedDateHint")}` |
| target date input 969 | `title={t(lang, "raidFieldTargetDateHint")}` |
| mitigation textarea 983 | `title={t(lang, "raidFieldMitigationHint")}` |
| linked-task picker input 1038 | `title={t(lang, "raidFieldLinkedTasksHint")}` |
| caused-by picker input 1106 | `title={t(lang, "raidFieldCausedByHint")}` |
| delete `<button>` 1168 | `title={t(lang, "raidFieldDeleteHint")}` |

Do NOT add titles to Cancel/Save (self-evident). The "create mitigation task" button already has `raidCreateMitigationTaskHint` — leave it.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/app/raid-panel.test.tsx` → PASS.
Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/raid-panel.tsx src/app/raid-panel.test.tsx
git commit -m "feat(raid): descriptive tooltips on list filters and edit-modal fields"
```

---

## Task 7: Resources tooltips

**Files:**
- Modify: `src/app/resource-directory.tsx` (search ~178)
- Modify: `src/app/resources-panel.tsx` (controls ~209-360)
- Test: `src/app/resource-directory.test.tsx`, `src/app/resources-panel.test.tsx`

Context: both panels have test harnesses. View/granularity toggles are `SegmentedControl`s (use the `title` prop). `lang`/`t` are in scope.

- [ ] **Step 1: Write failing representative tests**

In `src/app/resource-directory.test.tsx` (reuse the file's existing render harness):

```tsx
  it("gives the directory search box a descriptive tooltip", () => {
    // render ResourceDirectory via the existing harness
    expect(screen.getByPlaceholderText(/filter by name, title/i)).toHaveAttribute(
      "title",
      "Filter the directory to people whose name, title, department, or email match your text.",
    );
  });
```

In `src/app/resources-panel.test.tsx` (reuse harness), assert the Manage roles button:

```tsx
  it("gives the Manage roles button a descriptive tooltip", () => {
    // render ResourcesPanel via the existing harness
    expect(screen.getByRole("button", { name: /manage roles/i })).toHaveAttribute(
      "title",
      "Open the roles & rates editor to manage disciplines, grades, and rate cards.",
    );
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/resource-directory.test.tsx src/app/resources-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add titles**

`resource-directory.tsx`:

| Element (≈line) | Add |
|---|---|
| search input 178 | `title={t(lang, "directorySearchHint")}` |

`resources-panel.tsx`:

| Element (≈line) | Add |
|---|---|
| view SegmentedControl 209 | `title={t(lang, "resourcesViewHint")}` |
| manage-roles `<button>` 221 | `title={t(lang, "resourcesManageRolesHint")}` |
| open-report `<button>` 228 | `title={t(lang, "resourcesOpenReportHint")}` |
| add-absence `<button>` 235 | `title={t(lang, "resourcesAddAbsenceHint")}` |
| plan start date 264 | `title={t(lang, "resourcesPlanStartHint")}` |
| plan end date 270 | `title={t(lang, "resourcesPlanEndHint")}` |
| granularity SegmentedControl 274 | `title={t(lang, "resourcesGranularityHint")}` |
| rollup show/hide `<button>` 360 | `title={t(lang, "resourcesRollupHint")}` |

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/app/resource-directory.test.tsx src/app/resources-panel.test.tsx` → PASS.
Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/resource-directory.tsx src/app/resources-panel.tsx src/app/resource-directory.test.tsx src/app/resources-panel.test.tsx
git commit -m "feat(resources): descriptive tooltips on directory search and planning controls"
```

---

## Task 8: Activity tooltips + sort headers

**Files:**
- Modify: `src/app/activity-log-panel.tsx` (controls ~160-256)

Context: no unit-test harness for this panel — verified by `tsc` + the full suite + manual smoke. Search-mode and group-filter are `SegmentedControl`s (use the `title` prop). The three sort headers reuse the existing `sortBy` key with existing header label keys. `lang`/`t` are in scope.

- [ ] **Step 1: Add titles to the controls**

| Element (≈line) | Add |
|---|---|
| search input 172 | `title={t(lang, "activitySearchHint")}` |
| search-mode SegmentedControl 191 | `title={t(lang, "activitySearchModeHint")}` |
| group-filter SegmentedControl 201 | `title={t(lang, "activityGroupFilterHint")}` |
| clear-log `<button>` 160 | `title={t(lang, "activityClearHint")}` |
| sort header "When" `<button>` 231 | `title={t(lang, "sortBy", t(lang, "activityHeaderWhen"))}` |
| sort header "Kind" `<button>` 240 | `title={t(lang, "sortBy", t(lang, "activityHeaderKind"))}` |
| sort header "Message" `<button>` 250 | `title={t(lang, "sortBy", t(lang, "activityHeaderMessage"))}` |

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit` → PASS.
Run: `npx vitest run` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/activity-log-panel.tsx
git commit -m "feat(activity): descriptive tooltips on search, filters, and sort headers"
```

---

## Task 9: Tasks filter tooltips

**Files:**
- Modify: `src/app/tasks-section.tsx` (filter controls ~332-378)
- Test: `src/app/tasks-section.test.tsx`

Context: `tasks-section.test.tsx` exists — add a representative assertion. `lang`/`t` in scope.

- [ ] **Step 1: Write a failing representative test**

Add to `src/app/tasks-section.test.tsx`, reusing the existing render harness:

```tsx
  it("gives the tasks search box a descriptive tooltip", () => {
    // render TasksSection via the existing harness
    expect(screen.getByPlaceholderText(/search task name/i)).toHaveAttribute(
      "title",
      "Filter the table to tasks whose name, assignee, blockers, or notes match your text.",
    );
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/tasks-section.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add titles to the five filters**

| Element (≈line) | Add |
|---|---|
| search input 332 | `title={t(lang, "tasksSearchHint")}` |
| priority `<select>` 339 | `title={t(lang, "priorityFilterHint")}` |
| assignee `<select>` 353 | `title={t(lang, "assigneeFilterHint")}` |
| group `<select>` 365 | `title={t(lang, "tasksGroupFilterHint")}` |
| label `<select>` 378 | `title={t(lang, "tasksLabelFilterHint")}` |

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/app/tasks-section.test.tsx` → PASS.
Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "feat(tasks): descriptive tooltips on search and filters"
```

---

## Final verification

- [ ] **Whole suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Manual smoke**

1. Open each workspace tab (Gantt, RAID, Resources, Activity): hover the search box and each filter/sort control — confirm each shows its OWN descriptive tooltip, NOT the resize hint.
2. Open the RAID edit modal: hover the fields — confirm field-specific tooltips; confirm no resize hint anywhere.
3. Tasks section: hover the search box and the priority/assignee/group/label filters — confirm tooltips now appear.
4. Hover the Tasks "Task" column header and the Resources directory "Assignee" header — confirm the hover effect (text darkening) and the "Sort by …" tooltip match.
5. Confirm the workspace pane still resizes from its bottom-right corner and shows the `⠿` glyph.

---

## Self-Review

**Spec coverage:**
- Part 1 (kill leak + glyph) → Task 3.
- Part 2 (descriptive tooltips): i18n keys → Task 1; SegmentedControl title prop → Task 2; gantt → Task 5; RAID list+modal → Task 6; resources → Task 7; activity + sort headers → Task 8; tasks → Task 9.
- Part 3 (column parity) → Task 4.
- Testing (i18n parity via tsc, representative per-panel assertions, SortableTh test, manual smoke) → Tasks 1-9 + Final verification.

**Placeholder scan:** i18n copy is literal in Task 1. Wiring tasks give exact key→control mappings with the `title={t(lang, …)}` pattern shown. Line numbers are approximate (noted); implementers locate by the existing `aria-label`/`placeholder`. Tests for harness-less panels (gantt, activity) are intentionally tsc + manual — stated explicitly, not a hidden gap.

**Type consistency:** key names in Task 1 match those referenced in Tasks 5-9 (`priorityFilterHint`, `assigneeFilterHint`, `resetFiltersHint` shared). `SegmentedControl` `title?` (Task 2) is used by Tasks 6/7/8. `SortableTh` `lang` prop (Task 4) is passed in Task 4 Step 4. `sortBy` is a pre-existing key reused in Tasks 4 and 8.
