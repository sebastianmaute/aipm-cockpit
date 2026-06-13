# UI Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A batch of UI refinements — pane sizing, currency symbols, field tooltips, modal-heading fixes, RAID-style clickable rows, a color-coded RACI chip picker, and removal of the modern top-bar New-task button.

**Architecture:** Mostly per-file edits applying established patterns (`InfoTooltip`, the RAID `<tr onClick>` row, `view-styles` pane classes). One new small component, `raci-chip-picker.tsx`. New i18n keys land first so later tasks compile.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest 4 + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-13-ui-polish-batch-design.md`

**Conventions (read first):**
- `InfoTooltip` (`src/app/info-tooltip.tsx`): `<InfoTooltip text={t(lang,"keyHint")} />`, dropped INSIDE a field's `<label>` right after the label text. `text=""` renders nothing. It is NOT a `<button>` (won't steal the label association).
- AIPM palette only. Tokens: `AIPM-dark-blue`, `AIPM-green`, `AIPM-purple`, `AIPM-medium-grey`, `AIPM-pink`, `surface`, `surface-muted`, `line`, `muted-foreground`, `foreground`, `white`.
- `i18n.de.ts` must use REAL umlauts (ä ö ü ß) — `i18n-encoding.test.ts` bans ASCII subs. EN (`i18n.ts`) and DE (`i18n.de.ts`) MUST keep identical key sets. Do not corrupt existing ASCII `"` delimiters into curly quotes.
- Tests: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Lint: `npx eslint <files> --max-warnings=0`.
- The RAID reference row: `raid-panel.tsx:505` — `<tr onClick={() => openEdit(item)} className="cursor-pointer align-top hover:bg-surface-muted …">`.

---

## File Structure

**New:** `src/app/raci-chip-picker.tsx` + `src/app/raci-chip-picker.test.tsx`.
**Modified:** `i18n.ts`, `i18n.de.ts`, `resources-panel.tsx`, `roles-editor.tsx`, `change-edit-modal.tsx`, `stakeholder-edit-modal.tsx`, `task-form-modal.tsx`, `resource-edit-modal.tsx`, `absence-edit-modal.tsx`, `budget-panel.tsx`, `raid-edit-modal.tsx`, `raci-panel.tsx`, `stakeholders-panel.tsx`, `resource-directory.tsx`, `resource-workload.tsx`, `top-bar.tsx`, `modern-shell.tsx`, `version.ts`, `CHANGELOG.md`. Plus per-surface test files.

---

## Task 1: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`. Run `src/app/i18n-encoding.test.ts`.

- [ ] **Step 1: Add ALL new EN keys to `src/app/i18n.ts`** (place the block after the existing `snapshotNeedsTursoFirst` key, same object/indentation):

```ts
  // --- UI polish batch (0.76.0) ---
  // Modal heading fixes
  changeEditTitle: "Edit change",
  stakeholderEditTitle: "Edit stakeholder",
  taskEditTitle: "Edit task",
  // Manage Roles tooltips
  rolesDisciplineHint: "The skill area this role belongs to (e.g. Engineering).",
  rolesGradeHint: "Seniority level used to derive the blended rate.",
  rolesInternalRateHint: "Hourly internal cost rate (EUR).",
  rolesExternalRateHint: "Hourly external/billing rate (EUR).",
  // Edit Resource tooltips
  resourceFirstNameHint: "Given name of the person.",
  resourceLastNameHint: "Family name of the person.",
  resourceEmailHint: "Primary email; matches calendar and contacts.",
  resourcePhoneHint: "Contact phone number (optional).",
  resourceCompanyHint: "Employing company or vendor.",
  resourceDepartmentHint: "Department or team.",
  resourceJobTitleHint: "Job title or role label.",
  resourceLocationHint: "Work location; drives the holiday calendar.",
  resourceBirthdayHint: "Birthday for reminders; year optional.",
  resourceNotesHint: "Free-text notes about this person.",
  // New/Edit Absence tooltips
  absenceAssigneeHint: "Person who is absent.",
  absenceTypeHint: "Kind of absence (vacation, sick, training, other).",
  absenceStartHint: "First day of the absence (inclusive).",
  absenceEndHint: "Last day of the absence (inclusive).",
  absenceNoteHint: "Optional note about the absence.",
  // Budget tooltips
  budgetPlanHoursHint: "Planned effort hours for this bucket.",
  budgetCciCpiHint: "Cost Performance Index = earned ÷ actual. Above 1 is under budget.",
  budgetCciMarginHint: "Margin = (external value − internal cost) ÷ external value.",
  budgetCciConsumptionHint: "Share of budgeted hours already consumed.",
  budgetWinLossHint: "Hours won or lost versus plan.",
  budgetSpilloverInHint: "Hours carried in from another bucket.",
  // Edit Change tooltips
  changeFieldTitleHint: "Short name of the change request.",
  changeFieldTypeHint: "Type of change (scope, schedule, cost, …).",
  changeFieldStatusHint: "Current decision status.",
  changeFieldRequestedByHint: "Who raised the change.",
  changeFieldRaisedDateHint: "Date the change was raised.",
  changeFieldDecisionByHint: "Who decides on the change.",
  changeFieldDecisionDateHint: "Decision due or made date.",
  changeFieldDescriptionHint: "What is changing and why.",
  changeFieldImpactHint: "Overall impact rating.",
  changeFieldImpactDescriptionHint: "Details of the impact.",
  changeFieldCostImpactHint: "Estimated cost impact (EUR).",
  changeFieldScheduleImpactHint: "Estimated schedule impact (days).",
  changeFieldResolutionHint: "Decision outcome and rationale.",
  changeFieldLinkedTasksHint: "Tasks affected by this change.",
  changeFieldLinkedRaidHint: "Related RAID items.",
  // Edit Stakeholder tooltips
  stakeholderFieldNameHint: "Stakeholder's name.",
  stakeholderFieldTitleHint: "Role or title.",
  stakeholderFieldOrganizationHint: "Organization or department.",
  stakeholderFieldEmailHint: "Contact email.",
  stakeholderFieldCategoryHint: "Stakeholder category/group.",
  stakeholderFieldInfluenceHint: "Power to affect the project (1–3).",
  stakeholderFieldInterestHint: "Interest in the project (1–3).",
  stakeholderFieldNotesHint: "Free-text notes.",
  // RACI role labels (chip legend + aria)
  raciRoleResponsible: "Responsible",
  raciRoleAccountable: "Accountable",
  raciRoleConsulted: "Consulted",
  raciRoleInformed: "Informed",
```

- [ ] **Step 2: Add the matching DE keys to `src/app/i18n.de.ts`** (after its `snapshotNeedsTursoFirst`, real umlauts):

```ts
  // --- UI polish batch (0.76.0) ---
  changeEditTitle: "Änderung bearbeiten",
  stakeholderEditTitle: "Stakeholder bearbeiten",
  taskEditTitle: "Aufgabe bearbeiten",
  rolesDisciplineHint: "Der Fachbereich dieser Rolle (z. B. Engineering).",
  rolesGradeHint: "Erfahrungsstufe für den Mischsatz.",
  rolesInternalRateHint: "Interner Stundensatz (EUR).",
  rolesExternalRateHint: "Externer Stundensatz (EUR).",
  resourceFirstNameHint: "Vorname der Person.",
  resourceLastNameHint: "Nachname der Person.",
  resourceEmailHint: "Primäre E-Mail; gleicht Kalender und Kontakte ab.",
  resourcePhoneHint: "Telefonnummer (optional).",
  resourceCompanyHint: "Arbeitgeber oder Dienstleister.",
  resourceDepartmentHint: "Abteilung oder Team.",
  resourceJobTitleHint: "Position oder Rollenbezeichnung.",
  resourceLocationHint: "Arbeitsort; bestimmt den Feiertagskalender.",
  resourceBirthdayHint: "Geburtstag für Erinnerungen; Jahr optional.",
  resourceNotesHint: "Freitextnotizen zu dieser Person.",
  absenceAssigneeHint: "Abwesende Person.",
  absenceTypeHint: "Art der Abwesenheit (Urlaub, Krank, Schulung, Sonstiges).",
  absenceStartHint: "Erster Tag der Abwesenheit (einschließlich).",
  absenceEndHint: "Letzter Tag der Abwesenheit (einschließlich).",
  absenceNoteHint: "Optionale Notiz zur Abwesenheit.",
  budgetPlanHoursHint: "Geplante Aufwandsstunden für diesen Bereich.",
  budgetCciCpiHint: "Cost Performance Index = Earned Value ÷ Ist. Über 1 = unter Budget.",
  budgetCciMarginHint: "Marge = (externer Wert − interne Kosten) ÷ externer Wert.",
  budgetCciConsumptionHint: "Anteil der bereits verbrauchten Budgetstunden.",
  budgetWinLossHint: "Stunden über oder unter Plan.",
  budgetSpilloverInHint: "Aus einem anderen Bereich übertragene Stunden.",
  changeFieldTitleHint: "Kurzbezeichnung des Änderungsantrags.",
  changeFieldTypeHint: "Art der Änderung (Umfang, Zeitplan, Kosten …).",
  changeFieldStatusHint: "Aktueller Entscheidungsstatus.",
  changeFieldRequestedByHint: "Wer die Änderung beantragt hat.",
  changeFieldRaisedDateHint: "Datum der Einreichung.",
  changeFieldDecisionByHint: "Wer über die Änderung entscheidet.",
  changeFieldDecisionDateHint: "Fälligkeits- bzw. Entscheidungsdatum.",
  changeFieldDescriptionHint: "Was sich ändert und warum.",
  changeFieldImpactHint: "Gesamtbewertung der Auswirkung.",
  changeFieldImpactDescriptionHint: "Details zur Auswirkung.",
  changeFieldCostImpactHint: "Geschätzte Kostenauswirkung (EUR).",
  changeFieldScheduleImpactHint: "Geschätzte Auswirkung auf den Zeitplan (Tage).",
  changeFieldResolutionHint: "Entscheidungsergebnis und Begründung.",
  changeFieldLinkedTasksHint: "Von der Änderung betroffene Aufgaben.",
  changeFieldLinkedRaidHint: "Verknüpfte RAID-Einträge.",
  stakeholderFieldNameHint: "Name des Stakeholders.",
  stakeholderFieldTitleHint: "Funktion oder Titel.",
  stakeholderFieldOrganizationHint: "Organisation oder Abteilung.",
  stakeholderFieldEmailHint: "Kontakt-E-Mail.",
  stakeholderFieldCategoryHint: "Stakeholder-Kategorie bzw. -Gruppe.",
  stakeholderFieldInfluenceHint: "Einfluss auf das Projekt (1–3).",
  stakeholderFieldInterestHint: "Interesse am Projekt (1–3).",
  stakeholderFieldNotesHint: "Freitextnotizen.",
  raciRoleResponsible: "Verantwortlich",
  raciRoleAccountable: "Rechenschaftspflichtig",
  raciRoleConsulted: "Konsultiert",
  raciRoleInformed: "Informiert",
```

- [ ] **Step 3: Typecheck + i18n tests**

Run: `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts`
Expected: PASS (keys present in both dicts, parity holds, no ASCII umlaut subs).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: i18n keys for UI polish batch (EN/DE)"
```

---

## Task 2: RACI chip picker + legend

**Files:** Create `src/app/raci-chip-picker.tsx`, `src/app/raci-chip-picker.test.tsx`. Modify `src/app/raci-panel.tsx`.

Context: `raci-panel.tsx` currently renders a `<select>` per cell (line ~113) and a plain legend `<p>{t(lang,"raciLegend")}</p>` (line ~140). `RaciRole` + `RACI_ROLES` come from `./types`; `setRaciRole(stakeholder, milestoneId, role|null)` from the same module the panel already imports. The cell's `onChange` calls `onSave(setRaciRole(stakeholder, row.milestone.id, newRole))`.

- [ ] **Step 1: Write the failing test** `src/app/raci-chip-picker.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RaciChipPicker } from "./raci-chip-picker";

// The chip's accessible name is its aria-label: `${ariaPrefix} — ${roleLabel}`,
// e.g. "M1 · S1 — Responsible". Match by the role label, NOT the letter.
describe("RaciChipPicker", () => {
  it("renders four chips R/A/C/I", () => {
    const { getByRole } = render(
      <RaciChipPicker value="" onChange={() => {}} ariaPrefix="M1 · S1" lang="en-US" />,
    );
    for (const label of ["Responsible", "Accountable", "Consulted", "Informed"]) {
      expect(getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("clicking an inactive chip sets that role", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <RaciChipPicker value="" onChange={onChange} ariaPrefix="M1 · S1" lang="en-US" />,
    );
    fireEvent.click(getByRole("button", { name: /Responsible/ }));
    expect(onChange).toHaveBeenCalledWith("R");
  });

  it("clicking the active chip clears it", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <RaciChipPicker value="A" onChange={onChange} ariaPrefix="M1 · S1" lang="en-US" />,
    );
    const a = getByRole("button", { name: /Accountable/ });
    expect(a.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(a);
    expect(onChange).toHaveBeenCalledWith("");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/app/raci-chip-picker.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Write `src/app/raci-chip-picker.tsx`**

```tsx
"use client";
import { type Lang, t } from "./i18n";
import { RACI_ROLES, type RaciRole } from "./types";

interface RaciChipPickerProps {
  value: RaciRole | "";
  onChange: (role: RaciRole | "") => void;
  /** "{milestone} · {stakeholder}" context for the accessible label. */
  ariaPrefix: string;
  lang: Lang;
}

// Brand color per role (filled when active, outlined when inactive).
const CHIP: Record<RaciRole, { on: string; off: string }> = {
  R: { on: "bg-AIPM-dark-blue text-white border-AIPM-dark-blue", off: "border-AIPM-dark-blue text-AIPM-dark-blue" },
  A: { on: "bg-AIPM-green text-white border-AIPM-green", off: "border-AIPM-green text-AIPM-green" },
  C: { on: "bg-AIPM-purple text-white border-AIPM-purple", off: "border-AIPM-purple text-AIPM-purple" },
  I: { on: "bg-AIPM-medium-grey text-white border-AIPM-medium-grey", off: "border-AIPM-medium-grey text-AIPM-medium-grey" },
};

const ROLE_LABEL_KEY: Record<RaciRole, Parameters<typeof t>[1]> = {
  R: "raciRoleResponsible",
  A: "raciRoleAccountable",
  C: "raciRoleConsulted",
  I: "raciRoleInformed",
};

export function RaciChipPicker({ value, onChange, ariaPrefix, lang }: RaciChipPickerProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {RACI_ROLES.map((role) => {
        const active = value === role;
        const c = CHIP[role];
        return (
          <button
            key={role}
            type="button"
            aria-pressed={active}
            aria-label={`${ariaPrefix} — ${t(lang, ROLE_LABEL_KEY[role])}`}
            onClick={() => onChange(active ? "" : role)}
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition-colors ${
              active ? c.on : `bg-surface ${c.off} hover:bg-surface-muted`
            } focus:outline-none focus:ring-1 focus:ring-AIPM-green`}
          >
            {role}
          </button>
        );
      })}
    </span>
  );
}

/** Bottom-of-panel legend: the same four colored chips with full labels. */
export function RaciLegend({ lang }: { lang: Lang }) {
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {RACI_ROLES.map((role) => (
        <span key={role} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-white ${CHIP[role].on}`}
          >
            {role}
          </span>
          {t(lang, ROLE_LABEL_KEY[role])}
        </span>
      ))}
    </div>
  );
}
```

> If `RaciRole` is not the literal union `"R"|"A"|"C"|"I"`, read `./types` `RACI_ROLES` and adjust the `CHIP`/`ROLE_LABEL_KEY` keys to the actual role values before proceeding. Report as a concern if they differ.

- [ ] **Step 4: Run** `npx vitest run src/app/raci-chip-picker.test.tsx` → PASS (3 tests).

- [ ] **Step 5: Wire into `src/app/raci-panel.tsx`** — replace the `<td>…<select>…</select></td>` block (the cell render, ~lines 110–135) with:

```tsx
                      <td key={cell.stakeholderId} className="px-3 py-2">
                        <RaciChipPicker
                          value={(cell.role ?? "") as RaciRole | ""}
                          ariaPrefix={ariaLabel}
                          lang={lang}
                          onChange={(role) => {
                            if (!stakeholder) return;
                            onSave(setRaciRole(stakeholder, row.milestone.id, role === "" ? null : role));
                          }}
                        />
                      </td>
```

Replace the legend line `<p className="mt-3 shrink-0 text-xs text-muted-foreground">{t(lang, "raciLegend")}</p>` with `<RaciLegend lang={lang} />`. Add `import { RaciChipPicker, RaciLegend } from "./raci-chip-picker";` at the top. Remove the now-unused `RACI_ROLES` import from raci-panel IF it becomes unused (check; `RaciRole` may still be used).

- [ ] **Step 6: Run** the RACI panel's existing test (if any) + typecheck + lint:

Run: `npx tsc --noEmit && npx eslint src/app/raci-chip-picker.tsx src/app/raci-panel.tsx --max-warnings=0`
Expected: clean. (If `raci-panel.test.tsx` exists, run it; update any assertion that referenced the old `<select>` to the new chips.)

- [ ] **Step 7: Commit**

```bash
git add src/app/raci-chip-picker.tsx src/app/raci-chip-picker.test.tsx src/app/raci-panel.tsx
git commit -m "feat: color-coded RACI chip picker + legend (replaces dropdown)"
```

---

## Task 3: Sizing & currency (calendar pane, absence stepper, roles €)

**Files:** Modify `src/app/resources-panel.tsx`, `src/app/roles-editor.tsx`.

- [ ] **Step 1: A1 — Calendar pane = Workload pane.** In `resources-panel.tsx` find:

```tsx
  const paneClass = view === "calendar" ? CENTERED_HALF_PANE_CLASS : VIEW_PANE_RESIZABLE_CLASS;
```

Replace with:

```tsx
  // Calendar shares Workload's full resizable pane (was the half-size centered
  // pane, which made it visibly smaller than every sibling resource view).
  const paneClass = VIEW_PANE_RESIZABLE_CLASS;
```

Remove the now-unused `CENTERED_HALF_PANE_CLASS` from the `view-styles` import on line 24 if it is no longer referenced anywhere else in the file (grep first).

- [ ] **Step 2: A2 — Absence stepper = utilization stepper size.** In `resources-panel.tsx`, the absence-override input currently has `text-[10px]`. Change its className from:

```tsx
className={`mt-0.5 w-16 rounded border border-AIPM-purple/40 px-1 py-0.5 text-right text-[10px] tabular-nums text-AIPM-purple dark:border-AIPM-purple/50 dark:bg-surface dark:text-AIPM-purple${derived ? " bg-surface-muted opacity-60" : ""}`}
```

to (swap `text-[10px]` → `text-sm` so it matches the utilization input's font/box; keep the purple border + color):

```tsx
className={`mt-0.5 w-16 rounded border border-AIPM-purple/40 px-1 py-0.5 text-right text-sm tabular-nums text-AIPM-purple dark:border-AIPM-purple/50 dark:bg-surface dark:text-AIPM-purple${derived ? " bg-surface-muted opacity-60" : ""}`}
```

- [ ] **Step 3: A3 — Manage Roles currency symbol.** In `roles-editor.tsx`, wrap each rate input with a `€` prefix. Replace the internal-rate `<input …/>` with:

```tsx
                    <span className="inline-flex items-center justify-end gap-1">
                      <span aria-hidden className="text-muted-foreground">€</span>
                      <input type="number" min={0} step={1} value={r.internalRate}
                        aria-label={`${rowCtx} — ${t(lang, "rolesInternalRate")}`}
                        onChange={(e) => onSaveRole({ ...r, internalRate: clampRate(e.target.value) })}
                        className="w-24 rounded-md border border-line px-2 py-1 text-right text-sm tabular-nums bg-surface-muted" />
                    </span>
```

and the external-rate `<input …/>` identically but with `value={r.externalRate}`, `aria-label` using `rolesExternalRate`, and `onChange` setting `externalRate`.

- [ ] **Step 4: Add a focused test** `src/app/roles-editor.test.tsx` (create if absent; if it exists, append). Render `RolesEditor` with one role and assert a `€` is present next to a rate input:

```tsx
// Minimal: assert the euro symbol renders in the rate cells.
// (Reuse the existing RolesEditor test harness/props if a test file already exists.)
```

If no test harness exists for `RolesEditor`, SKIP creating one (it needs broad props); instead rely on the lint/tsc + a manual note. Do NOT fabricate a brittle harness. Record this as a concern.

- [ ] **Step 5: Verify** `npx tsc --noEmit && npx eslint src/app/resources-panel.tsx src/app/roles-editor.tsx --max-warnings=0` → clean. Run `npx vitest run src/app/resources-panel.test.tsx` if it exists.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx src/app/roles-editor.tsx
git commit -m "feat: calendar full pane, absence stepper size, manage-roles euro symbol"
```

---

## Task 4: Modal heading fixes + Edit Task close

**Files:** Modify `src/app/change-edit-modal.tsx`, `src/app/stakeholder-edit-modal.tsx`, `src/app/task-form-modal.tsx`. Check `src/app/task-edit-view.tsx` (modern) if present.

- [ ] **Step 1: Edit Change heading.** In `change-edit-modal.tsx` find:

```tsx
  const title = isNew
    ? t(lang, "changeReportAdd")
    : t(lang, "changeReportTitle");
```

Replace the edit branch:

```tsx
  const title = isNew
    ? t(lang, "changeReportAdd")
    : t(lang, "changeEditTitle");
```

- [ ] **Step 2: Edit Stakeholder heading.** In `stakeholder-edit-modal.tsx` find:

```tsx
  const title = isNew ? t(lang, "stakeholdersAdd") : t(lang, "navStakeholders");
```

Replace with:

```tsx
  const title = isNew ? t(lang, "stakeholdersAdd") : t(lang, "stakeholderEditTitle");
```

- [ ] **Step 3: Edit Task heading.** In `task-form-modal.tsx` find the `ModalHeader` title:

```tsx
    title={isEditing ? t(lang, "tabEditTask", editingId!) : t(lang, "tabNewTask")}
```

Replace with:

```tsx
    title={isEditing ? t(lang, "taskEditTitle") : t(lang, "tabNewTask")}
```

Also update the draggable-handle `title` (the other `tabEditTask` usage near line 78) to `taskEditTitle` for the edit case, mirroring this.

- [ ] **Step 4: Edit Task close X.** Confirm `task-form-modal.tsx`'s `<ModalHeader …>` does NOT pass `hideClose` (ModalHeader renders an X by default). If it passes `hideClose`, remove it. THEN check the modern path: open `src/app/task-edit-view.tsx` (if it exists). If the modern full-page task edit view lacks a visible close/cancel control in its header, add a close button that calls the existing cancel handler (the same handler the Cancel button uses), styled like other icon buttons (`rounded-md p-2 … hover:bg-surface-muted`). If `task-edit-view.tsx` already has a Cancel/close, leave it. Report what you found.

- [ ] **Step 5: Add tests** to the existing modal test files (or create minimal ones). For change + stakeholder, assert the edit-mode heading text:

```tsx
// change-edit-modal.test.tsx (append): rendering in edit mode shows "Edit change"
// stakeholder-edit-modal.test.tsx (append): edit mode shows "Edit stakeholder"
// task-form-modal.test.tsx (append): edit mode shows "Edit task" and a close control (getByLabelText close)
```

If a modal lacks a test harness and wiring one is heavy, assert via the smallest render that compiles; if genuinely impractical, record a concern rather than fabricating brittle setup.

- [ ] **Step 6: Verify** `npx tsc --noEmit && npx eslint src/app/change-edit-modal.tsx src/app/stakeholder-edit-modal.tsx src/app/task-form-modal.tsx --max-warnings=0` → clean. Run the three modals' tests if present.

- [ ] **Step 7: Commit**

```bash
git add src/app/change-edit-modal.tsx src/app/stakeholder-edit-modal.tsx src/app/task-form-modal.tsx
git commit -m "fix: correct edit-modal headings (change/stakeholder/task) + task close"
```

---

## Task 5: Tooltips — Manage Roles, Edit Resource, New Absence

**Files:** Modify `src/app/roles-editor.tsx`, `src/app/resource-edit-modal.tsx`, `src/app/absence-edit-modal.tsx`.

Pattern (worked example for ONE field): a field currently like

```tsx
<label className="flex flex-col gap-1 text-sm">
  {t(lang, "resourceFirstName")}
  <input … />
</label>
```

becomes

```tsx
<label className="flex flex-col gap-1 text-sm">
  <span className="flex items-center gap-1">{t(lang, "resourceFirstName")}<InfoTooltip text={t(lang, "resourceFirstNameHint")} /></span>
  <input … />
</label>
```

Add `import { InfoTooltip } from "./info-tooltip";` to each file (if not already imported).

- [ ] **Step 1:** In `resource-edit-modal.tsx`, attach `InfoTooltip` to each field using the matching `*Hint` key: firstName→`resourceFirstNameHint`, lastName→`resourceLastNameHint`, email→`resourceEmailHint`, phone→`resourcePhoneHint`, company→`resourceCompanyHint`, department→`resourceDepartmentHint`, jobTitle→`resourceJobTitleHint`, location→`resourceLocationHint`, birthday→`resourceBirthdayHint`, notes→`resourceNotesHint`. Wrap each label's text + tooltip in a `<span className="flex items-center gap-1">…</span>` as shown.

- [ ] **Step 2:** In `absence-edit-modal.tsx`, attach to: assignee→`absenceAssigneeHint`, type→`absenceTypeHint`, start→`absenceStartHint`, end→`absenceEndHint`, note→`absenceNoteHint`.

- [ ] **Step 3:** In `roles-editor.tsx`, attach to the column headers (the `<th>` for discipline/grade/internal/external rate) OR to the rate inputs' context. Since roles is a table (no per-field `<label>`), add `InfoTooltip` inside each `<th>` after the header text: discipline header→`rolesDisciplineHint`, grade header→`rolesGradeHint`, internal-rate header→`rolesInternalRateHint`, external-rate header→`rolesExternalRateHint`. Example:

```tsx
<th …><span className="inline-flex items-center gap-1">{t(lang, "rolesInternalRate")}<InfoTooltip text={t(lang, "rolesInternalRateHint")} /></span></th>
```

- [ ] **Step 4: Add tests** where a harness exists. Minimum: in the resource and absence modal test files, assert one tooltip is reachable by its accessible name, e.g. `getByLabelText(t("en-US","resourceEmailHint"))` (InfoTooltip's trigger uses the text as its aria-label). If a file has no harness, record a concern.

- [ ] **Step 5: Verify** `npx tsc --noEmit && npx eslint src/app/roles-editor.tsx src/app/resource-edit-modal.tsx src/app/absence-edit-modal.tsx --max-warnings=0` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/roles-editor.tsx src/app/resource-edit-modal.tsx src/app/absence-edit-modal.tsx
git commit -m "feat: field tooltips for roles, resource, absence editors"
```

---

## Task 6: Tooltips — Edit Change, Edit Stakeholder

**Files:** Modify `src/app/change-edit-modal.tsx`, `src/app/stakeholder-edit-modal.tsx`. Same `InfoTooltip`-inside-`<label>` pattern as Task 5.

- [ ] **Step 1:** In `change-edit-modal.tsx`, attach `InfoTooltip` to each field by its key: title→`changeFieldTitleHint`, type→`changeFieldTypeHint`, status→`changeFieldStatusHint`, requestedBy→`changeFieldRequestedByHint`, raisedDate→`changeFieldRaisedDateHint`, decisionBy→`changeFieldDecisionByHint`, decisionDate→`changeFieldDecisionDateHint`, description→`changeFieldDescriptionHint`, impact→`changeFieldImpactHint`, impactDescription→`changeFieldImpactDescriptionHint`, costImpact→`changeFieldCostImpactHint`, scheduleImpact→`changeFieldScheduleImpactHint`, resolution→`changeFieldResolutionHint`, linkedTasks→`changeFieldLinkedTasksHint`, linkedRaid→`changeFieldLinkedRaidHint`.

- [ ] **Step 2:** In `stakeholder-edit-modal.tsx`, attach to: name→`stakeholderFieldNameHint`, title→`stakeholderFieldTitleHint`, organization→`stakeholderFieldOrganizationHint`, email→`stakeholderFieldEmailHint`, category→`stakeholderFieldCategoryHint`, influence→`stakeholderFieldInfluenceHint`, interest→`stakeholderFieldInterestHint`, notes→`stakeholderFieldNotesHint`.

- [ ] **Step 3:** Ensure `InfoTooltip` is imported in both files.

- [ ] **Step 4: Add tests** where a harness exists (assert one tooltip by accessible name per modal); else record a concern.

- [ ] **Step 5: Verify** `npx tsc --noEmit && npx eslint src/app/change-edit-modal.tsx src/app/stakeholder-edit-modal.tsx --max-warnings=0` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/change-edit-modal.tsx src/app/stakeholder-edit-modal.tsx
git commit -m "feat: field tooltips for change and stakeholder editors"
```

---

## Task 7: Tooltips — Edit RAID (rewire) + Budget pane

**Files:** Modify `src/app/raid-edit-modal.tsx`, `src/app/budget-panel.tsx`.

- [ ] **Step 1: RAID rewire.** In `raid-edit-modal.tsx`, the fields currently set the hint as the HTML `title` attribute on the input/control (e.g. `title={t(lang,"raidFieldTitleHint")}`). For each such field, REMOVE the `title={…}` attribute and instead add `<InfoTooltip text={t(lang, "raidField<X>Hint")} />` inside the field's `<label>` after the label text (wrap label text + tooltip in `<span className="flex items-center gap-1">`). Apply to every existing `raidField*Hint`: Title, Category, Status, Severity, Owner, OwnerEmail, RaisedDate, TargetDate, Description, Mitigation, CausedBy, LinkedTasks, RiskMatrix, Delete. Import `InfoTooltip`. Removing the `title` avoids a duplicate native tooltip alongside the InfoTooltip.

- [ ] **Step 2: Budget tooltips.** In `budget-panel.tsx`, attach `InfoTooltip` next to the relevant column headers / metric labels: plan-hours header→`budgetPlanHoursHint`; the existing `budgetBudgetHoursHint`/`budgetActualHoursHint` may already render as `title` — convert those two to `InfoTooltip` as well for consistency; CCI metric labels: CPI→`budgetCciCpiHint`, margin→`budgetCciMarginHint`, consumption→`budgetCciConsumptionHint`, win/loss→`budgetWinLossHint`, spillover-in→`budgetSpilloverInHint`. Place `InfoTooltip` inside each header/label `<span>` after the text. Import `InfoTooltip`.

- [ ] **Step 3: Add tests** where harnesses exist (assert one RAID tooltip by accessible name AND that the corresponding input no longer has a `title` attribute; assert one budget tooltip). Else record a concern.

- [ ] **Step 4: Verify** `npx tsc --noEmit && npx eslint src/app/raid-edit-modal.tsx src/app/budget-panel.tsx --max-warnings=0` → clean. Run `npx vitest run src/app/raid-edit-modal.test.tsx src/app/budget-panel.test.tsx` if present.

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-edit-modal.tsx src/app/budget-panel.tsx
git commit -m "feat: rewire RAID hints to InfoTooltip; budget pane tooltips"
```

---

## Task 8: Clickable rows — Stakeholders, Directory, Workload

**Files:** Modify `src/app/stakeholders-panel.tsx`, `src/app/resource-directory.tsx`, `src/app/resource-workload.tsx`.

Pattern: add to the row `<tr>` → `onClick={() => <openEdit>(item)}` + `className` gains `cursor-pointer hover:bg-surface-muted`. The existing per-cell `<button>` keeps its own `onClick` but adds `e.stopPropagation()` so it doesn't double-fire, and stays for keyboard access.

- [ ] **Step 1: Stakeholders** (`stakeholders-panel.tsx`, row ~line 322; edit handler `openEdit`). Add to the `<tr>`: `onClick={() => openEdit(item)}` and `cursor-pointer hover:bg-surface-muted` in its className. In the name-cell button's onClick, change `onClick={() => openEdit(item)}` to `onClick={(e) => { e.stopPropagation(); openEdit(item); }}`.

- [ ] **Step 2: Directory** (`resource-directory.tsx`, row ~line 290; handler `onEditResource`). Add to `<tr>`: `onClick={() => onEditResource(r)}` + `cursor-pointer hover:bg-surface-muted`. Name-cell button onClick → `onClick={(e) => { e.stopPropagation(); onEditResource(r); }}`.

- [ ] **Step 3: Workload** (`resource-workload.tsx`, row ~line 110; handler `onEditResource`). Add to `<tr>`: `onClick={() => onEditResource(row.resource)}` + `cursor-pointer hover:bg-surface-muted`. The assignee-cell button AND the per-absence badge buttons (`onClick={() => onEditAbsence(a)}`, ~lines 173/278) each get `e.stopPropagation()` added before their existing call.

- [ ] **Step 4: Write a test** (one per panel where a harness exists) asserting: clicking the row region invokes the edit handler with the right item, and clicking an inner control still invokes its own handler exactly once (stopPropagation prevents the row handler). Example shape:

```tsx
// resource-directory.test.tsx (append)
it("clicking a row opens the resource editor", () => {
  const onEditResource = vi.fn();
  // render Directory with one resource + onEditResource
  fireEvent.click(screen.getByRole("row", { name: /<resource name>/i }));
  expect(onEditResource).toHaveBeenCalledTimes(1);
});
```

If a panel has no harness, add a minimal one only if straightforward; otherwise record a concern.

- [ ] **Step 5: Verify** `npx tsc --noEmit && npx eslint src/app/stakeholders-panel.tsx src/app/resource-directory.tsx src/app/resource-workload.tsx --max-warnings=0` → clean. Run any existing tests for these panels.

- [ ] **Step 6: Commit**

```bash
git add src/app/stakeholders-panel.tsx src/app/resource-directory.tsx src/app/resource-workload.tsx
git commit -m "feat: RAID-style clickable rows on stakeholders, directory, workload"
```

---

## Task 9: Clickable rows — Planning

**Files:** Modify `src/app/resources-panel.tsx`.

Context: the Planning table renders per-resource rows (`r`) inside the `view === "planning"` block; `onEditResource` is already a prop. The row has utilization + absence-override `<input>`s per period, and a name-cell `<button onClick={() => onEditResource(r)}>`.

- [ ] **Step 1:** On the Planning row `<tr>`, add `onClick={() => onEditResource(r)}` and `cursor-pointer hover:bg-surface-muted` to its className.

- [ ] **Step 2:** On BOTH period `<input>`s (utilization + absence override), add `onClick={(e) => e.stopPropagation()}` so clicking/focusing a number cell does not open the resource modal. (Keep their existing `onChange`.)

- [ ] **Step 3:** The name-cell `<button onClick={() => onEditResource(r)}>` → `onClick={(e) => { e.stopPropagation(); onEditResource(r); }}`.

- [ ] **Step 4: Add a test** (if a `resources-panel.test.tsx` harness exists) asserting a planning row click calls `onEditResource`, and that typing in a utilization input does not (stopPropagation). Else record a concern with a manual verification note.

- [ ] **Step 5: Verify** `npx tsc --noEmit && npx eslint src/app/resources-panel.tsx --max-warnings=0` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx
git commit -m "feat: clickable planning rows open resource editor (inputs unaffected)"
```

---

## Task 10: Remove modern New-task button

**Files:** Modify `src/app/top-bar.tsx`, `src/app/modern-shell.tsx`.

Context: `top-bar.tsx` renders `{primaryAction ?? (<button onClick={onNewTask}>{t(lang,"newTask")}</button>)}`. `primaryAction` replaces it while editing (Save/Cancel). We remove the default New-task button but KEEP the `primaryAction` slot.

- [ ] **Step 1:** In `top-bar.tsx`, change `{primaryAction ?? ( …New task button… )}` to just `{primaryAction}`. Remove `onNewTask: () => void;` from `TopBarProps`, remove `onNewTask` from the destructured params. Leave `primaryAction`, `onShowAlerts`, etc. intact.

- [ ] **Step 2:** In `modern-shell.tsx` (line ~87), remove the `onNewTask={onNewTask}` prop passed to `<TopBar>`. If `onNewTask` becomes an unused prop of `ModernShell` itself, remove it from `ModernShell`'s props and its call site (`task-manager.tsx`) — but ONLY if nothing else uses it; the classic header's add-task handler is separate. Grep for `onNewTask` to confirm scope before deleting up the chain. If it is still used elsewhere, leave the upstream wiring and only drop the TopBar pass-through.

- [ ] **Step 3: Add/adjust a test.** In `top-bar.test.tsx` (if present), assert the TopBar renders NO "New task" button when no `primaryAction` is given, and still renders `primaryAction` when provided:

```tsx
it("renders no New task button by default", () => {
  // render TopBar without primaryAction
  expect(screen.queryByText(/new task/i)).toBeNull();
});
```

- [ ] **Step 4: Verify** `npx tsc --noEmit && npx eslint src/app/top-bar.tsx src/app/modern-shell.tsx --max-warnings=0` → clean. Run `npx vitest run src/app/top-bar.test.tsx` if present.

- [ ] **Step 5: Commit**

```bash
git add src/app/top-bar.tsx src/app/modern-shell.tsx
git commit -m "feat: remove New task button from modern top bar"
```

---

## Task 11: Docs + version bump + full sweep

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: Bump `version.ts`.** `APP_VERSION` `"0.75.0"` → `"0.76.0"`; `APP_MILESTONE` `"Nagata"` → `"Delany"`; update the `APP_BUILD_DATE` comment to:
`export const APP_BUILD_DATE = "2026-06-13"; // 0.76.0 UI polish batch — clickable rows, RACI chip picker, field tooltips, sizing fixes`
Add `"versionHighlightUiPolishBatch",` to the end of `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Add the highlight i18n key** to BOTH dicts (after the previous `versionHighlight*` keys):
EN: `versionHighlightUiPolishBatch: "UI polish: clickable rows, a color-coded RACI chip picker, and field tooltips across the editors",`
DE: `versionHighlightUiPolishBatch: "UI-Politur: klickbare Zeilen, ein farbcodierter RACI-Chip-Picker und Feld-Tooltips in den Editoren",`

- [ ] **Step 3: CHANGELOG.** Insert above `## [0.75.0]`:

```markdown
## [0.76.0] - 2026-06-13 "Delany"

### Added
- Color-coded RACI chip picker (replaces the dropdown) with an aligned legend.
- Field tooltips across the Manage Roles, Edit Resource, New Absence, Budget,
  Edit RAID, Edit Change, and Edit Stakeholder editors.
- RAID-style clickable rows on Stakeholders, Directory, Workload, and Planning —
  click a row to open its editor (inline inputs unaffected).
- Currency (€) symbol next to the Manage Roles rate fields.

### Changed
- Resource Calendar now uses the full resizable pane (was a smaller centered
  pane), matching Workload's size.
- Planning's absence-override input matches the utilization input's size.
- Removed the New-task button from the modern top bar.

### Fixed
- Edit Change / Edit Stakeholder / Edit Task modals now show correct headings
  ("Edit change" / "Edit stakeholder" / "Edit task") instead of the view names.
```

- [ ] **Step 4: FULL sweep.** Run `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0`. Report total test files + tests. All must be green. If any fail, report (do not mask).

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "docs: 0.76.0 Delany — UI polish batch"
```

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green; `npx eslint src/app --max-warnings=0` clean.
- [ ] Manual smoke (dev server): Calendar pane matches Workload size; € shows on role rates; RACI chips set/clear with correct colors + legend; clicking rows on stakeholders/directory/workload/planning opens editors while inline inputs still work; edit modals show correct headings; task modal has a close X; tooltips appear on hover and persist on click; no New-task button in the modern top bar.
- [ ] Use **superpowers:finishing-a-development-branch**.
