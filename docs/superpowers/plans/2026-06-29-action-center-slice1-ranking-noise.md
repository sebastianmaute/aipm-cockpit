# Action Center Slice 1 — Ranking & Noise Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse multiple Action-Center signals on the same entity into one row, and cap the visible `now`/`soon` tiers with a show-more expander.

**Architecture:** Grouping is a pure, presentation-only layer over the existing flat scored list. `computeNextActions` stays flat and unchanged (learning/notifications/AI keep consuming it). A new pure `next-actions/group.ts` collapses the flat list into `ActionGroup[]`; `actions-panel.tsx` renders one row per group and caps `now`/`soon`; `action-row.tsx` shows a "+N more reasons" line.

**Tech Stack:** Forked Next.js 16 / React 19 / TypeScript / Tailwind v4 / Vitest + Testing Library. Commands: `npx tsc --noEmit` (typecheck + i18n EN/DE parity), `npm run lint` (`--max-warnings=0`), `npm run test:run` (vitest).

**Spec:** `docs/superpowers/specs/2026-06-29-action-center-slice1-ranking-noise-design.md`

---

## File Structure

- **Create** `src/app/next-actions/group.ts` — pure i18n-free `groupNextActions` + `ActionGroup` type. Sole responsibility: collapse a flat `SuggestedAction[]` into per-entity groups.
- **Create** `src/app/next-actions/group.test.ts` — unit tests for grouping.
- **Modify** `src/app/action-row.tsx` — add optional `extraReasonsCount` prop + muted reasons line.
- **Modify** `src/app/action-row.test.tsx` — cover the reasons line.
- **Modify** `src/app/actions-panel.tsx` — group, cap `now`/`soon`, show-more.
- **Modify** `src/app/actions-panel.test.tsx` — fix fixtures for grouping; add cap + collapse tests.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — 3 new keys.

---

## Task 1: Pure grouping module

**Files:**
- Create: `src/app/next-actions/group.ts`
- Test: `src/app/next-actions/group.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/next-actions/group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupNextActions } from "./group";
import type { SuggestedAction } from "./types";

const mk = (
  id: string,
  score: number,
  ctaId: string | number,
  tier: SuggestedAction["tier"] = "now",
): SuggestedAction => ({
  id,
  source: "raid",
  title: { key: "actionRaidTitle", params: [1, id] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score,
  tier,
  cta: { kind: "open", view: "raid", id: ctaId },
});

describe("groupNextActions", () => {
  it("collapses signals on the same entity into one group", () => {
    const groups = groupNextActions([mk("a", 40, 1), mk("b", 70, 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("raid:1");
    expect(groups[0].primary.id).toBe("b"); // higher score wins
    expect(groups[0].extra.map((e) => e.id)).toEqual(["a"]);
  });

  it("uses the max score and its tier for the group", () => {
    const groups = groupNextActions([mk("a", 70, 1, "now"), mk("b", 30, 1, "soon")]);
    expect(groups[0].score).toBe(70);
    expect(groups[0].tier).toBe("now");
  });

  it("keeps distinct entities as separate groups", () => {
    const groups = groupNextActions([mk("a", 40, 1), mk("b", 70, 2)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("raid:2"); // sorted by score desc
    expect(groups[1].key).toBe("raid:1");
  });

  it("passes through a single-signal entity with no extra", () => {
    const groups = groupNextActions([mk("a", 40, 1)]);
    expect(groups[0].extra).toEqual([]);
  });

  it("keys snooze-only actions by their own id (never merges)", () => {
    const snooze: SuggestedAction = {
      id: "s1", source: "raid",
      title: { key: "actionRaidTitle", params: [1, "s1"] },
      why: { key: "actionRaidWhySeverity", params: ["High"] },
      score: 10, tier: "monitor",
      cta: { kind: "snooze", actionId: "s1" },
    };
    const groups = groupNextActions([snooze, { ...snooze, id: "s2", cta: { kind: "snooze", actionId: "s2" } }]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(["s1", "s2"]);
  });

  it("orders group members by score desc then id asc", () => {
    const groups = groupNextActions([mk("z", 50, 1), mk("a", 50, 1), mk("m", 90, 1)]);
    expect(groups[0].primary.id).toBe("m");
    expect(groups[0].extra.map((e) => e.id)).toEqual(["a", "z"]); // equal score → id asc
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/app/next-actions/group.test.ts`
Expected: FAIL — `Failed to resolve import "./group"` / `groupNextActions is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/app/next-actions/group.ts`:

```ts
// src/app/next-actions/group.ts
//
// Pure, i18n-free presentation layer over the flat scored action list. Collapses
// multiple signals on the SAME entity into one group so the surface renders one
// row per thing-you-act-on. `computeNextActions` stays flat — this is layered on
// top by the surface only; learning/notifications/AI keep the flat list.
import type { SuggestedAction, ActionTier } from "./types";

export interface ActionGroup {
  /** `${cta.view}:${cta.id}` when the primary opens an entity; else the
   *  primary's own id (snooze-only / non-open actions never merge). */
  key: string;
  /** Highest-scoring action in the group. */
  primary: SuggestedAction;
  /** Remaining actions for this entity, score desc then id asc. */
  extra: readonly SuggestedAction[];
  /** = primary.score (max wins — entity shows at its most-urgent signal). */
  score: number;
  /** = primary.tier. */
  tier: ActionTier;
}

function groupKey(a: SuggestedAction): string {
  return a.cta.kind === "open" ? `${a.cta.view}:${a.cta.id}` : a.id;
}

/** Collapse a flat (already deduped + dismissed-filtered) action list into
 *  per-entity groups, sorted score desc then key asc. */
export function groupNextActions(actions: readonly SuggestedAction[]): ActionGroup[] {
  const byKey = new Map<string, SuggestedAction[]>();
  for (const a of actions) {
    const k = groupKey(a);
    const arr = byKey.get(k);
    if (arr) arr.push(a);
    else byKey.set(k, [a]);
  }
  const groups: ActionGroup[] = [];
  for (const [key, members] of byKey) {
    const sorted = [...members].sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
    const [primary, ...extra] = sorted;
    groups.push({ key, primary, extra, score: primary.score, tier: primary.tier });
  }
  return groups.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/app/next-actions/group.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/next-actions/group.ts src/app/next-actions/group.test.ts
git commit -m "feat(next-actions): add pure groupNextActions (collapse signals per entity)"
```

---

## Task 2: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (near `actionMonitoredCount`, ~line 2088)
- Modify: `src/app/i18n.de.ts` (near `actionMonitoredCount`, ~line 2064)

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, find the line:

```ts
  actionMonitoredCount: "{0} monitored",
```

Add immediately after it:

```ts
  actionMoreReasons: "+{0} more reasons",
  actionShowMore: "Show {0} more",
  actionShowLess: "Show less",
```

- [ ] **Step 2: Add the DE keys via a node utf8 write**

The Edit tool corrupts curly quotes/umlauts in `i18n.de.ts` (CRLF file). `Gründe`
carries a real `ü`. Patch with a node script that anchors on `\r\n` and writes
utf8. Create and run this throwaway script from the repo root:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  actionMonitoredCount: \"{0} überwacht\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const add =
  "  actionMoreReasons: \"+{0} weitere Gründe\",\r\n" +
  "  actionShowMore: \"{0} weitere anzeigen\",\r\n" +
  "  actionShowLess: \"Weniger anzeigen\",\r\n";
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
console.log("DE keys added");
'
```

Expected output: `DE keys added`.

- [ ] **Step 3: Verify the DE umlaut landed correctly (no ASCII sub, no corruption)**

Run: `npm run test:run -- src/app/i18n-encoding`
Expected: PASS (bans `fuer`/`druecken`-style ASCII subs; confirms real umlauts).

- [ ] **Step 4: Verify EN/DE key parity**

Run: `npx tsc --noEmit`
Expected: no errors (tsc enforces identical EN/DE key sets).

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add action-center reasons + show-more keys (EN/DE)"
```

---

## Task 3: ActionRow "+N more reasons" line

**Files:**
- Modify: `src/app/action-row.tsx`
- Test: `src/app/action-row.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/action-row.test.tsx` (inside the top-level `describe`, reuse
that file's existing `SuggestedAction` fixture style — build one inline here so
this task is self-contained):

```ts
it("renders a +N more reasons line when extraReasonsCount > 0", () => {
  const action = {
    id: "x", source: "raid",
    title: { key: "actionRaidTitle", params: [1, "x"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 70, tier: "now",
    cta: { kind: "open", view: "raid", id: 1 },
  } as never;
  const { getByText, rerender, queryByText } = render(
    <ActionRow lang="en-US" action={action} onOpen={() => {}} extraReasonsCount={2} />,
  );
  expect(getByText("+2 more reasons")).toBeTruthy();
  rerender(<ActionRow lang="en-US" action={action} onOpen={() => {}} extraReasonsCount={0} />);
  expect(queryByText(/more reasons/)).toBeNull();
});
```

If `ActionRow` and `render`/`screen` are not yet imported in that test file, add
at the top:

```ts
import { render } from "@testing-library/react";
import { ActionRow } from "./action-row";
```

(Skip any import already present — duplicate imports are a lint failure.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/action-row.test.tsx`
Expected: FAIL — `+2 more reasons` not found (prop not rendered yet).

- [ ] **Step 3: Add the prop and the line**

In `src/app/action-row.tsx`, add the prop to the interface (after `rebaseline?`):

```ts
interface ActionRowProps {
  lang: Lang;
  action: SuggestedAction;
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
  onCreateTask?: (action: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
  onDraftMessage?: (action: SuggestedAction) => void;
  escalate?: EscalateBundle;
  rebaseline?: RebaselineBundle;
  extraReasonsCount?: number;
}
```

Add `extraReasonsCount` to the destructured params:

```ts
export function ActionRow({ lang, action, onOpen, onSnooze, onCreateTask, assignOwner, onDraftMessage, escalate, rebaseline, extraReasonsCount }: ActionRowProps) {
```

Then, in the JSX, find this existing block:

```tsx
        {action.learning?.moved && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {action.learning.moved === "up"
              ? t(lang, "learningSurfacedHint")
              : t(lang, "learningDemotedHint")}
          </span>
        )}
```

Insert immediately before it (a non-interactive muted line):

```tsx
        {extraReasonsCount != null && extraReasonsCount > 0 && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {t(lang, "actionMoreReasons", extraReasonsCount)}
          </span>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/action-row.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/action-row.tsx src/app/action-row.test.tsx
git commit -m "feat(action-row): show +N more reasons line for grouped rows"
```

---

## Task 4: ActionsPanel grouping + tier caps

**Files:**
- Modify: `src/app/actions-panel.tsx`
- Test: `src/app/actions-panel.test.tsx`

- [ ] **Step 1: Update existing fixtures so distinct rows don't collapse, and add the new tests**

In `src/app/actions-panel.test.tsx`, the existing `mk` helper gives every row
`cta:{view:"raid", id:1}`. Under grouping those all collapse into ONE entity,
which breaks the existing "Now/Soon" and sort tests. Make each row a distinct
entity by using its string `id` as the cta id.

Change the existing `mk` helper's cta line from:

```ts
  cta: { kind: "open", view: "raid", id: 1 },
```

to:

```ts
  cta: { kind: "open", view: "raid", id },
```

In the same file, the inline `soon` helper inside the "sorts soon-tier rows"
test has the same `cta: { kind: "open", view: "raid", id: 1 }` — change it the
same way to `cta: { kind: "open", view: "raid", id }`.

Then add these new tests inside the top-level `describe("ActionsPanel", ...)`:

```ts
it("collapses multiple signals on one entity into a single row", () => {
  const base = {
    source: "raid", moduleId: "raid", score: 70, tier: "now",
    cta: { kind: "open", view: "raid", id: 1 },
  };
  const actions = [
    { ...base, id: "r1", title: { key: "actionRaidTitle", params: [1, "r1"] }, why: { key: "actionRaidWhySeverity", params: ["High"] } },
    { ...base, id: "r2", score: 40, title: { key: "actionRaidTitle", params: [1, "r2"] }, why: { key: "actionRaidWhyNoOwner" } },
  ] as never;
  render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
  // One row (one Open button), plus the grouped reasons line.
  expect(screen.getAllByText("Open")).toHaveLength(1);
  expect(screen.getByText("+1 more reasons")).toBeTruthy();
});

it("caps the now tier and reveals the rest via show-more", async () => {
  const user = userEvent.setup();
  const actions = Array.from({ length: 7 }, (_, i) => ({
    id: `n${i}`, source: "raid", moduleId: "raid",
    title: { key: "actionRaidTitle", params: [1, `n${i}`] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 70 - i, tier: "now",
    cta: { kind: "open", view: "raid", id: i }, // distinct entities → no collapse
  })) as never;
  render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
  expect(screen.getAllByText("Open")).toHaveLength(5); // capped
  const more = screen.getByRole("button", { name: /show 2 more/i });
  await user.click(more);
  expect(screen.getAllByText("Open")).toHaveLength(7);
  expect(screen.getByRole("button", { name: /show less/i })).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm run test:run -- src/app/actions-panel.test.tsx`
Expected: the two new tests FAIL (no collapse, no cap yet); the fixture-edited
existing tests still PASS.

- [ ] **Step 3: Implement grouping + caps in the panel**

In `src/app/actions-panel.tsx`:

Update the React import to include `useMemo`:

```ts
import { useMemo, useState } from "react";
```

Add the group import (next to the other `./next-actions/types` import) and a cap
constant below `TIERS`:

```ts
import { groupNextActions, type ActionGroup } from "./next-actions/group";
```

```ts
const MAX_VISIBLE_PER_TIER = 5;
```

Inside the component, after the existing `const { ref, reset } = useResizable(...)`
line, add:

```ts
  const groups = useMemo(() => groupNextActions(actions), [actions]);
  const [expanded, setExpanded] = useState<Record<ActionTier, boolean>>({ now: false, soon: false, monitor: false });
```

Replace the entire rows block — from `{actions.length === 0 ? (` down to its
matching closing `)}` (the current lines rendering the empty state + the
`TIERS.map(...)` list) — with:

```tsx
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "actionsEmptyState")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-2">
          {TIERS.map(({ tier, labelKey }) => {
            const rows = groups.filter((g) => g.tier === tier);
            if (rows.length === 0) return null;
            const renderRow = (g: ActionGroup) => (
              <ActionRow
                key={g.key}
                lang={lang}
                action={g.primary}
                extraReasonsCount={g.extra.length}
                onOpen={onOpen}
                onSnooze={onSnooze}
                onCreateTask={onCreateTask}
                assignOwner={assignOwner}
                onDraftMessage={onDraftMessage}
                escalate={escalate}
                rebaseline={rebaseline}
              />
            );
            if (tier === "monitor") {
              return (
                <section key={tier}>
                  <button
                    type="button"
                    aria-expanded={monitorOpen}
                    aria-controls="action-monitor-list"
                    onClick={() => setMonitorOpen((o) => !o)}
                    className="mb-2 flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <span aria-hidden>{monitorOpen ? "▾" : "▸"}</span>
                    {t(lang, "actionMonitoredCount", rows.length)}
                  </button>
                  <div id="action-monitor-list" className="flex flex-col gap-2" hidden={!monitorOpen}>
                    {rows.map(renderRow)}
                  </div>
                </section>
              );
            }
            const open = expanded[tier];
            const visible = open ? rows : rows.slice(0, MAX_VISIBLE_PER_TIER);
            const hiddenCount = rows.length - visible.length;
            return (
              <section key={tier}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(lang, labelKey)} ({rows.length})
                </h3>
                <div className="flex flex-col gap-2">{visible.map(renderRow)}</div>
                {rows.length > MAX_VISIBLE_PER_TIER && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [tier]: !open }))}
                    className="mt-2 text-xs font-medium text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey"
                  >
                    {open ? t(lang, "actionShowLess") : t(lang, "actionShowMore", hiddenCount)}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
```

Note: the previous per-tier `.filter(...).sort(...)` is gone — `groupNextActions`
already returns groups sorted score desc, and `.filter` preserves that order.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/app/actions-panel.test.tsx`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no warnings. (Confirm `useState` is still used and `useMemo`
is now imported — an unused/missing import is a fatal `--max-warnings=0` lint
error.)

- [ ] **Step 6: Commit**

```bash
git add src/app/actions-panel.tsx src/app/actions-panel.test.tsx
git commit -m "feat(actions-panel): group rows per entity and cap now/soon tiers"
```

---

## Task 5: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:run`
Expected: all green. If a downstream test rendered `ActionsPanel`/`ActionRow`
with multiple same-entity fixtures and now sees one collapsed row, fix that
test's fixtures to use distinct `cta.id`s (same pattern as Task 4 Step 1) — do
not change the engine.

- [ ] **Step 2: Typecheck + lint (final)**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Confirm no stray debug artifacts**

Run: `git diff --stat HEAD~4`
Expected: only `group.ts`, `group.test.ts`, `action-row.tsx`, `action-row.test.tsx`,
`actions-panel.tsx`, `actions-panel.test.tsx`, `i18n.ts`, `i18n.de.ts`. No
`console.log`, no unrelated files.

---

## Out of scope (later slices / explicit non-goals)

- TIER threshold retune (`TIER_NOW`/`TIER_SOON` unchanged).
- `DashboardTopActions` grouping (panel-only this slice).
- Inline expand UI for "+N more reasons" (slice 2 — Layout).
- New CTAs (slice 3) / new providers (slice 4).
- No release/push/MR — that happens only on the explicit "release" trigger.
