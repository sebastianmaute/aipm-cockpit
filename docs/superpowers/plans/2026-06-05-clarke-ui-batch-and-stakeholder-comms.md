# v0.55.0 "Clarke" — UI Batch + Stakeholder Communication Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 13-item batch: a German-i18n umlaut audit, six UI-polish tweaks, a stakeholder-visual refresh, a milestones-table upgrade, a sidebar mode pill, and a mode-aware stakeholder communication reminder subsystem.

**Architecture:** Mostly localized edits to existing panels plus one new pure engine (`stakeholder-comms.ts`) + hook (`use-stakeholder-comms.ts`) + notification surfaces. New optional `stakeholderIds?: number[]` field on `RaidItem`/`ChangeItem`, round-tripped through the existing serializers. All new automation is gated by the feature-module flags (`stakeholders`/`raid`/`changes`/`milestones`).

**Tech Stack:** Next.js (app dir), React, TypeScript (strict, no `any`), Tailwind (AIPM 9-color palette), Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-05-pm-tracker-ui-batch-and-stakeholder-comms-design.md`

## Conventions for every task
- Run a single test file: `npx vitest run src/app/<file>.test.ts(x)`. Full suite: `npm run test:run`. Lint: `npm run lint` (runs `--max-warnings=0` — unused imports FAIL). Types: `npx tsc --noEmit` (the pre-existing `.next/dev/types/routes.d.ts` error is ignorable).
- **`i18n.de.ts` edits MUST use a CRLF-aware Node byte-patch script, NEVER the Edit tool** (it turns ASCII `"` delimiters into curly quotes). After any DE edit, verify: `grep -c '[“”]' src/app/i18n.de.ts` returns 0 and `node -e "require('fs').readFileSync('src/app/i18n.de.ts','utf8')"` parses.
- AIPM palette only; no gradients/shadows/off-palette colors.
- Commit after each task with a conventional-commit message.

---

## Task 1: i18n umlaut audit + encoding guard test (Workstream A)

**Files:**
- Create: `src/app/i18n-encoding.test.ts`
- Modify: `src/app/i18n.de.ts` (byte-patch only), `src/app/i18n.ts` (en-GB block if any umlaut-less German leaks — unlikely)

- [ ] **Step 1: Write the failing guard test**

```typescript
// src/app/i18n-encoding.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messages, type Lang } from "./i18n";

const DE_SOURCE = readFileSync(join(__dirname, "i18n.de.ts"), "utf8");

describe("i18n German encoding", () => {
  it("has no mojibake byte sequences in the DE source", () => {
    // Ã / Â are the tell-tale UTF-8-read-as-latin1 lead bytes.
    expect(DE_SOURCE).not.toMatch(/[ÃÂ]/);
  });

  it("uses literal UTF-8, not \\uXXXX escapes, for umlauts", () => {
    expect(DE_SOURCE).not.toMatch(/\\u00(e4|f6|fc|c4|d6|dc|df)/i);
  });

  it("renders required German terms with their umlaut/ß intact", () => {
    const de = messages["de" as Lang] as Record<string, string>;
    const all = Object.values(de).join("\n");
    // Words that MUST keep their diacritic somewhere in the bundle.
    for (const term of ["für", "Änderung", "müssen", "schließen", "gültig", "zurück", "löschen", "übernehmen", "Überblick"]) {
      expect(all.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("contains no ASCII-substituted umlaut tokens in German values", () => {
    const de = messages["de" as Lang] as Record<string, string>;
    const all = Object.values(de).join(" ");
    // Common offenders if someone typed ASCII fallbacks.
    expect(all).not.toMatch(/\bfuer\b|\bmuessen\b|\bgeloescht\b|\bSchliessen\b/);
  });
});
```

- [ ] **Step 2: Run to verify it fails (or surfaces real gaps)**

Run: `npx vitest run src/app/i18n-encoding.test.ts`
Expected: FAIL on any term the bundle is currently missing (audit signal). If the term-presence test passes already, keep it as the regression lock.

- [ ] **Step 3: Audit + fix the DE bundle**

Manually scan `src/app/i18n.de.ts` for German values missing umlauts/ß. Apply fixes with a Node byte-patch script (CRLF-aware), e.g.:

```js
// _patch_de.cjs — run with: node _patch_de.cjs ; then delete the file
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const fixes = [
  // [from, to] — only literal, unambiguous corrections found during audit
  // example: ["fuer ", "für "],
];
for (const [a, b] of fixes) s = s.split(a).join(b);
fs.writeFileSync(p, s); // preserves existing CRLF since we never touch line endings
```

Confirm `messages.export` for the `messages` map exists; if `i18n.ts` exports the language map under a different name (e.g. `dictionaries`), adjust the test import accordingly (read `i18n.ts` first to confirm the exported map name and the `Lang` keys).

- [ ] **Step 4: Run tests + verify clean DE**

Run: `npx vitest run src/app/i18n-encoding.test.ts` → PASS
Run: `grep -c '[“”]' src/app/i18n.de.ts` → `0`

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n-encoding.test.ts src/app/i18n.de.ts src/app/i18n.ts
git commit -m "fix: audit German umlauts + add i18n encoding guard test"
```

---

## Task 2: Dashboard Save/Clear buttons → chat layout (Workstream B2)

**Files:**
- Modify: `src/app/dashboard-panel.tsx:209-234`
- Test: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `dashboard-panel.test.tsx` a test asserting the buttons sit in a column container beside the textarea:

```tsx
it("places Save and Clear in a right-hand column beside the textarea", () => {
  renderDashboard(); // existing helper; ensure status section visible
  const save = screen.getByText(/save/i).closest("button")!;
  const clear = screen.getByText(/clear/i).closest("button")!;
  // Both buttons share a vertical (flex-col) container.
  const col = save.parentElement!;
  expect(col).toBe(clear.parentElement);
  expect(col.className).toContain("flex-col");
  // The row wrapping textarea + button column is items-stretch.
  expect(col.parentElement!.className).toContain("items-stretch");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/dashboard-panel.test.tsx`
Expected: FAIL (current layout has buttons in a `justify-between` row below the textarea).

- [ ] **Step 3: Restructure the markup**

Replace the textarea + button block (currently `dashboard-panel.tsx:209-234`) with:

```tsx
<div className="flex items-stretch gap-2">
  <textarea
    className="min-h-24 min-w-0 flex-1 resize-none rounded-md border border-line bg-surface p-2 text-sm"
    placeholder={t(lang, "dashboardNarrativePlaceholder")}
    value={draftNarrative}
    onChange={(e) => setDraftNarrative(e.target.value)}
    onBlur={commitNarrative}
  />
  <div className="flex flex-col gap-2">
    <button
      type="button"
      onClick={commitNarrative}
      disabled={draftNarrative.trim() === (status.narrative ?? "")}
      className="rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
    >
      {t(lang, "dashboardStatusSave")}
    </button>
    <button
      type="button"
      onClick={clearNarrative}
      onMouseDown={(e) => e.preventDefault()}
      disabled={(status.narrative ?? "") === "" && draftNarrative === ""}
      className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
    >
      {t(lang, "dashboardStatusClear")}
    </button>
  </div>
</div>
<p className="mt-1 text-xs text-muted-foreground">
  {status.narrativeUpdatedAt
    ? t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))
    : ""}
</p>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/dashboard-panel.test.tsx` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat: dashboard status Save/Clear beside the textarea (chat layout)"
```

---

## Task 3: RACI legend style (Workstream B3)

**Files:**
- Modify: `src/app/i18n.ts` (`raciLegend`), `src/app/i18n.de.ts` (byte-patch)
- Test: `src/app/raci-panel.test.tsx` (or i18n.test.ts)

- [ ] **Step 1: Write the failing test**

Add to `i18n.test.ts`:

```typescript
it("RACI legend uses the parenthesized-initial style", () => {
  expect(t("en-US", "raciLegend")).toBe(
    "(R)esponsible, (A)ccountable, (C)onsulted, (I)nformed",
  );
  expect(t("de", "raciLegend")).toContain("(R)");
  expect(t("de", "raciLegend")).toContain("(A)");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/i18n.test.ts`
Expected: FAIL (current value is `"R Responsible, A Accountable, C Consulted, I Informed"`).

- [ ] **Step 3: Update the strings**

`i18n.ts`: `raciLegend: "(R)esponsible, (A)ccountable, (C)onsulted, (I)nformed",`
`i18n.de.ts` (byte-patch): `raciLegend: "(R) Verantwortlich, (A) Rechenschaftspflichtig, (C) Konsultiert, (I) Informiert",`

- [ ] **Step 4: Run tests + DE quote check**

Run: `npx vitest run src/app/i18n.test.ts` → PASS
Run: `grep -c '[“”]' src/app/i18n.de.ts` → `0`

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/i18n.test.ts
git commit -m "feat: RACI legend uses (R)esponsible/(A)ccountable parenthesized style"
```

---

## Task 4: Rename "List of Open Points" → "Project Management Tracker" (Workstream B11)

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (byte-patch)
- Test: `src/app/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("uses the Project Management Tracker brand name", () => {
  expect(t("en-US", "appTitle")).toBe("Project Management Tracker");
  expect(t("en-US", "sidebarBrandSubtitle")).toBe("PROJECT MANAGEMENT TRACKER");
  expect(t("de", "appTitle")).toBe("Project Management Tracker");
  expect(t("de", "sidebarBrandSubtitle")).toBe("PROJECT MANAGEMENT TRACKER");
});

it("has no remaining 'List of Open Points' brand strings", () => {
  for (const lang of ["en-US", "en-GB", "de"] as const) {
    expect(t(lang, "appTitle")).not.toMatch(/list of open points/i);
    expect(t(lang, "appSubtitle")).not.toMatch(/list of open points/i);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/i18n.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update strings (EN + DE + any en-GB override)**

- `appTitle` → `"Project Management Tracker"` (both files)
- `sidebarBrandSubtitle` → `"PROJECT MANAGEMENT TRACKER"` (both files)
- `appSubtitle`: replace any "List of Open Points Tracker" mention with "Project Management Tracker" (keep the rest of the sentence). EN line 532 help text and DE equivalent: replace the brand-name occurrences only.
- Grep first to find every occurrence: `grep -rn "List of Open Points" src/app/i18n.ts src/app/i18n.de.ts`. Update each brand-name occurrence; leave `navOpenPoints: "Open Points"` (the tasks-view label) unchanged.
- DE edits via byte-patch.

- [ ] **Step 4: Run tests + checks**

Run: `npx vitest run src/app/i18n.test.ts` → PASS
Run: `grep -rn "List of Open Points" src/app/i18n.ts src/app/i18n.de.ts` → only matches inside non-brand help prose if any remain intentionally (ideally none).
Run: `grep -c '[“”]' src/app/i18n.de.ts` → `0`

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/i18n.test.ts
git commit -m "feat: rename product to Project Management Tracker (EN+DE)"
```

---

## Task 5: Stakeholder row hover = Resources-Workload style (Workstream B5)

**Files:**
- Modify: `src/app/stakeholders-panel.tsx:318-353`
- Test: `src/app/stakeholders-panel.test.tsx`

**Context:** Today the whole `<tr>` is clickable with `cursor-pointer align-top hover:bg-surface-muted`. Resources-Workload instead makes the name a bordered button (`rounded-md border border-transparent px-2 py-0.5 … hover:border-AIPM-dark-blue hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-AIPM-green`) and the row has no hover. Match that: move the open action onto a name button, drop the row-level hover/cursor.

- [ ] **Step 1: Write the failing test**

```tsx
it("opens the editor from a workload-style name button, not a whole-row hover", () => {
  renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
  const btn = screen.getByRole("button", { name: "Dana" });
  expect(btn.className).toContain("hover:border-AIPM-dark-blue");
  expect(btn.className).toContain("hover:bg-surface-muted");
  fireEvent.click(btn);
  expect(screen.getByText(/save/i)).toBeInTheDocument(); // modal opened
  // Row no longer carries the whole-row hover highlight.
  const row = btn.closest("tr")!;
  expect(row.className).not.toContain("hover:bg-surface-muted");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/stakeholders-panel.test.tsx`
Expected: FAIL (name is plain text; row carries the hover).

- [ ] **Step 3: Implement**

Change the row to drop the click/hover and wrap the name in a button:

```tsx
<tr key={item.id} className="align-top">
  <td className="px-3 py-2">
    <button
      type="button"
      onClick={() => openEdit(item)}
      title={item.name}
      className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green"
    >
      {item.name}
    </button>
  </td>
  {/* …remaining cells unchanged… */}
```

Remove `onClick={() => openEdit(item)}` and `cursor-pointer … hover:bg-surface-muted` from the `<tr>`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/stakeholders-panel.test.tsx` → PASS (update any existing test that clicked the row to click the name button).

- [ ] **Step 5: Commit**

```bash
git add src/app/stakeholders-panel.tsx src/app/stakeholders-panel.test.tsx
git commit -m "feat: stakeholder name uses the Resources-Workload hover button"
```

---

## Task 6: Stakeholder dark-mode color scheme (Workstream C6)

**Files:**
- Modify: `src/app/stakeholders-panel.tsx:68-72` (`LEVEL_CHIP`), `src/app/stakeholder-map-panel.tsx` (quadrant `tintClass`)
- Test: `src/app/stakeholders-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("level chips carry dark-mode variants for legibility", () => {
  renderStakeholders({ stakeholders: [sampleStakeholder({ influence: "High", interest: "Medium" })] });
  const high = screen.getByText(t("en-US", "levelHigh")).closest("span")!;
  const med = screen.getByText(t("en-US", "levelMedium")).closest("span")!;
  expect(high.className).toContain("dark:");
  expect(med.className).toContain("dark:");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/stakeholders-panel.test.tsx`
Expected: FAIL (current `LEVEL_CHIP` has no `dark:` variants).

- [ ] **Step 3: Implement**

`stakeholders-panel.tsx`:

```tsx
const LEVEL_CHIP: Record<InfluenceInterest, string> = {
  Low: "bg-AIPM-light-grey/40 text-foreground dark:bg-AIPM-medium-grey/30 dark:text-AIPM-light-grey",
  Medium: "bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/25 dark:text-AIPM-light-grey",
  High: "bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/25 dark:text-AIPM-light-grey",
};
```

`stakeholder-map-panel.tsx` quadrant `tintClass` values gain dark variants:
- keep-satisfied: `"bg-AIPM-green/10 dark:bg-AIPM-green/15"`
- manage-closely: `"bg-AIPM-green/20 dark:bg-AIPM-green/25"`
- monitor: `"bg-surface-muted"` (already theme-aware — leave)
- keep-informed: `"bg-AIPM-light-grey/20 dark:bg-AIPM-medium-grey/25"`

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/stakeholders-panel.test.tsx src/app/stakeholder-map-panel.test.tsx` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/stakeholders-panel.tsx src/app/stakeholder-map-panel.tsx src/app/stakeholders-panel.test.tsx
git commit -m "feat: dark-mode-readable stakeholder level chips + quadrant tints"
```

---

## Task 7: Influence/interest matrix sized like chat (Workstream C4)

**Files:**
- Modify: `src/app/stakeholder-map-panel.tsx` (pane class import + outer `className`)
- Test: `src/app/stakeholder-map-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders the map in the centered half-size pane (chat sizing)", () => {
  const { container } = renderMap({ stakeholders: [] });
  const pane = container.querySelector("[data-testid='stakeholder-map-pane']")!;
  expect(pane.className).toContain("mx-auto"); // centered
  expect(pane.className).toContain("w-[50%]");
});
```

(Add `data-testid="stakeholder-map-pane"` to the outer pane div if not present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/stakeholder-map-panel.test.tsx`
Expected: FAIL (uses `VIEW_PANE_RESIZABLE_CLASS`, not centered).

- [ ] **Step 3: Implement**

In `stakeholder-map-panel.tsx`: replace the import/usage of `VIEW_PANE_RESIZABLE_CLASS` with `CENTERED_HALF_PANE_CLASS` from `./view-styles`, and set the outer pane:

```tsx
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
// …
<div ref={paneRef} data-testid="stakeholder-map-pane" className={CENTERED_HALF_PANE_CLASS}>
```

Keep the rotated axis labels and 2×2 grid. The grid already uses `min-h-0 flex-1`, so it reflows inside the smaller box.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/stakeholder-map-panel.test.tsx` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/stakeholder-map-panel.tsx src/app/stakeholder-map-panel.test.tsx
git commit -m "feat: size the influence/interest matrix like the chat pane"
```

---

## Task 8: `filterMilestones` helper + status classification (Workstream D8 logic)

**Files:**
- Modify: `src/app/milestones.ts`
- Test: `src/app/milestones.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { filterMilestones, type MilestoneFilterStatus } from "./milestones";

const mk = (over: Partial<Milestone> & Pick<Milestone, "id" | "name" | "date">): Milestone =>
  ({ linkedTaskIds: [], ...over });

describe("filterMilestones", () => {
  const today = "2026-06-05";
  const a = mk({ id: 1, name: "Alpha kickoff", date: "2026-06-10" });            // pending, future
  const b = mk({ id: 2, name: "Beta gate", date: "2026-06-01" });                // overdue
  const c = mk({ id: 3, name: "Gamma review", date: "2026-05-01", achievedDate: "2026-05-02" }); // achieved
  const all = [a, b, c];

  it("filters by name query (case-insensitive)", () => {
    expect(filterMilestones(all, { query: "beta", status: "all", today }).map((m) => m.id)).toEqual([2]);
  });
  it("status=pending excludes achieved and overdue-unachieved? (pending = unachieved & not overdue)", () => {
    expect(filterMilestones(all, { query: "", status: "pending", today }).map((m) => m.id)).toEqual([1]);
  });
  it("status=overdue = unachieved with date < today", () => {
    expect(filterMilestones(all, { query: "", status: "overdue", today }).map((m) => m.id)).toEqual([2]);
  });
  it("status=achieved = has achievedDate", () => {
    expect(filterMilestones(all, { query: "", status: "achieved", today }).map((m) => m.id)).toEqual([3]);
  });
  it("status=all returns everything", () => {
    expect(filterMilestones(all, { query: "", status: "all", today }).map((m) => m.id).sort()).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/milestones.test.ts`
Expected: FAIL (`filterMilestones` not exported).

- [ ] **Step 3: Implement in `milestones.ts`**

```typescript
export type MilestoneFilterStatus = "all" | "pending" | "achieved" | "overdue";

export function filterMilestones(
  milestones: readonly Milestone[],
  opts: { query: string; status: MilestoneFilterStatus; today: string },
): Milestone[] {
  const q = opts.query.trim().toLowerCase();
  return milestones.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false;
    const achieved = !!m.achievedDate;
    const overdue = !achieved && m.date < opts.today;
    switch (opts.status) {
      case "achieved": return achieved;
      case "overdue": return overdue;
      case "pending": return !achieved && !overdue;
      case "all": default: return true;
    }
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/milestones.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/milestones.ts src/app/milestones.test.ts
git commit -m "feat: filterMilestones helper (name search + status filter)"
```

---

## Task 9: Milestones panel upgrade — resize, filter, hover, button (Workstream D)

**Files:**
- Modify: `src/app/milestones-panel.tsx`
- Test: `src/app/milestones-panel.test.tsx`

**Pattern source:** mirror `stakeholders-panel.tsx` for `useColumnResize` + `ColumnResizeHandle` + toolbar (Add button BEFORE search) + `ResetColWidthsButton`/`ResetSizeButton`. Keep using `ReportCard` is optional — switching to the `stakeholders-panel`-style raw pane (`VIEW_PANE_RESIZABLE_CLASS` + `useResizable`) gives column resize + reset buttons consistently. Use the `VIEW_PANE_RESIZABLE_CLASS` pane to retain print support, OR keep `ReportCard` and pass `onResetCols`. **Chosen approach:** keep `ReportCard` (it already provides print + reset-size + `onResetCols` slot) and add column resize inside it.

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders the New milestone button at the left, styled like Gantt (solid dark-blue)", () => {
  renderMilestones({ milestones: [] });
  const btn = screen.getByRole("button", { name: /new milestone/i });
  expect(btn.className).toContain("bg-AIPM-dark-blue");
  expect(btn.className).toContain("text-white");
});

it("filters milestones by name search", () => {
  renderMilestones({ milestones: [m("Alpha", "2026-06-10"), m("Beta", "2026-06-11")] });
  fireEvent.change(screen.getByPlaceholderText(t("en-US", "milestonesFilterName")), { target: { value: "alpha" } });
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.queryByText("Beta")).not.toBeInTheDocument();
});

it("filters milestones by status", () => {
  renderMilestones({
    today: "2026-06-05",
    milestones: [m("Future", "2026-06-10"), m("Late", "2026-06-01")],
  });
  fireEvent.change(screen.getByLabelText(t("en-US", "milestonesFilterStatus")), { target: { value: "overdue" } });
  expect(screen.getByText("Late")).toBeInTheDocument();
  expect(screen.queryByText("Future")).not.toBeInTheDocument();
});

it("name button uses the workload hover style", () => {
  renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
  const btn = screen.getByRole("button", { name: "Alpha" });
  expect(btn.className).toContain("hover:border-AIPM-dark-blue");
});

it("renders resizable column headers", () => {
  const { container } = renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
  expect(container.querySelectorAll("[data-resize-handle]").length).toBeGreaterThan(0);
});
```

(Confirm `ColumnResizeHandle` renders an element with a stable selector; if it uses a different attribute, assert on its role/class instead. Read `task-manager-ui.tsx` `ColumnResizeHandle` first.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/milestones-panel.test.tsx`
Expected: FAIL (no filter inputs, button styled outline + on the right, no resize handles).

- [ ] **Step 3: Implement**

In `milestones-panel.tsx`:
1. Add state: `const [search, setSearch] = useState("");` and `const [statusFilter, setStatusFilter] = useState<MilestoneFilterStatus>("all");`.
2. Add `const MILESTONE_COL_WIDTHS = { name: 220, date: 130, status: 140, achieved: 130 } as const;` + `type MilestoneCol = keyof typeof MILESTONE_COL_WIDTHS;` and `const { colWidths, startColResize, resetColWidths } = useColumnResize<MilestoneCol>("milestone", MILESTONE_COL_WIDTHS);`.
3. Apply the filter BEFORE sort: `const filtered = filterMilestones(milestones, { query: search, status: statusFilter, today });` then feed `sortMilestones(filtered)` into `useSortableFilter`.
4. Pass `onResetCols={resetColWidths}` to `ReportCard`.
5. Move the Add button to be the FIRST child of `toolbarExtra` (left of the filters), restyled:

```tsx
toolbarExtra={
  <>
    <button
      type="button"
      onClick={openNew}
      className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
    >
      + {t(lang, "milestoneNew")}
    </button>
    <input
      type="search"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder={t(lang, "milestonesFilterName")}
      aria-label={t(lang, "milestonesFilterName")}
      className="min-w-[10rem] rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
    />
    <select
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value as MilestoneFilterStatus)}
      aria-label={t(lang, "milestonesFilterStatus")}
      className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
    >
      <option value="all">{t(lang, "milestonesFilterAll")}</option>
      <option value="pending">{t(lang, "milestonesFilterPending")}</option>
      <option value="achieved">{t(lang, "milestonesFilterAchieved")}</option>
      <option value="overdue">{t(lang, "milestonesFilterOverdue")}</option>
    </select>
  </>
}
```

6. Add resizable `<th>` widths + `ColumnResizeHandle` per the stakeholders pattern (each `<th>` gets `className="relative …"`, `style={{ width: colWidths.X, minWidth: colWidths.X }}`, and `<ColumnResizeHandle col="X" onMouseDown={startResize} />`). Define `const startResize = startColResize as (col: string, e: React.MouseEvent) => void;`.
7. Convert the name cell to the workload-style button:

```tsx
<td className="py-1" style={{ width: colWidths.name }}>
  <button
    type="button"
    onClick={() => { setIsNew(false); setEditing(m); }}
    title={m.name}
    className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green"
  >
    {m.name}
  </button>
</td>
```

Add the new i18n keys (Task 16 finalizes DE, but add EN now so tests pass): `milestonesFilterName`, `milestonesFilterStatus`, `milestonesFilterAll`, `milestonesFilterPending`, `milestonesFilterAchieved`, `milestonesFilterOverdue`. Add to both `i18n.ts` and `i18n.de.ts` (byte-patch) in this task to keep the build green.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/milestones-panel.test.tsx src/app/milestones.test.ts` → PASS
Run: `npx tsc --noEmit` (ignore the routes.d.ts error) → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/milestones-panel.tsx src/app/milestones-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: milestones table — resizable cols, name+status filters, left Gantt-style add, workload hover"
```

---

## Task 10: Sidebar mode indicator pill (Workstream E)

**Files:**
- Modify: `src/app/sidebar.tsx` (footer), `src/app/task-manager.tsx` (pass `mode` or `features` to `Sidebar`)
- Test: `src/app/sidebar.test.tsx`

**Context:** `deriveMode(features)` lives in `feature-modules.ts`; mode labels are `modeSimple`/`modeModular`/`modeAdvanced`. The sidebar footer currently renders the version button (`sidebar.tsx:56-67`). Add a pill above it. Read `sidebar.tsx` props to see whether `settings`/`features` is already in scope; if not, thread a `mode: AppMode` prop from `task-manager.tsx` (compute `deriveMode(settings.features)` once, already memoized there as part of the feature plumbing).

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the current mode pill in the sidebar footer when expanded", () => {
  renderSidebar({ mode: "modular", collapsed: false });
  expect(screen.getByTestId("sidebar-mode-badge")).toHaveTextContent(t("en-US", "modeModular"));
});
it("hides the mode pill when collapsed to the icon rail", () => {
  renderSidebar({ mode: "advanced", collapsed: true });
  expect(screen.queryByTestId("sidebar-mode-badge")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/sidebar.test.tsx`
Expected: FAIL (no mode badge; `mode` prop unknown).

- [ ] **Step 3: Implement**

Add `mode: AppMode` to `Sidebar` props (import `type AppMode`, and `MODE_LABEL_KEY`-equivalent map — define locally to avoid importing from a settings section):

```tsx
const SIDEBAR_MODE_LABEL: Record<AppMode, "modeSimple" | "modeModular" | "modeAdvanced"> = {
  simple: "modeSimple", modular: "modeModular", advanced: "modeAdvanced",
};
```

In the footer block, above the version button, when `!collapsed`:

```tsx
{!collapsed && (
  <span
    data-testid="sidebar-mode-badge"
    className="mb-2 inline-block rounded-full bg-AIPM-green/15 px-2.5 py-0.5 text-[11px] font-semibold text-AIPM-light-grey"
  >
    {t(lang, SIDEBAR_MODE_LABEL[mode])}
  </span>
)}
```

In `task-manager.tsx`, pass `mode={deriveMode(settings.features)}` (or reuse an existing memoized mode value) to `<Sidebar … />` (the Sidebar is rendered inside `ModernShell` via the `sidebar` slot — locate the `<Sidebar` usage; if Sidebar is constructed inside `modern-shell.tsx`, thread the prop through `ModernShell` like `navGroups` was threaded).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/sidebar.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/sidebar.tsx src/app/modern-shell.tsx src/app/task-manager.tsx src/app/sidebar.test.tsx
git commit -m "feat: show current app mode pill next to sidebar version info"
```

---

## Task 11: `stakeholderIds` field on RaidItem + ChangeItem — model + serializers (Workstream F-data)

**Files:**
- Modify: `src/app/types.ts:146-177` (RaidItem), `:206-224` (ChangeItem); `src/app/storage.ts` (parse/serialize for raid + changes); any CSV/Markdown/Turso serializer that lists raid/change fields; sanitizers.
- Test: `src/app/storage.ts` round-trip tests (find the existing raid/change round-trip test file), new assertions.

**Pattern source:** `ChangeItem.linkedRaidIds: number[]` is already a `number[]` round-tripped by every serializer — copy its exact handling for `stakeholderIds` on BOTH entities. `RaidItem.causedByRaidIds: number[]` is the equivalent on RAID.

- [ ] **Step 1: Write the failing round-trip test**

In the existing storage round-trip test (grep: `grep -rln "linkedRaidIds" src/app/*.test.ts`), add:

```typescript
it("round-trips RaidItem.stakeholderIds and ChangeItem.stakeholderIds", () => {
  const raid: RaidItem = { /* minimal valid */ stakeholderIds: [3, 7], /* … */ } as RaidItem;
  const change: ChangeItem = { /* minimal valid */ stakeholderIds: [3], /* … */ } as ChangeItem;
  const ws = makeWorkspace({ raid: [raid], changes: [change] });
  const restored = parseWorkspace(serializeWorkspace(ws)); // use the real fns
  expect(restored.raid[0].stakeholderIds).toEqual([3, 7]);
  expect(restored.changes[0].stakeholderIds).toEqual([3]);
});

it("defaults missing stakeholderIds to []", () => {
  // legacy data without the field parses to []
  const restored = parseWorkspace(legacyFixtureWithoutStakeholderIds);
  expect(restored.raid[0].stakeholderIds).toEqual([]);
});
```

(Use whatever serialize/parse entry points the existing tests use — CSV, Markdown, JSON, and Turso each have their own; add the assertion to each format's existing round-trip test for parity with `linkedRaidIds`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/storage.test.ts` (and the format-specific tests)
Expected: FAIL (field absent / undefined).

- [ ] **Step 3: Implement**

1. `types.ts`: add to `RaidItem` and `ChangeItem`:

```typescript
  /** Stakeholders explicitly associated with this item (FK -> Stakeholder.id).
   *  Drives the communication-reminder engine. Always an array; defaults to []. */
  stakeholderIds: number[];
```

(Make it required-with-default in the type to match `linkedRaidIds`/`causedByRaidIds` convention; sanitizers fill `[]`.)

2. In each serializer (mirror `linkedRaidIds`/`causedByRaidIds` exactly):
   - **JSON/storage.ts**: include `stakeholderIds` in the object; on parse, `sanitizeIdArray(raw.stakeholderIds)` → number[] (reuse the existing id-array sanitizer used for `linkedRaidIds`; grep its name).
   - **CSV**: add a column (semicolon/pipe-joined ids like the other id arrays — copy the `linkedRaidIds` column encoder/decoder).
   - **Markdown**: add to the raid/change row serializer the same way `linkedRaidIds` is emitted/parsed (escape with `\|` if it shares a table cell — see [[stakeholder-ui-batch-asimov]] mdEscape rule).
   - **Turso**: store as the same JSON-encoded text column pattern used for `linkedRaidIds`/`causedByRaidIds`. **Do NOT** add a new table; it's a column on the existing raid/change rows. If Turso has a `SCHEMA_VERSION`, bump it (and the storage.ts one) per the [[stakeholders-raci-deeplink]] gotcha.

3. Sanitizer: orphan ids (deleted stakeholder) are filtered at render time in the engine (Task 13), not on parse — parse keeps raw valid integers.

- [ ] **Step 4: Run tests**

Run: `npm run test:run` (serializer guard tests + round-trips) → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/types.ts src/app/storage.ts src/app/*.test.ts # + CSV/MD/Turso serializer files touched
git commit -m "feat: add stakeholderIds to RaidItem and ChangeItem (all serializers)"
```

---

## Task 12: Stakeholder multi-select in RAID + Change editors (Workstream F-data UI)

**Files:**
- Modify: `src/app/raid-panel.tsx` (inline RAID editor), `src/app/change-edit-modal.tsx`
- Test: `src/app/raid-panel.test.tsx`, `src/app/change-edit-modal.test.tsx`

**Context:** RAID is edited inline in `raid-panel.tsx` (no separate modal). Changes use `change-edit-modal.tsx`. Both need a stakeholder picker that writes `stakeholderIds`. The control is shown only when the stakeholders module is enabled — thread a `stakeholdersEnabled: boolean` prop (default `true`) and the `stakeholders` list into each editor.

- [ ] **Step 1: Write the failing tests**

```tsx
// change-edit-modal.test.tsx
it("edits linked stakeholders when stakeholders module is enabled", () => {
  const onChange = vi.fn();
  renderModal({ stakeholdersEnabled: true, stakeholders: [s(3, "Dana"), s(7, "Lee")], draft: change({ stakeholderIds: [] }), onChange });
  fireEvent.click(screen.getByLabelText("Dana"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stakeholderIds: [3] }));
});
it("hides the stakeholder picker when the module is disabled", () => {
  renderModal({ stakeholdersEnabled: false, stakeholders: [s(3, "Dana")], draft: change({ stakeholderIds: [] }) });
  expect(screen.queryByText(t("en-US", "fieldStakeholders"))).not.toBeInTheDocument();
});
```

(Analogous test for the RAID editor in `raid-panel.test.tsx`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/change-edit-modal.test.tsx src/app/raid-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a checkbox/multi-select group (reuse the existing linked-items multi-select pattern already in `change-edit-modal.tsx` for `linkedRaidIds`/`linkedTaskIds`). Field label key `fieldStakeholders` (add to i18n EN+DE). Render only when `stakeholdersEnabled`. On toggle, immutably update `draft.stakeholderIds`. Thread `stakeholders` + `stakeholdersEnabled` from the parents: `change-panel.tsx` (already has `raidEnabled` threading — add `stakeholdersEnabled` + `stakeholders`) and `raid-panel.tsx`'s host in `workspace-section.tsx`/`task-manager.tsx`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/change-edit-modal.test.tsx src/app/raid-panel.test.tsx` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-panel.tsx src/app/change-edit-modal.tsx src/app/change-panel.tsx src/app/workspace-section.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/*.test.tsx
git commit -m "feat: link stakeholders from RAID + Change editors (mode-gated)"
```

---

## Task 13: `stakeholder-comms.ts` engine (Workstream F-engine)

**Files:**
- Create: `src/app/stakeholder-comms.ts`, `src/app/stakeholder-comms.test.ts`

**Context:** `quadrantFor({influence, interest})` → `"manage-closely" | "keep-satisfied" | "keep-informed" | "monitor"` (in `stakeholders.ts`). RAID terminal statuses: there is a FLAT terminal set used by raid-review (see [[raid-review-and-ui-batch]]) — reuse/import it; do NOT use the category-aware `isTerminalStatus`. Change pending set = `["Proposed", "Under Review"]`. RAID severity order: import the existing severity rank helper (grep `severityRank`/`RAID_SEVERITY`); thresholds compare `>=`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { getStakeholderCommsItems } from "./stakeholder-comms";

const today = "2026-06-05";
const base = { milestones: [], raid: [], changes: [],
  flags: { stakeholdersEnabled: true, milestonesEnabled: true, raidEnabled: true, changesEnabled: true } };

it("returns nothing when stakeholders module is disabled", () => {
  const sh = [stake({ id: 1, influence: "High", interest: "High", raci: { "10": "A" } })];
  const ms = [milestone({ id: 10, date: "2026-06-06" })]; // due-soon
  expect(getStakeholderCommsItems({ ...base, stakeholders: sh, milestones: ms, today,
    flags: { ...base.flags, stakeholdersEnabled: false } })).toEqual([]);
});

it("manage-closely stakeholder is reminded about a due-soon RACI milestone", () => {
  const sh = [stake({ id: 1, name: "Dana", influence: "High", interest: "High", raci: { "10": "A" } })];
  const ms = [milestone({ id: 10, name: "Gate", date: "2026-06-12" })]; // within 14d lead
  const out = getStakeholderCommsItems({ ...base, stakeholders: sh, milestones: ms, today });
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ stakeholderId: 1, itemKind: "milestone", itemId: 10, quadrant: "manage-closely" });
});

it("monitor stakeholder is only reminded about OVERDUE milestones, not upcoming", () => {
  const sh = [stake({ id: 2, influence: "Low", interest: "Low", raci: { "10": "I" } })];
  const upcoming = [milestone({ id: 10, date: "2026-06-06" })];
  const overdue = [milestone({ id: 10, date: "2026-06-01" })];
  expect(getStakeholderCommsItems({ ...base, stakeholders: sh, milestones: upcoming, today })).toHaveLength(0);
  expect(getStakeholderCommsItems({ ...base, stakeholders: sh, milestones: overdue, today })).toHaveLength(1);
});

it("keep-satisfied requires High RAID severity; keep-informed gets no RAID at all", () => {
  const ks = stake({ id: 3, influence: "High", interest: "Low" });   // keep-satisfied
  const ki = stake({ id: 4, influence: "Low", interest: "High" });   // keep-informed
  const med = raidItem({ id: 20, status: "Open", severity: "Medium", stakeholderIds: [3, 4] });
  const high = raidItem({ id: 21, status: "Open", severity: "High", stakeholderIds: [3, 4] });
  const out = getStakeholderCommsItems({ ...base, stakeholders: [ks, ki], raid: [med, high], today });
  // keep-satisfied: only the High one. keep-informed: none (raid not in its sources).
  expect(out.filter((r) => r.stakeholderId === 3).map((r) => r.itemId)).toEqual([21]);
  expect(out.filter((r) => r.stakeholderId === 4)).toHaveLength(0);
});

it("a pending decision reminds linked stakeholders in raid/change-source quadrants", () => {
  const mc = stake({ id: 5, influence: "High", interest: "High" });
  const ch = change({ id: 30, status: "Under Review", stakeholderIds: [5] });
  const out = getStakeholderCommsItems({ ...base, stakeholders: [mc], changes: [ch], today });
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ itemKind: "change", itemId: 30 });
});

it("a source is suppressed when its module flag is off", () => {
  const mc = stake({ id: 5, influence: "High", interest: "High", raci: { "10": "A" } });
  const ms = [milestone({ id: 10, date: "2026-06-12" })];
  expect(getStakeholderCommsItems({ ...base, stakeholders: [mc], milestones: ms, today,
    flags: { ...base.flags, milestonesEnabled: false } })).toHaveLength(0);
});

it("filters orphan stakeholderIds (deleted stakeholder) safely", () => {
  const ch = change({ id: 30, status: "Proposed", stakeholderIds: [999] }); // no such stakeholder
  expect(getStakeholderCommsItems({ ...base, stakeholders: [], changes: [ch], today })).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/stakeholder-comms.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `stakeholder-comms.ts`**

```typescript
import { quadrantFor, type StakeholderQuadrant } from "./stakeholders";
import type { ChangeItem, Milestone, RaidItem, RaidSeverity, Stakeholder } from "./types";

export type CommsSource = "milestone" | "raid" | "change";

export interface StakeholderCommsReminder {
  stakeholderId: number;
  stakeholderName: string;
  quadrant: StakeholderQuadrant;
  itemKind: CommsSource;
  itemId: number;
  itemTitle: string;
  reasonKey: "commsReasonMilestoneDue" | "commsReasonMilestoneOverdue" | "commsReasonRaidActive" | "commsReasonDecisionPending";
  priority: number; // higher = more urgent (sorted desc by caller)
}

export interface CommsFlags {
  stakeholdersEnabled: boolean;
  milestonesEnabled: boolean;
  raidEnabled: boolean;
  changesEnabled: boolean;
}

interface QuadrantPolicy {
  leadDays: number;
  sources: readonly CommsSource[];
  minRaidSeverity?: RaidSeverity;
  milestonesOverdueOnly?: boolean;
  priority: number;
}

const POLICY: Record<StakeholderQuadrant, QuadrantPolicy> = {
  "manage-closely": { leadDays: 14, sources: ["milestone", "raid", "change"], minRaidSeverity: "Medium", priority: 4 },
  "keep-satisfied": { leadDays: 7, sources: ["milestone", "raid", "change"], minRaidSeverity: "High", priority: 3 },
  "keep-informed": { leadDays: 7, sources: ["milestone", "change"], priority: 2 },
  monitor: { leadDays: 3, sources: ["milestone"], milestonesOverdueOnly: true, priority: 1 },
};

const SEVERITY_RANK: Record<RaidSeverity, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
// RAID statuses that mean "no longer active" — FLAT set (NOT category-aware). Keep in sync with raid-review.
const RAID_TERMINAL = new Set(["Closed", "Resolved", "Realized", "Delivered", "Validated", "Invalidated"]);
const CHANGE_PENDING = new Set(["Proposed", "Under Review"]);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getStakeholderCommsItems(args: {
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  today: string;
  flags: CommsFlags;
}): StakeholderCommsReminder[] {
  const { stakeholders, milestones, raid, changes, today, flags } = args;
  if (!flags.stakeholdersEnabled || stakeholders.length === 0) return [];

  const byId = new Map(stakeholders.map((s) => [s.id, s] as const));
  const out: StakeholderCommsReminder[] = [];

  for (const s of stakeholders) {
    const quad = quadrantFor(s);
    const policy = POLICY[quad];

    // --- Milestones (via RACI) ---
    if (flags.milestonesEnabled && policy.sources.includes("milestone")) {
      const horizon = addDays(today, policy.leadDays);
      for (const m of milestones) {
        if (!s.raci[String(m.id)]) continue;
        if (m.achievedDate) continue;
        const overdue = m.date < today;
        const upcoming = !overdue && m.date <= horizon;
        if (policy.milestonesOverdueOnly ? !overdue : !(overdue || upcoming)) continue;
        out.push({
          stakeholderId: s.id, stakeholderName: s.name, quadrant: quad,
          itemKind: "milestone", itemId: m.id, itemTitle: m.name,
          reasonKey: overdue ? "commsReasonMilestoneOverdue" : "commsReasonMilestoneDue",
          priority: policy.priority,
        });
      }
    }

    // --- RAID (explicit links) ---
    if (flags.raidEnabled && policy.sources.includes("raid")) {
      const min = policy.minRaidSeverity ? SEVERITY_RANK[policy.minRaidSeverity] : 0;
      for (const r of raid) {
        if (!r.stakeholderIds?.includes(s.id)) continue;
        if (RAID_TERMINAL.has(r.status)) continue;
        const sevOk = r.severity ? SEVERITY_RANK[r.severity] >= min : false;
        const overdue = r.targetDate != null && r.targetDate < today;
        if (!sevOk && !overdue) continue;
        out.push({
          stakeholderId: s.id, stakeholderName: s.name, quadrant: quad,
          itemKind: "raid", itemId: r.id, itemTitle: r.title,
          reasonKey: "commsReasonRaidActive", priority: policy.priority,
        });
      }
    }

    // --- Changes / decisions (explicit links) ---
    if (flags.changesEnabled && policy.sources.includes("change")) {
      for (const c of changes) {
        if (!c.stakeholderIds?.includes(s.id)) continue;
        if (!CHANGE_PENDING.has(c.status)) continue;
        out.push({
          stakeholderId: s.id, stakeholderName: s.name, quadrant: quad,
          itemKind: "change", itemId: c.id, itemTitle: c.title,
          reasonKey: "commsReasonDecisionPending", priority: policy.priority,
        });
      }
    }
  }

  // Orphan guard is implicit: we only iterate real stakeholders, so an item's
  // orphan id simply never matches. Sort most-urgent first, stable by name.
  void byId;
  return out.sort((a, b) => b.priority - a.priority || a.stakeholderName.localeCompare(b.stakeholderName));
}
```

(Before coding, confirm `RaidSeverity` members are exactly `Low|Medium|High|Critical` in `types.ts`; adjust `SEVERITY_RANK` to the real union. Confirm the flat RAID terminal set against `raid-review.ts` and import it from there if exported, to stay DRY.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/stakeholder-comms.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/stakeholder-comms.ts src/app/stakeholder-comms.test.ts
git commit -m "feat: stakeholder communication reminder engine (quadrant policy)"
```

---

## Task 14: Comms hook + notification surfaces + snooze + settings (Workstream F-surfaces)

**Files:**
- Create: `src/app/use-stakeholder-comms.ts`, `src/app/use-stakeholder-comms.test.tsx`
- Modify: `src/app/reminder-snooze.ts` (add `"stakeholderComms"` kind), `src/app/settings-types.ts` (`stakeholderComms: ChannelConfig` + default), the Settings → Notifications section component, `src/app/notifications.tsx` (toast text + banner/modal content)
- Test: as above + the settings-section test

- [ ] **Step 1: Write the failing hook test**

```tsx
import { renderHook } from "@testing-library/react";
import { useStakeholderComms } from "./use-stakeholder-comms";

it("fires a toast once when there are comms reminders and not snoozed", () => {
  const showToast = vi.fn();
  renderHook(() => useStakeholderComms({
    hydrated: true, today: "2026-06-05", showToast,
    stakeholders: [stake({ id: 1, influence: "High", interest: "High", raci: { "10": "A" } })],
    milestones: [milestone({ id: 10, date: "2026-06-12" })], raid: [], changes: [],
    settings: settingsWith({ notifications: { stakeholderComms: { enabled: true }, toast: { enabled: true } } }),
    flags: { stakeholdersEnabled: true, milestonesEnabled: true, raidEnabled: true, changesEnabled: true },
  }));
  expect(showToast).toHaveBeenCalledTimes(1);
});

it("does not fire when stakeholderComms channel is disabled", () => {
  const showToast = vi.fn();
  renderHook(() => useStakeholderComms({ /* same but */ settings: settingsWith({ notifications: { stakeholderComms: { enabled: false } } }), /* … */ }));
  expect(showToast).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/use-stakeholder-comms.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

1. `reminder-snooze.ts`: `export type ReminderKind = "due" | "birthday" | "jiraToken" | "raidReview" | "stakeholderComms";`
2. `settings-types.ts`: add `stakeholderComms: ChannelConfig;` to `NotificationsConfig` and `stakeholderComms: { enabled: true }` to `defaultNotificationsConfig`. Update the settings parser/sanitizer to default it (grep where `raidReview` is sanitized and mirror).
3. `use-stakeholder-comms.ts`: mirror `use-due-alerts.ts` structure (refs, once-per-session ref, snooze check on `"stakeholderComms"`). Compute reminders via `getStakeholderCommsItems(...)`; if `cfg.stakeholderComms.enabled && cfg.toast.enabled && !snoozed && items.length` → `showToast("info", stakeholderCommsToastText(items, lang))`; expose `{ bannerDismissed, setBannerDismissed, reviewModalOpen, setReviewModalOpen, items }`.
4. `notifications.tsx`: add `stakeholderCommsToastText(items, lang)` (e.g. "{n} stakeholders need an update") and a banner + a review modal listing each `{stakeholderName} · {itemTitle} · reason}` with snooze buttons (1h/1d) calling `setSnoozedUntil("stakeholderComms", Date.now() + SNOOZE_1H|1D)`. Mirror the existing RAID-review banner/modal.
5. Settings → Notifications: add a toggle row for `stakeholderComms` (mirror the `raidReview` toggle row), i18n key `notifStakeholderComms`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/use-stakeholder-comms.test.tsx src/app/reminder-snooze.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/use-stakeholder-comms.ts src/app/use-stakeholder-comms.test.tsx src/app/reminder-snooze.ts src/app/settings-types.ts src/app/notifications.tsx src/app/settings-sections/*.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: stakeholder comms reminders — hook, banner/toast/modal, snooze, settings toggle"
```

---

## Task 15: Wire comms into task-manager with mode flags (Workstream F-wire)

**Files:**
- Modify: `src/app/task-manager.tsx` (instantiate the hook, pass mode flags, render banner/modal in the existing banner + modal slots)
- Test: `src/app/task-manager.test.tsx` (or an integration test) — assert the banner appears only when stakeholders enabled

**Context:** `task-manager.tsx` already derives `raidEnabled`/`changesEnabled` consts and threads banners via the `bannersEl`/ModernShell `banners` slot + classic AppHeader. Add `stakeholdersEnabled` + `milestonesEnabled` consts (via `isModuleEnabled("stakeholders"/"milestones", settings.features)`).

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the stakeholder comms banner only when the stakeholders module is enabled", () => {
  const feats = ALL_MODULE_IDS; // advanced
  renderApp({ features: feats, stakeholders: [/* one that triggers */], milestones: [/* due-soon RACI */] });
  expect(screen.getByTestId("stakeholder-comms-banner")).toBeInTheDocument();

  renderApp({ features: feats.filter((f) => f !== "stakeholders"), /* same data */ });
  expect(screen.queryByTestId("stakeholder-comms-banner")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-manager.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `task-manager.tsx`:
```tsx
const stakeholdersEnabled = isModuleEnabled("stakeholders", settings.features);
const milestonesEnabled = isModuleEnabled("milestones", settings.features);
// raidEnabled, changesEnabled already exist
const comms = useStakeholderComms({
  hydrated, today, showToast,
  stakeholders, milestones, raid, changes,
  settings,
  flags: { stakeholdersEnabled, milestonesEnabled, raidEnabled, changesEnabled },
});
```
Render `<StakeholderCommsBanner …>` (data-testid `stakeholder-comms-banner`) inside the shared `bannersEl` next to the due/RAID banners, gated by `stakeholdersEnabled && comms.items.length > 0 && !comms.bannerDismissed`. Render the review modal alongside the existing modals.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/task-manager.test.tsx` → PASS
Run: `npm run test:run` → green
Run: `npm run lint` → clean
Run: `npx tsc --noEmit` → clean (ignore routes.d.ts)

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx src/app/task-manager.test.tsx
git commit -m "feat: wire stakeholder comms reminders into the app (mode-gated)"
```

---

## Task 16: Release v0.55.0 "Clarke" (Workstream G)

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`, finalize any missing DE i18n keys.
- Test: `src/app/version.test.ts` (if present)

- [ ] **Step 1: Update version + highlight**

`version.ts`: `APP_VERSION = "0.55.0"`, `APP_MILESTONE = "Clarke"`, add `versionHighlightClarke` to `APP_HIGHLIGHT_KEYS` + a narrative comment. `package.json`: `"version": "0.55.0"`.

- [ ] **Step 2: Add i18n highlight + verify all new keys exist EN+DE**

Add `versionHighlightClarke` (EN+DE) and confirm every key added in Tasks 3,4,9,12,14 exists in BOTH `i18n.ts` and `i18n.de.ts`. Run: `npx vitest run src/app/i18n.test.ts` (the key-parity guard) → PASS.

- [ ] **Step 3: CHANGELOG + codemap**

Add a `## 0.55.0 "Clarke"` entry summarizing the 13 items. Note the new `stakeholder-comms.ts` / `use-stakeholder-comms.ts` modules and the `stakeholderIds` field in `docs/CODEMAPS/frontend.md`.

- [ ] **Step 4: Full verification**

Run: `npm run test:run` → all green
Run: `npm run lint` → clean
Run: `npx tsc --noEmit` → clean (ignore routes.d.ts)
Run: `grep -c '[“”]' src/app/i18n.de.ts` → `0`

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md docs/CODEMAPS/frontend.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m 'chore: release 0.55.0 "Clarke" — UI batch + stakeholder comms reminders'
```

---

## Final review (after all tasks)
Dispatch a holistic code reviewer over the whole branch diff. Specifically check the leak-surface checklist from [[simple-modular-advanced-mode]]: comms reminders must be fully silent when `stakeholders` is off, and each source silent when its module is off; the RAID/Change stakeholder pickers hidden when stakeholders off; no off-palette colors; DE bundle has 0 curly-quote delimiters and 0 mojibake.

Then use **superpowers:finishing-a-development-branch** → push + GitLab MR → merge on green.
