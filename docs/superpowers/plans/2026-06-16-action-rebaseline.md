# Action Re-baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Re-baseline" CTA on drifting Action Center rows — milestone rows move the milestone's target `date` to an editable, forecast-prefilled value (all backends); schedule/budget rows capture the project's current state as a new Turso snapshot baseline (Turso-gated).

**Architecture:** Surface-only — the `next-actions/` engine is untouched. The milestone path mutates an existing `Milestone.date` (serializers already cover it; no new write path). The schedule/budget path writes the existing Turso snapshot tables via a new `useSnapshots.rebaselineNow()`. A `RebaselinePopover` (mirroring `escalate-popover.tsx`) and a `RebaselineBundle` thread through the established 4-slice CTA path: task-manager → workspace-section → ActionsPanel (BOTH ActionRow lists) → action-row.

**Tech Stack:** Next.js (forked) / React 19 / TypeScript / Vitest. Pure domain logic in i18n-free `src/app/*.ts`; React surfaces translate.

**Spec:** `docs/superpowers/specs/2026-06-16-action-rebaseline-design.md`

---

## Codebase orientation (read before starting)

- **Mirror files** — this slice copies their structure almost verbatim:
  - `src/app/action-escalate.ts` — pure logic shape (`applyEscalation` same-ref-on-no-match).
  - `src/app/escalate-popover.tsx` — `role="dialog"` popover, focus-on-open, document-level Escape, `EscalateBundle` export.
  - `src/app/action-row.tsx` — `canEscalate` gate + `<EscalatePopover>` render (lines 65-69, 115-117).
  - `src/app/actions-panel.tsx` — threads `escalate` to BOTH ActionRow renders (lines 60 and 73).
  - `src/app/use-snapshots.ts` — `captureNow` (117-131) + `setBaseline` (133-145); `makeRecord(trigger, isBaseline, bucket)` (66-73).
- **i18n hard rules (CI-enforced):** `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces). DE uses real umlauts — **never** edit `i18n.de.ts` with the Edit tool (it corrupts umlauts + curls quotes); patch it with a node UTF-8 write matching `\r\n` (the file is CRLF). `Lang` is `"en-US" | "en-GB" | "de"` — there is **no** `"en"`. The DE dict is lazy — a test asserting DE output must call `loadI18n("de")` in `beforeAll`. Interpolation is 0-based positional: `t(lang, key, a, b)` → `{0}`/`{1}`.
- **Lint:** CI runs `npm run lint -- --max-warnings=0`; an unused import/var is FATAL. Re-check imports after every extract.
- **Commands:** `npm run test:run` (vitest), `npx tsc --noEmit` (typecheck + i18n parity), `npm run lint`, `npm run build`.
- **Branch:** `feat-action-rebaseline` (already checked out; spec committed at `fd796ae`).

**Do NOT** add the milestone `date` to any new serializer path — it is an existing persisted field. **Do NOT** add the snapshot tables to `TABLE_NAMES`.

---

## Task 1: Pure re-baseline logic (`action-rebaseline.ts`)

**Files:**
- Modify: `src/app/snapshot.ts` (export the existing `milestoneForecast`, ~line 132)
- Create: `src/app/action-rebaseline.ts`
- Test: `src/app/action-rebaseline.test.ts`

- [ ] **Step 1: Export `milestoneForecast` from `snapshot.ts`**

Find the existing private function (around line 132) and add `export`:

```ts
/** Latest effective end for a milestone: max of its target date and any linked
 *  task's effective end (completedDate || dueDate). */
export function milestoneForecast(m: Milestone, tasksById: ReadonlyMap<number, Task>): string {
  let latest = m.date;
  for (const id of m.linkedTaskIds) {
    const t = tasksById.get(id);
    if (!t) continue;
    const end = t.completedDate || t.dueDate;
    if (end && end > latest) latest = end;
  }
  return latest;
}
```

Only the `export` keyword changes; the body is untouched.

- [ ] **Step 2: Write the failing test**

Create `src/app/action-rebaseline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { milestoneRebaselineDate, applyMilestoneRebaseline, isValidIsoDate } from "./action-rebaseline";
import type { Milestone, Task } from "./types";

function milestone(over: Partial<Milestone> = {}): Milestone {
  return { id: 1, name: "M1", date: "2026-06-01", linkedTaskIds: [], ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: 1, title: "T", status: "todo", dueDate: "2026-06-01", linkedTaskIds: [], ...over } as Task;
}

describe("milestoneRebaselineDate", () => {
  it("returns the linked-task forecast when it slips past today", () => {
    const m = milestone({ date: "2026-06-01", linkedTaskIds: [1] });
    const tasks = [task({ id: 1, dueDate: "2026-08-15" })];
    expect(milestoneRebaselineDate(m, tasks, "2026-06-16")).toBe("2026-08-15");
  });
  it("returns today when forecast is in the past (overdue, no slip)", () => {
    const m = milestone({ date: "2026-05-01", linkedTaskIds: [] });
    expect(milestoneRebaselineDate(m, [], "2026-06-16")).toBe("2026-06-16");
  });
  it("returns the milestone date when it is future and has no linked tasks", () => {
    const m = milestone({ date: "2026-09-01", linkedTaskIds: [] });
    expect(milestoneRebaselineDate(m, [], "2026-06-16")).toBe("2026-09-01");
  });
});

describe("applyMilestoneRebaseline", () => {
  it("moves the matched milestone's date immutably", () => {
    const ms = [milestone({ id: 1, date: "2026-06-01" }), milestone({ id: 2, date: "2026-07-01" })];
    const next = applyMilestoneRebaseline(ms, 1, "2026-08-15");
    expect(next).not.toBe(ms);
    expect(next[0].date).toBe("2026-08-15");
    expect(next[1]).toBe(ms[1]); // untouched
    expect(ms[0].date).toBe("2026-06-01"); // original unmutated
  });
  it("returns the SAME array ref when no milestone matches", () => {
    const ms = [milestone({ id: 1 })];
    expect(applyMilestoneRebaseline(ms, 99, "2026-08-15")).toBe(ms);
  });
});

describe("isValidIsoDate", () => {
  it("accepts a real YYYY-MM-DD date", () => { expect(isValidIsoDate("2026-06-16")).toBe(true); });
  it("rejects an out-of-range month", () => { expect(isValidIsoDate("2026-13-01")).toBe(false); });
  it("rejects unpadded parts", () => { expect(isValidIsoDate("2026-6-1")).toBe(false); });
  it("rejects empty and junk", () => {
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:run -- action-rebaseline`
Expected: FAIL — `Cannot find module './action-rebaseline'`.

- [ ] **Step 4: Write the implementation**

Create `src/app/action-rebaseline.ts`:

```ts
import { milestoneForecast } from "./snapshot";
import type { Milestone, Task } from "./types";

/** Prefill target for a milestone re-baseline: the later of its forecast finish
 *  (max of its date and any linked task's effective end) and today. Guarantees a
 *  future-or-today date even for an overdue milestone with no slipping linked tasks. */
export function milestoneRebaselineDate(
  m: Milestone, tasks: readonly Task[], today: string,
): string {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const forecast = milestoneForecast(m, tasksById);
  return forecast > today ? forecast : today;
}

/** Immutable; returns the SAME array ref when no milestone matches (mirrors
 *  applyEscalation / applyOwnerAssignment so the caller can short-circuit). */
export function applyMilestoneRebaseline(
  milestones: readonly Milestone[], id: number, newDate: string,
): readonly Milestone[] {
  if (!milestones.some((m) => m.id === id)) return milestones;
  return milestones.map((m) => (m.id === id ? { ...m, date: newDate } : m));
}

/** Strict YYYY-MM-DD validity (shape + real calendar date). */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- action-rebaseline`
Expected: PASS (all 9 tests). Then `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/action-rebaseline.ts src/app/action-rebaseline.test.ts src/app/snapshot.ts
git commit -m "feat: pure re-baseline logic (milestone date + iso-date validity)"
```

---

## Task 2: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (node UTF-8 CRLF write only — NOT the Edit tool)

- [ ] **Step 1: Add EN keys to `src/app/i18n.ts`**

Locate the escalate keys (search `actionEscalateConfirm`) and add the following keys nearby, then the `errorInvalidDate` key near `errorInvalidEmail`, and `versionHighlightRebaseline` near the other `versionHighlight*` keys:

```ts
  actionRebaseline: "Re-baseline",
  actionRebaselineTitle: "Re-baseline",
  actionRebaselineMilestoneDesc: "Accept the slip and move milestone “{0}” to a new target date.",
  actionRebaselineNewDate: "New target date",
  actionRebaselineForecastHint: "Forecast finish: {0}",
  actionRebaselineSnapshotDesc: "Capture the current state as the new baseline. Future variance is measured from now; the previous baseline stays in history.",
  actionRebaselineConfirm: "Re-baseline now",
  errorInvalidDate: "Enter a valid date (YYYY-MM-DD).",
  versionHighlightRebaseline: "Re-baseline drifting milestones and schedule/budget from the Action Center.",
```

(If `errorInvalidDate` already exists, do not duplicate it — verify by searching first.)

- [ ] **Step 2: Run typecheck to verify it fails on DE parity**

Run: `npx tsc --noEmit`
Expected: FAIL — DE dictionary is missing the new keys (key-parity error pointing at `i18n.de.ts`).

- [ ] **Step 3: Add DE keys via a node UTF-8 CRLF write**

`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts. Use a node script. Find an existing DE anchor line (e.g. the DE `actionEscalateConfirm` line) and insert after it. Write `scripts/tmp-rebaseline-de.cjs`:

```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  actionEscalateConfirm: \"Eskalieren\",\r\n"; // verify exact current DE text first
const add =
  "  actionRebaseline: \"Neu ausrichten\",\r\n" +
  "  actionRebaselineTitle: \"Neu ausrichten\",\r\n" +
  "  actionRebaselineMilestoneDesc: \"Verzug akzeptieren und Meilenstein „{0}“ auf ein neues Zieldatum setzen.\",\r\n" +
  "  actionRebaselineNewDate: \"Neues Zieldatum\",\r\n" +
  "  actionRebaselineForecastHint: \"Prognostiziertes Ende: {0}\",\r\n" +
  "  actionRebaselineSnapshotDesc: \"Aktuellen Stand als neue Baseline erfassen. Zukünftige Abweichung wird ab jetzt gemessen; die bisherige Baseline bleibt im Verlauf.\",\r\n" +
  "  actionRebaselineConfirm: \"Jetzt neu ausrichten\",\r\n" +
  "  errorInvalidDate: \"Gültiges Datum eingeben (JJJJ-MM-TT).\",\r\n" +
  "  versionHighlightRebaseline: \"Abweichende Meilensteine sowie Termin/Budget direkt im Aktionscenter neu ausrichten.\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND — inspect i18n.de.ts and fix the anchor"); process.exit(1); }
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
console.log("DE keys inserted");
```

Run: `node scripts/tmp-rebaseline-de.cjs && rm scripts/tmp-rebaseline-de.cjs`

If the anchor string is not found, open `i18n.de.ts`, copy the exact current DE `actionEscalateConfirm` line (with its real umlaut-free or umlaut text and trailing `\r\n`), fix the `anchor`, and re-run. Place `errorInvalidDate`/`versionHighlightRebaseline` wherever parity is satisfied (any position works; tsc only checks the key set).

- [ ] **Step 4: Verify parity + encoding**

Run: `npx tsc --noEmit` — clean (key parity holds).
Run: `npm run test:run -- i18n-encoding` — PASS (no ASCII umlaut substitutions; the DE strings use real `ä`/`ö`/`ü`).

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: i18n keys for re-baseline CTA (EN + DE)"
```

---

## Task 3: `useSnapshots.rebaselineNow()`

**Files:**
- Modify: `src/app/use-snapshots.ts`
- Test: `src/app/use-snapshots.test.tsx`

- [ ] **Step 1: Write the failing test**

Open `src/app/use-snapshots.test.tsx` and read its existing setup (how it mocks `./snapshot-store` and renders the hook). Add a test mirroring the existing `captureNow`/`setBaseline` tests. It must assert that `rebaselineNow` (a) appends a record and (b) calls `setBaseline` for that record's id, and (c) the resulting `baseline` is the new record. Use the file's existing mock helpers; the shape below matches the existing mocks (adapt names to what the file already uses):

```tsx
it("rebaselineNow appends a fresh snapshot and flags it as baseline", async () => {
  const { result } = renderHook(() => useSnapshots(makeArgs({ active: true })));
  await act(async () => { await result.current.rebaselineNow(); });
  // storeAppend called once with a manual, non-baseline record:
  expect(appendMock).toHaveBeenCalledTimes(1);
  // storeSetBaseline called with that record's id:
  const appendedRec = appendMock.mock.calls[0][1];
  expect(setBaselineMock).toHaveBeenCalledWith(expect.anything(), appendedRec.id, expect.anything());
  // resulting baseline is the new record:
  expect(result.current.baseline?.id).toBe(appendedRec.id);
});
```

(Use the test file's existing `makeArgs`, `appendMock`, `setBaselineMock` equivalents. If their names differ, match the existing ones — do not invent new mock infrastructure.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- use-snapshots`
Expected: FAIL — `result.current.rebaselineNow is not a function`.

- [ ] **Step 3: Implement `rebaselineNow`**

In `src/app/use-snapshots.ts`, add `rebaselineNow: () => Promise<void>;` to `UseSnapshotsResult` (after `captureNow`), add the callback (after the `captureNow` definition, ~line 131), and return it.

```ts
  const rebaselineNow = useCallback(async () => {
    if (!active) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const rec = makeRecord("manual", false, currentBucket);
      await storeAppend(cfgRef.current, rec, pidRef.current);
      await storeSetBaseline(cfgRef.current, rec.id, pidRef.current);
      setSnapshots((prev) => [...prev, rec].map((s) => ({ ...s, isBaseline: s.id === rec.id })));
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active, makeRecord, currentBucket]);
```

Add `rebaselineNow` to the returned object:

```ts
  return { snapshots: sorted, baseline, latest, variance, gaps, busy, captureNow, rebaselineNow, setBaseline, deleteSnapshot, deleteSnapshots };
```

(`storeSetBaseline` is already imported at the top of the file as `setBaseline as storeSetBaseline`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- use-snapshots`
Expected: PASS. Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-snapshots.ts src/app/use-snapshots.test.tsx
git commit -m "feat: useSnapshots.rebaselineNow (append + flag baseline atomically)"
```

---

## Task 4: `RebaselinePopover` + `RebaselineBundle`

**Files:**
- Create: `src/app/rebaseline-popover.tsx`
- Test: `src/app/rebaseline-popover.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/rebaseline-popover.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RebaselinePopover, type RebaselineBundle } from "./rebaseline-popover";
import { loadI18n } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Milestone, Task } from "./types";

beforeAll(async () => { await loadI18n("de"); });

const milestones: Milestone[] = [{ id: 7, name: "Go-Live", date: "2026-06-01", linkedTaskIds: [1] }];
const tasks: Task[] = [{ id: 1, title: "T", status: "todo", dueDate: "2026-08-15", linkedTaskIds: [] } as Task];

function milestoneAction(): SuggestedAction {
  return {
    id: "milestone:7:at-risk", source: "milestone", moduleId: "milestones",
    title: { key: "actionMilestoneTitle", params: ["Go-Live"] },
    why: { key: "actionMilestoneWhyAtRisk" },
    score: 30, tier: "now", cta: { kind: "open", view: "milestones", id: 7 },
  };
}
function scheduleAction(): SuggestedAction {
  return {
    id: "schedule:0:slipping", source: "schedule", moduleId: "trends",
    title: { key: "actionScheduleTitle" }, why: { key: "actionScheduleWhySlipping" },
    score: 30, tier: "now", cta: { kind: "open", view: "dashboard", id: 0 },
  };
}
function bundle(over: Partial<RebaselineBundle> = {}): RebaselineBundle {
  return {
    milestones, tasks,
    onRebaselineMilestone: vi.fn(),
    snapshotActive: true,
    onRebaselineSnapshot: vi.fn(),
    ...over,
  };
}

describe("RebaselinePopover milestone variant", () => {
  it("prefills the forecast date and fires onRebaselineMilestone on confirm", () => {
    const b = bundle();
    render(<RebaselinePopover lang="en-US" action={milestoneAction()} bundle={b} />);
    fireEvent.click(screen.getByRole("button", { name: /^Re-baseline$/ }));
    const input = screen.getByLabelText("New target date") as HTMLInputElement;
    expect(input.value).toBe("2026-08-15"); // forecast from linked task
    fireEvent.click(screen.getByRole("button", { name: /Re-baseline now/ }));
    expect(b.onRebaselineMilestone).toHaveBeenCalledWith(7, "2026-08-15");
  });
  it("disables confirm when the date is cleared", () => {
    render(<RebaselinePopover lang="en-US" action={milestoneAction()} bundle={bundle()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Re-baseline$/ }));
    fireEvent.change(screen.getByLabelText("New target date"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: /Re-baseline now/ })).toBeDisabled();
  });
});

describe("RebaselinePopover snapshot variant", () => {
  it("fires onRebaselineSnapshot on confirm", () => {
    const b = bundle();
    render(<RebaselinePopover lang="en-US" action={scheduleAction()} bundle={b} />);
    fireEvent.click(screen.getByRole("button", { name: /^Re-baseline$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Re-baseline now/ }));
    expect(b.onRebaselineSnapshot).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- rebaseline-popover`
Expected: FAIL — `Cannot find module './rebaseline-popover'`.

- [ ] **Step 3: Implement the popover**

Create `src/app/rebaseline-popover.tsx`:

```tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Milestone, Task } from "./types";
import { milestoneRebaselineDate, isValidIsoDate } from "./action-rebaseline";

export interface RebaselineBundle {
  // Milestone (B) path — all backends:
  milestones: readonly Milestone[];
  tasks: readonly Task[];
  onRebaselineMilestone: (id: number, newDate: string) => void;
  // Schedule/budget (A) path — Turso-gated:
  snapshotActive: boolean;
  onRebaselineSnapshot: () => void;
}

interface RebaselinePopoverProps {
  lang: Lang;
  action: SuggestedAction;
  bundle: RebaselineBundle;
}

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

export function RebaselinePopover({ lang, action, bundle }: RebaselinePopoverProps) {
  const isMilestone = action.source === "milestone";
  const popRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");

  const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
  const milestone = isMilestone ? bundle.milestones.find((m) => m.id === id) : undefined;

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleOpen = () => {
    if (!open && milestone) {
      setDate(milestoneRebaselineDate(milestone, bundle.tasks, TODAY_ISO()));
    }
    setOpen((o) => !o);
  };

  const confirmMilestone = () => {
    if (!milestone) return;
    bundle.onRebaselineMilestone(milestone.id, date);
    setOpen(false);
  };

  const confirmSnapshot = () => {
    bundle.onRebaselineSnapshot();
    setOpen(false);
  };

  // Milestone variant needs a found milestone; snapshot variant always renders.
  const canRender = isMilestone ? milestone != null : true;

  return (
    <span className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
      >
        {t(lang, "actionRebaseline")}
      </button>
      {open && canRender && (
        <span
          ref={popRef}
          role="dialog"
          aria-label={t(lang, "actionRebaselineTitle")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-line bg-surface p-2"
        >
          {isMilestone && milestone ? (
            <>
              <p className="mb-2 text-xs text-foreground">
                {t(lang, "actionRebaselineMilestoneDesc", milestone.name)}
              </p>
              <label className="flex flex-col gap-1 text-xs text-foreground">
                <span className="font-medium">{t(lang, "actionRebaselineNewDate")}</span>
                <input
                  type="date"
                  aria-label={t(lang, "actionRebaselineNewDate")}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
                />
              </label>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!isValidIsoDate(date)}
                  onClick={(e) => { e.stopPropagation(); confirmMilestone(); }}
                  className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
                >
                  {t(lang, "actionRebaselineConfirm")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs text-foreground">{t(lang, "actionRebaselineSnapshotDesc")}</p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); confirmSnapshot(); }}
                  className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
                >
                  {t(lang, "actionRebaselineConfirm")}
                </button>
              </div>
            </>
          )}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- rebaseline-popover`
Expected: PASS. Then `npx tsc --noEmit` — clean. Then `npm run lint` — no unused-import warnings.

- [ ] **Step 5: Commit**

```bash
git add src/app/rebaseline-popover.tsx src/app/rebaseline-popover.test.tsx
git commit -m "feat: RebaselinePopover (milestone date + snapshot confirm)"
```

---

## Task 5: Wire the CTA into ActionRow + ActionsPanel + WorkspaceSection

**Files:**
- Modify: `src/app/action-row.tsx`
- Modify: `src/app/actions-panel.tsx`
- Modify: `src/app/workspace-section.tsx`
- Test: `src/app/action-row.test.tsx`

- [ ] **Step 1: Write the failing non-overlap tests**

Append to `src/app/action-row.test.tsx` a new describe block. Mirror the existing escalate describe (search `ActionRow escalate`). The Re-baseline row button label is `/^Re-baseline$/` (anchored so it does not match the "Re-baseline now" confirm button).

```tsx
describe("ActionRow rebaseline", () => {
  const milestones = [{ id: 7, name: "Go-Live", date: "2026-06-01", linkedTaskIds: [] }] as never;
  const tasks = [] as never;
  const reb = (over = {}) => ({
    milestones, tasks,
    onRebaselineMilestone: () => {},
    snapshotActive: true,
    onRebaselineSnapshot: () => {},
    ...over,
  });
  function action(source: string, whyKey: string, id: number): SuggestedAction {
    return {
      id: `${source}:${id}:x`, source, moduleId: undefined,
      title: { key: "actionMilestoneTitle", params: ["X"] },
      why: { key: whyKey }, score: 30, tier: "now",
      cta: { kind: "open", view: "milestones", id },
    } as never;
  }
  const REB = /^Re-baseline$/;

  it("shows Re-baseline for a milestone at-risk row", () => {
    render(<ActionRow lang="en-US" action={action("milestone", "actionMilestoneWhyAtRisk", 7)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("shows Re-baseline for a milestone overdue row", () => {
    render(<ActionRow lang="en-US" action={action("milestone", "actionMilestoneWhyOverdue", 7)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("shows Re-baseline for a schedule-slipping row when snapshotActive", () => {
    render(<ActionRow lang="en-US" action={action("schedule", "actionScheduleWhySlipping", 0)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("shows Re-baseline for a budget-worsening row when snapshotActive", () => {
    render(<ActionRow lang="en-US" action={action("budget", "actionBudgetWhyWorsening", 0)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("hides the snapshot CTA when snapshotActive is false", () => {
    render(<ActionRow lang="en-US" action={action("schedule", "actionScheduleWhySlipping", 0)} onOpen={() => {}} rebaseline={reb({ snapshotActive: false })} />);
    expect(screen.queryByRole("button", { name: REB })).toBeNull();
  });
  it("does not show Re-baseline for a raid row", () => {
    render(<ActionRow lang="en-US" action={action("raid", "actionRaidWhySeverity", 1)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.queryByRole("button", { name: REB })).toBeNull();
  });
  it("does not show Re-baseline when the bundle is absent", () => {
    render(<ActionRow lang="en-US" action={action("milestone", "actionMilestoneWhyAtRisk", 7)} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: REB })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- action-row`
Expected: FAIL — `rebaseline` is not a prop / `Re-baseline` button not found.

- [ ] **Step 3: Wire `action-row.tsx`**

Add the import (after the escalate import, line 10):

```ts
import { RebaselinePopover, type RebaselineBundle } from "./rebaseline-popover";
```

Add `rebaseline?: RebaselineBundle;` to `ActionRowProps` (after `escalate?`, line 32) and to the destructured params (line 35):

```ts
export function ActionRow({ lang, action, onOpen, onSnooze, onCreateTask, assignOwner, onDraftMessage, escalate, rebaseline }: ActionRowProps) {
```

Add the two gates after `canEscalate` (after line 69):

```ts
  const canRebaselineMilestone =
    rebaseline != null &&
    action.source === "milestone" &&
    (action.why.key === "actionMilestoneWhyAtRisk" ||
     action.why.key === "actionMilestoneWhyOverdue") &&
    action.cta.kind === "open";
  const canRebaselineSnapshot =
    rebaseline != null &&
    rebaseline.snapshotActive &&
    ((action.source === "schedule" && action.why.key === "actionScheduleWhySlipping") ||
     (action.source === "budget" && action.why.key === "actionBudgetWhyWorsening")) &&
    action.cta.kind === "open";
```

Render the popover next to the escalate render (after line 117):

```tsx
        {(canRebaselineMilestone || canRebaselineSnapshot) && rebaseline && (
          <RebaselinePopover lang={lang} action={action} bundle={rebaseline} />
        )}
```

- [ ] **Step 4: Wire `actions-panel.tsx`**

Add the import (after the `EscalateBundle` import, line 8):

```ts
import type { RebaselineBundle } from "./rebaseline-popover";
```

Add `rebaseline?: RebaselineBundle;` to `ActionsPanelProps` (after `escalate?`, line 25) and to the destructure (line 28). Then add `rebaseline={rebaseline}` to BOTH `<ActionRow ... />` renders (line 60 — monitor list — and line 73 — tier list):

```tsx
<ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} onCreateTask={onCreateTask} assignOwner={assignOwner} onDraftMessage={onDraftMessage} escalate={escalate} rebaseline={rebaseline} />
```

- [ ] **Step 5: Wire `workspace-section.tsx`**

Search `escalate` in `src/app/workspace-section.tsx`. At the props-interface site add `rebaseline?: RebaselineBundle;` (import the type: `import type { RebaselineBundle } from "./rebaseline-popover";`), destructure it alongside `escalate`, and pass `rebaseline={rebaseline}` to the `<ActionsPanel ... />` render (mirror exactly how `escalate` is threaded).

- [ ] **Step 6: Run the tests + typecheck + lint**

Run: `npm run test:run -- action-row`
Expected: PASS (all new + existing).
Run: `npx tsc --noEmit` — clean. Run: `npm run lint` — no warnings (verify no unused imports introduced).

- [ ] **Step 7: Commit**

```bash
git add src/app/action-row.tsx src/app/actions-panel.tsx src/app/workspace-section.tsx src/app/action-row.test.tsx
git commit -m "feat: thread Re-baseline CTA through ActionRow/ActionsPanel/WorkspaceSection"
```

---

## Task 6: task-manager handlers + bundle + workspaceProps

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Add imports**

After the escalate import (line 37):

```ts
import { applyMilestoneRebaseline, isValidIsoDate } from "./action-rebaseline";
import type { RebaselineBundle } from "./rebaseline-popover";
```

(`milestones`, `setMilestones`, `tasks`, `trendsActive`, `snapshots`, `isPopout` are all already in scope — see lines 208, 388-433.)

- [ ] **Step 2: Add the handlers + bundle**

After `escalateBundle` (after line 1088):

```ts
  const handleRebaselineMilestone = useCallback(
    (id: number, newDate: string) => {
      if (!isValidIsoDate(newDate)) { window.alert(t(lang, "errorInvalidDate")); return; }
      const next = applyMilestoneRebaseline(milestones, id, newDate);
      if (next !== milestones) setMilestones(next as Milestone[]);
    },
    [milestones, setMilestones, lang],
  );

  const handleRebaselineSnapshot = useCallback(() => {
    void snapshots.rebaselineNow();
  }, [snapshots]);

  const rebaselineBundle = useMemo<RebaselineBundle | undefined>(
    () =>
      isPopout
        ? undefined
        : {
            milestones,
            tasks,
            onRebaselineMilestone: handleRebaselineMilestone,
            snapshotActive: trendsActive,
            onRebaselineSnapshot: handleRebaselineSnapshot,
          },
    [isPopout, milestones, tasks, handleRebaselineMilestone, handleRebaselineSnapshot, trendsActive],
  );
```

(`Milestone` is already imported in task-manager — verify; if not, add it to the `./types` import. `trendsActive` already encodes `tursoConfig !== null && snapshotsCfg.enabled && trends-module-on`, so it is exactly the snapshot-CTA gate.)

- [ ] **Step 3: Add to `workspaceProps`**

At the `workspaceProps` object (near line 1457, where `escalate: escalateBundle` is), add:

```ts
    rebaseline: rebaselineBundle,
```

- [ ] **Step 4: Typecheck + lint + full test run**

Run: `npx tsc --noEmit` — clean.
Run: `npm run lint` — no warnings.
Run: `npm run test:run` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat: wire Re-baseline handlers + bundle in task-manager"
```

---

## Task 7: Release (0.93.0)

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump `version.ts`**

In `src/app/version.ts`: set `APP_VERSION = "0.93.0"`, set `APP_MILESTONE = "Cadigan"` (Pat Cadigan — sci-fi-author codename, not yet used; quickly grep `CHANGELOG.md` to confirm it is unused and pick another author surname if it collides), set `APP_BUILD_DATE = "2026-06-16"`, and append `"versionHighlightRebaseline"` to the `APP_HIGHLIGHT_KEYS` array.

- [ ] **Step 2: Add the CHANGELOG entry**

At the top of `CHANGELOG.md` (above the previous entry), add:

```markdown
## [0.93.0] - 2026-06-16 "Cadigan"

### Added
- **Re-baseline CTA (Action Center):** drifting rows now carry a one-click "Re-baseline" action. Slipping/overdue milestone rows open a confirm popover with the new target date prefilled to the linked-task forecast (editable) and move `milestone.date` on confirm — works on every backend. Schedule-slipping and budget-worsening rows capture the project's current state as a new Turso snapshot baseline (Turso-gated; the previous baseline is kept in history). Surface-only; the next-actions engine is unchanged. Execution-depth roadmap slice 5.
```

(Codename "Cadigan" — must match `APP_MILESTONE` from Step 1.)

- [ ] **Step 3: Verify build (prebuild docs-sync + version checks)**

Run: `npx tsc --noEmit` — clean.
Run: `npm run build`
Expected: success (the prebuild check confirms version/changelog/highlight-key consistency).

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.93.0 — Re-baseline CTA"
```

---

## Final verification (after all tasks)

- [ ] `npm run test:run` — all green.
- [ ] `npx tsc --noEmit` — clean (i18n parity holds).
- [ ] `npm run lint -- --max-warnings=0` — zero warnings.
- [ ] `npm run build` — success.
- [ ] Dispatch a final whole-branch code review (the prior four slices each had the final review catch a cross-cutting gap that per-task reviews missed — e.g. validate-before-mutate ordering). Fix CRITICAL/HIGH before finishing.
- [ ] Then `superpowers:finishing-a-development-branch`.

## Spec-coverage check (self-review)

- Hybrid B/A paths → Tasks 1 (logic), 3 (snapshot hook), 4 (popover branch), 5 (gates). ✓
- Milestone editable prefilled forecast → Task 4 (`toggleOpen` prefill via `milestoneRebaselineDate`). ✓
- Snapshot capture-fresh-and-flag → Task 3 (`rebaselineNow`). ✓
- Non-overlapping by source, Turso-gating only on snapshot path → Task 5 gates (`canRebaselineSnapshot` requires `snapshotActive`). ✓
- Both ActionRow lists → Task 5 Step 4. ✓
- Validate-before-mutate, deleted-milestone no-op → Tasks 6 (handler guard) + 1 (same-ref). ✓
- No new write path / not in TABLE_NAMES → milestone.date is existing; snapshot tables already excluded. ✓
- i18n EN/DE parity + real umlauts + lazy DE in tests → Task 2 + Task 4 test `loadI18n("de")`. ✓
- Release → Task 7. ✓
