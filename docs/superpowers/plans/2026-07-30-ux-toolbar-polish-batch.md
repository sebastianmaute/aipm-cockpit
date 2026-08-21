# UX toolbar-polish batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 19 UI corrections across toolbars, settings, the Open Points table and the task editor, plus one new AI feature ("Suggest RACI").

**Architecture:** Mostly edits to existing presentational surfaces, ordered shared-primitives-first so ripple changes land before their consumers. The one new feature clones the existing `useAllocPlan` plan-then-apply shape: pure engine → one forced tool call → grounding against live data → preview modal → confirm.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, vitest + Testing Library, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-07-30-ux-toolbar-polish-batch-design.md`

---

## Read before starting

- `AGENTS.md` — the whole file. Non-negotiable constraints live there.
- Lint runs `--max-warnings=0`. An unused import, variable or parameter is **fatal**. Several tasks delete UI; each leaves dead props/imports/i18n keys that must go in the same commit.
- `npx tsc --noEmit` after **any** test edit. `next build` does not typecheck test files and vitest never typechecks.
- `i18n.ts` and `i18n.de.ts` key sets must be identical (tsc enforces).
- **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Patch it with a node utf8 write (shown in Task 1), then grep-verify.
- `react-hooks/set-state-in-effect` is banned and fatal.
- Only sanctioned AIPM palette tokens. No gradients, no raw shadows.
- **No hand-rolled controls.** Where this plan shows a raw `<button …className="…">`, it is
  wrong — use the design-system primitive and treat the classes shown as a description of the
  intended look, not as markup to paste:
  - text + icon toolbar button → `<Button variant="secondary" size="xs" className="inline-flex items-center gap-1">`
  - filled `+ Add X` toolbar CTA → `<AddButton>` (= `Button variant="primary" size="xs"`)
  - icon-only toolbar utility → `<IconButton variant="bordered" size="md" label={…}>`
  - on/off control → `<ToggleButton pressed onToggle icon>`
  Two exceptions, both deliberate: a `role="menuitem"` inside a `PopoverPanel` matches its
  sibling menu items (`Button` has no menu-item shape), and throwaway `<button>`s inside a test
  harness are not product UI.
  ★ Primitives concatenate `className` with NO tailwind-merge, so a class that fights a
  variant PROP loses by CSS source order. Only LAYOUT may ride `className` (`inline-flex`,
  `shrink-0`, `w-full`, margins). If a site's bespoke colour cannot be expressed by a variant,
  drop the bespoke colour and say so in your report — do not try to override it.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/app/i18n.ts`, `i18n.de.ts` | all new strings, added once | 1 |
| `src/app/task-manager-ui.tsx` | `PrintButton` icon-only; `Th` padding variant | 2, 13 |
| `src/app/calendar-sync-controls.tsx` | push/pull icons, short labels, busy-name fix, tooltip | 3 |
| `src/app/tasks-section.tsx` | its own push/pull pair, tooltip, two toggles, toolbar order | 4, 15, 16 |
| `src/app/milestones-panel.tsx` | manual push/pull icons + labels | 4 |
| `src/app/settings-sections/integrations-section.tsx` | enable-checkbox tooltip | 4 |
| `src/app/resource-directory.tsx` | pull-contacts + hide-external icons | 5 |
| `src/app/resources-panel.tsx` | hide-external toggle, add-meeting placement | 6, 7 |
| `src/app/resources-panel-toolbar.tsx` | add-meeting slot, AI-plan position | 7, 8 |
| `src/app/knowledge-panel.tsx` | toolbar hoisted, right-aligned, in both branches | 9 |
| `src/app/timelog-apply-confirm.tsx` | row-count cap | 10 |
| `src/app/theme-gallery.tsx` | two-up cards, no Apply/Active | 11 |
| `src/app/settings-sections/general-section.tsx` | Project block removed | 12 |
| `src/app/task-row.tsx` | `Td` padding variant, Edit into ⋮ | 13, 14 |
| `src/app/use-column-manager.ts` | `actions` default width | 14 |
| `src/app/task-manager.tsx` | editor extras row; RACI wiring | 17, 24 |
| `src/app/rich-text-editor.tsx` | imperative `appendText` handle | 18 |
| `src/app/note-log-panel.tsx` | two dictation mics | 19 |
| `src/app/chat-panel.tsx` | attach/mic geometry | 20 |
| `src/app/raci-suggest/raci-suggest.ts` | **new** — pure engine | 21 |
| `src/app/raci-suggest-call.ts` | **new** — the one forced call | 22 |
| `src/app/use-raci-suggest.tsx` | **new** — glue hook, coverage-excluded | 23 |
| `src/app/raci-suggest-modal.tsx` | **new** — per-cell review | 23 |
| `src/app/raci-panel.tsx` | mounts the trigger + modal | 24 |

---

# Phase A — shared primitives

## Task 1: Add every new i18n key

All new strings land in one commit. Do not spread i18n edits across later tasks — parallel edits to these two files corrupt each other.

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, add these entries (anywhere in the object; keep them together):

```ts
  calendarSyncEnableHint: "Create and update Outlook calendar events for these items",
  calendarPushShort: "Push",
  calendarPullShort: "Pull",
  raciSuggest: "Suggest RACI",
  raciSuggestTitle: "Proposed RACI assignments",
  raciSuggestIntro: "Review each proposed assignment. Only ticked rows are applied.",
  raciSuggestThinking: "Asking Claude…",
  raciSuggestApply: "Apply selected",
  raciSuggestInclude: "Include",
  raciSuggestCurrent: "Current",
  raciSuggestProposed: "Proposed",
  raciSuggestNone: "None",
  raciSuggestNoProposal: "Claude proposed no assignments.",
  raciSuggestError: "Could not generate RACI suggestions.",
  raciSuggestSkipped: "{0} proposed assignments were refused because they did not match this project.",
  raciSuggestTruncated: "The proposal was capped; some assignments were not returned.",
  activityAiRaciSuggest: "Applied {0} AI-proposed RACI assignments",
```

- [ ] **Step 2: Add the DE keys via a node utf8 write**

`i18n.de.ts` is CRLF and the Edit tool corrupts its umlauts. Write a throwaway script and run it:

```bash
cat > /tmp/de-keys.mjs <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/app/i18n.de.ts";
const src = readFileSync(path, "utf8");
const anchor = "  calendarSyncEnable: \"Zum Outlook-Kalender hinzufügen\",\r\n";
if (!src.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const added = [
  '  calendarSyncEnableHint: "Outlook-Kalendereinträge für diese Einträge erstellen und aktualisieren",',
  '  calendarPushShort: "Senden",',
  '  calendarPullShort: "Abrufen",',
  '  raciSuggest: "RACI vorschlagen",',
  '  raciSuggestTitle: "Vorgeschlagene RACI-Zuordnungen",',
  '  raciSuggestIntro: "Prüfen Sie jede vorgeschlagene Zuordnung. Nur markierte Zeilen werden übernommen.",',
  '  raciSuggestThinking: "Claude wird gefragt…",',
  '  raciSuggestApply: "Auswahl übernehmen",',
  '  raciSuggestInclude: "Übernehmen",',
  '  raciSuggestCurrent: "Aktuell",',
  '  raciSuggestProposed: "Vorschlag",',
  '  raciSuggestNone: "Keine",',
  '  raciSuggestNoProposal: "Claude hat keine Zuordnungen vorgeschlagen.",',
  '  raciSuggestError: "RACI-Vorschläge konnten nicht erstellt werden.",',
  '  raciSuggestSkipped: "{0} vorgeschlagene Zuordnungen wurden abgelehnt, da sie nicht zu diesem Projekt passen.",',
  '  raciSuggestTruncated: "Der Vorschlag wurde gekürzt; einige Zuordnungen fehlen.",',
  '  activityAiRaciSuggest: "{0} von der KI vorgeschlagene RACI-Zuordnungen übernommen",',
].join("\r\n") + "\r\n";
writeFileSync(path, src.replace(anchor, anchor + added), "utf8");
console.log("ok");
EOF
node /tmp/de-keys.mjs
```

Note the `\r\n` in the anchor — a `\n` anchor silently matches nothing in this CRLF file and the script would report success while changing nothing. The script exits 1 if the anchor is missing; do not proceed on `ANCHOR NOT FOUND`.

- [ ] **Step 3: Verify the umlauts survived**

Run: `npx vitest run src/app/i18n-encoding.test.ts`
Expected: PASS. This test bans ASCII substitutions (`fuer`, `ue`) in the DE dict, so a corrupted write fails here.

Then confirm real umlauts are present:

Run: `grep -c "Kalendereinträge" src/app/i18n.de.ts`
Expected: `1`

- [ ] **Step 4: Verify key parity**

Run: `npx tsc --noEmit`
Expected: exit 0. A key present in one dict and not the other fails here.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add strings for the toolbar-polish batch and Suggest RACI"
```

---

## Task 2: PrintButton is icon-only everywhere

**Files:**
- Modify: `src/app/task-manager-ui.tsx:146-169`
- Modify: `src/app/tasks-section.tsx` (drops `iconOnly`)
- Modify: `src/app/dashboard-panel.tsx` (drops `iconOnly`)
- Test: `src/app/task-manager-ui.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/task-manager-ui.test.tsx` (create the file if absent, with the imports shown):

```tsx
import { render, screen } from "@testing-library/react";
import { PrintButton } from "./task-manager-ui";
import { t } from "./i18n";

describe("PrintButton", () => {
  it("renders the icon only — no visible Print label — but keeps its accessible name", () => {
    render(<PrintButton lang="en-US" />);
    const btn = screen.getByRole("button", { name: t("en-US", "printHint") });
    expect(btn.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/task-manager-ui.test.tsx -t "renders the icon only"`
Expected: FAIL — `expected 'Print' to be ''`.

- [ ] **Step 3: Make it icon-only**

In `src/app/task-manager-ui.tsx`, replace the `PrintButton` definition with:

```tsx
export function PrintButton({
  onClick,
  lang,
}: {
  onClick?: () => void;
  lang: Lang;
}) {
  return (
    <button
      type="button"
      onClick={onClick ?? (() => window.print())}
      aria-label={t(lang, "printHint")}
      title={t(lang, "printHint")}
      className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted print:hidden ${INTERACTIVE}`}
    >
      <PrinterIcon />
    </button>
  );
}
```

- [ ] **Step 4: Drop the now-invalid prop at both call sites**

Run: `grep -rn "iconOnly" src/app`

Every hit must go. In `src/app/tasks-section.tsx` change `<PrintButton lang={lang} iconOnly />` to `<PrintButton lang={lang} />`. Do the same in `src/app/dashboard-panel.tsx`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/app/task-manager-ui.test.tsx`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: exit 0. A missed `iconOnly` call site fails here.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager-ui.tsx src/app/tasks-section.tsx src/app/dashboard-panel.tsx src/app/task-manager-ui.test.tsx
git commit -m "feat(ui): print button is icon-only on every pane"
```

---

## Task 3: Calendar sync controls — icons, short labels, tooltip, busy-name fix

**Files:**
- Modify: `src/app/calendar-sync-controls.tsx`
- Test: `src/app/calendar-sync-controls.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/app/calendar-sync-controls.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { CalendarSyncControls } from "./calendar-sync-controls";
import { t } from "./i18n";

const base = {
  lang: "en-US" as const,
  entityLabelKey: "calendarSyncEntityRaid" as const,
  m365Configured: true,
  calendarEnabled: true,
  onToggleCalendar: () => {},
  onPushCalendar: () => {},
  onPullCalendar: () => {},
};

describe("CalendarSyncControls", () => {
  it("shows the short label but keeps the descriptive accessible name", () => {
    render(<CalendarSyncControls {...base} />);
    const push = screen.getByRole("button", { name: t("en-US", "calendarPush") });
    expect(push.textContent).toContain(t("en-US", "calendarPushShort"));
    const pull = screen.getByRole("button", { name: t("en-US", "calendarPull") });
    expect(pull.textContent).toContain(t("en-US", "calendarPullShort"));
  });

  it("gives the enable checkbox an explanatory tooltip", () => {
    render(<CalendarSyncControls {...base} />);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("title")).toBe(t("en-US", "calendarSyncEnableHint"));
  });

  it("switches the accessible name to the busy text while pushing, so the name still contains the visible label", () => {
    render(<CalendarSyncControls {...base} calendarPushBusy />);
    const push = screen.getByRole("button", { name: t("en-US", "calendarPushing") });
    expect(push.textContent).toContain(t("en-US", "calendarPushing"));
  });
});
```

The third test is the pre-existing WCAG 2.5.3 break: today the visible label reads "Pushing…" while the accessible name stays "Push to Outlook".

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/calendar-sync-controls.test.tsx`
Expected: FAIL on all three.

- [ ] **Step 3: Implement**

In `src/app/calendar-sync-controls.tsx`, change the import line to add the down icon:

```tsx
import { ArrowDownTrayIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";
```

Add the checkbox tooltip — on the `<input type="checkbox">`, add:

```tsx
          title={t(lang, "calendarSyncEnableHint")}
```

Replace both button bodies with:

```tsx
      {calendarEnabled && onPushCalendar && (
        <button
          type="button"
          onClick={onPushCalendar}
          disabled={calendarPushBusy}
          aria-busy={calendarPushBusy}
          aria-label={t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")}
          title={t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")}
          className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          <ArrowUpTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPushShort")}
        </button>
      )}
      {calendarEnabled && onPullCalendar && (
        <button
          type="button"
          onClick={onPullCalendar}
          disabled={calendarPullBusy}
          aria-busy={calendarPullBusy}
          aria-label={t(lang, calendarPullBusy ? "calendarPulling" : "calendarPull")}
          title={t(lang, calendarPullBusy ? "calendarPulling" : "calendarPull")}
          className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          <ArrowDownTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {calendarPullBusy ? t(lang, "calendarPulling") : t(lang, "calendarPullShort")}
        </button>
      )}
```

Note the Pull button previously had no `inline-flex items-center gap-1`; it needs it now that it has an icon.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/calendar-sync-controls.test.tsx`
Expected: PASS

- [ ] **Step 5: Check no consumer test asserted the old visible text**

Run: `npx vitest run src/app/raid-panel.test.tsx src/app/change-panel.test.tsx src/app/resources-panel.test.tsx`
Expected: PASS. These query by accessible name (`calendarPush`), which is unchanged, so they should be unaffected. If one fails on visible text, update that assertion to `calendarPushShort` — do not revert the component.

- [ ] **Step 6: Commit**

```bash
git add src/app/calendar-sync-controls.tsx src/app/calendar-sync-controls.test.tsx
git commit -m "feat(calendar): icons + short Push/Pull labels, enable tooltip, busy-state accessible name"
```

---

## Task 4: The same treatment at the three hand-rolled sites

`CalendarSyncControls` is shared, but three surfaces bypass it.

**Files:**
- Modify: `src/app/tasks-section.tsx` (push/pull pair + its own enable checkbox)
- Modify: `src/app/milestones-panel.tsx:319-337` (manual push/pull, no checkbox)
- Modify: `src/app/settings-sections/integrations-section.tsx:87` (checkbox tooltip)

- [ ] **Step 1: Write the failing test for the tasks pane checkbox tooltip**

Add to `src/app/tasks-section.test.tsx`:

```tsx
it("gives the Outlook enable checkbox an explanatory tooltip", () => {
  renderTasksSection({ m365Configured: true });
  const box = screen.getByRole("checkbox", { name: t("en-US", "calendarSyncEnable") });
  expect(box.getAttribute("title")).toBe(t("en-US", "calendarSyncEnableHint"));
});
```

Use whatever render helper the file already defines for the M365-configured case; the two existing tests that query this checkbox show the setup.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/tasks-section.test.tsx -t "explanatory tooltip"`
Expected: FAIL — `expected null to be '…'`.

- [ ] **Step 3: Update the tasks pane**

In `src/app/tasks-section.tsx`, on the enable checkbox add:

```tsx
                title={t(lang, "calendarSyncEnableHint")}
```

On its push button, add the icon import and swap the label, matching Task 3:

```tsx
                aria-label={t(lang, calPushBusy ? "calendarPushing" : "calendarPush")}
                title={t(lang, calPushBusy ? "calendarPushing" : "calendarPush")}
                className={`inline-flex items-center gap-1 rounded-md border border-ui-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
              >
                <ArrowUpTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
                {calPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPushShort")}
```

and on its pull button:

```tsx
                aria-label={t(lang, taskPull.busy ? "calendarPulling" : "calendarPull")}
                title={t(lang, taskPull.busy ? "calendarPulling" : "calendarPull")}
                className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
              >
                <ArrowDownTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
                {taskPull.busy ? t(lang, "calendarPulling") : t(lang, "calendarPullShort")}
```

Add to the imports at the top of the file:

```tsx
import { ArrowDownTrayIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";
```

- [ ] **Step 4: Update the milestones pane**

In `src/app/milestones-panel.tsx`, the push/pull buttons at roughly lines 319-337 get the same icon + short-label + busy-name treatment. There is **no enable checkbox here** (milestone sync is manual-only), so no tooltip. Add the same heroicons import.

- [ ] **Step 5: Update the Settings checkbox**

In `src/app/settings-sections/integrations-section.tsx`, on the checkbox at ~line 87 add:

```tsx
            title={t(lang, "calendarSyncEnableHint")}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/app/tasks-section.test.tsx src/app/milestones-panel.test.tsx`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add src/app/tasks-section.tsx src/app/milestones-panel.tsx src/app/settings-sections/integrations-section.tsx src/app/tasks-section.test.tsx
git commit -m "feat(calendar): icons, short labels and tooltips at the hand-rolled push/pull sites"
```

---

# Phase B — toolbars

## Task 5: Directory — icons on Pull contacts and Hide external

**Files:**
- Modify: `src/app/resource-directory.tsx:268-279`
- Test: `src/app/resource-directory.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders an icon inside the Pull contacts and Hide external controls", () => {
  renderDirectory({ onImportOutlook: () => {} });
  const pull = screen.getByRole("button", { name: t("en-US", "outlookImportButton") });
  expect(pull.querySelector("svg")).toBeTruthy();
  const hide = screen.getByRole("button", { name: t("en-US", "resourceHideExternal") });
  expect(hide.querySelector("svg")).toBeTruthy();
});
```

Use the file's existing render helper.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/resource-directory.test.tsx -t "renders an icon inside"`
Expected: FAIL — `expected null to be truthy`.

- [ ] **Step 3: Implement**

Add to the imports:

```tsx
import { ArrowDownTrayIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
```

Give the import button an icon and a flex shell:

```tsx
        {onImportOutlook && (
          <Button
            variant="secondary"
            size="xs"
            onClick={onImportOutlook}
            className="inline-flex shrink-0 items-center gap-1.5"
          >
            <ArrowDownTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {t(lang, "outlookImportButton")}
          </Button>
        )}
        <ToggleButton
          pressed={hideExternal}
          onToggle={toggleHideExternal}
          icon={<EyeSlashIcon aria-hidden="true" className="h-3.5 w-3.5" />}
          className="shrink-0"
        >
          {t(lang, "resourceHideExternal")}
        </ToggleButton>
```

`ToggleButton` already accepts an `icon` prop and renders it before the label — no change to the primitive.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/resource-directory.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/resource-directory.tsx src/app/resource-directory.test.tsx
git commit -m "feat(directory): icons on Pull contacts and Hide external"
```

---

## Task 6: Workload and Planning — hide-external becomes a toggle button

`resources-panel.tsx` builds `hideExternalToggle` once and mounts it in **both** the Planning toolbar and the Workload header. Both change together; that is intended.

**Files:**
- Modify: `src/app/resources-panel.tsx:494-505`
- Test: `src/app/resources-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders hide-external as a toggle button with an icon in both Planning and Workload", () => {
  const { unmount } = renderResourcesPanel({ view: "workload" });
  const wl = screen.getByRole("button", { name: t("en-US", "planningHideExternal") });
  expect(wl.getAttribute("aria-pressed")).toBe("false");
  expect(wl.querySelector("svg")).toBeTruthy();
  unmount();

  renderResourcesPanel({ view: "planning" });
  const pl = screen.getByRole("button", { name: t("en-US", "planningHideExternal") });
  expect(pl.getAttribute("aria-pressed")).toBe("false");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/resources-panel.test.tsx -t "hide-external as a toggle button"`
Expected: FAIL — no button with that name (it is a checkbox today).

- [ ] **Step 3: Implement**

Add imports:

```tsx
import { EyeSlashIcon } from "@heroicons/react/24/outline";
import { ToggleButton } from "./toggle-button";
```

Replace the `hideExternalToggle` definition:

```tsx
  const hideExternalToggle = (
    <ToggleButton
      pressed={hideExternal}
      onToggle={() => setHideExternal((v) => !v)}
      icon={<EyeSlashIcon aria-hidden="true" className="h-3.5 w-3.5" />}
    >
      {t(lang, "planningHideExternal")}
    </ToggleButton>
  );
```

The label already names what pressed=true *enables*, so `aria-pressed` stays coherent under WCAG 4.1.2 with no label change.

If `FOCUS_RING` is now unused in this file, remove it from the import — lint is `--max-warnings=0`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/resources-panel.test.tsx`
Expected: PASS. Any existing test querying `getByRole("checkbox", { name: planningHideExternal })` must become `getByRole("button", …)`.

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "feat(resources): hide-external is a toggle button in Planning and Workload"
```

---

## Task 7: Calendar — Add meeting moves left and becomes the primary add button

**Files:**
- Modify: `src/app/resources-panel.tsx:472-480` (remove from `headerActions`)
- Modify: `src/app/resources-panel-toolbar.tsx` (`CalendarToolbar` gains a leading slot)
- Test: `src/app/resources-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders Add meeting as the primary add button ahead of the calendar controls", () => {
  renderResourcesPanel({ view: "calendar", onAddCalendarEvent: () => {} });
  const add = screen.getByRole("button", { name: t("en-US", "calendarEventAddMeeting") });
  const mode = screen.getByRole("group", { name: t("en-US", "resourcesViewCalendar") });
  expect(add.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(add.className).toContain("bg-ui-dark-blue");
});
```

`compareDocumentPosition` is what actually proves "left of" in DOM order; a class check alone would not.

If `SegmentedControl` does not expose `role="group"`, target its `ariaLabel` however the existing calendar tests in this file do.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/resources-panel.test.tsx -t "primary add button ahead"`
Expected: FAIL — the button currently sits in `headerActions`, after the controls.

- [ ] **Step 3: Give CalendarToolbar a leading slot**

In `src/app/resources-panel-toolbar.tsx`, add to `CalendarToolbarProps`:

```tsx
  /** Rendered first in the control row (the Add meeting CTA). */
  leading?: ReactNode;
```

Destructure `leading` in the signature, and render it as the first child of the row:

```tsx
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
      {leading}
      <SegmentedControl<CalendarMode>
```

- [ ] **Step 4: Move the button in resources-panel**

Delete the `view === "calendar" && …` block from `headerActions`. Add near the other derived nodes:

```tsx
  const addMeetingButton =
    view === "calendar" && !isPopout && onAddCalendarEvent ? (
      <AddButton onClick={onAddCalendarEvent}>
        {t(lang, "calendarEventAddMeeting")}
      </AddButton>
    ) : null;
```

Pass it to the toolbar at the `CalendarToolbar` render site:

```tsx
            leading={addMeetingButton}
```

Import `AddButton`:

```tsx
import { AddButton } from "./pane-toolbar";
```

The i18n value already carries its own `+ ` prefix (`"+ Add meeting"`), so do **not** add another one — unlike the Open Points call site, which supplies the prefix in JSX.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/app/resources-panel.test.tsx`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resources-panel-toolbar.tsx src/app/resources-panel.test.tsx
git commit -m "feat(calendar): Add meeting leads the toolbar and uses the primary add style"
```

---

## Task 8: Planning — Plan with AI moves to the front of the row

**Files:**
- Modify: `src/app/resources-panel-toolbar.tsx:85-87`
- Test: `src/app/resources-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("puts Plan with AI ahead of the plan-window date fields", () => {
  renderResourcesPanel({ view: "planning", aiEnabled: true });
  const ai = screen.getByRole("button", { name: t("en-US", "allocPlanButton") });
  const start = screen.getByLabelText(t("en-US", "resourcesPlanStart"));
  expect(ai.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

Confirm the trigger's real accessible name in `use-alloc-plan.tsx` before writing this — use whichever key that button renders, not a guessed one.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/resources-panel.test.tsx -t "ahead of the plan-window"`
Expected: FAIL — `aiPlanButton` renders after `hideExternalToggle` today.

- [ ] **Step 3: Move it**

In `PlanningToolbar`, move `{aiPlanButton}` from after `{hideExternalToggle}` to the first child of the control row:

```tsx
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
        {aiPlanButton}
        <label className="flex items-center gap-1">
```

and delete the old `{aiPlanButton}` line further down, leaving `{hideExternalToggle}` in place.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/resources-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel-toolbar.tsx src/app/resources-panel.test.tsx
git commit -m "feat(planning): Plan with AI leads the toolbar row"
```

---

## Task 9: Knowledge — toolbar hoisted out of the scroller, right-aligned, present when empty

Three defects, one fix. Today the toolbar lives *inside* the `overflow-auto` scroller (so it scrolls away), its trailing controls are not pushed right, and it renders only in the non-empty branch — so an empty Knowledge view has no Print or Reset-size at all.

**Files:**
- Modify: `src/app/knowledge-panel.tsx`
- Test: `src/app/knowledge-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the toolbar even when there is nothing in the library yet", () => {
  renderKnowledgePanel({ tasks: [], knowledgeItems: [] });
  expect(screen.getByRole("button", { name: t("en-US", "printHint") })).toBeTruthy();
  expect(screen.getByRole("button", { name: t("en-US", "tableResetSizeHint") })).toBeTruthy();
});

it("keeps the toolbar outside the scrolling region", () => {
  renderKnowledgePanel({ tasks: [], knowledgeItems: [] });
  const print = screen.getByRole("button", { name: t("en-US", "printHint") });
  expect(print.closest(".overflow-auto")).toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/knowledge-panel.test.tsx -t "toolbar"`
Expected: FAIL — the buttons do not exist in the empty branch.

- [ ] **Step 3: Restructure**

Extract the toolbar row to a local const above the `docs.length === 0 && kItems.length === 0` ternary, and render it before the ternary rather than inside the non-empty branch. Push the trailing group right with `ml-auto`:

```tsx
  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
      <AddButton
        onClick={() => setAddOpen((o) => !o)}
        aria-expanded={addOpen}
        className="shrink-0"
      >
        + {t(lang, "documentsTabAdd")}
      </AddButton>
      {filterChips}
      {sortControl}
      <div className="ml-auto flex items-center gap-2">
        <PrintButton lang={lang} />
        <ResetSizeButton onClick={reset} lang={lang} />
      </div>
    </div>
  );
```

Move the existing filter-chip block and the sort `<label>` into `filterChips` / `sortControl` consts so the toolbar body stays readable — they are lifted verbatim, no behaviour change.

Then render:

```tsx
      {toolbar}
      {docs.length === 0 && kItems.length === 0 ? (
        <AddFirstItemButton … />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto pr-2">
          {/* toolbar removed from here */}
          {kItems.length > 0 && (
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/knowledge-panel.test.tsx`
Expected: PASS

★ The empty branch now renders both the toolbar's `+ Add knowledge` **and** the dashed `AddFirstItemButton`, whose label is also an add. If any existing test does a bare `getByRole("button", { name: /add/i })` it will now hit two matches — scope such a query to the specific control rather than loosening it.

- [ ] **Step 5: Commit**

```bash
git add src/app/knowledge-panel.tsx src/app/knowledge-panel.test.tsx
git commit -m "feat(knowledge): pin the toolbar above the scroller, right-align print/reset, show it when empty"
```

---

## Task 10: Timelog apply-confirm list grows to fit, caps at 25 rows

**Files:**
- Modify: `src/app/timelog-apply-confirm.tsx`
- Test: `src/app/timelog-apply-confirm.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { TimelogApplyConfirm, MAX_VISIBLE_ROWS } from "./timelog-apply-confirm";
import type { ApplyDiffLabel } from "./timelog-apply";

const row = (i: number): ApplyDiffLabel => ({
  bucketId: 1, allocIndex: 0, period: `2026-W${String(i).padStart(2, "0")}`,
  bucketName: "Build", lineName: "Dev", current: "0", next: "8",
});

function list(n: number) {
  render(
    <TimelogApplyConfirm
      lang="en-US"
      rows={Array.from({ length: n }, (_, i) => row(i + 1))}
      onApply={() => {}}
      onCancel={() => {}}
    />,
  );
  return screen.getByRole("list");
}

describe("TimelogApplyConfirm diff list", () => {
  it("does not cap a short list", () => {
    expect(list(3).className).not.toMatch(/max-h-/);
  });

  it("caps once the list is longer than MAX_VISIBLE_ROWS", () => {
    expect(list(MAX_VISIBLE_ROWS + 1).className).toMatch(/max-h-/);
  });

  it("does not cap at exactly MAX_VISIBLE_ROWS", () => {
    expect(list(MAX_VISIBLE_ROWS).className).not.toMatch(/max-h-/);
  });
});
```

The boundary case matters — an off-by-one here means a 25-row list still scrolls, which is the exact complaint.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/timelog-apply-confirm.test.tsx`
Expected: FAIL — `MAX_VISIBLE_ROWS` is not exported, and the class is unconditionally `max-h-[50vh]`.

- [ ] **Step 3: Implement**

```tsx
/** Rows shown before the diff list starts scrolling. The list is `text-xs`
 *  (1rem line height), so 25 rows is about 25rem — tighter than the old 50vh
 *  on most screens, which preserves the reason the cap exists at all. */
export const MAX_VISIBLE_ROWS = 25;
```

and replace the `<ul>`:

```tsx
        {/* Grows to fit a short diff; only scrolls past MAX_VISIBLE_ROWS.
            Bounded on purpose: this card gates a FINANCIAL write into
            actualHours, so Apply and Cancel must never be pushed out of reach
            by a long diff. */}
        <ul
          className={`mt-1 pr-2 text-xs text-muted-foreground${
            rows.length > MAX_VISIBLE_ROWS ? " max-h-[25rem] overflow-auto" : ""
          }`}
        >
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/timelog-apply-confirm.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-apply-confirm.tsx src/app/timelog-apply-confirm.test.tsx
git commit -m "feat(timelog): apply-confirm diff grows to fit and scrolls only past 25 rows"
```

---

# Phase C — settings

## Task 11: Theme gallery — two per row, no Apply, no Active label

**Files:**
- Modify: `src/app/theme-gallery.tsx`
- Modify: `src/app/settings-sections/appearance-section.tsx` (drops two props)
- Test: `src/app/theme-gallery.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("lists themes two-up with no Apply button and no Active label", () => {
  render(
    <ThemeGallery
      lang="en-US"
      schemes={[
        { id: "u-1", name: "Ocean", light: {}, supportsDark: false } as never,
        { id: "u-2", name: "Dust", light: {}, supportsDark: false } as never,
      ]}
      onImported={() => {}}
      onRemove={() => {}}
    />,
  );
  expect(screen.getByRole("list").className).toMatch(/sm:grid-cols-2/);
  expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  expect(screen.getByRole("button", { name: /Ocean/ })).toBeTruthy();
});
```

Note the props: `activeId` and `onApply` are gone, so this test does not compile until the interface changes — that is the point.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/theme-gallery.test.tsx -t "two-up"`
Expected: FAIL

- [ ] **Step 3: Implement**

In `src/app/theme-gallery.tsx`, remove `activeId` and `onApply` from `ThemeGalleryProps` and from the destructured signature. Replace the list:

```tsx
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {userSchemes.map((s) => (
            <Card
              as="li"
              key={s.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.name}</span>
              {/* Row control carries the scheme NAME: N rows with an identical
                  "Remove" would be a WCAG 2.4.6 fail the axe gate cannot see
                  (it reports missing names, never duplicate ones). */}
              <Button
                variant="ghost"
                size="xs"
                aria-label={t(lang, "themeGalleryRemove", s.name)}
                onClick={() => onRemove(s.id)}
              >
                {t(lang, "themeGalleryRemove", s.name)}
              </Button>
            </Card>
          ))}
        </ul>
```

Applying a theme is the AppearanceSection scheme `<select>`, which already routes every id through `selectScheme` — Apply on the card was a second path to the same action.

- [ ] **Step 4: Drop the props at the call site**

In `src/app/settings-sections/appearance-section.tsx`, remove `activeId={…}` and `onApply={…}` from the `<ThemeGallery …>` mount. If that leaves a local handler or variable unused, delete it too.

- [ ] **Step 5: Run tests, lint and typecheck**

Run: `npx vitest run src/app/theme-gallery.test.tsx src/app/settings-sections/appearance-section.test.tsx`
Expected: PASS

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 both. Lint is where a now-unused handler surfaces.

- [ ] **Step 6: Commit**

```bash
git add src/app/theme-gallery.tsx src/app/settings-sections/appearance-section.tsx src/app/theme-gallery.test.tsx
git commit -m "feat(settings): theme list is two-up, apply moves entirely to the scheme picker"
```

---

## Task 12: Settings → General drops the Project block

Project metadata stays editable in the Projects panel, which opens the same modal. This removes a duplicate entry point, not a capability.

**Files:**
- Modify: `src/app/settings-sections/general-section.tsx`
- Modify: `src/app/settings-view.tsx` (drops five props)
- Test: `src/app/settings-sections/general-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("no longer renders the project block or its edit button", () => {
  renderGeneralSection();
  expect(screen.queryByText(t("en-US", "settingsProjectHeading"))).toBeNull();
  expect(screen.queryByRole("button", { name: t("en-US", "projectEditTitle") })).toBeNull();
});
```

Confirm the real key behind the edit button in the current file before writing this; use that key, not a guess.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/settings-sections/general-section.test.tsx -t "no longer renders"`
Expected: FAIL

- [ ] **Step 3: Delete the block and everything that fed it**

In `general-section.tsx`:
- Delete the whole `{/* Project — … */}` `<div className="mb-4">` block, including the `<dl>`, the edit button and the `<ProjectEditModal …>` mount.
- Delete the `const [projectOpen, setProjectOpen] = useState(false);` line.
- Remove `project`, `stakeholderNames`, `addressBook`, `resources` and `onUpdateProject` from `GeneralSectionProps` and from the destructured signature (including their defaults).
- Remove the now-dead imports: `ProjectEditModal`, `ProjectMeta`, `Resource`, `Contact`, and `Button` **if** nothing else in the file uses it. Check each before deleting.
- Delete any now-unused existing tests in the test file that asserted on the project block.

- [ ] **Step 4: Drop the props at the call site**

In `src/app/settings-view.tsx`, remove those five props from the `<GeneralSection …>` mount, plus any local variable that existed only to feed them.

- [ ] **Step 5: Check for orphaned i18n keys**

Run: `grep -rn "settingsProjectHeading" src/`

If the only remaining hits are the two dict definitions, delete the key from **both** `i18n.ts` and `i18n.de.ts` (use the node-write recipe from Task 1 for the DE file). If any other surface still uses it, leave it. Do the same check for any other key the deleted block was the sole consumer of.

- [ ] **Step 6: Run the gates**

Run: `npx vitest run src/app/settings-sections/general-section.test.tsx src/app/settings-view.test.tsx`
Expected: PASS

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 both

- [ ] **Step 7: Verify the a11y gate — Settings → General is scanned**

Run: `PORT=3100 npm run dev` in the background, then:

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`
Expected: PASS

Stop it with `PORT=3100 npm run stop`. Use a fresh isolated port, never a reused long-running dev server — Playwright's `reuseExistingServer` will otherwise attach to a stale `:3000` whose Tailwind has not regenerated.

- [ ] **Step 8: Commit**

```bash
git add src/app/settings-sections/general-section.tsx src/app/settings-view.tsx src/app/settings-sections/general-section.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(settings): remove the duplicate project editor from General"
```

---

# Phase D — Open Points and its editor

## Task 13: `sel` and `status` columns get tight padding

The 36px widths in `DEFAULT_COL_WIDTHS` **are** already honoured (`table-layout: fixed` + `<colgroup>`). What fills them is `Th`'s `px-4` — 32px of padding around a 16px checkbox and a 10px dot. So the fix is padding, not a width number.

★ Padding is not persisted, so this lands for every user immediately — including everyone who has ever dragged a column.

**Files:**
- Modify: `src/app/task-manager-ui.tsx:109-124` (`Th`)
- Modify: `src/app/task-row.tsx:142` (local `Td`)
- Modify: `src/app/tasks-section.tsx` (the two header cells)
- Test: `src/app/task-manager-ui.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("Th supports a tight padding variant for icon-width columns", () => {
  const { container } = render(
    <table><thead><tr><Th padding="tight">x</Th></tr></thead></table>,
  );
  const th = container.querySelector("th")!;
  expect(th.className).toContain("px-1");
  expect(th.className).not.toContain("px-4");
});
```

Add `Th` to the import in that test file.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/task-manager-ui.test.tsx -t "tight padding"`
Expected: FAIL — `padding` is not a prop.

- [ ] **Step 3: Add the variant to Th**

```tsx
export function Th({
  children,
  onResize,
  padding = "normal",
}: {
  children: React.ReactNode;
  onResize?: (e: React.MouseEvent) => void;
  /** "tight" trims the horizontal padding for icon-width columns (the select
   *  checkbox, the health dot) — at px-4 the padding alone is wider than the
   *  content and the column cannot honour its 36px width. */
  padding?: "normal" | "tight";
}) {
  return (
    <th className={`relative ${padding === "tight" ? "px-1" : "px-4"} py-2 font-medium`}>
      {children}
      {onResize && (
        <ColumnResizeHandle col="" onMouseDown={(_col, e) => onResize(e)} />
      )}
    </th>
  );
}
```

- [ ] **Step 4: Add the same variant to the local Td**

In `src/app/task-row.tsx`, add a `padding?: "normal" | "tight"` prop to the local `Td` and apply it the same way. Read the existing `Td` body first and change only the horizontal padding class — leave its `stopClick`, `title` and `className` behaviour untouched.

- [ ] **Step 5: Use it on the two columns**

In `src/app/tasks-section.tsx`, the `sel` and `status` header cells:

```tsx
                <Th padding="tight" onResize={(e) => startColResize("sel", e)}>
```
```tsx
                {!hiddenCols.has("status") && <Th padding="tight" onResize={(e) => startColResize("status", e)}><span className="sr-only">{t(lang, "health")}</span></Th>}
```

In `src/app/task-row.tsx`, pass `padding="tight"` to the matching **body** cells for `sel` and `status`. Header and body must match or the columns misalign.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/task-manager-ui.test.tsx src/app/task-row.test.tsx src/app/tasks-section.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager-ui.tsx src/app/task-row.tsx src/app/tasks-section.tsx src/app/task-manager-ui.test.tsx
git commit -m "feat(open-points): tight padding on the select and health columns"
```

---

## Task 14: Edit moves into the ⋮ menu and the actions column shrinks

**Files:**
- Modify: `src/app/task-row.tsx:650-712`
- Modify: `src/app/use-column-manager.ts:42`
- Test: `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("offers Edit inside the overflow menu and no longer renders it inline", async () => {
  const onEdit = vi.fn();
  renderTaskRow({ onEdit });
  expect(screen.queryByRole("button", { name: t("en-US", "edit") })).toBeNull();

  await userEvent.click(
    screen.getByRole("button", { name: new RegExp(t("en-US", "actionMoreActions")) }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: t("en-US", "edit") }));
  expect(onEdit).toHaveBeenCalledTimes(1);
});
```

Use the file's existing row-render helper and its context provider wrapper.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/task-row.test.tsx -t "inside the overflow menu"`
Expected: FAIL — the inline Edit button still exists, so the first assertion fails.

- [ ] **Step 3: Implement**

In `TaskActionsImpl`, delete the inline Edit `<button>` and the wrapping `<div className="flex items-center gap-2 whitespace-nowrap">` is no longer needed for two children — keep it, it still positions the single trigger. Add Edit as the first menu item:

```tsx
  // All row verbs live in the ⋮ overflow menu. The trigger's aria-label is
  // row-unique (WCAG 2.4.6) so N rows don't share an identical name; Edit stays
  // an explicitly-labelled affordance for keyboard and screen-reader users even
  // though clicking the name or the #id also opens the editor.
  return (
    <div className="flex items-center whitespace-nowrap">
      <span className="relative">
        {/* trigger unchanged */}
        <PopoverPanel …>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { stop(e); setMenuOpen(false); onEdit(task); }}
            className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted"
          >
            {t(lang, "edit")}
          </button>
          {showSendInquiry && ( … )}
```

Leave the trigger button, `showSendInquiry`, `showPushToJira` and Delete exactly as they are.

- [ ] **Step 4: Shrink the column default**

In `src/app/use-column-manager.ts`:

```ts
  actions: 36,
```

Stored widths are deliberately **not** invalidated — the storage key stays `"open-points"`. Fresh installs get 36; existing users pick it up via "Reset column widths".

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/task-row.test.tsx src/app/tasks-section.test.tsx`
Expected: PASS. Any test that clicked the inline Edit button must now open the menu first.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-row.tsx src/app/use-column-manager.ts src/app/task-row.test.tsx
git commit -m "feat(open-points): fold Edit into the row overflow menu and narrow the actions column"
```

---

## Task 15: Hide finished and Hide externals become toggle buttons

**Files:**
- Modify: `src/app/tasks-section.tsx:594-610`
- Test: `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders the two row filters as toggle buttons that write their settings flags", async () => {
  const setSettings = vi.fn();
  renderTasksSection({ setSettings });

  const finished = screen.getByRole("button", { name: t("en-US", "hideFinishedTasks") });
  expect(finished.getAttribute("aria-pressed")).toBe("false");
  await userEvent.click(finished);
  expect(setSettings).toHaveBeenCalled();

  expect(
    screen.getByRole("button", { name: t("en-US", "hideExternalTasks") }).getAttribute("aria-pressed"),
  ).toBe("false");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/tasks-section.test.tsx -t "as toggle buttons"`
Expected: FAIL — they are checkboxes today.

- [ ] **Step 3: Implement**

Replace both `<label>`-wrapped checkboxes with:

```tsx
        <ToggleButton
          pressed={hideFinished}
          onToggle={() => setSettings((s) => ({ ...s, hideFinishedTasks: !(s.hideFinishedTasks ?? false) }))}
          icon={<CheckCircleIcon aria-hidden="true" className="h-3.5 w-3.5" />}
        >
          {t(lang, "hideFinishedTasks")}
        </ToggleButton>
        <ToggleButton
          pressed={hideExternal}
          onToggle={() => setSettings((s) => ({ ...s, hideExternalTasks: !(s.hideExternalTasks ?? false) }))}
          icon={<EyeSlashIcon aria-hidden="true" className="h-3.5 w-3.5" />}
        >
          {t(lang, "hideExternalTasks")}
        </ToggleButton>
```

Read the next flag out of `s` inside the functional updater, not from the render-scope `hideFinished` / `hideExternal` — two clicks in one tick would otherwise both read the same stale value.

Add imports:

```tsx
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { ToggleButton } from "./toggle-button";
```

`EyeSlashIcon` is already imported if you did Task 5 in the same file — it is not; add it here too.

Both labels already name what pressed=true *enables*, so `aria-pressed` is coherent with no label change.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/tasks-section.test.tsx`
Expected: PASS. Existing tests using `getByRole("checkbox", { name: hideFinishedTasks })` become `getByRole("button", …)`.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "feat(open-points): hide-finished and hide-externals are toggle buttons"
```

---

## Task 16: Restore the Open Points toolbar order

The convention is destructive first, then Print · reset-**columns** · reset-**size**. This pane renders Print · reset-size · reset-columns · Clear-all.

**Files:**
- Modify: `src/app/tasks-section.tsx:798-810`
- Test: `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("orders the trailing toolbar group: clear-all, print, reset-columns, reset-size", () => {
  renderTasksSection();
  const names = [
    t("en-US", "clearAll"),
    t("en-US", "printHint"),
    t("en-US", "colResetWidthsHint"),
    t("en-US", "tableResetSizeHint"),
  ];
  const nodes = names.map((n) => screen.getByRole("button", { name: n }));
  for (let i = 0; i < nodes.length - 1; i++) {
    expect(
      nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/tasks-section.test.tsx -t "orders the trailing toolbar group"`
Expected: FAIL

- [ ] **Step 3: Reorder**

Move the Clear-all `<button>` (the one wrapping `<EraserIcon />`) to sit **before** `<PrintButton …>`, and swap `ResetSizeButton` and `ResetColWidthsButton` so the order reads:

```tsx
        {/* clear-all button */}
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
        <ResetSizeButton onClick={resetTableSize} lang={lang} />
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/tasks-section.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "fix(open-points): restore the conventional toolbar button order"
```

---

## Task 17: Task editor extras share one line

**Files:**
- Modify: `src/app/task-manager.tsx:2451-2462`
- Test: `src/app/task-editor-actions.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a focused test that renders the two controls in the same wrapper shape the editor uses:

```tsx
it("puts Create RAID and New linked task in one flex row", () => {
  const { container } = render(
    <div className="flex flex-wrap items-start gap-2">
      <TaskEditorRaidMini lang="en-US" onAdd={() => {}} pending={[]} />
      <button type="button">{`+ ${t("en-US", "taskEditorNewLinkedTask")}`}</button>
    </div>,
  );
  const row = container.firstElementChild!;
  expect(row.className).toContain("flex-wrap");
  expect(row.children.length).toBe(2);
});
```

This pins the wrapper shape. The real assertion that they no longer stack is that `editorExtrasEl` supplies the flex row instead of a bare fragment — verify that by eye in step 4.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/task-editor-actions.test.tsx -t "one flex row"`
Expected: FAIL if `TaskEditorRaidMini` is not yet imported in that test file; add the import and re-run — it should then pass, since this test pins the target shape rather than the current one.

- [ ] **Step 3: Implement**

In `src/app/task-manager.tsx`, replace the fragment with a flex row:

```tsx
  // Shared editor extras (create-RAID mini-form + new-linked-task button),
  // mounted below the fields in the modal editor. Never in popouts.
  // ONE ROW: both are collapsed single buttons, and the modal's `space-y-3`
  // wrapper would otherwise stack them. `flex-wrap` is what handles the RAID
  // mini expanding in place into a wide category+title form — the linked-task
  // button drops to the next line on its own. Do NOT reach into the mini's
  // `open` state to size it; the parent has no business knowing.
  const editorExtrasEl = !isPopout ? (
    <div className="flex flex-wrap items-start gap-2">
      <TaskEditorRaidMini lang={lang} onAdd={handleAddRaidFromEditor} pending={editorBuffer.pendingRaid} />
      <Button variant="secondary" size="sm" onClick={() => setLinkedTaskOpen(true)}>
        {`+ ${t(lang, "taskEditorNewLinkedTask")}`}
      </Button>
    </div>
  ) : null;
```

The `space-y-3` wrapper in `task-form-modal.tsx` stays — it is a no-op for a single flex child and still spaces any future extra.

- [ ] **Step 4: Verify by eye**

Run: `npm run dev`, open a task editor, and confirm: collapsed, the two buttons sit side by side; after clicking "+ Create RAID", the form takes the row and the linked-task button wraps below it and stays clickable.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/task-editor-actions.test.tsx src/app/task-manager.characterization.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx src/app/task-editor-actions.test.tsx
git commit -m "feat(task-editor): create-RAID and new-linked-task share one row"
```

---

# Phase E — dictation

## Task 18: RichTextEditor gains an imperative appendText

Tiptap's `useEditor` binds `content` once at mount, so a dictation mic cannot push a new `value` in. Remounting via the composer's `key` is not an option either: Web Speech fires `onFinal` repeatedly per hold, so that would remount several times mid-sentence and lose the caret each time.

**Files:**
- Modify: `src/app/rich-text-editor.tsx`
- Test: `src/app/rich-text-editor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("appends dictated text through the imperative handle without remounting", async () => {
  const onChange = vi.fn();
  function Harness() {
    const ref = useRef<RichTextEditorHandle>(null);
    return (
      <>
        <RichTextEditor
          variant="lean"
          value="<p>Hello</p>"
          onChange={onChange}
          label="Note"
          lang="en-US"
          editorRef={ref}
        />
        <button type="button" onClick={() => ref.current?.appendText(" world")}>go</button>
      </>
    );
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "go" }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls.at(-1)![0]).toContain("world");
});

it("inserts dictated text as text, never as markup", async () => {
  const onChange = vi.fn();
  function Harness() {
    const ref = useRef<RichTextEditorHandle>(null);
    return (
      <>
        <RichTextEditor variant="lean" value="<p></p>" onChange={onChange} label="Note" lang="en-US" editorRef={ref} />
        <button type="button" onClick={() => ref.current?.appendText("<b>x</b>")}>go</button>
      </>
    );
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "go" }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const html = onChange.mock.calls.at(-1)![0];
  expect(html).toContain("&lt;b&gt;");
  expect(html).not.toContain("<b>x</b>");
});
```

The second test is the security-relevant one: `insertContent` parses a bare **string** as HTML, so dictated text containing `<` would be interpreted as markup.

Tiptap needs jsdom stubs for `Range.getClientRects` and `getBoundingClientRect`; this test file should already have them — if not, copy them from the existing rich-text tests.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/rich-text-editor.test.tsx -t "imperative handle"`
Expected: FAIL — `editorRef` is not a prop.

- [ ] **Step 3: Implement**

Add to the imports:

```tsx
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
```

Add the handle type and prop:

```tsx
export interface RichTextEditorHandle {
  /** Insert plain text at the caret. Used by the dictation mic — the editor
   *  binds `content` once at mount, so a new `value` cannot reach it. */
  appendText(text: string): void;
}
```

In `RichTextEditorProps`:

```tsx
  /** Imperative handle for appending dictated text (React 19 ref-as-prop). */
  editorRef?: Ref<RichTextEditorHandle>;
```

After the `useEditor(...)` call:

```tsx
  // insertContent with a TEXT NODE, not a string: a bare string is parsed as
  // HTML, so dictated text containing "<" or "&" would become markup.
  useImperativeHandle(
    props.editorRef,
    () => ({
      appendText(text: string) {
        if (!text) return;
        editor?.chain().focus().insertContent({ type: "text", text }).run();
      },
    }),
    [editor],
  );
```

`onUpdate` already fires on insert and pushes the sanitized HTML to `onChange`, so the parent needs no extra wiring.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/rich-text-editor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx
git commit -m "feat(rich-text): imperative appendText handle for dictation"
```

---

## Task 19: Note log gets dictation mics

**Files:**
- Modify: `src/app/note-log-panel.tsx`
- Test: `src/app/note-log-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("offers a dictation mic beside the note composer", () => {
  renderNoteLogPanel({ entries: [] });
  expect(
    screen.getByRole("button", { name: new RegExp(t("en-US", "dictationHold")) }),
  ).toBeTruthy();
});
```

`useDictationMic` returns `null` for `mic` when the engine is unsupported, so the test environment needs `usePushToTalk` to report supported. Check how `task-form-fields.test.tsx` sets that up and mirror it — most likely a `vi.mock` of `./voice` or of `./use-push-to-talk`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/note-log-panel.test.tsx -t "dictation mic"`
Expected: FAIL

- [ ] **Step 3: Wire the composer mic**

In `src/app/note-log-panel.tsx`, add imports:

```tsx
import { useRef } from "react";
import { useDictationMic } from "./dictation-mic";
import { useSettings } from "./use-settings";
import type { RichTextEditorHandle } from "./rich-text-editor";
```

In the composer component:

```tsx
  const composerRef = useRef<RichTextEditorHandle>(null);
  const { settings } = useSettings();
  const { mic: composerMic, registration: composerReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "noteLogPlaceholder"),
    // The editor owns its content; append through the handle rather than
    // re-feeding `value`, which Tiptap binds only at mount.
    onAppendFinal: (txt) => composerRef.current?.appendText(txt),
  });
```

Pass `editorRef={composerRef}` to the composer `<RichTextEditor>`, and render `{composerMic}` in the existing `<div className="mt-2 flex justify-end">` row beside the Add button.

Attach `composerReg.onFocus` / `composerReg.onBlur` to the wrapper `<div>` around the editor so the global hold-to-talk hotkey can find this target.

- [ ] **Step 4: Wire the entry-editor mic**

Do the same for the in-place edit `<RichTextEditor>` in `NoteRow`: its own `useRef<RichTextEditorHandle>`, its own `useDictationMic` with `label: t(lang, "edit")`, `editorRef` passed, and `{mic}` rendered in that row's existing button group.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/note-log-panel.test.tsx src/app/notes-window.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/note-log-panel.tsx src/app/note-log-panel.test.tsx
git commit -m "feat(notes): dictation mic on the note composer and the entry editor"
```

---

## Task 20: AI Assistant — attach and mic match in size with centred icons

Attach is a `<Button>` (`px-4 py-2`); the mic is a raw `<button>` (`px-2 py-1`). Neither centres its icon, because `Button`'s `BASE_CLASS` carries no `inline-flex items-center justify-center`.

Fix **locally**, not in `BASE_CLASS` — that class backs every button in the app and switching it to `inline-flex` would reflow layouts app-wide for a two-button problem.

★ The mic stays a raw `<button>` here, and that is NOT a violation of the no-hand-rolled-controls
rule above. It lives in exactly ONE shared component (`dictation-mic.tsx`), so it is not sprawl,
and its resting/listening colour swap (`text-ui-green-strong` vs `text-muted-foreground`) is a
bespoke semantic that no `Button` variant expresses — routing it through the primitive would put
that colour in `className`, where it would fight the variant's own `text-*` by CSS source order.
Same category as the chat pink Stop and the purple consent button, which AGENTS.md already lists
as deliberately bespoke. Give it the `className` passthrough and leave its element alone.

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Modify: `src/app/dictation-mic.tsx` (accept a `className` override)
- Test: `src/app/chat-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("gives the attach and dictate buttons the same centred-icon shell", () => {
  renderChatPanel({ aiEnabled: true });
  const attach = screen.getByRole("button", { name: t("en-US", "chatAttach") });
  expect(attach.className).toContain("justify-center");
  const mic = screen.getByRole("button", { name: new RegExp(t("en-US", "dictationHold")) });
  expect(mic.className).toContain("justify-center");
  expect(mic.className).toContain("px-4");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/chat-panel.test.tsx -t "centred-icon shell"`
Expected: FAIL

- [ ] **Step 3: Let the mic take a className**

In `src/app/dictation-mic.tsx`, add an optional `className` to `UseDictationMicArgs` and append it to the button's classes:

```tsx
interface UseDictationMicArgs {
  lang: Lang;
  dictation?: Settings["dictation"];
  enabled?: boolean;
  label: string;
  onAppendFinal: (text: string) => void;
  /** Appended to the mic button's classes so a caller can match a sibling
   *  control's geometry (the chat composer's attach button). */
  className?: string;
}
```

```tsx
      className={`rounded-md border border-line px-2 py-1 ${INTERACTIVE} ${ptt.listening ? "text-ui-green-strong" : "text-muted-foreground"}${className ? ` ${className}` : ""}`}
```

Every other caller omits `className` and is byte-identical.

- [ ] **Step 4: Match the two chat controls**

In `src/app/chat-panel.tsx`, give the attach button centring:

```tsx
          <Button
            variant="secondary"
            className="inline-flex items-center justify-center"
            onClick={() => fileInputRef.current?.click()}
```

and pass the matching shell to the mic:

```tsx
  const { mic, status, registration } = useDictationMic({
    lang,
    dictation,
    enabled: true,
    label: t(lang, "chatPlaceholder"),
    className: "inline-flex items-center justify-center px-4 py-2",
    onAppendFinal: (txt) => setInput((prev) => appendDictation(prev, txt)),
  });
```

★★ CORRECTION — do NOT do it that way. An earlier draft of this step claimed the trailing
`px-4 py-2` "wins over the base `px-2 py-1` by CSS source order, so ordering is the mechanism".
That is false and is exactly the landmine AGENTS.md warns about: the order classes appear in the
`class` ATTRIBUTE has no bearing on precedence. Both utilities have equal specificity, so the one
emitted later in Tailwind's generated stylesheet wins — which happens to be `px-4` today only
because Tailwind sorts padding utilities numerically. That is luck, not a mechanism, and it
inverts the moment either value changes.

Give the mic a `padding` prop that REPLACES the default instead:

```tsx
interface UseDictationMicArgs {
  …
  /** Replaces the mic button's default padding so a caller can match a sibling
   *  control's geometry. REPLACES rather than appends: two padding utilities in
   *  one class list are resolved by Tailwind's stylesheet order, not by their
   *  order in the attribute, so appending is not a reliable override. */
  padding?: string;
  /** Non-padding layout extras (flex/centring). */
  className?: string;
}
```

```tsx
      className={`rounded-md border border-line ${padding ?? "px-2 py-1"} ${INTERACTIVE} ${ptt.listening ? "text-ui-green-strong" : "text-muted-foreground"}${className ? ` ${className}` : ""}`}
```

and chat passes `padding="px-4 py-2"` with `className="inline-flex items-center justify-center"`.
Every other caller omits both and stays byte-identical.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/chat-panel.test.tsx src/app/dictation-mic.test.tsx`
Expected: PASS

- [ ] **Step 6: Verify by eye — chat is not in the axe gate**

Run: `npm run dev`, open AI Assistant, confirm the attach and mic buttons are the same size with centred glyphs.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-panel.tsx src/app/dictation-mic.tsx src/app/chat-panel.test.tsx
git commit -m "feat(chat): attach and dictate buttons match in size with centred icons"
```

---

# Phase F — Suggest RACI

## Task 21: The pure RACI-suggestion engine

Pure, i18n-free, no clock, no network. This is where the coverage lives.

**Files:**
- Create: `src/app/raci-suggest/raci-suggest.ts`
- Test: `src/app/raci-suggest/raci-suggest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/raci-suggest/raci-suggest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildRaciContext,
  cellKey,
  groundRaciCells,
  parseRaciProposal,
  MAX_RACI_CELLS,
} from "./raci-suggest";
import type { Milestone, Stakeholder } from "../types";

const sh = (id: number, name: string, extra: Partial<Stakeholder> = {}): Stakeholder => ({
  id, name, category: "Internal", influence: "High", interest: "High",
  stakeholderIds: [] as never, raci: {}, ...extra,
} as Stakeholder);

const ms = (id: number, name: string): Milestone =>
  ({ id, name, date: "2026-03-01" } as Milestone);

const stakeholders = [sh(1, "Ada", { title: "Sponsor" }), sh(2, "Bo", { title: "Lead" })];
const milestones = [ms(10, "Design freeze"), ms(11, "Go live")];

describe("parseRaciProposal", () => {
  it("returns no cells for a malformed payload instead of throwing", () => {
    expect(parseRaciProposal({}).cells).toEqual([]);
    expect(parseRaciProposal({ cells: "nope" }).cells).toEqual([]);
    expect(parseRaciProposal(null).cells).toEqual([]);
  });

  it("keeps well-formed cells", () => {
    const out = parseRaciProposal({ cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }] });
    expect(out.cells).toHaveLength(1);
  });

  it("reports truncation when the model exceeds the cap", () => {
    const cells = Array.from({ length: MAX_RACI_CELLS + 5 }, (_, i) => ({
      stakeholderId: 1, milestoneId: i, role: "C",
    }));
    const out = parseRaciProposal({ cells });
    expect(out.cells).toHaveLength(MAX_RACI_CELLS);
    expect(out.truncated).toBe(true);
  });
});

describe("groundRaciCells", () => {
  it("drops a hallucinated stakeholder id", () => {
    const g = groundRaciCells([{ stakeholderId: 99, milestoneId: 10, role: "R" }], stakeholders, milestones);
    expect(g.cells).toEqual([]);
    expect(g.skipped).toHaveLength(1);
  });

  it("drops a hallucinated milestone id", () => {
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 99, role: "R" }], stakeholders, milestones);
    expect(g.cells).toEqual([]);
  });

  it("rejects a letter outside RACI_ROLES", () => {
    const g = groundRaciCells(
      [{ stakeholderId: 1, milestoneId: 10, role: "X" as never }],
      stakeholders, milestones,
    );
    expect(g.cells).toEqual([]);
  });

  it("dedupes repeated cells for the same stakeholder and milestone", () => {
    const g = groundRaciCells(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 10, role: "C" },
      ],
      stakeholders, milestones,
    );
    expect(g.cells).toHaveLength(1);
  });

  it("refuses a second Accountable for a milestone that already has one", () => {
    const withA = [sh(1, "Ada", { raci: { "10": "A" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 2, milestoneId: 10, role: "A" }], withA, milestones);
    expect(g.cells).toEqual([]);
    expect(g.skipped[0].reason).toBe("duplicate-accountable");
  });

  it("allows re-proposing Accountable for the stakeholder who already holds it", () => {
    const withA = [sh(1, "Ada", { raci: { "10": "A" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 10, role: "A" }], withA, milestones);
    expect(g.cells).toHaveLength(1);
  });

  it("refuses two proposed Accountables for the same milestone within one proposal", () => {
    const g = groundRaciCells(
      [
        { stakeholderId: 1, milestoneId: 10, role: "A" },
        { stakeholderId: 2, milestoneId: 10, role: "A" },
      ],
      stakeholders, milestones,
    );
    expect(g.cells).toHaveLength(1);
    expect(g.skipped).toHaveLength(1);
  });

  it("carries the current role so the modal can show current -> proposed", () => {
    const withR = [sh(1, "Ada", { raci: { "10": "C" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 10, role: "R" }], withR, milestones);
    expect(g.cells[0].currentRole).toBe("C");
    expect(g.cells[0].role).toBe("R");
  });

  it("drops a no-op cell whose proposed role already matches", () => {
    const withR = [sh(1, "Ada", { raci: { "10": "R" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 10, role: "R" }], withR, milestones);
    expect(g.cells).toEqual([]);
  });
});

describe("buildRaciContext", () => {
  it("includes the fields the model reasons over and caps both lists", () => {
    const ctx = buildRaciContext(stakeholders, milestones);
    expect(ctx.text).toContain("Ada");
    expect(ctx.text).toContain("Sponsor");
    expect(ctx.text).toContain("Design freeze");
    expect(ctx.truncated).toBe(false);
  });

  it("flags truncation rather than silently dropping rows", () => {
    const many = Array.from({ length: 500 }, (_, i) => sh(i + 1, `P${i}`));
    expect(buildRaciContext(many, milestones).truncated).toBe(true);
  });
});

describe("cellKey", () => {
  it("is unique per stakeholder and milestone", () => {
    expect(cellKey({ stakeholderId: 1, milestoneId: 10 } as never))
      .not.toBe(cellKey({ stakeholderId: 1, milestoneId: 11 } as never));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/raci-suggest/raci-suggest.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the engine**

Create `src/app/raci-suggest/raci-suggest.ts`:

```ts
// Pure, i18n-free engine for "Suggest RACI". No clock, no network, no DOM —
// mirrors alloc-plan/alloc-plan.ts. The model's output is UNTRUSTED and is
// re-grounded against the live stakeholders/milestones before anything can be
// shown or applied.
import { RACI_ROLES, type Milestone, type RaciRole, type Stakeholder } from "../types";

export const MAX_RACI_CELLS = 200;
export const MAX_CONTEXT_STAKEHOLDERS = 120;
export const MAX_CONTEXT_MILESTONES = 60;

export interface ProposedCell {
  stakeholderId: number;
  milestoneId: number;
  role: RaciRole;
}

export interface GroundedRaciCell extends ProposedCell {
  stakeholderName: string;
  milestoneName: string;
  /** The role stored today, or null when the cell is empty. */
  currentRole: RaciRole | null;
}

export type SkipReason =
  | "unknown-stakeholder"
  | "unknown-milestone"
  | "invalid-role"
  | "duplicate-accountable";

export interface SkippedRaciCell {
  stakeholderId: number;
  milestoneId: number;
  reason: SkipReason;
}

export function cellKey(c: { stakeholderId: number; milestoneId: number }): string {
  return `${c.stakeholderId}:${c.milestoneId}`;
}

function isRaciRole(v: unknown): v is RaciRole {
  return typeof v === "string" && (RACI_ROLES as readonly string[]).includes(v);
}

/** Validate the model's raw tool input. Never throws; a malformed payload
 *  yields zero cells rather than a crash. */
export function parseRaciProposal(
  raw: unknown,
): { cells: ProposedCell[]; truncated: boolean } {
  const cellsRaw = (raw as { cells?: unknown } | null)?.cells;
  if (!Array.isArray(cellsRaw)) return { cells: [], truncated: false };
  const cells: ProposedCell[] = [];
  for (const entry of cellsRaw) {
    if (cells.length >= MAX_RACI_CELLS) break;
    const e = entry as Partial<ProposedCell> | null;
    if (!e || typeof e !== "object") continue;
    if (!Number.isFinite(e.stakeholderId) || !Number.isFinite(e.milestoneId)) continue;
    if (!isRaciRole(e.role)) continue;
    cells.push({
      stakeholderId: Number(e.stakeholderId),
      milestoneId: Number(e.milestoneId),
      role: e.role,
    });
  }
  return { cells, truncated: cellsRaw.length > MAX_RACI_CELLS };
}

/** Re-ground UNTRUSTED cells against the live workspace. */
export function groundRaciCells(
  proposed: readonly ProposedCell[],
  stakeholders: readonly Stakeholder[],
  milestones: readonly Milestone[],
): { cells: GroundedRaciCell[]; skipped: SkippedRaciCell[]; truncated: boolean } {
  const byStakeholder = new Map(stakeholders.map((s) => [s.id, s]));
  const byMilestone = new Map(milestones.map((m) => [m.id, m]));

  // Who already holds Accountable for each milestone. A proposal may re-assert
  // the CURRENT holder (a no-op that later gets dropped) but must never mint a
  // second one — the panel already warns on that state and the model must not
  // manufacture it.
  const accountableHolder = new Map<number, number>();
  for (const s of stakeholders) {
    for (const [key, role] of Object.entries(s.raci)) {
      if (role === "A") accountableHolder.set(Number(key), s.id);
    }
  }

  const cells: GroundedRaciCell[] = [];
  const skipped: SkippedRaciCell[] = [];
  const seen = new Set<string>();

  for (const c of proposed) {
    if (cells.length >= MAX_RACI_CELLS) break;
    const key = cellKey(c);
    if (seen.has(key)) continue;
    seen.add(key);

    const s = byStakeholder.get(c.stakeholderId);
    if (!s) { skipped.push({ ...c, reason: "unknown-stakeholder" }); continue; }
    const m = byMilestone.get(c.milestoneId);
    if (!m) { skipped.push({ ...c, reason: "unknown-milestone" }); continue; }
    if (!isRaciRole(c.role)) { skipped.push({ ...c, reason: "invalid-role" }); continue; }

    const currentRole = s.raci[String(c.milestoneId)] ?? null;
    // Nothing to change — not an error, just not worth showing.
    if (currentRole === c.role) continue;

    if (c.role === "A") {
      const holder = accountableHolder.get(c.milestoneId);
      if (holder !== undefined && holder !== c.stakeholderId) {
        skipped.push({ ...c, reason: "duplicate-accountable" });
        continue;
      }
      // Claim it so a second proposed A for the same milestone is refused too.
      accountableHolder.set(c.milestoneId, c.stakeholderId);
    }

    cells.push({
      ...c,
      stakeholderName: s.name,
      milestoneName: m.name,
      currentRole,
    });
  }

  return { cells, skipped, truncated: proposed.length > MAX_RACI_CELLS };
}

/** Compact English digest for the model. Capped, and reports the cap — a silent
 *  truncation reads as "covered everything". */
export function buildRaciContext(
  stakeholders: readonly Stakeholder[],
  milestones: readonly Milestone[],
): { text: string; truncated: boolean } {
  const s = stakeholders.slice(0, MAX_CONTEXT_STAKEHOLDERS);
  const m = milestones.slice(0, MAX_CONTEXT_MILESTONES);
  const lines: string[] = ["STAKEHOLDERS (id | name | title | organization | category | influence | interest)"];
  for (const p of s) {
    lines.push(
      [p.id, p.name, p.title ?? "", p.organization ?? "", p.category, p.influence, p.interest].join(" | "),
    );
  }
  lines.push("", "MILESTONES (id | name | date | description)");
  for (const x of m) {
    lines.push([x.id, x.name, x.date ?? "", x.description ?? ""].join(" | "));
  }
  lines.push("", "EXISTING ASSIGNMENTS (stakeholderId | milestoneId | role)");
  for (const p of s) {
    for (const [key, role] of Object.entries(p.raci)) {
      lines.push([p.id, key, role].join(" | "));
    }
  }
  return {
    text: lines.join("\n"),
    truncated:
      stakeholders.length > MAX_CONTEXT_STAKEHOLDERS ||
      milestones.length > MAX_CONTEXT_MILESTONES,
  };
}

export const RACI_SUGGEST_TOOL = {
  name: "propose_raci",
  description:
    "Propose RACI assignments for stakeholders across project milestones. " +
    "R = Responsible (does the work), A = Accountable (exactly ONE per milestone, owns the outcome), " +
    "C = Consulted (two-way input), I = Informed (one-way updates). " +
    "Only propose assignments you are confident about; omit a cell rather than guess. " +
    "Never propose a second Accountable for a milestone that already has one.",
  input_schema: {
    type: "object" as const,
    properties: {
      cells: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            stakeholderId: { type: "number" as const, description: "id from the STAKEHOLDERS list" },
            milestoneId: { type: "number" as const, description: "id from the MILESTONES list" },
            role: { type: "string" as const, enum: [...RACI_ROLES] },
          },
          required: ["stakeholderId", "milestoneId", "role"],
        },
      },
    },
    required: ["cells"],
  },
} as const;
```

If `Milestone` has no `description` field, drop that column from the digest rather than inventing one — check `types.ts` first.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/raci-suggest/raci-suggest.test.ts`
Expected: PASS (all 14)

- [ ] **Step 5: Check the coverage gate**

Run: `npm run test:coverage`
Expected: PASS. A new pure `.ts` file is coverage-gated; if the per-engine globs in `vitest.config.ts` do not yet include `raci-suggest/`, the global floors still apply and this file must carry its own weight.

- [ ] **Step 6: Commit**

```bash
git add src/app/raci-suggest/
git commit -m "feat(raci): pure suggestion engine with grounding against live entities"
```

---

## Task 22: The forced call

**Files:**
- Create: `src/app/raci-suggest-call.ts`
- Test: `src/app/raci-suggest-call.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./ai-forced-call", () => ({ runForcedToolCall: vi.fn() }));
import { runForcedToolCall } from "./ai-forced-call";
import { runRaciSuggestion } from "./raci-suggest-call";

describe("runRaciSuggestion", () => {
  it("forces propose_raci and returns the parsed proposal", async () => {
    vi.mocked(runForcedToolCall).mockResolvedValue({
      cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }],
    });
    const out = await runRaciSuggestion(
      { text: "ctx", truncated: false },
      { apiKey: "sk-ant-x", model: "claude-opus-5" },
    );
    expect(vi.mocked(runForcedToolCall).mock.calls[0][0].toolName).toBe("propose_raci");
    expect(out.cells).toHaveLength(1);
  });

  it("never puts the api key in the request body", async () => {
    vi.mocked(runForcedToolCall).mockResolvedValue({ cells: [] });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "sk-ant-secret", model: "m" });
    const args = vi.mocked(runForcedToolCall).mock.calls[0][0];
    expect(JSON.stringify(args.messages)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(args.system ?? "")).not.toContain("sk-ant-secret");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/raci-suggest-call.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// ONE forced tool call for "Suggest RACI". Mirrors task-dedup-call.ts: no
// agentic loop, and the api key goes to the shared never-log envelope only —
// it is a request HEADER there and is never logged or echoed.
import { runForcedToolCall } from "./ai-forced-call";
import {
  parseRaciProposal,
  RACI_SUGGEST_TOOL,
  type ProposedCell,
} from "./raci-suggest/raci-suggest";

const MAX_TOKENS = 4096;

const SYSTEM =
  "You assign RACI roles for project milestones. Use the stakeholder's title, " +
  "organization, category, influence and interest to decide. Exactly one " +
  "Accountable per milestone. Prefer omitting a cell to guessing. Do not " +
  "restate assignments that already exist.";

export async function runRaciSuggestion(
  context: { text: string; truncated: boolean },
  ai: { apiKey: string; model: string },
  signal?: AbortSignal,
): Promise<{ cells: ProposedCell[]; truncated: boolean }> {
  const raw = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: SYSTEM,
    tools: [RACI_SUGGEST_TOOL],
    toolName: RACI_SUGGEST_TOOL.name,
    messages: [{ role: "user", content: context.text }],
    maxTokens: MAX_TOKENS,
    signal,
  });
  return parseRaciProposal(raw);
}
```

Match the `ApiMessage` shape exactly as `task-dedup-call.ts` builds it — if `content` there is a block array rather than a string, mirror that.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/raci-suggest-call.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/raci-suggest-call.ts src/app/raci-suggest-call.test.ts
git commit -m "feat(raci): forced propose_raci call through the shared never-log envelope"
```

---

## Task 23: The glue hook and the review modal

★★ **The apply logic is the highest-risk code in this batch.** `RaciPanel.onSave` takes a **single** stakeholder. `handleSaveStakeholder` does use a functional `setStakeholders`, but it writes the caller's object verbatim — and `setRaciRole` returns a pure copy taken from a snapshot. So two accepted cells on the **same stakeholder, different milestones** would each fold into the same stale snapshot and the second would silently drop the first's `raci` key.

**Group cells by `stakeholderId`, fold all of that stakeholder's cells with repeated `setRaciRole`, and call `onSave` once per stakeholder.**

**Files:**
- Create: `src/app/use-raci-suggest.tsx`
- Create: `src/app/raci-suggest-modal.tsx`
- Test: `src/app/use-raci-suggest.test.tsx`

- [ ] **Step 1: Write the failing test for the fold**

```tsx
import { describe, expect, it } from "vitest";
import { foldCellsByStakeholder } from "./use-raci-suggest";
import type { Stakeholder } from "./types";

const sh = (id: number, raci: Record<string, "R" | "A" | "C" | "I"> = {}): Stakeholder =>
  ({ id, name: `S${id}`, category: "Internal", influence: "High", interest: "High", raci } as Stakeholder);

describe("foldCellsByStakeholder", () => {
  it("folds MULTIPLE cells for one stakeholder into a SINGLE save, keeping every role", () => {
    const out = foldCellsByStakeholder(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 11, role: "C" },
      ] as never,
      [sh(1)],
    );
    expect(out).toHaveLength(1);
    expect(out[0].raci["10"]).toBe("R");
    expect(out[0].raci["11"]).toBe("C");
  });

  it("preserves roles the proposal did not touch", () => {
    const out = foldCellsByStakeholder(
      [{ stakeholderId: 1, milestoneId: 11, role: "C" }] as never,
      [sh(1, { "10": "A" })],
    );
    expect(out[0].raci["10"]).toBe("A");
    expect(out[0].raci["11"]).toBe("C");
  });

  it("returns one entry per stakeholder", () => {
    const out = foldCellsByStakeholder(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 2, milestoneId: 10, role: "C" },
      ] as never,
      [sh(1), sh(2)],
    );
    expect(out).toHaveLength(2);
  });

  it("skips a stakeholder that vanished between propose and confirm", () => {
    const out = foldCellsByStakeholder(
      [{ stakeholderId: 9, milestoneId: 10, role: "R" }] as never,
      [sh(1)],
    );
    expect(out).toEqual([]);
  });
});
```

The first test is the regression guard. Seed it with two cells on **one** stakeholder — a fixture with one cell each passes whichever way the code is written and proves nothing.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/use-raci-suggest.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the fold and the hook**

Create `src/app/use-raci-suggest.tsx`. Read `src/app/use-alloc-plan.tsx` first and mirror its phase machine, request-generation nonce, abort handling and error classification exactly — the differences are only the engine calls and the apply.

The exported fold:

```tsx
/** Collapse the accepted cells into ONE updated Stakeholder per person.
 *
 *  ★★ Load-bearing. `onSave` takes a single stakeholder and writes the caller's
 *  object verbatim, while `setRaciRole` returns a pure copy of a SNAPSHOT. So
 *  calling onSave once per CELL would make two cells on the same stakeholder
 *  each fold into the same stale snapshot, and the second would drop the
 *  first's raci key. Fold first, save once per stakeholder. */
export function foldCellsByStakeholder(
  cells: readonly GroundedRaciCell[],
  stakeholders: readonly Stakeholder[],
): Stakeholder[] {
  const byId = new Map(stakeholders.map((s) => [s.id, s]));
  const folded = new Map<number, Stakeholder>();
  for (const c of cells) {
    const base = folded.get(c.stakeholderId) ?? byId.get(c.stakeholderId);
    if (!base) continue; // deleted between propose and confirm
    folded.set(c.stakeholderId, setRaciRole(base, c.milestoneId, c.role));
  }
  return [...folded.values()];
}
```

Confirm `setRaciRole`'s real signature in `stakeholders.ts` before writing this — it is `(s, milestoneId, role)`; match the milestone-id type it expects.

`onConfirm` then reads:

```tsx
  const onConfirm = useCallback(() => {
    if (phase !== "preview") return;
    const chosen = cells.filter((c) => selected.has(cellKey(c)));
    if (chosen.length === 0) return;
    const updated = foldCellsByStakeholder(chosen, stakeholders);
    capture?.({ setter: setStakeholders, kind: "bulk.edit", edited: updated, fromArray: stakeholders, entityKey: "stakeholder" });
    for (const s of updated) onSave(s, false, { suppressFieldUndo: true });
    logActivity?.("ai.raciSuggest", chosen.length);
    reset();
  }, [phase, cells, selected, stakeholders, onSave, capture, setStakeholders, logActivity, reset]);
```

`suppressFieldUndo` keeps this to ONE undo entry rather than one per stakeholder — check that `handleSaveStakeholder`'s third parameter still carries that meaning before relying on it.

Gate the trigger:

```tsx
  const enabled =
    isAiEnabled(settings.ai) && !isPopout && !!apiKey.trim() &&
    stakeholders.length > 0 && milestones.length > 0;
```

- [ ] **Step 4: Implement the modal**

Create `src/app/raci-suggest-modal.tsx`, modelled on `alloc-plan-modal.tsx`. Per row: a checkbox, the stakeholder name, the milestone name, and `current → proposed`.

★ Row-unique accessible names — N identical "Include" labels is a WCAG 2.4.6 failure the axe gate cannot see (it reports missing names, never duplicate ones):

```tsx
              aria-label={`${t(lang, "raciSuggestInclude")} – ${c.stakeholderName} – ${c.milestoneName}`}
```

Render `raciSuggestSkipped` with `skipped.length` when non-empty, and `raciSuggestTruncated` when `truncated` — a silent cap reads as "covered everything".

- [ ] **Step 5: Register the activity kind**

Add `"ai.raciSuggest": "activityAiRaciSuggest"` to the map in `src/app/activity-log.ts`, alongside the other `ai.*` kinds.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/app/use-raci-suggest.test.tsx`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 7: Add the hook to the coverage exclusions**

`use-raci-suggest.tsx` is render glue. It is a `.tsx` file, so the existing `src/app/**/*.tsx` exclusion in `vitest.config.ts` already covers it — confirm with `npm run test:coverage` rather than assuming.

- [ ] **Step 8: Commit**

```bash
git add src/app/use-raci-suggest.tsx src/app/raci-suggest-modal.tsx src/app/use-raci-suggest.test.tsx src/app/activity-log.ts
git commit -m "feat(raci): suggestion review modal and apply that folds per stakeholder"
```

---

## Task 24: Mount Suggest RACI in the panel

**Files:**
- Modify: `src/app/raci-panel.tsx`
- Modify: `src/app/workspace-section.tsx` (thread the new props if the panel needs them)
- Test: `src/app/raci-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("offers the Suggest RACI trigger when AI is configured", () => {
  renderRaciPanel({ aiEnabled: true });
  expect(screen.getByRole("button", { name: t("en-US", "raciSuggest") })).toBeTruthy();
});

it("hides the trigger in a popout", () => {
  renderRaciPanel({ aiEnabled: true, isPopout: true });
  expect(screen.queryByRole("button", { name: t("en-US", "raciSuggest") })).toBeNull();
});

it("hides the trigger when there are no milestones to assign against", () => {
  renderRaciPanel({ aiEnabled: true, milestones: [] });
  expect(screen.queryByRole("button", { name: t("en-US", "raciSuggest") })).toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/raci-panel.test.tsx -t "Suggest RACI"`
Expected: FAIL

- [ ] **Step 3: Mount it**

In `src/app/raci-panel.tsx`:

```tsx
  const suggest = useRaciSuggest({
    settings, isPopout: isPopout ?? false, lang,
    stakeholders, milestones, onSave, capture, logActivity,
  });
```

Render `{suggest.button}` in the panel toolbar, to the LEFT of the trailing Print/Reset group, and `{suggest.modal}` beside the panel's other modals.

`RaciPanelProps` gains whatever of `settings` / `capture` / `logActivity` it does not already receive; thread them from `workspace-section.tsx` the way the sibling panels get theirs.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/raci-panel.test.tsx src/app/workspace-section.characterization.test.tsx`
Expected: PASS. The characterization test pins the prop contract, so new props must be reflected there.

- [ ] **Step 5: Verify by eye — RACI is not in the axe gate**

Run: `npm run dev`, open Stakeholders → RACI, confirm the trigger renders and the modal's per-row checkboxes read distinctly in a screen reader.

- [ ] **Step 6: Commit**

```bash
git add src/app/raci-panel.tsx src/app/workspace-section.tsx src/app/raci-panel.test.tsx
git commit -m "feat(raci): mount Suggest RACI in the matrix toolbar"
```

---

# Phase G — release

## Task 25: Full gate run

- [ ] **Step 1: Run every blocking gate**

```bash
npm run lint
npx tsc --noEmit
npm run test:run
npm run test:coverage
npm run dup:check
npm run size:check
```

Expected: all exit 0.

`dup:check` matters here — Tasks 3, 4 and 5 each add a similar icon-button block. If jscpd flags them, extract the shared shape rather than raising the threshold.

`size:check` matters for `tasks-section.tsx` and `resources-panel.tsx`, which took several additions. If either crosses the ratchet, split it along the gantt convention (orchestrator + `*-rows` + `*-toolbar`) rather than baselining the growth.

- [ ] **Step 2: Run the a11y gate on a fresh isolated server**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium
PORT=3100 npm run stop
```

Expected: 85/85 checks pass.

Never reuse the long-running `:3000` dev server — `reuseExistingServer` will attach to a stale Tailwind build and produce phantom failures.

- [ ] **Step 3: Run the rest of the e2e suite**

Run: `npm run e2e`
Expected: PASS

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: gate fixes for the toolbar-polish batch"
```

---

## Task 26: Version bump and changelog

★★ **Six places carry the version and no gate checks five of them.**

- [ ] **Step 1: Pick a codename and prove it is unused**

Run: `grep -in "<candidate>" CHANGELOG.md`
Expected: no matches. Codenames are unique; pick another on any hit.

- [ ] **Step 2: Bump every version site**

- `src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, milestone
- `package.json` — `version`
- `package-lock.json` — **two** occurrences: the root `version` and the `packages[""]` one
- `README.md` — the shields badge, both version **and** codename
- `docs/CODEMAPS/*.md` — the `<!-- Generated: … | App <version> "<codename>" … -->` header on **all five**

- [ ] **Step 3: Add the changelog entry**

Add a `CHANGELOG.md` section covering the 19 items, grouped as in the spec.

- [ ] **Step 4: Add the release highlight**

Append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` and add its EN + DE strings (DE via the node-write recipe from Task 1).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run test:run`
Expected: exit 0

Run: `grep -rn "$(node -p "require('./package.json').version")" README.md docs/CODEMAPS/ | wc -l`
Expected: at least 6 (one README badge line plus five codemap headers).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(release): bump version for the toolbar-polish batch"
```

---

## Task 27: Update AGENTS.md

- [ ] **Step 1: Correct the claims this batch invalidated**

Grep before editing — several of these lines assert things that are now false:

- The toolbar-order bullet says Open Points already follows the convention. It did not; Task 16 fixed it. Update the wording so it documents the rule, not a false compliance claim.
- `PrintButton`'s `iconOnly` prop no longer exists — remove any reference.
- The theme-gallery bullet describes an Apply button per card. Update it.
- The Settings-General bullet describes the project block. Remove it.
- Add a line for `raci-suggest/` under the AI section, and one for the `RichTextEditorHandle` append API under the rich-text section.
- Add the fold-per-stakeholder landmine from Task 23 next to the existing functional-setter landmine — it is a *different* failure mode with the same symptom, and the existing bullet does not cover it.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for the toolbar-polish batch"
```

---

## Self-review notes

Checked against the spec:

- Every spec item A1–A3, B1–B6, C1–C2, D1–D5, E1–E2, F maps to a task: A1→2, A2→3, A3→4, B1→5, B2→6, B3→7, B4→8, B5→9, B6→10, C1→11, C2→12, D1→13, D2→14, D3→15, D4→16, D5→17, E1→18+19, E2→20, F→21+22+23+24.
- Spec risk 1 (i18n churn) → Task 1 serializes additions; Task 12 handles deletions.
- Spec risk 2 (unused-symbol fallout) → explicit lint steps in Tasks 11 and 12.
- Spec risk 3 (shared-node blast radius) → grep steps in Tasks 2 and 6.
- Spec risk 4 (RACI apply) → Task 23, with the failure mode revised after reading `use-stakeholders.ts`: the setter *is* functional, so the real defect is same-stakeholder cell folding in the caller. The test seeds two cells on one stakeholder.
- Deferred Blockers rich text is correctly absent from every task.

Naming is consistent across tasks: `cellKey`, `groundRaciCells`, `parseRaciProposal`, `buildRaciContext`, `foldCellsByStakeholder`, `RichTextEditorHandle.appendText`, `MAX_VISIBLE_ROWS`, `MAX_RACI_CELLS`.
