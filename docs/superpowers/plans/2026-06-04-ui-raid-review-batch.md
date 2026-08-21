# UI polish batch + RAID review reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 10 small UI refinements (Dashboard, Budget Report, Reports, Chat, Help) plus a RAID-review reminder feature that extends the existing due-date nudges.

**Architecture:** Each UI tweak is a focused edit to one existing component. The RAID-review feature follows the established due-date pattern: a pure logic module (`raid-review.ts`), a settings extension, banner + modal components in `notifications.tsx`, and once-per-session firing via `use-due-alerts.ts`, wired in `task-manager.tsx`.

**Tech Stack:** Next.js (app dir), React, TypeScript, Tailwind (AIPM palette tokens only), Vitest 4 + Testing Library, fake-indexeddb (already a devDependency).

**Conventions:**
- Run tests with `npm run test:run -- <path>` (single file) and `npm run test:run` (full suite). Typecheck with `npx tsc --noEmit`.
- DE strings in `i18n.de.ts` MUST be ASCII (the Edit tool corrupts `"` → curly quotes). After any DE edit, verify: `git grep -nP "[^\x00-\x7F]" src/app/i18n.de.ts` should print nothing new.
- AIPM palette only: pink (`AIPM-pink`), purple (`AIPM-purple`), green (`AIPM-green`), dark-blue, etc. No gradients/shadows/off-palette.
- Commit each task separately with `git commit -F - <<'EOF' … EOF` (Bash tool).

---

### Task 1: Add all new i18n keys (EN + DE)

Add keys up front so later tasks just reference them.

**Files:**
- Modify: `src/app/i18n.ts` (EN map)
- Modify: `src/app/i18n.de.ts` (DE map)

- [ ] **Step 1: Add EN keys** to `src/app/i18n.ts` (place near related existing keys; the `TranslationKey` type is derived from this object so order is cosmetic):

```ts
// Help search
helpSearchPlaceholder: "Search help",
helpSearchNoResults: "No help topics match your search.",
// Dashboard status summary
dashboardStatusSave: "Save",
// RAID review reminders — settings
notifRaidReview: "RAID review reminders",
notifRaidReviewTooltip: "Nudge when RAID items are past their target date or have not been reviewed within the interval.",
raidReviewIntervalDays: "RAID review interval (days)",
raidReviewIntervalDaysTooltip: "An open RAID item not touched within this many days is flagged for review.",
// RAID review reminders — banner / modal / toast
raidReviewBannerAria: "RAID review reminders",
raidReviewBannerTitle: "{0} RAID items need review",
raidReviewToastTitle: "RAID review due",
raidReviewSummaryOverdue: "{0} past target",
raidReviewSummaryStale: "{0} not reviewed",
raidReviewModalTitle: "RAID items to review",
raidReviewModalNone: "No RAID items need review.",
raidReviewReasonOverdue: "Past target",
raidReviewReasonStale: "Needs review",
raidReviewLastTouched: "Last touched",
// Version highlight
versionHighlightRaidReview: "RAID review reminders flag overdue & stale items; RAG polish on the dashboard and budget report.",
```

- [ ] **Step 2: Add the matching DE keys** to `src/app/i18n.de.ts` (ASCII only — no umlauts, no curly quotes):

```ts
helpSearchPlaceholder: "Hilfe durchsuchen",
helpSearchNoResults: "Keine Hilfethemen passen zur Suche.",
dashboardStatusSave: "Speichern",
notifRaidReview: "RAID-Pruefungserinnerungen",
notifRaidReviewTooltip: "Hinweis, wenn RAID-Eintraege ihr Zieldatum ueberschritten haben oder nicht innerhalb des Intervalls geprueft wurden.",
raidReviewIntervalDays: "RAID-Pruefintervall (Tage)",
raidReviewIntervalDaysTooltip: "Ein offener RAID-Eintrag, der innerhalb dieser Tage nicht bearbeitet wurde, wird zur Pruefung markiert.",
raidReviewBannerAria: "RAID-Pruefungserinnerungen",
raidReviewBannerTitle: "{0} RAID-Eintraege brauchen eine Pruefung",
raidReviewToastTitle: "RAID-Pruefung faellig",
raidReviewSummaryOverdue: "{0} ueber Ziel",
raidReviewSummaryStale: "{0} nicht geprueft",
raidReviewModalTitle: "Zu pruefende RAID-Eintraege",
raidReviewModalNone: "Keine RAID-Eintraege muessen geprueft werden.",
raidReviewReasonOverdue: "Ueber Ziel",
raidReviewReasonStale: "Pruefung faellig",
raidReviewLastTouched: "Zuletzt geaendert",
versionHighlightRaidReview: "RAID-Pruefungserinnerungen markieren ueberfaellige und veraltete Eintraege; RAG-Politur im Dashboard und Budgetbericht.",
```

- [ ] **Step 3: Typecheck + verify DE is ASCII**

Run: `npx tsc --noEmit`
Expected: no errors (both maps must stay key-aligned — TS errors if a key is missing on one side).
Run: `git grep -nP "[^\x00-\x7F]" src/app/i18n.de.ts`
Expected: no NEW non-ASCII lines among the keys you added.

- [ ] **Step 4: Commit**

```
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: add i18n keys for UI batch + RAID review reminders
EOF
```

---

### Task 2: Widen `Tile.value` to `ReactNode`

Enables colorized R/A/G counts (Task 3) without touching every caller.

**Files:**
- Modify: `src/app/report-table.tsx:129-139`
- Test: `src/app/report-table.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `src/app/report-table.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Tile } from "./report-table";

test("Tile renders a ReactNode value", () => {
  render(<Tile label="Split" value={<span data-testid="node">1 / 2 / 3</span>} />);
  expect(screen.getByTestId("node")).toHaveTextContent("1 / 2 / 3");
});
```

- [ ] **Step 2: Run it — expect a TYPE/compile error** (value currently typed `string`)

Run: `npx tsc --noEmit`
Expected: error that `Element` is not assignable to `string` on the `value` prop.

- [ ] **Step 3: Widen the prop type** in `src/app/report-table.tsx`:

```tsx
export function Tile({ label, value, rag }: { label: string; value: React.ReactNode; rag?: React.ReactNode }) {
```

(The JSX body is unchanged — `<span>{value}</span>` already accepts a `ReactNode`.)

- [ ] **Step 4: Run test + typecheck**

Run: `npm run test:run -- src/app/report-table.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```
git add src/app/report-table.tsx src/app/report-table.test.tsx
git commit -F - <<'EOF'
refactor: allow ReactNode values in report-table Tile
EOF
```

---

### Task 3: Dashboard — colorized R/A/G, burn RAG bubbles, boxed sections, status Save button

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Test: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Write failing tests** — append to `src/app/dashboard-panel.test.tsx`. (Reuse the existing render helper/fixtures in that file; the snippet below assumes a `renderDashboard(props)` style or adapt to the file's existing setup.)

```tsx
// Colorized counts: each number carries its health color class.
test("dashboard colorizes the R / A / G counts", () => {
  renderDashboardWithTasks(/* tasks producing R>0, A>0, G>0 */);
  const r = screen.getByText(String(/* expected R count */));
  expect(r.className).toContain("text-AIPM-pink");
});

// Progress + Budget burn are boxed cards.
test("Progress and Budget burn sections are boxed", () => {
  const { container } = renderDashboardWithBudget();
  // boxed Section => a div with rounded-lg border bg-surface wrapping the heading
  const progressHeading = screen.getByText(/Progress/i);
  expect(progressHeading.closest("div.rounded-lg")).not.toBeNull();
});

// Save button commits the narrative.
test("status summary Save button commits the draft narrative", async () => {
  const user = userEvent.setup();
  renderDashboard();
  const box = screen.getByPlaceholderText(/* narrative placeholder */);
  await user.type(box, "Slipping on integration");
  await user.click(screen.getByRole("button", { name: "Save" }));
  // assert setStatus was called / "Updated" label appears
  expect(screen.getByText(/Updated/i)).toBeInTheDocument();
});
```

> Adapt assertions to the file's existing test utilities. If the file lacks a budget fixture, add one with a single `BudgetBucket` so `model.burn` is non-null.

- [ ] **Step 2: Run them — expect failures**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: FAIL (no Save button, counts not colored, sections not boxed).

- [ ] **Step 3: Implement.** In `src/app/dashboard-panel.tsx`:

(a) Add the import:
```ts
import { ratioHealth } from "./budget-health";
```

(b) Replace the R/A/G tile (the `<Tile label="R / A / G" …/>`) with colorized spans:
```tsx
<Tile
  label="R / A / G"
  value={
    <span>
      <span className={healthText.R}>{model.progress.counts.R}</span>
      {" / "}
      <span className={healthText.A}>{model.progress.counts.A}</span>
      {" / "}
      <span className={healthText.G}>{model.progress.counts.G}</span>
    </span>
  }
/>
```

(c) Add `rag` to the two burn tiles:
```tsx
<Tile
  label={t(lang, "dashboardSubBudget")}
  value={`${money(model.burn.consumedValue)} / ${money(model.burn.budgetValue)}`}
  rag={<RagBadge value={ratioHealth(model.burn.consumedValue, model.burn.budgetValue)} lang={lang} title={t(lang, "dashboardSubBudget")} />}
/>
<Tile
  label="h"
  value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`}
  rag={<RagBadge value={ratioHealth(model.burn.actualHours, model.burn.budgetHours)} lang={lang} title="h" />}
/>
```

(d) Box the two sections — change `<Section title={t(lang, "dashboardProgress")}>` and `<Section title={t(lang, "dashboardBudgetBurn")}>` to add `boxed`:
```tsx
<Section title={t(lang, "dashboardProgress")} boxed>
…
<Section title={t(lang, "dashboardBudgetBurn")} boxed>
```

(e) Status-summary Save button + always-on label. Replace the narrative `<Section>` body:
```tsx
<Section title={t(lang, "dashboardStatusSummary")}>
  <textarea
    className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm"
    placeholder={t(lang, "dashboardNarrativePlaceholder")}
    value={draftNarrative}
    onChange={(e) => setDraftNarrative(e.target.value)}
    onBlur={commitNarrative}
  />
  <div className="mt-1 flex items-center justify-between gap-2">
    <span className="text-xs text-muted-foreground">
      {status.narrativeUpdatedAt
        ? t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))
        : ""}
    </span>
    <button
      type="button"
      onClick={commitNarrative}
      disabled={draftNarrative.trim() === (status.narrative ?? "")}
      className="rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
    >
      {t(lang, "dashboardStatusSave")}
    </button>
  </div>
</Section>
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -F - <<'EOF'
feat: dashboard RAG polish — colorized counts, burn bubbles, boxed sections, status Save
EOF
```

---

### Task 4: Budget Report — burndown caption + RAG bubbles on Plan(h)/Actual(h)/Revenue

**Files:**
- Modify: `src/app/budget-report-panel.tsx`
- Test: `src/app/budget-report-panel.test.tsx`

- [ ] **Step 1: Write failing tests** — append to `src/app/budget-report-panel.test.tsx` (reuse the file's existing render helper + bucket fixtures):

```tsx
test("budget report shows the burndown caption", () => {
  renderBudgetReport();
  expect(screen.getByText(/burn-down shows remaining budget/i)).toBeInTheDocument();
});

test("Plan, Actual and Revenue tiles carry a RAG badge", () => {
  renderBudgetReport();
  // RagBadge renders an element with title === the tile label
  expect(screen.getByTitle(/Plan/i)).toBeInTheDocument();
  expect(screen.getByTitle(/Actual/i)).toBeInTheDocument();
  expect(screen.getByTitle(/Revenue/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:run -- src/app/budget-report-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** in `src/app/budget-report-panel.tsx`:

(a) Caption — under the burndown `<Section>`:
```tsx
<Section title={t(lang, "budgetBurndownTitle")}>
  <BurndownCharts series={burndown} lang={lang} currency={plan.currency || "EUR"} />
  <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
</Section>
```

(b) RAG bubbles on the three project-total tiles (Budget(h) stays plain):
```tsx
<Tile label={t(lang, "budgetPlanHours")} value={proj.plannedHours.toFixed(0)}
  rag={<RagBadge value={ratioHealth(proj.plannedHours, proj.budgetHours)} lang={lang} title={t(lang, "budgetPlanHours")} />} />
<Tile label={t(lang, "budgetActualHours")} value={proj.actualHours.toFixed(0)}
  rag={<RagBadge value={ratioHealth(proj.actualHours, proj.budgetHours)} lang={lang} title={t(lang, "budgetActualHours")} />} />
<Tile label={t(lang, "budgetReportRevenue")} value={money(proj.revenue)}
  rag={<RagBadge value={marginHealth(proj.contributionMargin.percent)} lang={lang} title={t(lang, "budgetReportRevenue")} />} />
```

(`ratioHealth` and `marginHealth` are already imported in this file.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/app/budget-report-panel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx
git commit -F - <<'EOF'
feat: budget report — burndown caption + RAG bubbles on plan/actual hours & revenue
EOF
```

---

### Task 5: Reports — remove added reports via a dropdown

**Files:**
- Modify: `src/app/reports.tsx:371-398`
- Test: `src/app/reports.test.tsx`

- [ ] **Step 1: Write failing test** — append to `src/app/reports.test.tsx`:

```tsx
test("a remove-report dropdown is offered when reports are added and removes the chosen one", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderReports({ extraReports: ["raid-report", "budget-report"], onChangeExtraReports: onChange });
  const remove = screen.getByLabelText("Remove report") as HTMLSelectElement; // aria-label
  await user.selectOptions(remove, "raid-report");
  expect(onChange).toHaveBeenCalledWith(["budget-report"]);
});

test("the remove dropdown is absent when no reports are added", () => {
  renderReports({ extraReports: [], onChangeExtraReports: vi.fn() });
  expect(screen.queryByLabelText("Remove report")).toBeNull();
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:run -- src/app/reports.test.tsx`
Expected: FAIL (no remove dropdown).

- [ ] **Step 3: Implement.** In `reports.tsx`, just after the `addReportControl` definition (~line 388), add a sibling control and pass both to the toolbar:

```tsx
const removeReportControl = extraReports.length > 0 ? (
  <select
    aria-label={t(lang, "reportsRemoveReport")}
    value=""
    onChange={(e) => {
      const id = e.target.value as AddableReportId;
      if (id) onChangeExtraReports?.(extraReports.filter((x) => x !== id));
    }}
    className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
  >
    <option value="">{`− ${t(lang, "reportsRemoveReport")}`}</option>
    {extraReports.map((id) => {
      const meta = ADDABLE_REPORTS.find((r) => r.id === id);
      return meta ? <option key={id} value={id}>{t(lang, meta.titleKey)}</option> : null;
    })}
  </select>
) : null;
```

Then change the `ReportCard` `toolbarExtra` prop (~line 398) to render both:
```tsx
toolbarExtra={<>{addReportControl}{removeReportControl}</>}
```

(`reportsRemoveReport` already exists in i18n. `−` is the minus sign, mirroring the `+ Add report` affordance.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/app/reports.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/app/reports.tsx src/app/reports.test.tsx
git commit -F - <<'EOF'
feat: reports — remove added reports via a dropdown (alongside the x button)
EOF
```

---

### Task 6: Chat — reset button on the left + textarea height matches button stack

**Files:**
- Modify: `src/app/chat-panel.tsx:326-357`
- Test: `src/app/chat-panel.test.tsx`

- [ ] **Step 1: Write failing test** — append to `src/app/chat-panel.test.tsx` (reuse the file's render helper; consent is auto-accepted there or pass `ai.consentAccepted`):

```tsx
test("reset-size button sits before the textarea in the input row", () => {
  renderChat();
  const row = screen.getByPlaceholderText(/* chat placeholder */).parentElement!;
  const reset = screen.getByRole("button", { name: /reset size/i }); // adapt to ResetSizeButton aria-label
  const textarea = screen.getByPlaceholderText(/* chat placeholder */);
  // reset precedes the textarea in DOM order within the row
  expect(row.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeFalsy();
});
```

> If `ResetSizeButton`'s accessible name is unknown, grep `task-manager-ui.tsx` for its `aria-label`/`title` and match it. Keep the assertion about DOM order only.

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:run -- src/app/chat-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** Replace the input row (the `<div className="mt-3 flex items-end gap-2"> … </div>`) with:

```tsx
<div className="mt-3 flex items-stretch gap-2">
  <ResetSizeButton onClick={resetChatSize} lang={lang} className="self-center" />
  <textarea
    ref={inputRef}
    rows={2}
    maxLength={CHAT_MESSAGE_MAX}
    value={input}
    onChange={(e) => setInput(e.target.value)}
    onKeyDown={onKeyDown}
    placeholder={t(lang, "chatPlaceholder")}
    disabled={busy || apiKeyMissing}
    className="min-w-0 flex-1 self-stretch resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:opacity-50"
  />
  <div className="flex flex-col gap-2">
    <button
      type="button"
      onClick={sendMessage}
      disabled={busy || !input.trim() || apiKeyMissing}
      className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t(lang, "chatSend")}
    </button>
    <button
      type="button"
      onClick={clearChat}
      disabled={busy || display.length === 0}
      className="rounded-md border border-line bg-surface px-4 py-2 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t(lang, "chatClear")}
    </button>
  </div>
</div>
```

- [ ] **Step 3b: Make `ResetSizeButton` accept `className`.** Check `src/app/task-manager-ui.tsx` `ResetSizeButton` signature. If it does not already accept `className`, add an optional `className?: string` prop and append it to the button's class list (e.g. `className={\`<existing classes> ${className ?? ""}\`}`). Do not change its default appearance.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/app/chat-panel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/app/chat-panel.tsx src/app/task-manager-ui.tsx src/app/chat-panel.test.tsx
git commit -F - <<'EOF'
feat: chat — reset-size button left-of-input (centered); textarea matches button-stack height
EOF
```

---

### Task 7: Help — full-text search (filter + highlight + jump)

**Files:**
- Create: `src/app/help-search.ts` (pure helper)
- Create: `src/app/help-search.test.ts`
- Modify: `src/app/help-menu.tsx`
- Test: `src/app/help-menu.test.tsx` (create if absent)

- [ ] **Step 1: Write failing test** for the pure helper — `src/app/help-search.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { matchesQuery, highlightSegments } from "./help-search";

describe("matchesQuery", () => {
  test("true when query empty", () => {
    expect(matchesQuery("Title", "Body", "")).toBe(true);
  });
  test("matches title case-insensitively", () => {
    expect(matchesQuery("Gantt chart", "body", "GANTT")).toBe(true);
  });
  test("matches body", () => {
    expect(matchesQuery("Title", "keyboard shortcuts", "keyboard")).toBe(true);
  });
  test("false on no match", () => {
    expect(matchesQuery("Title", "Body", "zzz")).toBe(false);
  });
});

describe("highlightSegments", () => {
  test("splits a string into matched / unmatched parts", () => {
    expect(highlightSegments("abcABCabc", "abc")).toEqual([
      { text: "abc", match: true },
      { text: "ABC", match: true },
      { text: "abc", match: true },
    ]);
  });
  test("returns one unmatched segment when query empty", () => {
    expect(highlightSegments("hello", "")).toEqual([{ text: "hello", match: false }]);
  });
  test("preserves surrounding text", () => {
    expect(highlightSegments("a key b", "key")).toEqual([
      { text: "a ", match: false },
      { text: "key", match: true },
      { text: " b", match: false },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect failure** (module missing)

Run: `npm run test:run -- src/app/help-search.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement** `src/app/help-search.ts`:

```ts
export type HighlightSegment = { text: string; match: boolean };

/** Case-insensitive substring test across a section's title and body. */
export function matchesQuery(title: string, body: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return title.toLowerCase().includes(q) || body.toLowerCase().includes(q);
}

/** Split `text` into segments, flagging case-insensitive matches of `query`. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: HighlightSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(needle, i);
    if (hit === -1) {
      out.push({ text: text.slice(i), match: false });
      break;
    }
    if (hit > i) out.push({ text: text.slice(i, hit), match: false });
    out.push({ text: text.slice(hit, hit + needle.length), match: true });
    i = hit + needle.length;
  }
  return out;
}
```

- [ ] **Step 4: Run helper tests**

Run: `npm run test:run -- src/app/help-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing component test** — `src/app/help-menu.test.tsx` (create if absent):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpMenu } from "./help-menu";

async function openHelp() {
  const user = userEvent.setup();
  render(<HelpMenu lang="en-US" />);
  await user.click(screen.getByRole("button", { name: /help/i }));
  return user;
}

test("typing in the search box filters the section list", async () => {
  const user = await openHelp();
  const search = await screen.findByPlaceholderText("Search help");
  await user.type(search, "keyboard");
  // Only sections matching "keyboard" remain as tabs.
  const tabs = screen.getAllByRole("tab");
  expect(tabs.length).toBeGreaterThan(0);
  for (const tab of tabs) {
    // each surviving tab's section matched; at least the Keyboard section is present
  }
  expect(screen.getByText(/Keyboard|Shortcuts/i)).toBeInTheDocument();
});

test("no-results state when nothing matches", async () => {
  const user = await openHelp();
  await user.type(await screen.findByPlaceholderText("Search help"), "zzzznotfound");
  expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run — expect failure**

Run: `npm run test:run -- src/app/help-menu.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implement** in `src/app/help-menu.tsx`:

(a) Imports:
```ts
import { matchesQuery, highlightSegments } from "./help-search";
```

(b) Add state near `activeIdx`:
```ts
const [query, setQuery] = useState("");
```

(c) Compute the filtered sections and a clamped active index (place after `SECTIONS` is in scope, inside the component):
```ts
const filtered = SECTIONS.map((s, i) => ({ s, i })).filter(({ s }) =>
  matchesQuery(t(lang, s.titleKey), t(lang, s.bodyKey), query),
);
// When the query changes the active section may fall out of the filtered set;
// snap to the first match. Derived during render — no effect needed.
const activeInFiltered = filtered.some(({ i }) => i === activeIdx);
const effectiveIdx = activeInFiltered ? activeIdx : (filtered[0]?.i ?? -1);
```

(d) Add the search input directly above the tablist `<div role="tablist" …>`:
```tsx
<div className="shrink-0 border-r border-line p-2">
  <input
    type="search"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    placeholder={t(lang, "helpSearchPlaceholder")}
    aria-label={t(lang, "helpSearchPlaceholder")}
    className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-AIPM-dark-blue focus:outline-none"
  />
</div>
```

> Wrap the existing search input + tablist + tabpanel so layout still works: keep the search box and tablist in the left column. Simplest: place the search box inside the existing `<div role="tablist">`'s parent left column, above the tablist. The tablist then maps over `filtered` instead of `SECTIONS`, using `entry.i` for ids and `effectiveIdx` for `aria-selected`/active styling.

(e) Change the tablist to map over `filtered`:
```tsx
{filtered.map(({ s, i }) => {
  const isActive = i === effectiveIdx;
  return (
    <button
      key={s.titleKey}
      ref={(el) => { tabRefs.current[i] = el; }}
      type="button"
      role="tab"
      id={`help-tab-${i}`}
      aria-selected={isActive}
      aria-controls={`help-panel-${i}`}
      tabIndex={isActive ? 0 : -1}
      onClick={() => setActiveIdx(i)}
      onKeyDown={onTabKeyDown}
      className={isActive
        ? "block w-full border-l-2 border-AIPM-dark-blue bg-surface-muted px-3 py-1.5 text-left text-xs font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
        : "block w-full border-l-2 border-transparent px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue dark:text-muted-foreground dark:hover:text-AIPM-light-grey"}
    >
      {t(lang, s.titleKey)}
    </button>
  );
})}
```

(f) Update `onTabKeyDown` to navigate within `filtered`. Replace its body so Arrow/Home/End move across the filtered indices:
```ts
const onTabKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const order = SECTIONS.map((s, i) => ({ s, i })).filter(({ s }) =>
      matchesQuery(t(lang, s.titleKey), t(lang, s.bodyKey), query),
    ).map(({ i }) => i);
    if (order.length === 0) return;
    const cur = Math.max(0, order.indexOf(activeIdx));
    let nextPos = cur;
    if (e.key === "ArrowDown") { e.preventDefault(); nextPos = (cur + 1) % order.length; }
    else if (e.key === "ArrowUp") { e.preventDefault(); nextPos = (cur - 1 + order.length) % order.length; }
    else if (e.key === "Home") { e.preventDefault(); nextPos = 0; }
    else if (e.key === "End") { e.preventDefault(); nextPos = order.length - 1; }
    else return;
    const idx = order[nextPos];
    setActiveIdx(idx);
    tabRefs.current[idx]?.focus();
  },
  [activeIdx, lang, query],
);
```

(g) Render the tabpanel body with highlighting + a no-results state. Replace the body paragraph block:
```tsx
{effectiveIdx === -1 ? (
  <p className="text-sm text-muted-foreground">{t(lang, "helpSearchNoResults")}</p>
) : (
  <>
    <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
      {highlightSegments(t(lang, SECTIONS[effectiveIdx].titleKey), query).map((seg, k) =>
        seg.match ? <mark key={k} className="bg-AIPM-green/30 text-foreground">{seg.text}</mark> : <span key={k}>{seg.text}</span>,
      )}
    </p>
    <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-foreground">
      {highlightSegments(t(lang, SECTIONS[effectiveIdx].bodyKey), query).map((seg, k) =>
        seg.match ? <mark key={k} className="bg-AIPM-green/30 text-foreground">{seg.text}</mark> : <span key={k}>{seg.text}</span>,
      )}
    </p>
  </>
)}
```

Also update the `role="tabpanel"` wrapper's `id`/`aria-labelledby` to use `effectiveIdx` (guard the `-1` case — when `-1`, omit the ids or keep them as `help-panel--1`; the no-results branch has no active tab so it is acceptable).

- [ ] **Step 8: Run tests + typecheck**

Run: `npm run test:run -- src/app/help-search.test.ts src/app/help-menu.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```
git add src/app/help-search.ts src/app/help-search.test.ts src/app/help-menu.tsx src/app/help-menu.test.tsx
git commit -F - <<'EOF'
feat: help — full-text search with section filtering, highlighting and jump-to-first-match
EOF
```

---

### Task 8: `raid-review.ts` — pure logic for "items overdue for review"

**Files:**
- Create: `src/app/raid-review.ts`
- Create: `src/app/raid-review.test.ts`

- [ ] **Step 1: Inspect `raid.ts`** for an existing open/closed predicate. Run: `git grep -n "closedDate\|isClosed\|isOpen\|TERMINAL" src/app/raid.ts`. If a helper like `isRaidClosed(item)` exists, import and use it; otherwise use the inline terminal-status set below. Document which you used in a code comment.

- [ ] **Step 2: Write failing tests** — `src/app/raid-review.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { getRaidReviewItems, summarizeRaidReview } from "./raid-review";
import type { RaidItem } from "./types";

function raid(partial: Partial<RaidItem>): RaidItem {
  return {
    id: 1, category: "R", title: "x", status: "Open",
    linkedTaskIds: [], causedByRaidIds: [], raisedDate: "2026-01-01",
    ...partial,
  };
}
const TODAY = "2026-06-04";

describe("getRaidReviewItems", () => {
  test("flags an open item past its target date as overdue", () => {
    const out = getRaidReviewItems([raid({ id: 1, targetDate: "2026-05-01", localModifiedAt: "2026-06-03T00:00:00Z" })], TODAY, 14);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("overdue");
    expect(out[0].daysOverdue).toBeGreaterThan(0);
  });

  test("flags an untouched open item as stale", () => {
    // last touch raisedDate 2026-01-01, interval 14 -> stale
    const out = getRaidReviewItems([raid({ id: 2, raisedDate: "2026-01-01" })], TODAY, 14);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("stale");
  });

  test("recently-touched, no target = not flagged", () => {
    const out = getRaidReviewItems([raid({ id: 3, localModifiedAt: "2026-06-02T00:00:00Z" })], TODAY, 14);
    expect(out).toHaveLength(0);
  });

  test("overdue wins when both apply", () => {
    const out = getRaidReviewItems([raid({ id: 4, targetDate: "2026-05-01", raisedDate: "2026-01-01" })], TODAY, 14);
    expect(out[0].reason).toBe("overdue");
  });

  test("excludes closed / terminal items", () => {
    const closed = raid({ id: 5, status: "Closed", closedDate: "2026-05-01", targetDate: "2026-01-01" });
    const resolved = raid({ id: 6, status: "Resolved", targetDate: "2026-01-01" });
    expect(getRaidReviewItems([closed, resolved], TODAY, 14)).toHaveLength(0);
  });

  test("interval boundary: exactly interval days untouched is flagged", () => {
    // 2026-05-21 is 14 days before 2026-06-04
    const out = getRaidReviewItems([raid({ id: 7, raisedDate: "2026-05-21" })], TODAY, 14);
    expect(out).toHaveLength(1);
  });

  test("sorts overdue before stale, most overdue first", () => {
    const items = [
      raid({ id: 10, raisedDate: "2026-01-01" }),                       // stale
      raid({ id: 11, targetDate: "2026-05-20" }),                       // overdue 15d
      raid({ id: 12, targetDate: "2026-03-01" }),                       // overdue ~95d
    ];
    const out = getRaidReviewItems(items, TODAY, 14);
    expect(out.map((o) => o.item.id)).toEqual([12, 11, 10]);
  });

  test("empty input -> empty", () => {
    expect(getRaidReviewItems([], TODAY, 14)).toEqual([]);
  });
});

describe("summarizeRaidReview", () => {
  test("counts overdue and stale", () => {
    const items = getRaidReviewItems(
      [raid({ id: 1, targetDate: "2026-01-01" }), raid({ id: 2, raisedDate: "2026-01-01" })],
      TODAY, 14,
    );
    expect(summarizeRaidReview(items)).toEqual({ overdue: 1, stale: 1 });
  });
});
```

- [ ] **Step 3: Run — expect failure**

Run: `npm run test:run -- src/app/raid-review.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement** `src/app/raid-review.ts`:

```ts
import type { RaidItem, RaidStatus } from "./types";

export type RaidReviewReason = "overdue" | "stale";

export type RaidReviewItem = {
  item: RaidItem;
  reason: RaidReviewReason; // "overdue" wins when both apply
  daysOverdue: number;      // whole days past targetDate, else 0
  daysSinceReview: number;  // whole days since last touch
};

// Terminal statuses — an item in one of these is considered resolved and is not
// nudged for review. (If raid.ts exposes a shared predicate, prefer it.)
const TERMINAL: ReadonlySet<RaidStatus> = new Set<RaidStatus>([
  "Closed", "Resolved", "Delivered", "Validated", "Invalidated",
]);

function isActive(item: RaidItem): boolean {
  return !item.closedDate && !TERMINAL.has(item.status);
}

/** Whole-day difference (a - b) for two YYYY-MM-DD dates; negative if a < b. */
function dayDiff(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  return Math.round((da - db) / 86_400_000);
}

/** Last-touch date (YYYY-MM-DD): localModifiedAt date part, else raisedDate. */
function lastTouch(item: RaidItem): string {
  return item.localModifiedAt ? item.localModifiedAt.slice(0, 10) : item.raisedDate;
}

export function getRaidReviewItems(
  raid: RaidItem[],
  today: string,
  reviewIntervalDays: number,
): RaidReviewItem[] {
  const out: RaidReviewItem[] = [];
  for (const item of raid) {
    if (!isActive(item)) continue;
    const daysOverdue = item.targetDate && item.targetDate < today ? dayDiff(today, item.targetDate) : 0;
    const daysSinceReview = dayDiff(today, lastTouch(item));
    const overdue = daysOverdue > 0;
    const stale = daysSinceReview >= reviewIntervalDays;
    if (!overdue && !stale) continue;
    out.push({ item, reason: overdue ? "overdue" : "stale", daysOverdue, daysSinceReview });
  }
  out.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "overdue" ? -1 : 1;
    if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
    return b.daysSinceReview - a.daysSinceReview;
  });
  return out;
}

export function summarizeRaidReview(items: RaidReviewItem[]): { overdue: number; stale: number } {
  let overdue = 0;
  let stale = 0;
  for (const i of items) {
    if (i.reason === "overdue") overdue++;
    else stale++;
  }
  return { overdue, stale };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:run -- src/app/raid-review.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/app/raid-review.ts src/app/raid-review.test.ts
git commit -F - <<'EOF'
feat: raid-review logic — flag active RAID items past target or stale
EOF
```

---

### Task 9: Settings — `raidReview` + `raidReviewIntervalDays`

**Files:**
- Modify: `src/app/settings-types.ts:29-43`
- Test: `src/app/settings-types.test.ts` (create if absent) OR add to the existing settings sanitize test (grep `git grep -l "defaultNotificationsConfig\|sanitizeSettings\|resolveSettings"`).

- [ ] **Step 1: Find the notifications load/merge path.** Run: `git grep -n "notifications" src/app/storage.ts src/app/settings-menu.tsx src/app/use-settings.ts`. Identify where saved `notifications` is parsed/merged onto defaults (likely a spread `{ ...defaultNotificationsConfig, ...raw.notifications }` or a dedicated sanitizer). You will ensure the two new keys are backfilled there.

- [ ] **Step 2: Write failing test** for defaults + backfill — add to the settings test file:

```ts
import { defaultNotificationsConfig } from "./settings-types";

test("notifications defaults include RAID review enabled with a 14-day interval", () => {
  expect(defaultNotificationsConfig.raidReview).toEqual({ enabled: true });
  expect(defaultNotificationsConfig.raidReviewIntervalDays).toBe(14);
});
```

If a notifications sanitizer/merge function exists, also assert that parsing a legacy object without the keys yields the defaults:
```ts
// e.g. expect(mergeNotifications({ reminderLeadDays: 7 }).raidReviewIntervalDays).toBe(14);
```

- [ ] **Step 3: Run — expect failure**

Run: `npm run test:run -- <settings test path>`
Expected: FAIL.

- [ ] **Step 4: Implement.** In `settings-types.ts` extend the type + default:

```ts
export type NotificationsConfig = {
  reminderLeadDays: number;
  banner: ChannelConfig;
  toast: ChannelConfig;
  popup: ChannelConfig;
  birthday: ChannelConfig;
  raidReview: ChannelConfig;
  raidReviewIntervalDays: number;
};

export const defaultNotificationsConfig: NotificationsConfig = {
  reminderLeadDays: 7,
  banner: { enabled: true },
  toast: { enabled: true },
  popup: { enabled: true },
  birthday: { enabled: true },
  raidReview: { enabled: true },
  raidReviewIntervalDays: 14,
};
```

Then in the load/merge path found in Step 1, ensure missing keys fall back to defaults. If it currently does `{ ...defaultNotificationsConfig, ...raw.notifications }`, that already backfills scalars but a present-but-partial `raidReview` is fine since old saves lack the key entirely. If there is an explicit field-by-field sanitizer, add:
```ts
raidReview: { enabled: typeof raw?.raidReview?.enabled === "boolean" ? raw.raidReview.enabled : true },
raidReviewIntervalDays: clampInt(raw?.raidReviewIntervalDays, 1, 365, 14),
```
(Use the file's existing clamp/coerce idiom; if none, inline `Math.max(1, Math.min(365, Math.round(Number(x) || 14)))`.)

- [ ] **Step 5: Run test + typecheck**

Run: `npm run test:run -- <settings test path> && npx tsc --noEmit`
Expected: PASS. (Typecheck may surface other places that build a `NotificationsConfig` literal — fix each by adding the two fields, defaulting to `{ enabled: true }` / `14`.)

- [ ] **Step 6: Commit**

```
git add src/app/settings-types.ts <settings test path> <any files fixed for the new fields>
git commit -F - <<'EOF'
feat: settings — add raidReview channel + raidReviewIntervalDays (default on, 14d)
EOF
```

---

### Task 10: NotificationsSection — RAID-review toggle + interval input

**Files:**
- Modify: `src/app/settings-sections/notifications-section.tsx`
- Test: `src/app/settings-sections/notifications-section.test.tsx` (create if absent)

- [ ] **Step 1: Write failing test:**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsSection } from "./notifications-section";
import { defaultSettings } from "../settings-types";

test("toggling RAID review reminders calls onChange", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
  await user.click(screen.getByLabelText("RAID review reminders"));
  expect(onChange).toHaveBeenCalled();
  const next = onChange.mock.calls.at(-1)![0];
  expect(next.notifications.raidReview.enabled).toBe(false);
});

test("editing the review interval calls onChange with the clamped value", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
  const input = screen.getByLabelText("RAID review interval (days)") as HTMLInputElement;
  await user.clear(input);
  await user.type(input, "30");
  const next = onChange.mock.calls.at(-1)![0];
  expect(next.notifications.raidReviewIntervalDays).toBe(30);
});
```

> The toggle uses `t(lang,"notifRaidReview")` text as its accessible name; pair the `<input>` with that label. The interval input's `aria-label` must be `t(lang,"raidReviewIntervalDays")`.

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:run -- src/app/settings-sections/notifications-section.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** — add, after the birthday row (before the closing `</div>` of the section):

```tsx
<div className="mt-2 flex items-center gap-2 text-sm text-foreground">
  <label className="flex items-center gap-2">
    <input
      type="checkbox"
      checked={settings.notifications.raidReview.enabled}
      onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, raidReview: { enabled: e.target.checked } } })}
      className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
    />
    {t(lang, "notifRaidReview")}
  </label>
  <InfoTooltip text={t(lang, "notifRaidReviewTooltip")} />
</div>
<label className="mt-2 flex items-center justify-between gap-2 text-sm text-foreground">
  <span className="inline-flex items-center gap-1">
    {t(lang, "raidReviewIntervalDays")}
    <InfoTooltip text={t(lang, "raidReviewIntervalDaysTooltip")} />
  </span>
  <input
    type="number" min={1} max={365}
    aria-label={t(lang, "raidReviewIntervalDays")}
    value={settings.notifications.raidReviewIntervalDays}
    onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, raidReviewIntervalDays: Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 14))) } })}
    className="w-20 rounded-md border border-line px-2 py-1 text-right tabular-nums"
  />
</label>
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm run test:run -- src/app/settings-sections/notifications-section.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/app/settings-sections/notifications-section.tsx src/app/settings-sections/notifications-section.test.tsx
git commit -F - <<'EOF'
feat: settings UI — RAID review toggle + interval input
EOF
```

---

### Task 11: `reminder-snooze` kind + `RaidReviewBanner` / `RaidReviewModal` / toast text

**Files:**
- Modify: `src/app/reminder-snooze.ts:1`
- Modify: `src/app/notifications.tsx`
- Test: `src/app/notifications.test.tsx` (create if absent) — or add to existing notifications tests.

- [ ] **Step 1: Add the snooze kind.** In `reminder-snooze.ts`:
```ts
export type ReminderKind = "due" | "birthday" | "jiraToken" | "raidReview";
```

- [ ] **Step 2: Write failing test** — `src/app/notifications.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { RaidReviewBanner, raidReviewToastText } from "./notifications";
import { getRaidReviewItems } from "./raid-review";
import type { RaidItem } from "./types";

function raid(p: Partial<RaidItem>): RaidItem {
  return { id: 1, category: "R", title: "T", status: "Open", linkedTaskIds: [], causedByRaidIds: [], raisedDate: "2026-01-01", ...p };
}
const items = getRaidReviewItems([raid({ id: 1, targetDate: "2026-01-01", title: "Server risk" })], "2026-06-04", 14);

test("raidReviewToastText summarizes counts", () => {
  expect(raidReviewToastText(items, "en-US")).toMatch(/past target/i);
});

test("RaidReviewBanner shows the count and fires callbacks", () => {
  render(<RaidReviewBanner items={items} lang="en-US" onOpenList={() => {}} onDismiss={() => {}} onSnooze={() => {}} />);
  expect(screen.getByText(/1 RAID items need review/i)).toBeInTheDocument();
});

test("RaidReviewBanner renders nothing when empty", () => {
  const { container } = render(<RaidReviewBanner items={[]} lang="en-US" onOpenList={() => {}} onDismiss={() => {}} onSnooze={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 3: Run — expect failure**

Run: `npm run test:run -- src/app/notifications.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement** in `notifications.tsx`. Add imports + summary + components (mirrors `DueBanner`/`DueDatesModal`; reuses the existing `SnoozeMenu` and `Modal`):

```tsx
import { type RaidReviewItem, summarizeRaidReview } from "./raid-review";

function raidReviewSummary(items: RaidReviewItem[], lang: Lang): string {
  const { overdue, stale } = summarizeRaidReview(items);
  const parts: string[] = [];
  if (overdue > 0) parts.push(t(lang, "raidReviewSummaryOverdue", overdue));
  if (stale > 0) parts.push(t(lang, "raidReviewSummaryStale", stale));
  return parts.join(" · ");
}

export function raidReviewToastText(items: RaidReviewItem[], lang: Lang): string {
  return `${t(lang, "raidReviewToastTitle")} — ${raidReviewSummary(items, lang)}`;
}

export function RaidReviewBanner({
  items, lang, onOpenList, onDismiss, onSnooze,
}: {
  items: RaidReviewItem[];
  lang: Lang;
  onOpenList: () => void;
  onDismiss: () => void;
  onSnooze: (ms: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div role="region" aria-label={t(lang, "raidReviewBannerAria")}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-purple/40 bg-AIPM-purple/10 px-4 py-3 dark:border-AIPM-purple/60 dark:bg-AIPM-purple/15">
      <span aria-hidden className="text-lg">&#9888;</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "raidReviewBannerTitle", items.length)}</p>
        <p className="text-xs text-muted-foreground">{raidReviewSummary(items, lang)}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onOpenList}
          className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
          {t(lang, "alertBannerOpen")}
        </button>
        <SnoozeMenu lang={lang} onSnooze={onSnooze} />
        <button type="button" onClick={onDismiss} aria-label={t(lang, "alertBannerDismiss")}
          className="rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
          {t(lang, "alertBannerDismiss")}
        </button>
      </div>
    </div>
  );
}

export function RaidReviewModal({
  items, lang, onClose, onSelectRaid,
}: {
  items: RaidReviewItem[];
  lang: Lang;
  onClose: () => void;
  onSelectRaid?: (id: number) => void;
}) {
  const { ref: panelRef } = useResizable("lop-app:raid-review-modal-size");
  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "raidReviewModalTitle")}>
      <div ref={panelRef}
        className="relative h-[640px] max-h-[95vh] min-h-[300px] w-[640px] min-w-[320px] max-w-[95vw] resize overflow-y-auto rounded-xl border border-line bg-surface">
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "raidReviewModalTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{raidReviewSummary(items, lang)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t(lang, "alertModalClose")}
            className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path fillRule="evenodd" d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </header>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t(lang, "raidReviewModalNone")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map(({ item, reason, daysSinceReview }) => (
              <li key={item.id} className="px-6 py-3">
                <div className="flex items-start gap-3">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${reason === "overdue" ? "bg-AIPM-pink text-white" : "bg-AIPM-purple text-white"}`}>
                    {t(lang, reason === "overdue" ? "raidReviewReasonOverdue" : "raidReviewReasonStale")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
                      <span className="font-mono text-xs text-muted-foreground">#{item.id}</span> {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.owner ? `${item.owner} · ` : ""}
                      {item.targetDate ? `${t(lang, "raidTargetDate")}: ${item.targetDate} · ` : ""}
                      {t(lang, "raidReviewLastTouched")}: {daysSinceReview}d
                    </p>
                  </div>
                  {onSelectRaid && (
                    <button type="button" onClick={() => onSelectRaid(item.id)}
                      className="shrink-0 text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue">
                      {t(lang, "edit")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
```

> Verify `raidTargetDate` exists as an i18n key (`git grep -n "raidTargetDate" src/app/i18n.ts`). If not, use the existing key the RAID panel uses for target date, or fall back to a literal label key you add in Task 1's spirit — but prefer reuse.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:run -- src/app/notifications.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/app/reminder-snooze.ts src/app/notifications.tsx src/app/notifications.test.tsx
git commit -F - <<'EOF'
feat: RAID review banner + modal + toast text and snooze kind
EOF
```

---

### Task 12: Extend `use-due-alerts` to fire the RAID-review nudge

**Files:**
- Modify: `src/app/use-due-alerts.ts`
- Test: `src/app/use-due-alerts.test.ts`

- [ ] **Step 1: Write failing test** — add to `src/app/use-due-alerts.test.ts` (follow the file's existing harness for rendering the hook + asserting `showToast`):

```ts
test("fires a RAID-review toast once per session when items exist and channel on", async () => {
  const showToast = vi.fn();
  const raid = [{ id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [], causedByRaidIds: [], raisedDate: "2026-01-01" }];
  renderHook(() => useDueAlerts({
    hydrated: true, tasks: [/* >=1 task so the effect runs */], holidaySet: new Set(), absences: [],
    settings: { /* defaultSettings with notifications.raidReview.enabled true, toast on */ },
    today: "2026-06-04", showToast, raid,
  }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", expect.stringMatching(/RAID review due/i)));
});
```

> Match the existing test's settings-builder. The effect currently early-returns when `tasks.length === 0`; see Step 3 — guard on `tasks.length === 0 && raid.length === 0` instead so a RAID-only project still nudges.

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:run -- src/app/use-due-alerts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `use-due-alerts.ts`:

(a) Imports + args:
```ts
import { getRaidReviewItems } from "./raid-review";
import { raidReviewToastText } from "./notifications";
import type { Task, Absence, RaidItem } from "./types";
```
Add to `UseDueAlertsArgs`:
```ts
raid: RaidItem[];
```
Add to the return type:
```ts
raidReviewModalOpen: boolean;
setRaidReviewModalOpen: Dispatch<SetStateAction<boolean>>;
```

(b) State + ref:
```ts
const [raidReviewModalOpen, setRaidReviewModalOpen] = useState(false);
const raidRef = useRef(raid);
useEffect(() => { raidRef.current = raid; }, [raid]);
```

(c) In the once-per-session effect, change the early return and add the RAID-review firing. Replace:
```ts
if (tasks.length === 0) return;
```
with:
```ts
if (tasks.length === 0 && raid.length === 0) return;
```
Then, after the existing task toast/popup `Promise.resolve().then(...)` block, add a RAID-review block reusing the same snooze pattern (use snooze kind `"raidReview"`):
```ts
const rrSnoozeUntil = getSnoozedUntil("raidReview");
const rrSnoozed = rrSnoozeUntil != null && Date.now() < rrSnoozeUntil;
const cfg = settingsRef.current.notifications;
const reviewItems = cfg.raidReview.enabled && !rrSnoozed
  ? getRaidReviewItems(raidRef.current, todayRef.current, cfg.raidReviewIntervalDays)
  : [];
void Promise.resolve().then(() => {
  if (reviewItems.length > 0 && cfg.toast.enabled) {
    showToast("info", raidReviewToastText(reviewItems, currentLanguage));
  }
  if (reviewItems.length > 0 && cfg.popup.enabled) setRaidReviewModalOpen(true);
});
```
Add `raid` to the effect dependency array alongside `tasks`.

(d) Return the new fields:
```ts
return { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen, raidReviewModalOpen, setRaidReviewModalOpen };
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/app/use-due-alerts.test.ts && npx tsc --noEmit`
Expected: PASS. (Typecheck will flag the `useDueAlerts(...)` call in `task-manager.tsx` for the now-required `raid` arg — fixed in Task 13.)

- [ ] **Step 5: Commit**

```
git add src/app/use-due-alerts.ts src/app/use-due-alerts.test.ts
git commit -F - <<'EOF'
feat: use-due-alerts — fire once-per-session RAID review nudge
EOF
```

---

### Task 13: Wire the RAID-review banner + modal into `task-manager.tsx`

**Files:**
- Modify: `src/app/task-manager.tsx`
- Test: covered by existing task-manager tests + full suite (a focused integration test is optional).

- [ ] **Step 1: Pass `raid` to `useDueAlerts`** (~line 246). Capture the new return fields:
```ts
const { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen, raidReviewModalOpen, setRaidReviewModalOpen } =
  useDueAlerts({ hydrated, tasks, holidaySet, absences, settings, today, showToast, raid });
```
(If the existing call did not destructure these, update accordingly. `raid` is already in scope — it is destructured around line 123.)

- [ ] **Step 2: Import the new components + add a snooze** near the other `useReminderSnooze`/snooze hooks (grep `git grep -n "dueSnooze\|useReminderSnooze" src/app/task-manager.tsx` to match the exact idiom):
```ts
import { BirthdayBanner, DueBanner, JiraTokenBanner, RaidReviewBanner, RaidReviewModal } from "./notifications";
```
Add a `raidReviewSnooze` mirroring `dueSnooze` (same hook, kind `"raidReview"`), and a `raidReviewDismissed` state mirroring `bannerDismissed` if banners use a local dismissed flag.

- [ ] **Step 3: Compute banner items** near `bannerItems` (~line 576):
```ts
const raidReviewItems = useMemo(
  () => settings.notifications.raidReview.enabled
    ? getRaidReviewItems(raid, today, settings.notifications.raidReviewIntervalDays)
    : [],
  [raid, today, settings.notifications.raidReview, settings.notifications.raidReviewIntervalDays],
);
```
Add the import: `import { getRaidReviewItems } from "./raid-review";`

- [ ] **Step 4: Render the banner** inside `bannersEl` (after the Jira token banner, ~line 896):
```tsx
{!isPopout && !raidReviewSnooze.isSnoozed && raidReviewItems.length > 0 && (
  <RaidReviewBanner
    items={raidReviewItems}
    lang={lang}
    onOpenList={() => setRaidReviewModalOpen(true)}
    onDismiss={() => raidReviewSnooze.snooze(SNOOZE_1D)}
    onSnooze={raidReviewSnooze.snooze}
  />
)}
```
> If banners use a `*Dismissed` boolean rather than snooze-on-dismiss, mirror that instead (`!raidReviewDismissed` gate + `onDismiss={() => setRaidReviewDismissed(true)}`). Match the file's existing banner idiom; import `SNOOZE_1D` from `./reminder-snooze` only if you use it.

- [ ] **Step 5: Render the modal** in the modals block (near `DueDatesModal`; grep `git grep -n "DueDatesModal" src/app/task-manager.tsx` for the open-handler used for RAID rows, e.g. `handleOpenRaid`/`openRaidEditor`):
```tsx
{raidReviewModalOpen && (
  <RaidReviewModal
    items={raidReviewItems}
    lang={lang}
    onClose={() => setRaidReviewModalOpen(false)}
    onSelectRaid={(id) => { setRaidReviewModalOpen(false); /* call the existing RAID-open handler with id */ }}
  />
)}
```
Use the same RAID-open handler the dashboard/registers band uses (`onOpenRaid`). If none is directly in scope, reuse the handler passed as `onOpenRaid` to `DashboardPanel`/`RegistersBand`.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm run test:run`
Expected: no type errors; full suite green.

- [ ] **Step 7: Commit**

```
git add src/app/task-manager.tsx
git commit -F - <<'EOF'
feat: wire RAID review banner + modal into the app shell
EOF
```

---

### Task 14: Version bump, changelog, codemaps, final verification

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/frontend.md`, `docs/CODEMAPS/data.md`

- [ ] **Step 1: Bump version.** In `src/app/version.ts` set `APP_VERSION = "0.51.0"`, `APP_BUILD_DATE = "2026-06-04"`, `APP_MILESTONE = "Pratchett"`, and append `versionHighlightRaidReview` to `APP_HIGHLIGHT_KEYS` (grep the file to match the exact const names). In `package.json` set `"version": "0.51.0"`.

- [ ] **Step 2: Changelog + README.** Add a `0.51.0 "Pratchett"` entry to `CHANGELOG.md` summarizing: RAID review reminders; dashboard RAG polish (colorized counts, burn bubbles, boxed sections, status Save); budget-report caption + RAG bubbles; reports remove-dropdown; chat layout; help full-text search. Update the README feature list / current-version line if it names a version.

- [ ] **Step 3: Codemaps.** Add `raid-review.ts` and `help-search.ts` to `docs/CODEMAPS/frontend.md` (and `data.md` if it lists logic modules), with one-line descriptions.

- [ ] **Step 4: Full verification.**

Run: `npx tsc --noEmit`
Expected: clean.
Run: `npm run lint`
Expected: clean (do NOT edit `eslint.config.mjs` — it is hook-blocked).
Run: `npm run test:run`
Expected: full suite green; coverage gate (70%) holds.

- [ ] **Step 5: Commit**

```
git add src/app/version.ts package.json CHANGELOG.md README.md docs/CODEMAPS/frontend.md docs/CODEMAPS/data.md
git commit -F - <<'EOF'
chore: release 0.51.0 "Pratchett" — RAID review reminders + RAG/UI polish batch
EOF
```

---

## Self-review notes

- **Spec coverage:** A1–A4 → Task 3 (+ Task 2 enabler); B5–B6 → Task 4; C7 → Task 5; D8–D9 → Task 6; E10 → Task 7; F (logic/settings/UI/hook/wiring) → Tasks 8–13; G (i18n/version/tests) → Task 1 + Task 14 + per-task tests. No gaps.
- **Type consistency:** `getRaidReviewItems`/`summarizeRaidReview`/`RaidReviewItem`/`RaidReviewReason` consistent across Tasks 8, 11, 12, 13; `raidReview`/`raidReviewIntervalDays` consistent across Tasks 9, 10, 12, 13; `matchesQuery`/`highlightSegments`/`HighlightSegment` consistent in Task 7; `Tile.value: React.ReactNode` (Task 2) consumed in Task 3.
- **Known gotchas encoded:** DE ASCII + grep check (Task 1); no `eslint.config.mjs` edits (Task 14); Bash heredoc commits throughout; `Date.now()` only in the hook (allowed — runtime code, not a workflow script); pure modules avoid it.
- **Verify-before-use flags:** existing RAID open/closed predicate (Task 8 Step 1), notifications merge path (Task 9 Step 1), `ResetSizeButton` className support (Task 6 Step 3b), `raidTargetDate` i18n key (Task 11 Step 4), RAID-open handler name in task-manager (Task 13 Step 5).
