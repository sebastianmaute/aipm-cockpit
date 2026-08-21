# Control Tooltips Rework — Design Spec

**Date:** 2026-05-26
**Status:** Approved (design); pending spec review
**Topic:** Stop the workspace resize-hint tooltip leaking onto unrelated controls, and give search/filter/sort controls (and RAID modal fields) proper, descriptive tooltips. Align the tasks column-header hover to the resources directory.

---

## Problem

In the workspace pane (Gantt, RAID, Resources, Activity) every search/filter control — and every field of the RAID edit modal — shows the tooltip **"Drag the bottom-right corner to resize this workspace pane."** In the Tasks section, the search and filter controls show **no** tooltip at all. Separately, the Tasks table column header hover effect differs from the Resources directory's "Assignee" header.

## Root Cause

`src/app/workspace-section.tsx:123-137` renders the whole workspace pane inside one `<section>` that carries `title={t(lang, "workspaceResizeHint")}` (and the CSS `resize` class). Per HTML semantics, the browser shows the nearest ancestor's `title` for any descendant lacking its own — so every title-less control inside the pane (gantt/RAID/resources/activity filters, RAID modal fields) displays the resize hint. The **Tasks** section is a sibling rendered *outside* this `<section>`, so it inherits nothing; its controls also have no `title`, hence no tooltip there.

Note: the existing tasks-table corner grip (`src/app/tasks-section.tsx:524-525`) is a `pointer-events-none` `⠿` glyph — its `title` never fires. The app's working convention is therefore "native CSS resize corner + a decorative glyph, **no** resize tooltip."

## Goals

1. The resize hint must never appear on a control or form field.
2. Every search/filter/sort control (and RAID modal field) shows a descriptive tooltip relevant to that control.
3. The Tasks column-header hover matches the Resources directory header (hover shade + a "Sort by …" tooltip).

## Non-Goals

- Tooltips on self-evident modal buttons (Cancel, Save) — excluded. (Delete gets a cautionary hint.)
- Changing any control's behavior, layout, or the resize mechanism itself.
- Reworking controls already carrying a correct descriptive `title` (e.g. resources directory sort headers, gantt critical-path/add-task, tasks toolbar buttons).
- The resources per-cell utilization inputs (already labelled; out of the approved set).

---

## Design

### Part 1 — Kill the leak

**File:** `src/app/workspace-section.tsx`

- Remove `title={…}` from the `<section>` (lines 125-129). The `title` prop is dropped entirely; the `isPopout || workspaceCollapsed` conditional that produced it goes away.
- Add a decorative corner glyph as the last child of the `<section>`, mirroring `tasks-section.tsx:524-525`, shown only when resizable (not popout, not collapsed):

  ```tsx
  {!isPopout && !workspaceCollapsed && (
    <span aria-hidden={true} title={t(lang, "workspaceResizeHint")}
      className="pointer-events-none absolute bottom-1 right-1 select-none text-zinc-300 dark:text-zinc-600">⠿</span>
  )}
  ```

  The glyph is `pointer-events-none` (its `title` is inert, exactly like the tasks grip — it never produces a tooltip and never blocks the native resize). `workspaceResizeHint` thus remains referenced (no orphaned key). The `<section>` must establish a positioning context for the `absolute` glyph — add `relative` to its className if not already implied.

Result: no descendant inherits a `title` from the section, so the leak is gone across gantt, RAID, the RAID modal, resources, and activity.

### Part 2 — Descriptive tooltips

Add new `*Hint` i18n keys (EN in `i18n.ts`, DE in `i18n.de.ts`) and wire each as a `title=` on its control. Shared keys are used where the meaning is identical across tabs (DRY).

#### New i18n keys (EN / DE)

**Shared**

| Key | EN | DE |
|---|---|---|
| `priorityFilterHint` | Show only tasks of the selected priority. | Zeigt nur Aufgaben mit der gewählten Priorität. |
| `assigneeFilterHint` | Show only tasks assigned to the selected person. | Zeigt nur Aufgaben, die der gewählten Person zugewiesen sind. |
| `resetFiltersHint` | Clear the search box and all filters to show every item again. | Setzt Suchfeld und alle Filter zurück, um wieder alle Einträge anzuzeigen. |

**Gantt**

| Key | EN | DE |
|---|---|---|
| `ganttSearchHint` | Filter the timeline to tasks whose name, assignee, blockers, or notes match your text. | Filtert die Zeitachse auf Aufgaben, deren Name, Zuständige(r), Blocker oder Notizen zum Text passen. |
| `ganttStatusFilterHint` | Show only tasks in the selected status. | Zeigt nur Aufgaben mit dem gewählten Status. |
| `ganttSortHint` | Choose the order in which task bars are arranged on the timeline. | Legt die Reihenfolge fest, in der die Aufgabenbalken auf der Zeitachse angeordnet werden. |

(Gantt priority/assignee filters use the shared `priorityFilterHint`/`assigneeFilterHint`; reset uses `resetFiltersHint`.)

**RAID list**

| Key | EN | DE |
|---|---|---|
| `raidSearchHint` | Filter the register to items whose title, owner, or description match your text. | Filtert das Register auf Einträge, deren Titel, Verantwortliche(r) oder Beschreibung zum Text passen. |
| `raidCategoryFilterHint` | Show only items of the selected category — Risk, Assumption, Issue, or Dependency. | Zeigt nur Einträge der gewählten Kategorie – Risiko, Annahme, Problem oder Abhängigkeit. |
| `raidSeverityFilterHint` | Show only items of the selected severity. | Zeigt nur Einträge mit dem gewählten Schweregrad. |
| `raidStatusFilterHint` | Show only items in the selected status. | Zeigt nur Einträge mit dem gewählten Status. |

(RAID list reset uses the shared `resetFiltersHint`.)

**RAID modal fields**

| Key | EN | DE |
|---|---|---|
| `raidFieldCategoryHint` | The kind of entry — Risk, Assumption, Issue, or Dependency. Changing it may reset status and severity. | Die Art des Eintrags – Risiko, Annahme, Problem oder Abhängigkeit. Eine Änderung kann Status und Schweregrad zurücksetzen. |
| `raidFieldStatusHint` | Current lifecycle state of this item; the available options depend on the category. | Aktueller Status dieses Eintrags; die verfügbaren Optionen hängen von der Kategorie ab. |
| `raidFieldTitleHint` | A short, specific summary of the risk, assumption, issue, or dependency. | Eine kurze, konkrete Zusammenfassung des Risikos, der Annahme, des Problems oder der Abhängigkeit. |
| `raidFieldDescriptionHint` | Optional background and context for the steering committee. | Optionaler Hintergrund und Kontext für das Lenkungsgremium. |
| `raidFieldSeverityHint` | How serious this item is. For risks it is derived automatically from probability × impact. | Wie schwerwiegend dieser Eintrag ist. Bei Risiken wird er automatisch aus Wahrscheinlichkeit × Auswirkung abgeleitet. |
| `raidFieldRiskMatrixHint` | Pick probability × impact; the cell you choose sets the risk's severity. | Wahrscheinlichkeit × Auswirkung wählen; die gewählte Zelle bestimmt den Schweregrad des Risikos. |
| `raidFieldOwnerHint` | The person accountable for managing this item. | Die für die Bearbeitung dieses Eintrags verantwortliche Person. |
| `raidFieldOwnerEmailHint` | Email of the owner, used for status inquiries. | E-Mail der verantwortlichen Person, für Statusanfragen verwendet. |
| `raidFieldRaisedDateHint` | The date this item was first raised. | Das Datum, an dem dieser Eintrag erstmals erfasst wurde. |
| `raidFieldTargetDateHint` | Optional date by which this item should be resolved or mitigated. | Optionales Datum, bis zu dem dieser Eintrag gelöst oder gemildert sein soll. |
| `raidFieldMitigationHint` | How this item will be mitigated, resolved, validated, or delivered. | Wie dieser Eintrag gemildert, gelöst, validiert oder geliefert wird. |
| `raidFieldLinkedTasksHint` | Search by id or name to link tasks affected by or addressing this item. | Nach ID oder Name suchen, um Aufgaben zu verknüpfen, die von diesem Eintrag betroffen sind oder ihn behandeln. |
| `raidFieldCausedByHint` | Search by id or title to record which other RAID items caused this one. | Nach ID oder Titel suchen, um zu erfassen, welche anderen RAID-Einträge diesen verursacht haben. |
| `raidFieldDeleteHint` | Permanently delete this RAID item. This cannot be undone. | Diesen RAID-Eintrag dauerhaft löschen. Dies kann nicht rückgängig gemacht werden. |

**Resources**

| Key | EN | DE |
|---|---|---|
| `directorySearchHint` | Filter the directory to people whose name, title, department, or email match your text. | Filtert das Verzeichnis auf Personen, deren Name, Titel, Abteilung oder E-Mail zum Text passen. |
| `resourcesViewHint` | Switch between Directory, Workload, Calendar, and Planning views. | Wechselt zwischen den Ansichten Verzeichnis, Auslastung, Kalender und Planung. |
| `resourcesGranularityHint` | Group the planning grid by week or by month. | Gruppiert das Planungsraster nach Woche oder Monat. |
| `resourcesPlanStartHint` | First day of the planning window. | Erster Tag des Planungszeitraums. |
| `resourcesPlanEndHint` | Last day of the planning window. | Letzter Tag des Planungszeitraums. |
| `resourcesManageRolesHint` | Open the roles & rates editor to manage disciplines, grades, and rate cards. | Öffnet den Editor für Rollen & Sätze, um Disziplinen, Grade und Sätze zu verwalten. |
| `resourcesOpenReportHint` | Open the resource report in its own window. | Öffnet den Ressourcenbericht in einem eigenen Fenster. |
| `resourcesRollupHint` | Show or hide the read-only capacity and cost rollup. | Blendet die schreibgeschützte Kapazitäts- und Kostenübersicht ein oder aus. |
| `resourcesAddAbsenceHint` | Record a vacation, sick day, training, or other absence for a person. | Erfasst Urlaub, Krankheit, Schulung oder eine andere Abwesenheit für eine Person. |

**Activity**

| Key | EN | DE |
|---|---|---|
| `activitySearchHint` | Search the log by text, wildcard (* ?), or regular expression, depending on the mode. | Durchsucht das Protokoll nach Text, Platzhaltern (* ?) oder regulärem Ausdruck – je nach Modus. |
| `activitySearchModeHint` | Choose how the search text is interpreted: literal text, wildcards, or regex. | Legt fest, wie der Suchtext interpretiert wird: wörtlich, Platzhalter oder Regex. |
| `activityGroupFilterHint` | Show only log entries of the selected kind. | Zeigt nur Protokolleinträge der gewählten Art. |
| `activityClearHint` | Delete all activity log entries. This cannot be undone. | Löscht alle Einträge des Aktivitätsprotokolls. Dies kann nicht rückgängig gemacht werden. |

**Tasks**

| Key | EN | DE |
|---|---|---|
| `tasksSearchHint` | Filter the table to tasks whose name, assignee, blockers, or notes match your text. | Filtert die Tabelle auf Aufgaben, deren Name, Zuständige(r), Blocker oder Notizen zum Text passen. |
| `tasksGroupFilterHint` | Show only tasks in the selected group. | Zeigt nur Aufgaben der gewählten Gruppe. |
| `tasksLabelFilterHint` | Show only tasks carrying the selected label. | Zeigt nur Aufgaben mit der gewählten Beschriftung. |

(Tasks priority/assignee filters use the shared `priorityFilterHint`/`assigneeFilterHint`.)

#### Wiring (add `title={t(lang, <key>)}` to each control)

| File | Control (line ≈) | Key |
|---|---|---|
| gantt.tsx | search 1018 | `ganttSearchHint` |
| gantt.tsx | status 1026 | `ganttStatusFilterHint` |
| gantt.tsx | priority 1039 | `priorityFilterHint` |
| gantt.tsx | assignee 1054 | `assigneeFilterHint` |
| gantt.tsx | sort 1069 | `ganttSortHint` |
| gantt.tsx | reset-filters 1085 | `resetFiltersHint` |
| raid-panel.tsx | search 314 | `raidSearchHint` |
| raid-panel.tsx | category 322 | `raidCategoryFilterHint` |
| raid-panel.tsx | severity 337 | `raidSeverityFilterHint` |
| raid-panel.tsx | status 352 | `raidStatusFilterHint` |
| raid-panel.tsx | reset-filters 375 | `resetFiltersHint` |
| raid-panel.tsx | modal category 785 | `raidFieldCategoryHint` |
| raid-panel.tsx | modal status 849 | `raidFieldStatusHint` |
| raid-panel.tsx | modal title 864 | `raidFieldTitleHint` |
| raid-panel.tsx | modal description 878 | `raidFieldDescriptionHint` |
| raid-panel.tsx | modal severity 913 | `raidFieldSeverityHint` |
| raid-panel.tsx | modal risk-matrix 1261 | `raidFieldRiskMatrixHint` |
| raid-panel.tsx | modal owner 929 | `raidFieldOwnerHint` |
| raid-panel.tsx | modal owner email 943 | `raidFieldOwnerEmailHint` |
| raid-panel.tsx | modal raised date 957 | `raidFieldRaisedDateHint` |
| raid-panel.tsx | modal target date 969 | `raidFieldTargetDateHint` |
| raid-panel.tsx | modal mitigation 983 | `raidFieldMitigationHint` |
| raid-panel.tsx | modal linked-task picker 1038 | `raidFieldLinkedTasksHint` |
| raid-panel.tsx | modal caused-by picker 1106 | `raidFieldCausedByHint` |
| raid-panel.tsx | modal delete 1168 | `raidFieldDeleteHint` |
| resource-directory.tsx | search 178 | `directorySearchHint` |
| resources-panel.tsx | view toggle 209 | `resourcesViewHint` |
| resources-panel.tsx | granularity 274 | `resourcesGranularityHint` |
| resources-panel.tsx | plan start 264 | `resourcesPlanStartHint` |
| resources-panel.tsx | plan end 270 | `resourcesPlanEndHint` |
| resources-panel.tsx | manage roles 221 | `resourcesManageRolesHint` |
| resources-panel.tsx | open report 228 | `resourcesOpenReportHint` |
| resources-panel.tsx | rollup 360 | `resourcesRollupHint` |
| resources-panel.tsx | add absence 235 | `resourcesAddAbsenceHint` |
| activity-log-panel.tsx | search 172 | `activitySearchHint` |
| activity-log-panel.tsx | search-mode 191 | `activitySearchModeHint` |
| activity-log-panel.tsx | group filter 201 | `activityGroupFilterHint` |
| activity-log-panel.tsx | clear-log 160 | `activityClearHint` |
| tasks-section.tsx | search 332 | `tasksSearchHint` |
| tasks-section.tsx | priority 339 | `priorityFilterHint` |
| tasks-section.tsx | assignee 353 | `assigneeFilterHint` |
| tasks-section.tsx | group 365 | `tasksGroupFilterHint` |
| tasks-section.tsx | label 378 | `tasksLabelFilterHint` |

Notes:
- For SegmentedControl-based toggles (raid category/status/severity, resources view/granularity, activity search-mode/group filter), the `title` goes on the SegmentedControl's outer container so it covers the whole control. If `SegmentedControl` does not forward a `title`, add an optional `title?: string` prop to it that lands on its root element.
- Line numbers are approximate (from inventory); the implementer locates the element by its existing `aria-label`/`placeholder` key.

#### Sort-header tooltips (reuse existing `sortBy`)

- **Activity** sort headers (`activity-log-panel.tsx` ~231/240/250): add `title={t(lang, "sortBy", t(lang, <headerLabelKey>))}` using the existing header label keys (`activityHeaderWhen`/`activityHeaderKind`/`activityHeaderMessage`). No new keys.

### Part 3 — Column-hover parity (Tasks ↔ Resources directory)

**Files:** `src/app/task-manager-ui.tsx` (`SortableTh`) + `src/app/tasks-section.tsx` (call sites).

The Resources directory "Assignee" header (`resource-directory.tsx:206`) is a `<button class="hover:text-zinc-800 dark:hover:text-zinc-200" title={t(lang,"sortBy", t(lang,"assignee"))}>`. Align the Tasks `SortableTh`:

1. Change the header `<button>` hover classes from `hover:text-zinc-900 dark:hover:text-zinc-100` to `hover:text-zinc-800 dark:hover:text-zinc-200` (active-state class unchanged).
2. Add a `lang: Lang` prop to `SortableTh` and set `title={t(lang, "sortBy", label)}` on the `<button>` (`label` is the already-translated column label, e.g. "Task" → "Sort by Task"). `sortBy` already exists ("Sort by {0}").
3. Update every `<SortableTh … />` call site in `tasks-section.tsx` (lines ~464-470) to pass `lang={lang}`.

This makes all Tasks column headers visually and behaviourally match the Resources directory headers (the "Task" column included).

---

## Testing

Tooltips are `title` attributes — assert with React Testing Library.

1. **Leak fix** (`workspace-section.test.tsx` if a harness exists; else a focused new test): render `WorkspaceSection` (non-popout, not collapsed) and assert the `<section>` has **no** `title` attribute and the `⠿` glyph span is present. If rendering the full section is impractical due to providers, rely on the controls' own tooltips below + manual smoke.
2. **Control tooltips** — for at least one control per area (gantt, raid list, raid modal, resources, activity, tasks), assert the rendered element has the expected `title` via `getByTitle` or `toHaveAttribute("title", t("en-US", <key>))`. Panels with an existing test file get representative assertions; panels without a harness are covered by i18n-key presence (typecheck) + manual smoke.
3. **i18n parity** — `npx tsc --noEmit` proves every new key exists in both `enUS` and the `de` dictionary (`de` is typed `Record<TranslationKey, string>`).
4. **Column parity** (`SortableTh`) — a focused test: render `SortableTh` with `label="Task" lang="en-US"` and assert the button has `title="Sort by Task"` and the `hover:text-zinc-800` class.

Manual smoke: hover the gantt/RAID/resources/activity search & filter controls and confirm each shows its own descriptive tooltip (not the resize hint); hover the RAID modal fields; confirm Tasks search/filters now show tooltips; confirm the Tasks "Task" header hover matches the Resources "Assignee" header.

## Files Touched

- `src/app/i18n.ts` — ~40 new EN keys (incl. shared).
- `src/app/i18n.de.ts` — matching DE keys.
- `src/app/workspace-section.tsx` — remove section `title`; add `⠿` glyph.
- `src/app/gantt.tsx` — 6 control titles.
- `src/app/raid-panel.tsx` — 5 list + ~13 modal field titles.
- `src/app/resource-directory.tsx` — directory search title.
- `src/app/resources-panel.tsx` — ~8 control titles.
- `src/app/activity-log-panel.tsx` — 4 control titles + 3 sort-header titles.
- `src/app/tasks-section.tsx` — 5 filter titles + pass `lang` to `SortableTh`.
- `src/app/task-manager-ui.tsx` — `SortableTh` gains `lang` prop, hover-class change, `sortBy` title.
- Possibly the `SegmentedControl` component file — optional `title?` passthrough.
- Tests: per-panel representative assertions + `SortableTh` test.
