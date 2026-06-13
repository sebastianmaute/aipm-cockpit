# UI Polish Batch — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete)
**Branch:** `feat-emergency-recovery` (additive — same branch as the recovery feature)

## Goal

A batch of UI refinements across the resource/stakeholder/RAID/change/budget/task
surfaces: consistent sizing, currency symbols, field tooltips, modal-heading
fixes, RAID-style clickable rows, a color-coded RACI chip picker, and removal of
the modern top-bar New-task button.

## Scope decisions (locked during brainstorming)

1. **RACI chip picker:** four brand-color chips R/A/C/I (R=dark-blue, A=green,
   C=purple, I=medium-grey), click-to-toggle (click the active chip to clear),
   legend restyled to match.
2. **Planning row-click:** opens the **Resource edit modal** (like
   Directory/Workload); inline number inputs `stopPropagation`.
3. **New-task button removal:** modern `TopBar` only; classic header `+` stays.
4. **Tooltips:** authored EN/DE here (real umlauts), attached via the existing
   `InfoTooltip` hover/click-persist pattern.

## Constraints

- AIPM palette only (9 brand colors; green dominant, dark-blue headers; no
  gradients/shadows). Tokens used: `AIPM-dark-blue`, `AIPM-green`, `AIPM-purple`,
  `AIPM-medium-grey`, `AIPM-pink`, `surface`, `surface-muted`, `line`, `white`.
- `i18n.de.ts` must use real umlauts (the `i18n-encoding` test bans ASCII subs);
  EN/DE key sets must stay identical.
- `InfoTooltip` (`info-tooltip.tsx`) is dropped INSIDE a field's `<label>` after
  the label text — there is no `Field` wrapper component.

---

## Section A — Sizing & stepper consistency

### A1. Calendar pane = Workload pane size
`resource-calendar.tsx` and `resource-workload.tsx` both render inside
`resources-panel.tsx`. The calendar's content area must fill its pane the same
way Workload's does. Implementation: ensure the Calendar view uses the same
outer pane shell and inner-fill classes as Workload (`VIEW_PANE_RESIZABLE_CLASS`
shell + an `INNER_TABLE_CLASS`/`h-full min-h-0 flex-1` fill). The exact wrapper
is pinned in the plan after reading the `resources-panel.tsx` render site for
both sub-views. Outcome: switching between Calendar and Workload keeps the pane
the same width and height.

### A2. Planning absence stepper = utilization stepper
In `resources-panel.tsx` the planned-utilization input is `w-16 … text-sm`; the
absence override input is `w-16 … text-[10px]`. Change the absence input to the
same box metrics and font (`px-1 py-0.5 text-right text-sm`), **keeping** its
`border-AIPM-purple/40` + `text-AIPM-purple` so it stays visually distinct. Result:
identical size, only color differs.

### A3. Manage Roles currency symbol
In `roles-editor.tsx`, render a muted `€` immediately before each rate `<input>`
(internal + external) — e.g. wrap the input in a flex span:
`<span class="inline-flex items-center gap-1"><span class="text-muted-foreground">€</span><input…/></span>`.
Rates are EUR. No data change.

---

## Section B — Row highlight + click-to-edit (RAID pattern)

Reference (RAID, `raid-panel.tsx:505`): `<tr onClick={() => openEdit(item)}
className="cursor-pointer align-top hover:bg-surface-muted …">`.

Apply to:
- **Stakeholders** (`stakeholders-panel.tsx`): `<tr>` gets `cursor-pointer` +
  `hover:bg-surface-muted` + `onClick={() => openEdit(item)}`. The existing
  name-cell `<button>` remains for a11y/keyboard but calls `stopPropagation` (so
  it doesn't double-fire) — or is simplified to a plain span; keep the button for
  keyboard focus, add `e.stopPropagation()`.
- **Directory** (`resource-directory.tsx`): same; `onClick={() =>
  onEditResource(r)}`; name-cell button `stopPropagation`.
- **Workload** (`resource-workload.tsx`): row `onClick={() =>
  onEditResource(row.resource)}`; the assignee-cell button AND the per-absence
  badge buttons (`onEditAbsence`) `stopPropagation` so they keep their own
  behavior.
- **Planning** (`resources-panel.tsx`): row `onClick` opens the **Resource edit
  modal** for that row's resource; the inline utilization/absence `<input>`s call
  `e.stopPropagation()` on click so editing a number never opens the modal.

A11y: rows are clickable but each row retains a focusable control (the name
button or inputs) for keyboard users; the row `onClick` is a mouse convenience
mirroring RAID. Match RAID exactly (RAID does not add `role="button"` to the
`<tr>`).

---

## Section C — Modal heading fixes + Edit Task close

- **Edit Change** (`change-edit-modal.tsx:205`): edit-state title is
  `changeReportTitle` ("Change report"). New key `changeEditTitle`; title becomes
  `isNew ? changeReportAdd : changeEditTitle`.
- **Edit Stakeholder** (`stakeholder-edit-modal.tsx:119`): edit-state title is
  `navStakeholders` ("Stakeholders"). New key `stakeholderEditTitle`; title
  becomes `isNew ? stakeholdersAdd : stakeholderEditTitle`.
- **Edit Task** (`task-form-modal.tsx:88`): edit-state title is `tabEditTask`
  ("Editing task #N"). New key `taskEditTitle` = "Edit task" / "Aufgabe
  bearbeiten"; use it for the edit state (keep `tabNewTask` for new). Ensure the
  `ModalHeader` close X is rendered (it is by default — confirm
  `task-form-modal.tsx` does not pass `hideClose`). If the modern full-page task
  edit view (`task-edit-view.tsx`, if present) lacks a close affordance, add a
  close X that cancels the edit. The plan verifies the modern path.

New i18n keys (EN / DE):
| key | EN | DE |
|---|---|---|
| `changeEditTitle` | Edit change | Änderung bearbeiten |
| `stakeholderEditTitle` | Edit stakeholder | Stakeholder bearbeiten |
| `taskEditTitle` | Edit task | Aufgabe bearbeiten |

---

## Section D — Tooltips (InfoTooltip)

Attach `InfoTooltip` inside each field `<label>`. For the **RAID modal**, the
copy already exists as `raidField*Hint` keys (currently HTML `title`) — rewire
those to `InfoTooltip` (no new copy, but drop the bare `title` attribute to avoid
the redundant native tooltip). For the others, author the keys below.

### Manage Roles (`roles-editor.tsx`)
| key | EN | DE |
|---|---|---|
| `rolesDisciplineHint` | The skill area this role belongs to (e.g. Engineering). | Der Fachbereich dieser Rolle (z. B. Engineering). |
| `rolesGradeHint` | Seniority level used to derive the blended rate. | Erfahrungsstufe für den Mischsatz. |
| `rolesInternalRateHint` | Hourly internal cost rate (EUR). | Interner Stundensatz (EUR). |
| `rolesExternalRateHint` | Hourly external/billing rate (EUR). | Externer Stundensatz (EUR). |

### Edit Resource (`resource-edit-modal.tsx`)
| key | EN | DE |
|---|---|---|
| `resourceFirstNameHint` | Given name of the person. | Vorname der Person. |
| `resourceLastNameHint` | Family name of the person. | Nachname der Person. |
| `resourceEmailHint` | Primary email; matches calendar and contacts. | Primäre E-Mail; gleicht Kalender und Kontakte ab. |
| `resourcePhoneHint` | Contact phone number (optional). | Telefonnummer (optional). |
| `resourceCompanyHint` | Employing company or vendor. | Arbeitgeber oder Dienstleister. |
| `resourceDepartmentHint` | Department or team. | Abteilung oder Team. |
| `resourceJobTitleHint` | Job title or role label. | Position oder Rollenbezeichnung. |
| `resourceLocationHint` | Work location; drives the holiday calendar. | Arbeitsort; bestimmt den Feiertagskalender. |
| `resourceBirthdayHint` | Birthday for reminders; year optional. | Geburtstag für Erinnerungen; Jahr optional. |
| `resourceNotesHint` | Free-text notes about this person. | Freitextnotizen zu dieser Person. |

### New/Edit Absence (`absence-edit-modal.tsx`)
| key | EN | DE |
|---|---|---|
| `absenceAssigneeHint` | Person who is absent. | Abwesende Person. |
| `absenceTypeHint` | Kind of absence (vacation, sick, training, other). | Art der Abwesenheit (Urlaub, Krank, Schulung, Sonstiges). |
| `absenceStartHint` | First day of the absence (inclusive). | Erster Tag der Abwesenheit (einschließlich). |
| `absenceEndHint` | Last day of the absence (inclusive). | Letzter Tag der Abwesenheit (einschließlich). |
| `absenceNoteHint` | Optional note about the absence. | Optionale Notiz zur Abwesenheit. |

### Budget pane (`budget-panel.tsx`) — add hints to the metrics lacking them
(`budgetBudgetHoursHint` and `budgetActualHoursHint` already exist; reuse.)
| key | EN | DE |
|---|---|---|
| `budgetPlanHoursHint` | Planned effort hours for this bucket. | Geplante Aufwandsstunden für diesen Bereich. |
| `budgetCciCpiHint` | Cost Performance Index = earned ÷ actual. Above 1 is under budget. | Cost Performance Index = Earned Value ÷ Ist. Über 1 = unter Budget. |
| `budgetCciMarginHint` | Margin = (external value − internal cost) ÷ external value. | Marge = (externer Wert − interne Kosten) ÷ externer Wert. |
| `budgetCciConsumptionHint` | Share of budgeted hours already consumed. | Anteil der bereits verbrauchten Budgetstunden. |
| `budgetWinLossHint` | Hours won or lost versus plan. | Stunden über oder unter Plan. |
| `budgetSpilloverInHint` | Hours carried in from another bucket. | Aus einem anderen Bereich übertragene Stunden. |

### Edit RAID (`raid-edit-modal.tsx`)
Rewire existing `raidField*Hint` keys from HTML `title` → `InfoTooltip` (Title,
Category, Status, Severity, Owner, OwnerEmail, RaisedDate, TargetDate,
Description, Mitigation, CausedBy, LinkedTasks, RiskMatrix, Delete). No new copy.

### Edit Change (`change-edit-modal.tsx`)
| key | EN | DE |
|---|---|---|
| `changeFieldTitleHint` | Short name of the change request. | Kurzbezeichnung des Änderungsantrags. |
| `changeFieldTypeHint` | Type of change (scope, schedule, cost, …). | Art der Änderung (Umfang, Zeitplan, Kosten …). |
| `changeFieldStatusHint` | Current decision status. | Aktueller Entscheidungsstatus. |
| `changeFieldRequestedByHint` | Who raised the change. | Wer die Änderung beantragt hat. |
| `changeFieldRaisedDateHint` | Date the change was raised. | Datum der Einreichung. |
| `changeFieldDecisionByHint` | Who decides on the change. | Wer über die Änderung entscheidet. |
| `changeFieldDecisionDateHint` | Decision due or made date. | Fälligkeits- bzw. Entscheidungsdatum. |
| `changeFieldDescriptionHint` | What is changing and why. | Was sich ändert und warum. |
| `changeFieldImpactHint` | Overall impact rating. | Gesamtbewertung der Auswirkung. |
| `changeFieldImpactDescriptionHint` | Details of the impact. | Details zur Auswirkung. |
| `changeFieldCostImpactHint` | Estimated cost impact (EUR). | Geschätzte Kostenauswirkung (EUR). |
| `changeFieldScheduleImpactHint` | Estimated schedule impact (days). | Geschätzte Auswirkung auf den Zeitplan (Tage). |
| `changeFieldResolutionHint` | Decision outcome and rationale. | Entscheidungsergebnis und Begründung. |
| `changeFieldLinkedTasksHint` | Tasks affected by this change. | Von der Änderung betroffene Aufgaben. |
| `changeFieldLinkedRaidHint` | Related RAID items. | Verknüpfte RAID-Einträge. |

### Edit Stakeholder (`stakeholder-edit-modal.tsx`)
| key | EN | DE |
|---|---|---|
| `stakeholderFieldNameHint` | Stakeholder's name. | Name des Stakeholders. |
| `stakeholderFieldTitleHint` | Role or title. | Funktion oder Titel. |
| `stakeholderFieldOrganizationHint` | Organization or department. | Organisation oder Abteilung. |
| `stakeholderFieldEmailHint` | Contact email. | Kontakt-E-Mail. |
| `stakeholderFieldCategoryHint` | Stakeholder category/group. | Stakeholder-Kategorie bzw. -Gruppe. |
| `stakeholderFieldInfluenceHint` | Power to affect the project (1–3). | Einfluss auf das Projekt (1–3). |
| `stakeholderFieldInterestHint` | Interest in the project (1–3). | Interesse am Projekt (1–3). |
| `stakeholderFieldNotesHint` | Free-text notes. | Freitextnotizen. |

---

## Section E — RACI chip picker + legend

New component `raci-chip-picker.tsx` consumed by `raci-panel.tsx`, replacing the
`<select>` at `raci-panel.tsx:113`.

- Props: `value: RaciRole | ""`, `onChange: (role: RaciRole | "") => void`,
  `ariaPrefix: string` (the `{milestone} · {stakeholder}` context).
- Renders four `<button>` chips R/A/C/I. Color map:
  | role | color token |
  |---|---|
  | R (Responsible) | `AIPM-dark-blue` |
  | A (Accountable) | `AIPM-green` |
  | C (Consulted) | `AIPM-purple` |
  | I (Informed) | `AIPM-medium-grey` |
- Active chip: filled (`bg-<color> text-white`); inactive: outlined
  (`border-<color> text-<color>` on `bg-surface`). Click a chip → set that role;
  click the **active** chip → clear (`onChange("")`). `aria-pressed` reflects
  active; `aria-label` = `${ariaPrefix} — ${roleLabel}`.
- Legend (replaces the plain `raciLegend` text at `raci-panel.tsx:140`): a row of
  the same four colored chip-dots with their labels, visually aligned with the
  picker. New keys reuse existing role labels; legend container styled to match.
- Keyboard: chips are buttons (tab + enter/space). The cell no longer needs a
  native select.

Color tokens are all existing AIPM brand colors, consistent with how RAID uses
brand colors for categorization.

---

## Section F — Remove modern New-task button

In `top-bar.tsx`, remove the "New task" button (lines ~62–66) and the `onNewTask`
prop. In `modern-shell.tsx:87`, drop the `onNewTask={onNewTask}` pass-through and
remove the now-unused plumbing up the chain ONLY if it becomes dead (verify
nothing else consumes it; the classic header's `+` is a separate handler and
stays). Tasks remain creatable from the classic header `+` and existing create
surfaces.

---

## Testing

React Testing Library, one focused assertion set per item:
- A2: absence input className includes `text-sm` (not `text-[10px]`).
- A3: a `€` renders adjacent to each rate input.
- B: clicking a row (not a control) calls the edit handler; clicking an inner
  input/button does NOT (stopPropagation).
- C: edit modals render "Edit change" / "Edit stakeholder" / "Edit task"; task
  modal has a close control.
- D: a sampling of fields render an `InfoTooltip` (by accessible name); RAID
  fields no longer set a bare `title`.
- E: clicking chip "R" sets role R (filled, `aria-pressed`); clicking it again
  clears; legend shows four colored entries.
- F: modern `TopBar` renders no "New task" button.

i18n: all new keys in EN + DE with identical sets; `i18n-encoding` + parity
tests pass.

## Out of scope (YAGNI)
- Calendar feature changes (only pane sizing).
- Budget metric recomputation (only tooltips).
- Keyboard re-architecture of tables beyond retaining a focusable control.
- Removing the classic header `+` button.

## File summary
**New:** `raci-chip-picker.tsx` (+ test).
**Modified:** `resources-panel.tsx`, `resource-calendar.tsx`, `roles-editor.tsx`,
`stakeholders-panel.tsx`, `resource-directory.tsx`, `resource-workload.tsx`,
`change-edit-modal.tsx`, `stakeholder-edit-modal.tsx`, `task-form-modal.tsx`
(+ modern task edit view if applicable), `resource-edit-modal.tsx`,
`absence-edit-modal.tsx`, `budget-panel.tsx`, `raid-edit-modal.tsx`,
`raci-panel.tsx`, `top-bar.tsx`, `modern-shell.tsx`, `i18n.ts`, `i18n.de.ts`,
plus the test files for each touched surface.
