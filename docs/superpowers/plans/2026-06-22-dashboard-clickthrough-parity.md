# Dashboard Click-Through Parity (#9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Dashboard surface click-through — entities open their specific editor via the existing `requestOpen(view, id)` channel; non-entity tiles / sparkline / activity rows launch their view via `onNavigate`.

**Architecture:** Pure wiring + making static surfaces interactive. A new pure `activityViewOf` mapper, a clickable `Tile` variant, widened `onOpenMilestone`/`onOpenChange` signatures, and the workspace-section handlers rewired to `requestOpen`. No new deep-link infrastructure.

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript, Tailwind (AIPM palette tokens), vitest + Testing Library, Playwright axe gate.

---

## Conventions every task must honor

- **Lint is fatal** (`--max-warnings=0`): no unused imports/vars. Re-check after each extract.
- **tsc enforces i18n EN/DE key parity** — add every new key to BOTH `i18n.ts` and `i18n.de.ts`.
- **Edit tool corrupts umlauts + curls quotes in `i18n.de.ts`** — patch that file with a node utf8 write (CRLF `\r\n` anchors), never the Edit tool. `i18n.ts` (EN) is safe to Edit.
- **`Lang` test value is `"en-US"`** (never `"en"`).
- **Dashboard IS axe-scanned** — every new clickable must be a real `<button>` with a row-unique accessible name.
- **`t(lang, key, a, b)`** interpolates 0-based `{0}`/`{1}`.
- Run `npx tsc --noEmit` after editing ANY `.test.tsx` (build + vitest don't typecheck tests).

---

### Task 1: Pure `activityViewOf` kind→view mapper

**Files:**
- Create: `src/app/dashboard-activity-nav.ts`
- Create: `src/app/dashboard-activity-nav.test.ts`

- [ ] **Step 1: Write the failing test**

`src/app/dashboard-activity-nav.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { activityViewOf } from "./dashboard-activity-nav";
import { ACTIVITY_KIND_TO_KEY, type ActivityKind } from "./activity-log";

describe("activityViewOf", () => {
  it("maps entity kinds to their view", () => {
    expect(activityViewOf("task.completed")).toBe("open-points");
    expect(activityViewOf("raid.created")).toBe("raid");
    expect(activityViewOf("milestone.updated")).toBe("milestones");
    expect(activityViewOf("change.created")).toBe("changes");
    expect(activityViewOf("stakeholder.updated")).toBe("stakeholders");
  });

  it("returns null for non-deep-linkable kinds", () => {
    expect(activityViewOf("bulk.edit")).toBeNull();
    expect(activityViewOf("jira.sync")).toBeNull();
    expect(activityViewOf("settings.updated")).toBeNull();
    expect(activityViewOf("doc.linkAdded")).toBeNull();
    expect(activityViewOf("resource.created")).toBeNull();
  });

  it("is total over the ActivityKind union (never throws)", () => {
    for (const kind of Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[]) {
      expect(() => activityViewOf(kind)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/dashboard-activity-nav.test.ts`
Expected: FAIL — `activityViewOf` not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

`src/app/dashboard-activity-nav.ts`:
```ts
// Pure, i18n-free: maps an activity-log kind to the AppView whose editor/list
// it belongs to, for view-level click-through from the dashboard's recent-activity
// list. Returns null for kinds with no deep-linkable destination (bulk/jira/
// absence/shift/resource/role/settings/doc/history) — those rows stay static.
import type { ActivityKind } from "./activity-log";
import type { AppView } from "./nav-config";

export function activityViewOf(kind: ActivityKind): AppView | null {
  if (kind.startsWith("task.")) return "open-points";
  if (kind.startsWith("raid.")) return "raid";
  if (kind.startsWith("milestone.")) return "milestones";
  if (kind.startsWith("change.")) return "changes";
  if (kind.startsWith("stakeholder.")) return "stakeholders";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/dashboard-activity-nav.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/dashboard-activity-nav.ts src/app/dashboard-activity-nav.test.ts
git commit -m "feat: add pure activityViewOf kind->view mapper for dashboard click-through"
```

---

### Task 2: Clickable `Tile` variant

**Files:**
- Modify: `src/app/report-table.tsx:141-152`
- Test: `src/app/report-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/report-table.test.tsx` (inside the file, add a new `describe`):
```tsx
import { fireEvent } from "@testing-library/react";
// (Tile, render, screen, vi already imported at top of the file — reuse them;
//  add only what's missing.)

describe("Tile clickable variant", () => {
  it("renders a button with the activateLabel name and fires onActivate", () => {
    const onActivate = vi.fn();
    render(<Tile label="Overdue" value="3" onActivate={onActivate} activateLabel="Open the tasks list" />);
    const btn = screen.getByRole("button", { name: "Open the tasks list" });
    fireEvent.click(btn);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("renders a non-interactive tile without onActivate", () => {
    render(<Tile label="Complete" value="42%" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```
(If `Tile`, `render`, `screen`, `vi`, `describe`, `it`, `expect` are not all already imported at the top of `report-table.test.tsx`, add the missing names to the existing imports — DO NOT duplicate an import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/report-table.test.tsx`
Expected: FAIL — `onActivate`/`activateLabel` not a prop; no button rendered.

- [ ] **Step 3: Implement the clickable variant**

Replace `src/app/report-table.tsx:141-152` (the entire `Tile` function) with:
```tsx
export function Tile({
  label, value, rag, trend, onActivate, activateLabel,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  rag?: React.ReactNode;
  trend?: React.ReactNode;
  onActivate?: () => void;
  activateLabel?: string;
}) {
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-1.5 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">
        <span>{value}</span>
        {rag}
      </div>
      {trend ? <div className="mt-1">{trend}</div> : null}
    </>
  );
  if (onActivate) {
    return (
      <button
        type="button"
        aria-label={activateLabel}
        onClick={onActivate}
        className="w-full rounded-lg border border-line bg-surface p-3 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted focus-visible:ring-1 focus-visible:ring-AIPM-green"
      >
        {inner}
      </button>
    );
  }
  return <div className="rounded-lg border border-line bg-surface p-3">{inner}</div>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/report-table.test.tsx`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/report-table.tsx src/app/report-table.test.tsx
git commit -m "feat: add clickable Tile variant (onActivate + activateLabel)"
```

---

### Task 3: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts:117` (insert after `dashboardDensityCompactView`)
- Modify: `src/app/i18n.de.ts:120` (via node utf8 write)

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts`, immediately AFTER the line `  dashboardDensityCompactView: "Compact view",` (line 117), insert:
```ts
  dashboardOpenTasksView: "Open the tasks list",
  dashboardOpenRaidView: "Open the RAID register",
  dashboardOpenBudgetView: "Open the budget",
  dashboardOpenTrendsView: "Open trends",
  dashboardOpenChangeItem: "Open change {0}",
  dashboardActivityOpenView: "Open {0}",
  versionHighlightClickThrough: "Dashboard tiles, lists and chips are now clickable — jump straight to the item or view",
```

- [ ] **Step 2: Add DE keys via node (umlaut-safe)**

Run this node script (matches the CRLF file, real umlauts, no Edit-tool corruption):
```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  dashboardDensityCompactView: \"Kompakte Ansicht\",\r\n";
const add =
  "  dashboardOpenTasksView: \"Aufgabenliste öffnen\",\r\n" +
  "  dashboardOpenRaidView: \"RAID-Register öffnen\",\r\n" +
  "  dashboardOpenBudgetView: \"Budget öffnen\",\r\n" +
  "  dashboardOpenTrendsView: \"Trends öffnen\",\r\n" +
  "  dashboardOpenChangeItem: \"Änderung {0} öffnen\",\r\n" +
  "  dashboardActivityOpenView: \"{0} öffnen\",\r\n" +
  "  versionHighlightClickThrough: \"Dashboard-Kacheln, -Listen und -Chips sind jetzt anklickbar — direkt zum Element oder zur Ansicht springen\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
console.log("DE keys inserted");
'
```
Expected output: `DE keys inserted`. (If `ANCHOR NOT FOUND`, the DE line uses different whitespace/quotes — grep `dashboardDensityCompactView` in `i18n.de.ts` and adjust the anchor string, keeping `\r\n`.)

- [ ] **Step 3: Verify parity + umlauts**

```bash
npx tsc --noEmit
npm run test:run -- src/app/i18n-encoding.test.ts
```
Expected: tsc clean (EN/DE key sets identical); i18n-encoding test PASS (real umlauts, no ASCII subs).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add dashboard click-through aria-label + version-highlight i18n keys (EN+DE)"
```

---

### Task 4: Milestone horizon chip carries its id

**Files:**
- Modify: `src/app/milestone-horizon-strip.tsx:7-11,30,48-89`
- Test: `src/app/milestone-horizon-strip.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/milestone-horizon-strip.test.tsx` (reuse the file's existing render helper / `buckets` factory if present; otherwise build minimal buckets). Add:
```tsx
describe("MilestoneHorizonStrip click-through", () => {
  it("calls onOpenMilestone with the chip's milestone id", () => {
    const onOpen = vi.fn();
    // Build buckets with one milestone in thisWeek. Reuse the file's existing
    // HorizonEntry/bucket shape; a minimal inline entry:
    const buckets = {
      overdue: [],
      thisWeek: [{ milestone: { id: 42, name: "M42", date: "2026-07-01" }, status: "upcoming" }],
      next2Weeks: [],
      later: [],
    } as never;
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets} onOpenMilestone={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /M42/ }));
    expect(onOpen).toHaveBeenCalledWith(42);
  });

  it("calls onOpenMilestone with -1 for the +N more affordance", () => {
    const onOpen = vi.fn();
    const entry = (id: number) => ({ milestone: { id, name: `M${id}`, date: "2026-07-01" }, status: "upcoming" });
    const buckets = {
      overdue: [],
      thisWeek: [],
      next2Weeks: [],
      later: [entry(1), entry(2), entry(3), entry(4), entry(5), entry(6)], // 6 > MAX_PER_BUCKET(5)
    } as never;
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets} onOpenMilestone={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /more|\+1/ }));
    expect(onOpen).toHaveBeenCalledWith(-1);
  });
});
```
(Add any missing imports — `render`, `screen`, `fireEvent`, `vi`, `describe`, `it`, `expect`, `MilestoneHorizonStrip` — to the existing import block without duplicating.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/milestone-horizon-strip.test.tsx`
Expected: FAIL — `onOpenMilestone` called with no args (id assertion fails).

- [ ] **Step 3: Widen the signature + pass ids**

In `src/app/milestone-horizon-strip.tsx`:

(a) Line 7-11, change the prop type:
```tsx
interface MilestoneHorizonStripProps {
  lang: Lang;
  buckets: MilestoneHorizonBuckets;
  onOpenMilestone?: (id: number) => void;
}
```

(b) The per-chip button (lines 48-60) — change `onClick={() => onOpenMilestone()}` to:
```tsx
                      onClick={() => onOpenMilestone(e.milestone.id)}
```

(c) The "+N more" button (lines 76-83) — change `onClick={() => onOpenMilestone()}` to:
```tsx
                    onClick={() => onOpenMilestone(-1)}
```
(`-1` is the view-level sentinel: the milestones panel finds no milestone and just switches the view.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/milestone-horizon-strip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/milestone-horizon-strip.tsx src/app/milestone-horizon-strip.test.tsx
git commit -m "feat: milestone horizon chip deep-links to its milestone id"
```

---

### Task 5: Dashboard panel — widened props, clickable tiles/sparkline/changes/activity

**Files:**
- Modify: `src/app/dashboard-panel.tsx` (prop types ~51-65; KPI strip ~290-306; sparkline card ~309-330; Top Changes ~569-578; recent activity ~601-613; import `activityViewOf`)
- Test: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` to `src/app/dashboard-panel.test.tsx`. Reuse the file's existing render helper (it has one — find the function that renders `<DashboardPanel ... />` with default props; pass the new handlers through it, or render directly mirroring its prop set). Tests:
```tsx
describe("DashboardPanel click-through parity (slice #9)", () => {
  it("KPI Overdue tile navigates to open-points", () => {
    const onNavigate = vi.fn();
    // render with at least one overdue task so the tile shows a non-zero value;
    // any tasks fixture is fine — the tile renders regardless.
    renderDashboard({ onNavigate }); // use the file's helper; ensure onNavigate threaded
    fireEvent.click(screen.getByRole("button", { name: "Open the tasks list" }));
    expect(onNavigate).toHaveBeenCalledWith("open-points");
  });

  it("KPI Open RAID tile navigates to raid", () => {
    const onNavigate = vi.fn();
    renderDashboard({ onNavigate });
    fireEvent.click(screen.getByRole("button", { name: "Open the RAID register" }));
    expect(onNavigate).toHaveBeenCalledWith("raid");
  });

  it("a Top Changes row opens that change by id", () => {
    const onOpenChange = vi.fn();
    // render with showChanges and at least one change {id, title, impact, status}
    renderDashboard({ onOpenChange, changes: [{ id: 7, title: "Scope cut", impact: "High", status: "Proposed" } as never] });
    fireEvent.click(screen.getByRole("button", { name: "Open change Scope cut" }));
    expect(onOpenChange).toHaveBeenCalledWith(7);
  });

  it("a task.* activity row navigates to open-points; settings.updated stays static", () => {
    const onNavigate = vi.fn();
    // The panel reads activity via loadActivityLog(); seed localStorage before render.
    // Use the file's existing activity-seeding helper if present.
    renderDashboard({ onNavigate });
    // Asserts depend on seeded activity; if the helper seeds a task.* entry, click it.
  });
});
```
NOTE for the implementer: `dashboard-panel.test.tsx` already has a render helper and ~30 call sites — DO NOT invent `renderDashboard` if a differently-named helper exists; use the real one and thread `onNavigate`/`onOpenChange`/`changes` overrides. For the activity-row test, seed `localStorage["lop-app:activity-log"]` with a `task.created` entry before render (the panel calls `loadActivityLog()` at mount via `useState`), then click the row and assert `onNavigate("open-points")`; assert a `settings.updated` row has no button role. Keep accessible names EXACT (must match the EN strings from Task 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: FAIL — tiles/changes/activity render as non-interactive (no matching buttons).

- [ ] **Step 3a: Widen prop types**

In `src/app/dashboard-panel.tsx`, the `DashboardPanelProps` interface — change:
```tsx
  onOpenMilestone?: (id: number) => void;
```
and
```tsx
  onOpenChange?: (id: number) => void;
```
(`onOpenRaid?: (id: number) => void` and `onNavigate?: (view: AppView) => void` already exist — leave them.)

- [ ] **Step 3b: Import the mapper**

Add near the other imports (after the `nav-config` import line):
```tsx
import { activityViewOf } from "./dashboard-activity-nav";
```

- [ ] **Step 3c: Adapt the delta-strip aggregate handlers (sentinel)**

In the `<DashboardDeltaStrip .../>` element, change the milestone/change handlers so the widened `(id)` props still satisfy the strip's `() => void` slots with the view-level sentinel:
```tsx
          onOpenMilestone={props.onOpenMilestone ? () => props.onOpenMilestone!(-1) : undefined}
          onOpenChange={props.onOpenChange ? () => props.onOpenChange!(-1) : undefined}
```
(`onOpenRaid`/`onOpenTask` lines in the strip stay as they are — already rep-id.)

- [ ] **Step 3d: KPI tiles clickable**

Replace the three KPI `<Tile>`s (the `grid grid-cols-3` block) so each gets `onActivate`/`activateLabel` (only when `props.onNavigate` is present):
```tsx
        <div className={`grid grid-cols-3 ${dc.kpiGap}`}>
          <Tile
            label={t(lang, "dashboardKpiComplete")}
            value={`${model.progress.percent}%`}
            trend={<TrendArrow trend={trends.complete} metricLabel={t(lang, "dashboardKpiComplete")} unit="%" lang={lang} />}
            onActivate={props.onNavigate ? () => props.onNavigate!("open-points") : undefined}
            activateLabel={t(lang, "dashboardOpenTasksView")}
          />
          <Tile
            label={t(lang, "dashboardKpiOverdue")}
            value={String(model.overdue.length)}
            trend={<TrendArrow trend={trends.overdue} metricLabel={t(lang, "dashboardKpiOverdue")} lang={lang} />}
            onActivate={props.onNavigate ? () => props.onNavigate!("open-points") : undefined}
            activateLabel={t(lang, "dashboardOpenTasksView")}
          />
          <Tile
            label={t(lang, "dashboardKpiOpenRaid")}
            value={String(model.openRaidCount)}
            trend={<TrendArrow trend={trends.openRaid} metricLabel={t(lang, "dashboardKpiOpenRaid")} lang={lang} />}
            onActivate={props.onNavigate ? () => props.onNavigate!("raid") : undefined}
            activateLabel={t(lang, "dashboardOpenRaidView")}
          />
        </div>
```
NOTE: Complete and Overdue share the label "Open the tasks list"; in the test query by exact name will match the FIRST. To keep names row-unique for axe, the implementer MAY instead reuse the existing per-tile metric labels — but simplest axe-safe option: leave both as "Open the tasks list" (axe allows duplicate accessible names on non-list buttons; WCAG 2.4.6 wants context — the visible tile label provides it). Keep both as `dashboardOpenTasksView`. For the test, query the Overdue tile via `getAllByRole("button", { name: "Open the tasks list" })[1]` if needed, or assert the call value only.

- [ ] **Step 3e: Progress + Budget burn tiles clickable**

In the Progress `<Section>`, give the two progress `<Tile>`s:
```tsx
            onActivate={props.onNavigate ? () => props.onNavigate!("open-points") : undefined}
            activateLabel={t(lang, "dashboardOpenTasksView")}
```
In the Budget burn `<Section>`, give each budget/h/CPI `<Tile>` (the ones inside `model.burn`):
```tsx
            onActivate={props.onNavigate ? () => props.onNavigate!("budget") : undefined}
            activateLabel={t(lang, "dashboardOpenBudgetView")}
```
(Add to each `<Tile>` in those two sections. The EVM SPI/CPI tiles in the second row also get the budget activate.)

- [ ] **Step 3f: Sparkline card clickable**

Wrap the sparkline card's outer `<div className={...rounded border...}>` as a button when `onNavigate` is present. Replace the card container so it becomes:
```tsx
        {completionSeries.length >= 2 && (() => {
          const sparkBody = (
            <>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t(lang, "dashboardCompletionTrend")}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t(lang, "dashboardCompletionTrendPoints", completionSeries.length)}
                </span>
              </div>
              <Sparkline
                points={completionSeries}
                ariaLabel={t(
                  lang,
                  "dashboardCompletionTrendAria",
                  completionSeries[completionSeries.length - 1].percent,
                  completionSeries[0].percent,
                  completionSeries.length,
                )}
              />
            </>
          );
          const trendView = props.tursoActive ? "trends" : "open-points";
          return props.onNavigate ? (
            <button
              type="button"
              aria-label={t(lang, props.tursoActive ? "dashboardOpenTrendsView" : "dashboardOpenTasksView")}
              onClick={() => props.onNavigate!(trendView)}
              className={`block w-full rounded border border-line bg-surface text-left hover:border-AIPM-dark-blue focus-visible:ring-1 focus-visible:ring-AIPM-green ${dc.cardPad}`}
            >
              {sparkBody}
            </button>
          ) : (
            <div className={`rounded border border-line bg-surface ${dc.cardPad}`}>{sparkBody}</div>
          );
        })()}
```

- [ ] **Step 3g: Top Changes rows clickable**

In the Changes `<Section>`, replace the `model.topChanges.map(...)` `<li>` body so each row is a button when `props.onOpenChange` is present:
```tsx
                  {model.topChanges.map((c) => {
                    const content = (
                      <>
                        <RagBadge value={changeImpactRag(c.impact)} lang={lang} />
                        <span className="text-muted-foreground">#{c.id}</span>
                        <span className="font-medium">{c.title}</span>
                        <span className="text-muted-foreground">· {t(lang, CHANGE_STATUS_KEY[c.status])}</span>
                      </>
                    );
                    return (
                      <li key={c.id}>
                        {props.onOpenChange ? (
                          <button
                            type="button"
                            aria-label={t(lang, "dashboardOpenChangeItem", c.title)}
                            onClick={() => props.onOpenChange!(c.id)}
                            className="flex w-full items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted focus-visible:ring-1 focus-visible:ring-AIPM-green"
                          >
                            {content}
                          </button>
                        ) : (
                          <span className="flex items-center gap-2">{content}</span>
                        )}
                      </li>
                    );
                  })}
```
(The wrapping `<ul className="space-y-1 text-sm">` stays.)

- [ ] **Step 3h: Recent activity rows clickable by kind**

Replace the `model.recentActivity.map(...)` `<li>` body:
```tsx
              {model.recentActivity.map((e) => {
                const view = activityViewOf(e.kind);
                const label = `${e.timestamp.slice(0, 10)} · ${e.kind}`;
                return (
                  <li key={e.id}>
                    {view && props.onNavigate ? (
                      <button
                        type="button"
                        aria-label={t(lang, "dashboardActivityOpenView", t(lang, navLabelKey(view)))}
                        onClick={() => props.onNavigate!(view)}
                        className="w-full rounded-md border border-transparent px-1 py-0.5 text-left text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus-visible:ring-1 focus-visible:ring-AIPM-green"
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">{label}</span>
                    )}
                  </li>
                );
              })}
```
`nav-config.ts` exports `navLabelKey(view: AppView): TranslationKey` (line 185) — import it (`import { navLabelKey, type AppView } from "./nav-config";` — `AppView` is already imported, so just add `navLabelKey` to that existing import) and call `t(lang, navLabelKey(view))`. Do NOT hand-roll a second label map.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat: dashboard tiles, changes rows, activity rows and sparkline are click-through"
```

---

### Task 6: Wire workspace-section handlers to `requestOpen`

**Files:**
- Modify: `src/app/workspace-section.tsx:755-778`

- [ ] **Step 1: Rewire the three handlers**

In `src/app/workspace-section.tsx`, the `<DashboardPanel ...>` element:

(a) Replace the `onOpenRaid` handler (lines ~755-759) with one that deep-links AND keeps the side-effects:
```tsx
              onOpenRaid={(id) => {
                requestOpen("raid", id);
                handleClearRaidTaskFilter();
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
```

(b) Replace `onOpenMilestone={() => setActiveTab("milestones")}` with:
```tsx
              onOpenMilestone={(id) => requestOpen("milestones", id)}
```

(c) Replace `onOpenChange={() => setActiveTab("changes")}` with:
```tsx
              onOpenChange={(id) => requestOpen("changes", id)}
```
(`onOpenTask` and `onNavigate={setActiveTab}` stay unchanged. `requestOpen` is already destructured at line 187.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (the widened `(id: number) => void` props now match).

- [ ] **Step 3: Run the workspace-section + dashboard test suites**

Run: `npm run test:run -- src/app/workspace-section src/app/dashboard-panel.test.tsx`
Expected: PASS (no regression).

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add src/app/workspace-section.tsx
git commit -m "feat: dashboard RAID/milestone/change handlers deep-link via requestOpen"
```

---

### Task 7: Release bump + AGENTS.md

**Files:**
- Modify: `src/app/version.ts:5,6,10,138` (version, date, milestone, highlight key)
- Modify: `CHANGELOG.md` (new top entry)
- Modify: `README.md:5` (badge)
- Modify: `package.json:3` (version)
- Modify: `AGENTS.md` (flip the asymmetry landmine)

- [ ] **Step 1: Bump version.ts**

In `src/app/version.ts`:
- Line 5: `export const APP_VERSION = "0.124.0";`
- Line 6: `export const APP_BUILD_DATE = "2026-06-22"; // 0.124.0 Dashboard click-through parity (Pratchett)`
- Lines 7-10 comment + `export const APP_MILESTONE = "Pratchett";`
- Append `"versionHighlightClickThrough",` as the last entry of `APP_HIGHLIGHT_KEYS` (after `"versionHighlightDashboardDensity",`).

- [ ] **Step 2: CHANGELOG entry**

Add a new top entry to `CHANGELOG.md`:
```markdown
## 0.124.0 "Pratchett" — 2026-06-22

### Dashboard click-through parity
- Every Dashboard surface is now clickable: KPI tiles, Progress/Budget tiles and the completion sparkline jump to their view; Top Changes rows, RAID register rows and milestone horizon chips open the specific item; recent-activity rows jump to the relevant view by kind.
- Resolves the prior asymmetry where RAID/milestone/change navigation dropped the item id — now they deep-link via the shared `requestOpen` channel (the same one the Action Center uses).
```

- [ ] **Step 3: README badge**

`README.md` line 5 — replace `v0.123.0_%22Atwood%22` with `v0.124.0_%22Pratchett%22`.

- [ ] **Step 4: package.json**

`package.json` line 3 — `"version": "0.124.0",`.

- [ ] **Step 5: AGENTS.md landmine flip**

Find the chip-routing-asymmetry note (in the dashboard landing-cockpit section: "CHIP CLICK ROUTING ASYMMETRY: `onOpenRaid`/`onOpenMilestone`/`onOpenChange` IGNORE their id arg..."). Update it to read that as of v0.124.0 the Dashboard DEEP-LINKS RAID/milestone/change to the specific item via `requestOpen(view, id)` (wired in `workspace-section.tsx`); only the AGGREGATE delta-strip chips and the horizon "+N more" affordance stay view-level (sentinel `-1` → target panel finds no item → view switch only). Also add a one-line "Dashboard click-through (v0.124.0)" note: `Tile` gained an optional `onActivate`/`activateLabel` clickable variant (renders a real `<button>`, axe-safe); pure `activityViewOf` (`dashboard-activity-nav.ts`) maps an activity kind to its `AppView` for recent-activity row navigation.

- [ ] **Step 6: Verify + commit**

```bash
npx tsc --noEmit
npm run test:run -- src/app/version
git add src/app/version.ts CHANGELOG.md README.md package.json AGENTS.md
git commit -m "release: 0.124.0 \"Pratchett\" — dashboard click-through parity"
```

---

### Task 8: Full gate + a11y

- [ ] **Step 1: Full unit suite**

Run: `npm run test:run`
Expected: all green.

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean (`--max-warnings=0`).

- [ ] **Step 3: Dashboard axe gate**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`
Expected: PASS (webServer auto-starts; ~16s). Every new control is a `<button>` with an accessible name.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success (prebuild script-docs sync + Next build).

---

## Self-review notes

- **Spec coverage:** A→Tasks 4,5,6; B→Tasks 2,5; C→Tasks 1,5; i18n→Task 3; release+AGENTS→Task 7; gate→Task 8. All spec sections mapped.
- **Type consistency:** `onOpenMilestone`/`onOpenChange` widened to `(id: number) => void` in BOTH the panel props (Task 5) and the strip (Task 4, milestone only); the change handler lives only in the panel. `activityViewOf` signature identical in Task 1 (def) and Task 5 (use). `Tile` `onActivate`/`activateLabel` identical in Task 2 (def) and Task 5 (use).
- **Sentinel `-1`** consistently means "view-level, open nothing" across delta strip (Task 5c) and horizon "+N more" (Task 4c).
- **NAV_LABEL_KEY:** Task 5h flags that the implementer must reuse `nav-config.ts`'s existing exported label mapping rather than redefine one — confirm the exact export name there first.
