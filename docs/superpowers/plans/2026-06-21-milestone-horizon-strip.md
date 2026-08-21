# Milestone Horizon Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A horizon-bucketed "what's coming" milestone band on the Dashboard (Overdue · This week · Next 2 weeks · Later), replacing the flat near-term list.

**Architecture:** Extend the pure `milestones.ts` engine with `bucketMilestonesByHorizon`; render via a new presentational `milestone-horizon-strip.tsx`; swap it into the existing `showMilestones`-gated Milestones `Section` in `dashboard-panel.tsx`. No new prop threading.

**Tech Stack:** TypeScript, React 19, vitest, fast-check, Tailwind (AIPM tokens), forked Next.js 16.

**Conventions (AGENTS.md):**
- `npm run lint` is `--max-warnings=0` (unused import/var FATAL).
- `npx tsc --noEmit` enforces i18n EN/DE parity AND typechecks tests (vitest doesn't). Run after editing ANY test.
- react-hooks PURITY: no `new Date()` in a render body; `set-state-in-effect` BANNED. (This slice's `new Date()` need is zero — `today` is passed in.)
- `i18n.de.ts` is CRLF; Edit corrupts umlauts/curls quotes — patch DE via a node utf8 script matching `\r\n`, real umlauts.
- `t(lang, key, ...args)` uses 0-based `{0}` placeholders.
- Dashboard IS in axe `A11Y_VIEWS` (`e2e/a11y.spec.ts:10`) — interactive chips need row-unique accessible names; verify with `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`.
- fast-check: build dates via integer-ms → `new Date(ms).toISOString().slice(0,10)` (avoid `fc.date()` Invalid Date); never the `/s` regex flag.

**Branch:** create `feat-milestone-horizon-strip` off `main` before Task 1. Never commit `docs/refactor-review-2026-06-19.md` (pre-existing unrelated deletion).

---

### Task 1: `bucketMilestonesByHorizon` engine + unit tests

**Files:**
- Modify: `src/app/milestones.ts`
- Modify: `src/app/milestones.test.ts`

- [ ] **Step 1: Add failing unit tests to `src/app/milestones.test.ts`**

Append (reuse the file's existing imports for `Milestone`/`Task`; add the new symbols to the existing `./milestones` import):

```ts
import { bucketMilestonesByHorizon, HORIZON_THIS_WEEK_DAYS, HORIZON_NEXT_DAYS } from "./milestones";

describe("bucketMilestonesByHorizon", () => {
  const today = "2026-06-21";
  const noTasks = new Map<number, Task>();
  const hs = new Set<string>();
  const ms = (id: number, date: string, extra: Partial<Milestone> = {}): Milestone =>
    ({ id, name: `M${id}`, date, linkedTaskIds: [], ...extra } as Milestone);

  it("excludes achieved milestones", () => {
    const b = bucketMilestonesByHorizon([ms(1, "2026-06-25", { achievedDate: "2026-06-20" })], noTasks, today, hs);
    expect(b.overdue.length + b.thisWeek.length + b.next2Weeks.length + b.later.length).toBe(0);
  });

  it("buckets a past unachieved milestone as overdue", () => {
    const b = bucketMilestonesByHorizon([ms(1, "2026-06-10")], noTasks, today, hs);
    expect(b.overdue.map((e) => e.milestone.id)).toEqual([1]);
    expect(b.overdue[0].status).toBe("overdue");
  });

  it("buckets by calendar-day windows (boundaries 0,7,8,21,22)", () => {
    const list = [
      ms(1, "2026-06-21"), // d=0 → thisWeek
      ms(2, "2026-06-28"), // d=7 → thisWeek
      ms(3, "2026-06-29"), // d=8 → next2Weeks
      ms(4, "2026-07-12"), // d=21 → next2Weeks
      ms(5, "2026-07-13"), // d=22 → later
    ];
    const b = bucketMilestonesByHorizon(list, noTasks, today, hs);
    expect(b.thisWeek.map((e) => e.milestone.id)).toEqual([1, 2]);
    expect(b.next2Weeks.map((e) => e.milestone.id)).toEqual([3, 4]);
    expect(b.later.map((e) => e.milestone.id)).toEqual([5]);
  });

  it("carries the at-risk status into a future bucket", () => {
    const tasks = new Map<number, Task>([[10, { id: 10, dueDate: "2026-06-30" } as Task]]);
    // Milestone due 2026-06-28 (thisWeek) but a linked task ends after it → at-risk.
    const b = bucketMilestonesByHorizon([ms(1, "2026-06-28", { linkedTaskIds: [10] })], tasks, today, hs);
    expect(b.thisWeek[0].status).toBe("at-risk");
  });

  it("sorts each bucket by date then id", () => {
    const b = bucketMilestonesByHorizon([ms(2, "2026-07-30"), ms(1, "2026-07-20")], noTasks, today, hs);
    expect(b.later.map((e) => e.milestone.id)).toEqual([1, 2]);
  });

  it("treats a malformed date as later (never crashes, never mis-overdues)", () => {
    const b = bucketMilestonesByHorizon([ms(1, "not-a-date")], noTasks, today, hs);
    expect(b.overdue.length).toBe(0);
    expect(b.later.map((e) => e.milestone.id)).toEqual([1]);
  });

  it("exposes the window threshold constants", () => {
    expect(HORIZON_THIS_WEEK_DAYS).toBe(7);
    expect(HORIZON_NEXT_DAYS).toBe(21);
  });
});
```

> Note on the malformed-date test: a lexical string `"not-a-date"` is NOT `< "2026-06-21"` (`'n' > '2'`), so `milestoneStatus` does not classify it overdue; the day-diff yields `NaN` → it falls to `later`. The test asserts exactly that.

- [ ] **Step 2: Run, verify failure**

Run: `npm run test:run -- src/app/milestones.test.ts`
Expected: FAIL — `bucketMilestonesByHorizon` / constants not exported.

- [ ] **Step 3: Implement in `src/app/milestones.ts`**

Append (the file already imports `workdaysUntil`, `Milestone`, `Task`, and defines `milestoneStatus`, `MilestoneStatus`, `MILESTONE_DUE_SOON_WORKDAYS`):

```ts
export type MilestoneHorizon = "overdue" | "thisWeek" | "next2Weeks" | "later";
export type HorizonEntry = { milestone: Milestone; status: MilestoneStatus };
export type MilestoneHorizonBuckets = Record<MilestoneHorizon, HorizonEntry[]>;

/** Calendar-day window thresholds for the dashboard horizon strip. */
export const HORIZON_THIS_WEEK_DAYS = 7;
export const HORIZON_NEXT_DAYS = 21;

/** Whole calendar days from `fromISO` to `toISO` (both YYYY-MM-DD, parsed as
 *  UTC midnight). NaN when either is unparseable. Pure — no "now". */
function calendarDaysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.round((to - from) / 86_400_000);
}

/** Bucket non-achieved milestones into a forward time horizon for the dashboard
 *  "what's coming" strip. Overdue first; the rest by calendar days until due.
 *  Each entry carries its `milestoneStatus` so callers can flag at-risk. */
export function bucketMilestonesByHorizon(
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): MilestoneHorizonBuckets {
  const buckets: MilestoneHorizonBuckets = { overdue: [], thisWeek: [], next2Weeks: [], later: [] };
  for (const m of milestones) {
    if (m.achievedDate) continue;
    const status = milestoneStatus(m, tasksById, todayISO, holidaySet, leadWorkdays);
    if (status === "overdue") {
      buckets.overdue.push({ milestone: m, status });
      continue;
    }
    const d = calendarDaysBetween(todayISO, m.date);
    if (!Number.isNaN(d) && d <= HORIZON_THIS_WEEK_DAYS) buckets.thisWeek.push({ milestone: m, status });
    else if (!Number.isNaN(d) && d <= HORIZON_NEXT_DAYS) buckets.next2Weeks.push({ milestone: m, status });
    else buckets.later.push({ milestone: m, status });
  }
  const byDate = (a: HorizonEntry, b: HorizonEntry) =>
    a.milestone.date.localeCompare(b.milestone.date) || a.milestone.id - b.milestone.id;
  (Object.keys(buckets) as MilestoneHorizon[]).forEach((k) => buckets[k].sort(byDate));
  return buckets;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm run test:run -- src/app/milestones.test.ts`
Expected: PASS (existing + 7 new).

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/milestones.ts src/app/milestones.test.ts
git commit -m "feat(milestones): bucketMilestonesByHorizon engine for the dashboard horizon strip"
```

---

### Task 2: `milestones.property.test.ts`

**Files:**
- Create: `src/app/milestones.property.test.ts`

- [ ] **Step 1: Write the property test**

```ts
import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import { bucketMilestonesByHorizon, type MilestoneHorizon } from "./milestones";
import type { Milestone, Task } from "./types";

const dateArb = fc.integer({ min: Date.parse("2024-01-01T00:00:00Z"), max: Date.parse("2030-12-31T00:00:00Z") })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

const milestoneArb = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  name: fc.string(),
  date: dateArb,
  achievedDate: fc.option(dateArb, { nil: undefined }),
  linkedTaskIds: fc.constant([] as number[]),
}) as fc.Arbitrary<Milestone>;

const BUCKETS: MilestoneHorizon[] = ["overdue", "thisWeek", "next2Weeks", "later"];
const noTasks = new Map<number, Task>();
const hs = new Set<string>();

describe("bucketMilestonesByHorizon properties", () => {
  test("every non-achieved milestone lands in exactly one bucket; achieved in none", () => {
    fc.assert(fc.property(fc.array(milestoneArb, { maxLength: 40 }), dateArb, (milestones, today) => {
      const b = bucketMilestonesByHorizon(milestones, noTasks, today, hs);
      const placed = BUCKETS.reduce((n, k) => n + b[k].length, 0);
      const nonAchieved = milestones.filter((m) => !m.achievedDate).length;
      expect(placed).toBe(nonAchieved);
      // No milestone id appears in two buckets.
      const ids = BUCKETS.flatMap((k) => b[k].map((e) => e.milestone.id));
      expect(new Set(ids).size).toBe(ids.length);
    }));
  });

  test("each bucket is sorted ascending by date", () => {
    fc.assert(fc.property(fc.array(milestoneArb, { maxLength: 40 }), dateArb, (milestones, today) => {
      const b = bucketMilestonesByHorizon(milestones, noTasks, today, hs);
      for (const k of BUCKETS) {
        const dates = b[k].map((e) => e.milestone.date);
        expect([...dates].sort((x, y) => x.localeCompare(y))).toEqual(dates);
      }
    }));
  });
});
```

- [ ] **Step 2: Run + tsc**

Run: `npm run test:run -- src/app/milestones.property.test.ts && npx tsc --noEmit`
Expected: PASS, no tsc errors.

> If the sort property fails, the engine is the source of truth — re-check the test, not the engine. (`localeCompare` ties broken by id won't violate date-ascending.)

- [ ] **Step 3: Commit**

```bash
git add src/app/milestones.property.test.ts
git commit -m "test(milestones): property tests for horizon bucketing"
```

---

### Task 3: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (after `versionHighlightLandingCockpit`)
- Modify: `src/app/i18n.de.ts` (node utf8 script)
- Create (temp): `scripts/_patch-de-horizon.mjs` (delete after)

- [ ] **Step 1: Add EN keys to `src/app/i18n.ts`**

Insert immediately after the `versionHighlightLandingCockpit: "…",` entry:

```ts
  versionHighlightMilestoneHorizon:
    "The Dashboard's milestone list is now a \"what's coming\" horizon: Overdue, This week, Next 2 weeks, and Later — so you can see the road ahead at a glance.",
  milestoneHorizonOverdue: "Overdue",
  milestoneHorizonThisWeek: "This week",
  milestoneHorizonNext2Weeks: "Next 2 weeks",
  milestoneHorizonLater: "Later",
  milestoneHorizonEmpty: "No upcoming milestones",
  milestoneHorizonCount: "{0} ({1})",
```

> `milestoneHorizonCount` formats a bucket header as `Label (n)` — `t(lang, "milestoneHorizonCount", t(lang, bucketLabelKey), String(count))`.

- [ ] **Step 2: tsc to confirm the parity gap**

Run: `npx tsc --noEmit`
Expected: FAIL — DE dict missing the new keys.

- [ ] **Step 3: DE via node script**

Create `scripts/_patch-de-horizon.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/app/i18n.de.ts";
let s = readFileSync(path, "utf8");
const anchor = /(versionHighlightLandingCockpit:\s*\r?\n?\s*"[^"]*",\r?\n)/;
if (!anchor.test(s)) { console.error("anchor not found"); process.exit(1); }
const block =
  '  versionHighlightMilestoneHorizon:\r\n' +
  '    "Die Meilensteinliste im Dashboard ist jetzt ein „Was kommt“-Horizont: Überfällig, Diese Woche, Nächste 2 Wochen und Später – so siehst du den Weg nach vorn auf einen Blick.",\r\n' +
  '  milestoneHorizonOverdue: "Überfällig",\r\n' +
  '  milestoneHorizonThisWeek: "Diese Woche",\r\n' +
  '  milestoneHorizonNext2Weeks: "Nächste 2 Wochen",\r\n' +
  '  milestoneHorizonLater: "Später",\r\n' +
  '  milestoneHorizonEmpty: "Keine anstehenden Meilensteine",\r\n' +
  '  milestoneHorizonCount: "{0} ({1})",\r\n';
s = s.replace(anchor, (m) => m + block);
writeFileSync(path, s, "utf8");
console.log("DE horizon keys inserted");
```

Run: `node scripts/_patch-de-horizon.mjs` → expect `DE horizon keys inserted`. If `anchor not found`, open `i18n.de.ts`, find the DE `versionHighlightLandingCockpit` entry, adjust the regex to its exact bytes (keep `\r\n`), re-run.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run test:run -- src/app/i18n-encoding`
Expected: tsc clean (parity), `i18n-encoding` PASS (real umlauts: Überfällig, Nächste, Später).

- [ ] **Step 5: Delete temp script**

```bash
rm scripts/_patch-de-horizon.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(dashboard): milestone horizon strings (EN + DE)"
```

---

### Task 4: `milestone-horizon-strip.tsx` component

**Files:**
- Create: `src/app/milestone-horizon-strip.tsx`
- Create: `src/app/milestone-horizon-strip.test.tsx`

**Context:** `RagBadge` from `./rag-badge` (`<RagBadge value={Health|null} lang={lang} />`). `t`/`Lang` from `./i18n`. Types `MilestoneHorizonBuckets`, `MilestoneHorizon`, `HorizonEntry` from `./milestones`. i18n keys from Task 3 exist.

- [ ] **Step 1: Write the failing test**

`src/app/milestone-horizon-strip.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
import type { MilestoneHorizonBuckets } from "./milestones";
import type { Milestone } from "./types";

const m = (id: number, date: string): Milestone => ({ id, name: `M${id}`, date, linkedTaskIds: [] } as Milestone);
function buckets(over: Partial<MilestoneHorizonBuckets> = {}): MilestoneHorizonBuckets {
  return { overdue: [], thisWeek: [], next2Weeks: [], later: [], ...over };
}

describe("MilestoneHorizonStrip", () => {
  test("all buckets empty → 'No upcoming milestones'", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets()} />);
    expect(screen.getByText(/No upcoming milestones/i)).toBeInTheDocument();
  });

  test("renders a bucket header with its count", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ thisWeek: [{ milestone: m(1, "2026-06-28"), status: "due-soon" }] })} />);
    expect(screen.getByText(/This week \(1\)/)).toBeInTheDocument();
  });

  test("a chip click invokes onOpenMilestone", () => {
    const onOpen = vi.fn();
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: [{ milestone: m(2, "2026-08-01"), status: "on-track" }] })} onOpenMilestone={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /M2 · 2026-08-01/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("handler-less chip is a span, not a button", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: [{ milestone: m(3, "2026-08-01"), status: "on-track" }] })} />);
    expect(screen.queryByRole("button", { name: /M3/ })).toBeNull();
    expect(screen.getByText(/M3 · 2026-08-01/)).toBeInTheDocument();
  });

  test("at-risk entry shows the warning marker", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ thisWeek: [{ milestone: m(4, "2026-06-28"), status: "at-risk" }] })} />);
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm run test:run -- src/app/milestone-horizon-strip.test.tsx`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement `src/app/milestone-horizon-strip.tsx`**

```tsx
"use client";

import { t, type Lang } from "./i18n";
import { RagBadge } from "./rag-badge";
import type { MilestoneHorizon, MilestoneHorizonBuckets, HorizonEntry } from "./milestones";

interface MilestoneHorizonStripProps {
  lang: Lang;
  buckets: MilestoneHorizonBuckets;
  onOpenMilestone?: () => void;
}

const ORDER: readonly MilestoneHorizon[] = ["overdue", "thisWeek", "next2Weeks", "later"];
const LABEL_KEY: Record<MilestoneHorizon, Parameters<typeof t>[1]> = {
  overdue: "milestoneHorizonOverdue",
  thisWeek: "milestoneHorizonThisWeek",
  next2Weeks: "milestoneHorizonNext2Weeks",
  later: "milestoneHorizonLater",
};

/** Overdue + at-risk get a RAG badge + ⚠; due-soon/on-track are plain. */
function entryAlert(e: HorizonEntry): boolean {
  return e.status === "overdue" || e.status === "at-risk";
}

export function MilestoneHorizonStrip({ lang, buckets, onOpenMilestone }: MilestoneHorizonStripProps) {
  const total = ORDER.reduce((n, k) => n + buckets[k].length, 0);
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "milestoneHorizonEmpty")}</p>;
  }
  return (
    <div className="space-y-3">
      {ORDER.filter((k) => buckets[k].length > 0).map((k) => (
        <div key={k}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            {t(lang, "milestoneHorizonCount", t(lang, LABEL_KEY[k]), String(buckets[k].length))}
          </p>
          <ul className="flex flex-wrap gap-2">
            {buckets[k].map((e) => {
              const alert = entryAlert(e);
              const label = `${alert ? "⚠ " : ""}${e.milestone.name} · ${e.milestone.date}`;
              return (
                <li key={e.milestone.id}>
                  {onOpenMilestone ? (
                    <button
                      type="button"
                      onClick={() => onOpenMilestone()}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-foreground hover:bg-surface-muted hover:border-AIPM-dark-blue"
                    >
                      {alert && <RagBadge value={e.status === "overdue" ? "R" : "A"} lang={lang} />}
                      {label}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted-foreground">
                      {alert && <RagBadge value={e.status === "overdue" ? "R" : "A"} lang={lang} />}
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm run test:run -- src/app/milestone-horizon-strip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint + tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/milestone-horizon-strip.tsx src/app/milestone-horizon-strip.test.tsx
git commit -m "feat(dashboard): milestone horizon strip component"
```

---

### Task 5: Wire into `dashboard-panel.tsx` (replace the flat list)

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Modify: `src/app/dashboard-panel.test.tsx` (extend)

**Context:** the flat Milestones section is `dashboard-panel.tsx:427-447` (a `<Section title={t(lang,"dashboardMilestones")} boxed>` with a conditional `<ul>` over `[...model.overdueMilestones, ...model.atRiskMilestones, ...model.dueSoonMilestones]`). `useMemo`/`useState` already imported. `model` is in scope. `props.tasks`, `props.holidaySet`, `today`, `props.milestones`, `props.onOpenMilestone` all available.

- [ ] **Step 1: Extend `dashboard-panel.test.tsx`**

Add (the file's `fullProps` already has a milestone `{ id: 1, name: "Go-Live", date: "2026-06-01", linkedTaskIds: [] }` with `today: "2026-06-02"` → overdue):

```tsx
describe("DashboardPanel milestone horizon", () => {
  it("renders a horizon bucket header instead of the flat list", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    // Go-Live dated 2026-06-01 with today 2026-06-02 → Overdue bucket.
    expect(screen.getByText(/Overdue \(1\)/)).toBeInTheDocument();
  });

  it("still hides the whole milestones section when showMilestones is false", () => {
    render(<DashboardPanel {...fullProps} showMilestones={false} />, { wrapper });
    expect(screen.queryByText(/Overdue \(/)).toBeNull();
    expect(screen.queryByText("Milestones")).toBeNull();
  });
});
```

> The existing Task-8 test `"shows ... Milestones ..."` asserts `screen.getByText("Milestones")` (the `Section` title) — that title is UNCHANGED (still `dashboardMilestones`), so it keeps passing. Only the section BODY changes.

- [ ] **Step 2: Run, verify failure**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: FAIL — no "Overdue (1)" header (flat list still rendered).

- [ ] **Step 3: Add imports + bucket memo to `dashboard-panel.tsx`**

Add import:

```ts
import { bucketMilestonesByHorizon } from "./milestones";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
```

Near the other derived values (after the `greeting`/`repTaskId` block from slice 1), add:

```ts
  const milestoneBuckets = useMemo(
    () =>
      bucketMilestonesByHorizon(
        showMilestones ? (props.milestones ?? []) : [],
        new Map(props.tasks.map((t) => [t.id, t] as const)),
        today,
        props.holidaySet,
      ),
    [showMilestones, props.milestones, props.tasks, today, props.holidaySet],
  );
```

- [ ] **Step 4: Replace the flat list body**

Replace the Milestones `Section` body (lines ~427-447, the `{ ... === 0 ? <p>—</p> : <ul>...</ul> }`) so the `Section` wraps the strip:

```tsx
          {showMilestones && (
            <Section title={t(lang, "dashboardMilestones")} boxed>
              <MilestoneHorizonStrip lang={lang} buckets={milestoneBuckets} onOpenMilestone={props.onOpenMilestone} />
            </Section>
          )}
```

(Keep the surrounding `<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">` and the Changes `Section` as-is.)

- [ ] **Step 5: Run tests**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Full lint + tsc + unit suite**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: all green, zero warnings.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat(dashboard): replace flat milestone list with horizon strip"
```

---

### Task 6: a11y gate + release

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`

- [ ] **Step 1: Dashboard a11y gate**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`
Expected: PASS. Chips are `<button>`s with text content (`M1 · date`) as accessible names. If axe flags a node, add an `aria-label`; re-run until green.

- [ ] **Step 2: Bump `version.ts`**

- `APP_VERSION = "0.119.0"`
- `APP_BUILD_DATE = "2026-06-21"` comment `// 0.119.0 Milestone horizon strip (Gibson)`
- `APP_MILESTONE = "Gibson"`; update the doc comment `0.119.x line is "Gibson" (William Gibson)`.
- Append `"versionHighlightMilestoneHorizon",` as the LAST entry of `APP_HIGHLIGHT_KEYS` (after `"versionHighlightLandingCockpit",`).

- [ ] **Step 3: CHANGELOG entry**

At the top of the version list in `CHANGELOG.md`:

```markdown
## [0.119.0] - 2026-06-21 "Gibson"

### Changed
- **Dashboard milestone horizon.** The Dashboard's milestone list is now a
  "what's coming" horizon — Overdue, This week, Next 2 weeks, and Later —
  with at-risk milestones flagged, replacing the flat near-term list. Pure
  date-bucketing; works on every storage backend.
```

- [ ] **Step 4: README badge + package.json**

- `README.md`: bump the version badge `0.118.0`/`Atwood` → `0.119.0`/`Gibson` (grep `0.118.0`).
- `package.json`: `"version": "0.119.0"`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS (prebuild docs-sync + version-highlight present + typecheck).

- [ ] **Step 6: Final verification**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md README.md package.json
git commit -m "release: 0.119.0 \"Gibson\" — milestone horizon strip"
```

---

## After all tasks

Final branch code review, then push → GitLab MR ( (GitLab)) → poll pipeline → merge on green → sync main → delete branch (per the established loop).

## Self-review notes (plan vs spec)

- Engine bucketing ✓ (T1) — overdue-first, calendar windows 7/21, achieved excluded, at-risk status carried, NaN→later. Property coverage ✓ (T2: disjoint+exhaustive, sort). Component ✓ (T4). In-place panel swap ✓ (T5). i18n ✓ (T3). Release ✓ (T6).
- Type consistency: `MilestoneHorizon`, `HorizonEntry`, `MilestoneHorizonBuckets`, `bucketMilestonesByHorizon` signature, `HORIZON_THIS_WEEK_DAYS`/`HORIZON_NEXT_DAYS` — identical across T1/T2/T4/T5. ✓
- No new Workspace field, no new prop threading, no `workspace-section.tsx` change. ✓
- Dashboard axe gate (T6) covers the new buttons; `dashboardMilestones` Section title unchanged so the existing Task-8 visibility test still passes. ✓
- Chip click parity with slice 1: `onOpenMilestone` ignores its arg (routes to view), so no dead-click concern here (unlike the task chips). ✓
