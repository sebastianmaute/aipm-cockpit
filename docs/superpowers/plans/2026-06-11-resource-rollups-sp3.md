# Resource Rollups SP3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, in the workload/people view, how many open RAID items each resource owns — consuming the `RaidItem.ownerResourceId` FK set in SP2.

**Architecture:** Extend the pure `buildResourceWorkload` aggregation with a `raid` input and a `raidOpenCount` per row (resolving open RAID by owner FK → owner name, into the existing managed/unlinked buckets). Add an "Open RAID" column to the `ResourceWorkload` table and thread `raid` from `workspace-section` → `ResourcesPanel` → `ResourceWorkload`. No schema/serializer change.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + RTL, Tailwind (AIPM palette).

**Spec:** `docs/superpowers/specs/2026-06-11-resource-rollups-sp3-design.md`. **Branch:** `feat-resource-rollups-sp3`. Do NOT edit `eslint.config.mjs`.

**Verified facts:**
- `buildResourceWorkload(resources, tasks, absences, shifts, today)` in `resource-workload-rows.ts`; rows are `WorkloadRowBase` (managed + unlinked); `resolve(resourceId: number|null|undefined, assignee, email)` joins FK→name; the tasks loop increments `openCount`.
- `isTerminalStatus(status: RaidStatus, category: RaidCategory): boolean` in `./raid` (category-aware).
- `RaidItem`: `owner?: string`, `ownerEmail?: string`, `ownerResourceId?: number | null`, `status`, `category`.
- The table is `ResourceWorkload` in `resource-workload.tsx` (owns `WORKLOAD_COL_WIDTHS` + `WorkloadCol`); it renders managed rows AND unlinked rows in two separate blocks, both showing `row.openCount`/`row.overdueCount`. It is rendered ONLY in `resources-panel.tsx` (the `view === "workload"` block), which gets `tasks`/`absences`/`shifts` as props from `workspace-section.tsx`.

---

## Task 1: Aggregation — raidOpenCount in buildResourceWorkload

**Files:**
- Modify: `src/app/resource-workload-rows.ts`
- Modify: `src/app/resource-workload.tsx` (the single call site — add the `raid` prop + pass it; intermediate tsc error confined to resources-panel until Task 2)
- Test: `src/app/resource-workload-rows.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/resource-workload-rows.test.ts` (the file already has `res()`/`task()` helpers and imports `Resource`/`Task`/`Absence`/`Shift`; add a `RaidItem` import and a small `raidItem` helper):

```ts
import type { RaidItem } from "./types";

const raidItem = (id: number, over: Partial<RaidItem> = {}): RaidItem =>
  ({ id, category: "R", title: `R${id}`, status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01",
     causedByRaidIds: [], stakeholderIds: [], ...over });

describe("buildResourceWorkload — raidOpenCount", () => {
  it("counts open RAID a resource owns, by ownerResourceId and by owner name", () => {
    const r = res(1, "Sample", "Dummy");
    const raid = [
      raidItem(10, { ownerResourceId: 1 }),
      raidItem(11, { owner: "Alex Example" }),
    ];
    const { managed } = buildResourceWorkload([r], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(2);
  });
  it("does not count terminal/closed RAID", () => {
    const r = res(1, "Sample", "Dummy");
    const raid = [raidItem(10, { ownerResourceId: 1, status: "Closed" })]; // Closed is terminal for category R
    const { managed } = buildResourceWorkload([r], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(0);
  });
  it("prefers ownerResourceId over a mismatched owner name", () => {
    const r = res(1, "Sample", "Dummy");
    const raid = [raidItem(10, { ownerResourceId: 1, owner: "stale name" })];
    const { managed, unlinked } = buildResourceWorkload([r], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(1);
    expect(unlinked).toHaveLength(0);
  });
  it("buckets a free-text RAID owner with no match under unlinked", () => {
    const raid = [raidItem(10, { owner: "External Owner", ownerEmail: "e@x.com" })];
    const { managed, unlinked } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(0);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ display: "External Owner", raidOpenCount: 1 });
  });
  it("skips a RAID item with neither owner nor FK", () => {
    const raid = [raidItem(10, {})];
    const { managed, unlinked } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(0);
    expect(unlinked).toHaveLength(0);
  });
});
```

Also update the EXISTING tests' `buildResourceWorkload(...)` calls in this file: they currently pass `(resources, tasks, absences, shifts, today)` — insert `[]` (empty raid) before `today` so they compile: `buildResourceWorkload(resources, tasks, absences, shifts, [], today)`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/resource-workload-rows.test.ts`
Expected: FAIL — `buildResourceWorkload` takes 5 args / `raidOpenCount` undefined.

- [ ] **Step 3: Implement the aggregation**

In `src/app/resource-workload-rows.ts`:

1. Extend the imports: add `RaidItem` to the `./types` import, and add `import { isTerminalStatus } from "./raid";`.
2. Add `raidOpenCount: number;` to `WorkloadRowBase` (after `openCount`).
3. In BOTH row constructors (the managed `managed.set(r.id, { ... })` and the unlinked `row = { ... }`), add `raidOpenCount: 0,` next to `openCount: 0`.
4. Change the signature to add `raid` before `today`:
```ts
export function buildResourceWorkload(
  resources: readonly Resource[],
  tasks: readonly Task[],
  absences: readonly Absence[],
  shifts: readonly Shift[],
  raid: readonly RaidItem[],
  today: string,
): WorkloadResult {
```
5. After the `for (const s of shifts) { ... }` loop, add the RAID loop:
```ts
  for (const item of raid) {
    if (isTerminalStatus(item.status, item.category)) continue;
    const row = resolve(item.ownerResourceId, item.owner ?? "", item.ownerEmail);
    if (!row) continue;
    row.raidOpenCount++;
  }
```
6. Update the function's top doc comment to mention RAID ownership as a fourth contributor (task/absence/shift/raid).

- [ ] **Step 4: Keep the call site compiling**

In `src/app/resource-workload.tsx`, the `useMemo` at ~line 57 calls `buildResourceWorkload(resources, tasks, absences, shifts, today)`. Add a `raid` prop to the component and pass it:
- Add `raid: readonly RaidItem[];` to `ResourceWorkloadProps` (after `shifts`); add `RaidItem` to its `./types` import.
- Destructure `raid` in the component signature.
- Change the call to `buildResourceWorkload(resources, tasks, absences, shifts, raid, today)` and add `raid` to the useMemo deps array.

(This leaves `resources-panel.tsx` not yet passing `raid` to `<ResourceWorkload>` — a tsc error confined to resources-panel.tsx, fixed in Task 2. This is an intermediate plumbing commit.)

- [ ] **Step 5: Run the aggregation tests**

Run: `npx vitest run src/app/resource-workload-rows.test.ts`
Expected: PASS (existing + 5 new tests).

- [ ] **Step 6: Verify the confined tsc error**

Run: `npx tsc --noEmit`
Expected: error(s) ONLY in `src/app/resources-panel.tsx` (missing required `raid` prop on `<ResourceWorkload>`), and possibly `resource-workload.test.tsx`/`resources-panel.test.tsx` fixtures. If errors appear anywhere else, investigate. Note them for Task 2.

- [ ] **Step 7: Commit**

```bash
git add src/app/resource-workload-rows.ts src/app/resource-workload-rows.test.ts src/app/resource-workload.tsx
git commit -m "feat: raidOpenCount per resource in buildResourceWorkload"
```

---

## Task 2: Workload column + thread raid

**Files:**
- Modify: `src/app/resource-workload.tsx` (column + i18n key usage)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (new key `workloadOpenRaid`)
- Modify: `src/app/resources-panel.tsx` (add `raid` prop, forward to ResourceWorkload)
- Modify: `src/app/workspace-section.tsx` (pass `raid` to ResourcesPanel)
- Test: `src/app/resource-workload.test.tsx` if present (render assertion); else covered by Task 1 + tsc

- [ ] **Step 1: Add the i18n key**

In `src/app/i18n.ts` add to `enUS` (near other `workload*`/`resources*` keys): `workloadOpenRaid: "Open RAID",`.
In `src/app/i18n.de.ts` add the matching line: `workloadOpenRaid: "Offene RAID",`.
(ASCII `"` delimiters — verify the de diff shows only this one added line.)

- [ ] **Step 2: Add the column width + header + body cells**

In `src/app/resource-workload.tsx`:

1. Add `openRaid` to `WORKLOAD_COL_WIDTHS` (the object near line 12) with a width consistent with the other numeric columns, e.g. `openRaid: 90,` placed next to `overdue`. (`WorkloadCol` is `keyof typeof WORKLOAD_COL_WIDTHS`, so it picks this up automatically.)
2. Add a header `<th>` after the `overdue` header (~line 82-85), mirroring its markup:
```tsx
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.openRaid, minWidth: colWidths.openRaid }}>
              {t(lang, "workloadOpenRaid")}
            </th>
```
3. In BOTH the managed-row body (~line 113-122) and the unlinked-row body (~line 213-222), after the overdue `<td>`, add a numeric cell:
```tsx
                <td className="px-3 py-2 text-right tabular-nums">{row.raidOpenCount}</td>
```
Match the exact `<td>` styling of the adjacent open/overdue cells in each block (copy their className). If the overdue cell has conditional styling, the openRaid cell uses the plain numeric style (like the openCount cell).

- [ ] **Step 3: Thread `raid` through resources-panel**

In `src/app/resources-panel.tsx`:
- Add `raid: readonly RaidItem[];` to `ResourcesPanelProps` (after `shifts`); add `RaidItem` to its `./types` import.
- Destructure `raid` in the component params (near `tasks`/`absences`/`shifts`).
- Pass `raid={raid}` to `<ResourceWorkload>` (the `view === "workload"` render, after `shifts={shifts}`).

- [ ] **Step 4: Pass `raid` from workspace-section**

In `src/app/workspace-section.tsx`, find the `<ResourcesPanel ... />` render (it already passes `tasks`/`absences`/`shifts`; `raid` is already destructured from `useWorkspace()` at ~line 237). Add `raid={raid}`. ALSO grep for any OTHER render site of `ResourcesPanel` or `ResourceWorkload` (e.g. a popout path) and add `raid` there too — `tsc` will flag a missed one since the prop is required.

- [ ] **Step 5: Fix any test fixtures**

`npx tsc --noEmit` — if `resource-workload.test.tsx` / `resources-panel.test.tsx` / `workspace-section.test.tsx` fixtures now lack the required `raid` prop, add `raid={[]}` (JSX) or `raid: []` (object) to them.

- [ ] **Step 6: Gates**

Run: `npx tsc --noEmit` (0 now — full chain threaded), `npm run lint` (0), `npx vitest run src/app/resource-workload-rows.test.ts src/app/resource-workload.test.tsx src/app/resources-panel.test.tsx src/app/workspace-section.test.tsx 2>$null`, then broad `npx vitest run src/app`.

- [ ] **Step 7: Commit**

```bash
git add src/app/resource-workload.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/resources-panel.tsx src/app/workspace-section.tsx <any fixtures>
git commit -m "feat: Open RAID column in the workload view"
```

---

## Task 3: Release 0.64.0 + final gates

**Files:** `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version bump**

`package.json`: `0.63.0` → `0.64.0`. `src/app/version.ts`: `APP_VERSION = "0.64.0"`, update the `APP_BUILD_DATE` comment, set `APP_MILESTONE = "Hamilton"` (Peter F. Hamilton — fresh codename for the 0.64.x line), update the codename JSDoc to say the 0.64.x line is "Hamilton".

- [ ] **Step 2: CHANGELOG entry**

Prepend above `## [0.63.0]`:
```markdown
## [0.64.0] - 2026-06-11 "Hamilton"

Per-resource RAID ownership rollup (identity normalization SP3).

### Added
- The workload/people view now shows an "Open RAID" count per resource — how many non-terminal RAID items each person owns, resolved by the owner link set in 0.63.0 (falling back to the owner name into the unlinked bucket). The first view to consume the resource-ownership links.
```

- [ ] **Step 3: Full gates + build**

Run: `npm run lint` (0), `npx tsc --noEmit` (0), `npx vitest run` (full suite green — report counts; confirm `golden-workspace.test.ts` passes / fixtures byte-unchanged), `npm run build` (succeeds).

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.64.0 \"Hamilton\" — per-resource RAID rollup (SP3)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean; `npm run lint` clean; full `npx vitest run` green; `npm run build` succeeds; golden fixtures unchanged.
- [ ] Manual: in the workload view, a resource owning an open RAID item shows a non-zero "Open RAID"; closing that RAID drops the count; a RAID with a free-text owner shows under an unlinked row.

## Notes / landmines

- i18n.de.ts curly-quote vigilance (one key added).
- `isTerminalStatus` is CATEGORY-AWARE — pass both `item.status` and `item.category` (not a flat status check).
- `resolve` reused as-is — `ownerResourceId` is `number | null`, passes directly (no coalesce).
- All render sites of `ResourceWorkload`/`ResourcesPanel` must receive `raid` (tsc enforces — required prop).
- Out of scope: severity RAG breakdown, changes-owned, table display-authority, SP4.
