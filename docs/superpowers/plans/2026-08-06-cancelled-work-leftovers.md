# Cancelled-work leftovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the cancelled-work presentation split that 0.213.0 stopped short of — close
`docs/open-followups.md` §65, §66 and §67, and §64's presentation half.

**Architecture:** One shared predicate (`isTaskOutOfScope`) replaces the twice-inlined
`isTaskClosed(t) && !isTaskDelivered(t)`; the health engine stops colouring out-of-scope work Green
and publishes its count separately; the portfolio surfaces and the two model-facing feeds gain the
same no-active-scope state the dashboard already has.

**Tech Stack:** TypeScript · React 19 · vitest 4 · i18n EN/DE key parity enforced by `tsc`.

**Source spec:** `docs/superpowers/specs/2026-08-06-open-followups-triage-design.md`, slice 2.

---

## Decisions taken before writing this plan

**§66 → option B** (exclude out-of-scope work from the R/A/G tally *and* surface its count), chosen
by the user over A (exclude silently) and C (per-caller flag; rejected — a second copy of this
predicate is the drift `hasNoActiveScope`'s doc comment records having already caused once).

★ **Implemented as a sibling field, not a fourth key in `counts`.** `GroupHealth.counts` is typed
`Record<Health, number>` and `Health` is the RAG union; a non-RAG key inside it muddles the type and
breaks `counts[h.color] += 1`. `GroupHealth.outOfScope: number` delivers the same user-visible
outcome. The option table shown to the user said "counts gains a 4th key" — this is that option,
better typed.

★★ **A hand-pinned out-of-scope task is NOT excluded.** `computeTaskHealth` checks `healthOverride`
first, and §66 records that `dashboardProgressCaption`'s "unless its health was set by hand" clause
exists for precisely that reason. So the exclusion is guarded on `!task.healthOverride`, and the
invariant is `R + A + G + outOfScope === total`, **not** `R + A + G === inScope`.

**§67 → the ` ` source escape, not a printable stand-in.** The register proposes `|` or a space and
warns both are merely *unlikely* to collide. Writing the existing NUL as an escape sequence keeps the
runtime separator byte-identical — still the one character that cannot occur in a URL or a token —
while removing the raw `0x00` that makes the file read as binary to grep. No behaviour change at all.

**Out of scope — §64's persisted half.** `snapshot.ts` `pctComplete` and `dashboard-panel.tsx`'s
landing-state `complete:` stay untouched. §64's ★★ warns against pattern-matching the presentation
fix onto stored figures: null-ing a persisted number is a data-shape change that Trends charts over
time and version history diffs.

**Two surfaces this plan adds that the register does not name:**

- `portfolio-rollup.ts` `avgCompletionPercent` averages `completionPercent` across projects, so a
  no-scope project drags the portfolio-wide figure down with a 0 meaning "nothing left", not
  "nothing done". §64 names the row and the cell but not the aggregate.
- §66 claims the fix "ripples well past the dashboard" via `dashboard.ts`'s `overallComputed`. That
  is **false**: out-of-scope tasks only ever add to `counts.G`, and `color` is
  `R > 0 ? "R" : A > 0 ? "A" : "G"` with G as the fallback, so removing G-only entries cannot change
  the result in any case. Only the reports group tiles actually move. Task 8 records this.

**Deviation from the spec's register discipline.** The spec says a slice that closes an entry updates
`docs/open-followups.md` "in the same commit". This plan puts the register in its own final commit,
matching what slice 1 shipped. Flagged rather than done silently.

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `src/app/task-closed.ts` | **new export** `isTaskOutOfScope` — the single scope predicate |
| `src/app/dashboard.ts` | `scopeCounts` consumes it; `DashboardProgress.outOfScope` |
| `src/app/health.ts` | `"closed"` driver (§65); `GroupHealth.outOfScope` + guarded exclusion (§66) |
| `src/app/dashboard-panel.tsx` | render the count on the R/A/G tile |
| `src/app/reports.tsx` | render it on each group card |
| `src/app/i18n.ts` · `i18n.de.ts` | 3 new keys; reword `dashboardProgressCaption` |
| `src/app/no-nul-bytes.test.ts` | **new** ratchet — no NUL in any tracked `.ts`/`.tsx` |
| `src/app/portfolio-rollup.ts` | `completionPercent: number \| null`; average skips nulls |
| `src/app/use-portfolio-health.ts` | emit null when no active scope; §67 NUL → ` ` |
| `src/app/portfolio-health-panel.tsx` | render the null state |
| `src/app/ai-dashboard-snapshot.ts` | `progress.noActiveScope` |
| `src/app/committee-report/report-draft.ts` | no-active-scope completion line |
| `docs/open-followups.md` | close §65 · §66 · §67; half-close §64 |

**Fixture helpers already in the target test files — use these names, do not invent new ones:**
`createTask(overrides)` in `health.test.ts` · `task(overrides)` in `task-closed.test.ts` ·
`baseRow(overrides)` in `portfolio-rollup.test.ts`.
★ `health.test.ts` **mocks `./i18n`** so `t()` returns the key itself (or `key(arg1,arg2)`); assert
on keys there, never on English strings.

---

## Task 1: The shared scope predicate

**Files:**
- Modify: `src/app/task-closed.ts`
- Modify: `src/app/dashboard.ts` (`scopeCounts`)
- Test: `src/app/task-closed.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/app/task-closed.test.ts`, and add
      `isTaskOutOfScope` to the existing import from `./task-closed`.

```ts
describe("isTaskOutOfScope", () => {
  it("is true for a cancelled task", () => {
    expect(isTaskOutOfScope(task({ status: "Cancelled" }))).toBe(true);
  });

  // The pair open-followups §65 is about: closed, but nothing was delivered.
  it("is true for Done with no completedDate", () => {
    expect(isTaskOutOfScope(task({ status: "Done" }))).toBe(true);
  });

  it("is false for a delivered task", () => {
    expect(isTaskOutOfScope(task({ status: "Done", completedDate: "2026-08-01" }))).toBe(false);
  });

  it("is false for an open task", () => {
    expect(isTaskOutOfScope(task({ status: "In Progress" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/task-closed.test.ts --reporter=dot`
Expected: FAIL, 4 tests, `TypeError: isTaskOutOfScope is not a function`

- [ ] **Step 3: Implement** — append to `src/app/task-closed.ts`

```ts
/** CLOSED but never DELIVERED — cancelled work, plus the `Done`-with-no-date
 *  rows. This is the "not part of the scope any more" question, the one that
 *  decides both the completion denominator and the R/A/G tally.
 *
 *  ★★ Shared rather than re-derived, and that is the whole point: `scopeCounts`
 *  (dashboard.ts) and `computeGroupHealth` (health.ts) render side by side in
 *  ONE card, so a second copy of `isTaskClosed(t) && !isTaskDelivered(t)` that
 *  drifts puts two tiles on one screen disagreeing about the same tasks. That
 *  has already happened once with `hasNoActiveScope`. */
export function isTaskOutOfScope(task: Pick<Task, "status" | "completedDate">): boolean {
  return isTaskClosed(task) && !isTaskDelivered(task);
}
```

- [ ] **Step 4: Point `scopeCounts` at it** — in `src/app/dashboard.ts`, replace the inlined pair and
      the doc line naming it. Add `isTaskOutOfScope` to the existing `./task-closed` import.

```ts
 *  ★★ Extracted so a caller that needs only the SCOPE question does not have to
 *  re-derive the pair `isTaskOutOfScope` answers — re-deriving it is how two
 *  dashboard cards came to disagree in the first place. Callers outside
 *  `computeDashboardProgress` want `tasksHaveNoActiveScope` below, not this.
 *
 *  ★ `computeGroupHealth` asks the SAME predicate to decide what to leave out of
 *  the R/A/G tally, which is why it lives in `task-closed.ts` and not here.
 */
export function scopeCounts(tasks: readonly Task[]): { total: number; inScope: number } {
  const total = tasks.length;
  const outOfScope = tasks.filter(isTaskOutOfScope).length;
  return { total, inScope: Math.max(0, total - outOfScope) };
}
```

★ `isTaskClosed` and `isTaskDelivered` are still used elsewhere in `dashboard.ts` — do **not** drop
them from the import, or `--max-warnings=0` fails on the opposite mistake.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/task-closed.test.ts src/app/dashboard.test.ts --reporter=dot`
Expected: PASS, 0 failures

- [ ] **Step 6: Commit**

```bash
git add src/app/task-closed.ts src/app/task-closed.test.ts src/app/dashboard.ts
git commit -m "refactor: extract isTaskOutOfScope, the shared scope predicate"
```

---

## Task 2: §65 — a `Done` task with no completion date announces "closed"

**Files:**
- Modify: `src/app/health.ts` (`HealthDriver`, `computeTaskHealth`, `driverKeys`)
- Modify: `src/app/reports.tsx` (`driverKey`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/health.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/app/health.test.ts`

```ts
describe("closed-but-not-delivered drivers (open-followups §65)", () => {
  it("a Done task with no completedDate says 'closed', not 'completed'", () => {
    const h = computeTaskHealth(createTask({ status: "Done" }), "2026-08-06");
    expect(h.drivers).toEqual(["closed"]);
  });

  it("a delivered task still says 'completed'", () => {
    const h = computeTaskHealth(
      createTask({ status: "Done", completedDate: "2026-08-01" }),
      "2026-08-06",
    );
    expect(h.drivers).toEqual(["completed"]);
  });

  it("a cancelled task still says 'cancelled'", () => {
    const h = computeTaskHealth(createTask({ status: "Cancelled" }), "2026-08-06");
    expect(h.drivers).toEqual(["cancelled"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/health.test.ts --reporter=dot`
Expected: FAIL on the first case — received `["completed"]`, expected `["closed"]`

- [ ] **Step 3: Implement** — in `src/app/health.ts`, add `"closed"` to the `HealthDriver` union
      (after `"completed"`), and replace the finished-task branch of `computeTaskHealth`:

```ts
  // A finished task is non-active: it must not be flagged red/amber/overdue.
  // ★ THREE-WAY, not two. `isTaskDelivered` alone would label a Done-with-no-date
  //   row "cancelled", which is a different false statement from the one being
  //   fixed (open-followups §65). Cancelled is a STATUS; delivered is a DATE.
  if (task.completedDate || isTaskFinished(task)) {
    return {
      color: "G",
      drivers: [
        task.status === "Cancelled"
          ? "cancelled"
          : isTaskDelivered(task)
            ? "completed"
            : "closed",
      ],
    };
  }
```

  Add `isTaskDelivered` to `health.ts`'s imports from `./task-closed`.

- [ ] **Step 4: Fix the two exhaustive driver maps `tsc` now rejects**

Run: `npx tsc --noEmit`
Expected: FAIL — `Record<HealthDriver, …>` missing `closed`, in `health.ts` `driverKeys` **and**
`reports.tsx` `driverKey`.

Add `closed: "healthDriverClosed",` to both, and add
`| "healthDriverClosed"` to each map's inline value union.

- [ ] **Step 5: Add the i18n key to both dictionaries**

`src/app/i18n.ts`, beside `healthDriverCompleted`:

```ts
  healthDriverClosed: "closed",
```

`src/app/i18n.de.ts`, same position:

```ts
  healthDriverClosed: "geschlossen",
```

★★ **Write `i18n.de.ts` with a node utf8 write, never the Edit tool** — the file is CRLF and Edit
curls double quotes and corrupts umlauts. Anchor the replacement on `\r\n`, not `\n`, or it silently
no-ops:

```bash
node -e "const f='src/app/i18n.de.ts';const fs=require('fs');let s=fs.readFileSync(f,'utf8');const a='  healthDriverCompleted:';if(!s.includes(a))throw new Error('anchor missing');s=s.replace(a,'  healthDriverClosed: \"geschlossen\",\r\n'+a);fs.writeFileSync(f,s,'utf8');console.log('ok')"
```

- [ ] **Step 6: Run tests and typecheck to verify they pass**

Run: `npx vitest run src/app/health.test.ts --reporter=dot` → PASS
Run: `npx tsc --noEmit; echo "EXIT=$?"` → `EXIT=0`

- [ ] **Step 7: Commit**

```bash
git add src/app/health.ts src/app/health.test.ts src/app/reports.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "fix: a Done task with no completion date announces \"closed\" (open-followups §65)"
```

---

## Task 3: §66 — cancelled work leaves the R/A/G tally

**Files:**
- Modify: `src/app/health.ts` (`GroupHealth`, `computeGroupHealth`)
- Modify: `src/app/dashboard.ts` (`DashboardProgress`, `computeDashboardProgress`)
- Test: `src/app/health.test.ts`, `src/app/dashboard.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/app/health.test.ts`

```ts
describe("out-of-scope work in the group tally (open-followups §66)", () => {
  const TODAY = "2026-08-06";

  it("excludes cancelled work from R/A/G and counts it separately", () => {
    const g = computeGroupHealth(
      [createTask({ status: "Cancelled" }), createTask({ status: "Cancelled" })],
      TODAY,
    );
    expect(g.counts).toEqual({ R: 0, A: 0, G: 0 });
    expect(g.outOfScope).toBe(2);
  });

  it("keeps a HAND-PINNED cancelled task in the tally", () => {
    const g = computeGroupHealth(
      [createTask({ status: "Cancelled", healthOverride: "R" })],
      TODAY,
    );
    expect(g.counts.R).toBe(1);
    expect(g.outOfScope).toBe(0);
    expect(g.color).toBe("R");
  });

  it("keeps delivered work Green — only never-delivered work leaves", () => {
    const g = computeGroupHealth(
      [createTask({ status: "Done", completedDate: "2026-08-01" })],
      TODAY,
    );
    expect(g.counts.G).toBe(1);
    expect(g.outOfScope).toBe(0);
  });

  it("holds R + A + G + outOfScope === total", () => {
    const tasks = [
      createTask({ status: "Cancelled" }),
      createTask({ status: "Done" }),
      createTask({ status: "Done", completedDate: "2026-08-01" }),
      createTask({ status: "In Progress", dueDate: "2026-01-01" }),
      createTask({ status: "In Progress", dueDate: "2026-12-01" }),
    ];
    const g = computeGroupHealth(tasks, TODAY);
    expect(g.counts.R + g.counts.A + g.counts.G + g.outOfScope).toBe(tasks.length);
    expect(g.outOfScope).toBe(2);
  });

  it("leaves the overall colour unchanged — G is the fallback either way", () => {
    expect(computeGroupHealth([createTask({ status: "Cancelled" })], TODAY).color).toBe("G");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/health.test.ts --reporter=dot`
Expected: FAIL — `g.outOfScope` is `undefined`, `counts.G` is `2` in the first case

- [ ] **Step 3: Implement in `health.ts`** — add the field to the type:

```ts
export type GroupHealth = {
  color: Health;
  counts: Record<Health, number>;
  /** Closed-but-never-delivered tasks, EXCLUDED from `counts` — cancelled work
   *  and the Done-with-no-date rows. A hand-pinned one is NOT counted here; it
   *  keeps its manual colour in `counts` (open-followups §66). So the invariant
   *  is `R + A + G + outOfScope === total`, not `=== inScope`. */
  outOfScope: number;
  drivers: HealthDriver[];
};
```

  and replace the loop in `computeGroupHealth`:

```ts
  const counts: Record<Health, number> = { R: 0, A: 0, G: 0 };
  const seenDrivers = new Set<HealthDriver>();
  let outOfScope = 0;

  for (const t of tasks) {
    // ★★ `healthOverride` FIRST — a hand-pinned cancelled row keeps its colour,
    //    which is exactly what `dashboardProgressCaption`'s "unless its health
    //    was set by hand" clause has always described. Do not simplify it away.
    if (!t.healthOverride && isTaskOutOfScope(t)) {
      outOfScope += 1;
      continue;
    }
    const h = computeTaskHealth(t, todayISO, holidays);
    counts[h.color] += 1;
    if (h.color !== "G") {
      for (const d of h.drivers) seenDrivers.add(d);
    } else if (h.drivers.includes("manual")) {
      // A user-pinned Green is a deliberate signal worth surfacing.
      seenDrivers.add("manual");
    }
  }
```

  Return `{ color, counts, outOfScope, drivers }`. Import `isTaskOutOfScope` from `./task-closed`.

- [ ] **Step 4: Thread it onto `DashboardProgress`** — in `src/app/dashboard.ts`:

```ts
  counts: Record<Health, number>;
  /** Closed-but-never-delivered tasks, excluded from `counts`. Equals
   *  `total - inScope` whenever no task carries a `healthOverride`. */
  outOfScope: number;
```

  and in `computeDashboardProgress`, capture the whole result instead of just `.counts`:

```ts
  const group = computeGroupHealth(tasks, todayISO, holidaySet);
  const { total, inScope: denominator } = scopeCounts(tasks);
  const completed = tasks.filter((t) => isTaskDelivered(t)).length;
  const percent = denominator === 0 ? 0 : Math.round((completed / denominator) * 100);
  return {
    total,
    inScope: denominator,
    completed,
    percent,
    counts: group.counts,
    outOfScope: group.outOfScope,
  };
```

  Update the function's doc comment — it currently says "completed tasks are counted in BOTH
  `completed` and `counts.G`", which stays true for DELIVERED work only. Say so, and add that
  never-delivered work is now in `outOfScope` instead.

- [ ] **Step 5: Pin the two engines agreeing** — append to `src/app/dashboard.test.ts`

```ts
it("progress.outOfScope equals total - inScope when nothing is hand-pinned", () => {
  const tasks = [
    createTask({ status: "Cancelled" }),
    createTask({ status: "Done", completedDate: "2026-08-01" }),
    createTask({ status: "In Progress" }),
  ];
  const p = computeDashboardProgress(tasks, "2026-08-06", new Set());
  expect(p.outOfScope).toBe(p.total - p.inScope);
  expect(p.outOfScope).toBe(1);
});
```

★ Use whatever task fixture `dashboard.test.ts` already defines; if it has none, build the array
inline with the same shape `health.test.ts`'s `createTask` produces.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/app/health.test.ts src/app/dashboard.test.ts --reporter=dot` → PASS
Run: `npx tsc --noEmit; echo "EXIT=$?"` → `EXIT=0`

- [ ] **Step 7: Commit**

```bash
git add src/app/health.ts src/app/health.test.ts src/app/dashboard.ts src/app/dashboard.test.ts
git commit -m "fix: cancelled work no longer counts Green in the R/A/G tally (open-followups §66)"
```

---

## Task 4: §66 — render the count, and correct the captions it falsifies

**Files:**
- Modify: `src/app/dashboard-panel.tsx` (the R/A/G `Tile`)
- Modify: `src/app/reports.tsx` (the group card counts line)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the two i18n keys.** `src/app/i18n.ts`:

```ts
  dashboardOutOfScopeCount: "Cancelled",
  reportsGroupOutOfScope: "{0} cancelled",
```

  `src/app/i18n.de.ts` (node utf8 write, CRLF anchors — see Task 2 Step 5):

```ts
  dashboardOutOfScopeCount: "Abgebrochen",
  reportsGroupOutOfScope: "{0} abgebrochen",
```

- [ ] **Step 2: Reword `dashboardProgressCaption` — it is FALSE otherwise.** It currently ends
      "…covers every task; closed work counts Green unless its health was set by hand." Cancelled
      work no longer counts Green.

`src/app/i18n.ts`:

```ts
  dashboardProgressCaption: "Completed tasks vs tasks in scope — cancelled work is out of both. The Red / Amber / Green split covers work still in scope; delivered work counts Green and cancelled work is counted separately, unless its health was set by hand.",
```

`src/app/i18n.de.ts`:

```ts
  dashboardProgressCaption: "Erledigte Aufgaben im Verhältnis zum Umfang — abgebrochene Arbeit bleibt in beiden außen vor. Die Rot/Gelb/Grün-Aufteilung umfasst Aufgaben im Umfang; gelieferte Arbeit zählt als Grün, abgebrochene wird separat gezählt, sofern die Ampel nicht manuell gesetzt wurde.",
```

★ Re-read `dashboardRagHint` in the same pass and correct it only if it makes the same claim.

- [ ] **Step 3: Render it on the dashboard tile** — in `src/app/dashboard-panel.tsx`, after the three
      `RagDot` spans inside the R / A / G `Tile`:

```tsx
                      {model.progress.outOfScope > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden="true" className="text-muted-foreground">✕</span>
                          <span className="sr-only">{t(lang, "dashboardOutOfScopeCount")}</span>
                          {model.progress.outOfScope}
                        </span>
                      )}
```

★ Conditional on `> 0` — "✕ 0" on every healthy project is noise. ★ The glyph is `aria-hidden` with
an `sr-only` companion because a bare "✕" announces inconsistently across screen readers; the three
existing `RagDot`s rely on the tile's own "R / A / G" label for context, and this one cannot.

- [ ] **Step 4: Render it on the reports group card** — in `src/app/reports.tsx`, replace the counts
      `<div>`:

```tsx
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {t(
                    lang,
                    "reportsGroupCounts",
                    row.health.counts.R,
                    row.health.counts.A,
                    row.health.counts.G,
                  )}
                  {row.health.outOfScope > 0
                    ? ` · ${t(lang, "reportsGroupOutOfScope", String(row.health.outOfScope))}`
                    : null}
                </div>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit; echo "EXIT=$?"` → `EXIT=0`
Run: `npx vitest run src/app/dashboard-panel.test.tsx src/app/reports.test.tsx --reporter=dot`
Expected: PASS (or a snapshot/assertion that legitimately names the new element — update it, do not
delete the assertion)

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/reports.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: surface the cancelled count beside R/A/G (open-followups §66)"
```

---

## Task 5: §67 — the NUL ratchet, written BEFORE the byte is fixed

★ **Order matters and this is why this task precedes Task 6.** A guard that has never been red is not
known to work. The offending byte is still on the branch at this point, so the test goes red for the
real reason, on real data.

**Files:**
- Create: `src/app/no-nul-bytes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/no-nul-bytes.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/** ★★ Filter by EXTENSION, never "everything under src" — `src/app/favicon.ico`
 *  is a tracked binary holding NULs legitimately, and open-followups §67 records
 *  that the looser phrasing was written for one command and then disproved by
 *  the very sweep meant to confirm it. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("committed source files are text", () => {
  // A NUL makes grep/ripgrep classify the file as BINARY and print
  // "Binary file … matches" with no line content, so every content sweep
  // silently SKIPS it. That already cost a reviewer once (open-followups §67).
  it("no .ts/.tsx file under src/ contains a NUL byte", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file, at: readFileSync(file).indexOf(0) }))
      .filter((hit) => hit.at !== -1)
      .map((hit) => `${hit.file} @ byte ${hit.at}`);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails on the REAL byte**

Run: `npx vitest run src/app/no-nul-bytes.test.ts --reporter=dot`
Expected: FAIL, naming `use-portfolio-health.ts @ byte 2940`. If it passes here, the walk is not
reaching the file — fix the walk before going on, because a green guard proves nothing yet.

- [ ] **Step 3: Commit the guard while it is still red-worthy**

```bash
git add src/app/no-nul-bytes.test.ts
git commit -m "test: ratchet against committed NUL bytes in source (open-followups §67)"
```

★ Committing a knowingly-failing test is deliberate here — it is one commit, and Task 6's first step
turns it green. Do not run the full suite between these two commits.

---

## Task 6: §64 presentation half + §67 fix

**Files:**
- Modify: `src/app/use-portfolio-health.ts` (the NUL, and the null completion)
- Modify: `src/app/portfolio-rollup.ts`
- Modify: `src/app/portfolio-health-panel.tsx`
- Test: `src/app/portfolio-rollup.test.ts`

- [ ] **Step 1: Fix the NUL** — in `src/app/use-portfolio-health.ts`, the `configKey` template
      literal. Replace the raw `0x00` byte with the two-character escape ` `:

```ts
  const configKey = tursoConfig ? `${tursoConfig.httpUrl}\u0000${tursoConfig.authToken}` : "";
```

  Verify the byte is gone and the guard flips:

```bash
node -e "console.log('has NUL:', require('fs').readFileSync('src/app/use-portfolio-health.ts').includes(0))"
```
Expected: `has NUL: false`

Run: `npx vitest run src/app/no-nul-bytes.test.ts --reporter=dot` → PASS

- [ ] **Step 2: Write the failing rollup test** — append to `src/app/portfolio-rollup.test.ts`

```ts
describe("avgCompletionPercent with no-scope projects (open-followups §64)", () => {
  it("excludes a null-completion project instead of counting it as 0", () => {
    const agg = aggregatePortfolio([
      baseRow({ id: "a", completionPercent: 80 }),
      baseRow({ id: "b", completionPercent: null }),
    ]);
    expect(agg.avgCompletionPercent).toBe(80);
    expect(agg.projectCount).toBe(2);
  });

  it("returns 0 when every project has no active scope", () => {
    const agg = aggregatePortfolio([baseRow({ completionPercent: null })]);
    expect(agg.avgCompletionPercent).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/app/portfolio-rollup.test.ts --reporter=dot`
Expected: FAIL — first case received `40` (the null coerced through arithmetic), expected `80`

- [ ] **Step 4: Implement in `portfolio-rollup.ts`** — widen the field:

```ts
  /** Completion %, or null when the project has tasks but none in scope — an
   *  all-cancelled project's 0 would read as "not started" in a table scanned
   *  across projects (open-followups §64). */
  completionPercent: number | null;
```

  and count only real figures in `aggregatePortfolio`:

```ts
  let completionSum = 0;
  let completionCount = 0;
  for (const row of rows) {
    …
    if (row.completionPercent !== null) {
      completionSum += row.completionPercent;
      completionCount += 1;
    }
  }
  return {
    …
    avgCompletionPercent: completionCount === 0 ? 0 : Math.round(completionSum / completionCount),
  };
```

★ Divide by `completionCount`, **not** `rows.length` — that is the whole defect.

- [ ] **Step 5: Emit the null** — in `src/app/use-portfolio-health.ts`, in the `collected.push({…})`:

```ts
            completionPercent: hasNoActiveScope(model.progress) ? null : model.progress.percent,
```

  Import `hasNoActiveScope` from `./dashboard`.

- [ ] **Step 6: Render the null state** — in `src/app/portfolio-health-panel.tsx`, replace the
      completion cell:

```tsx
              <td className="py-2 pr-3 tabular-nums">
                {row.completionPercent === null ? (
                  <span title={t(lang, "dashboardNoActiveScope")}>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">{t(lang, "dashboardNoActiveScope")}</span>
                  </span>
                ) : (
                  `${row.completionPercent}%`
                )}
              </td>
```

★ A bare em dash is not an accessible value — `title` is hover-only (no keyboard focus, unreachable
on touch), so the `sr-only` companion is the actual disclosure, not the tooltip.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/app/portfolio-rollup.test.ts src/app/no-nul-bytes.test.ts --reporter=dot`
→ PASS
Run: `npx tsc --noEmit; echo "EXIT=$?"` → `EXIT=0` (it will flag any other consumer of
`completionPercent` that cannot take null — fix each at its own call site)

- [ ] **Step 8: Commit**

```bash
git add src/app/use-portfolio-health.ts src/app/portfolio-rollup.ts src/app/portfolio-rollup.test.ts src/app/portfolio-health-panel.tsx
git commit -m "fix: a no-scope project reads \"—\", not 0%, in portfolio health (open-followups §64, §67)"
```

---

## Task 7: §64 — the two model-facing feeds

**Files:**
- Modify: `src/app/ai-dashboard-snapshot.ts`
- Modify: `src/app/committee-report/report-draft.ts`
- Test: `src/app/ai-dashboard-snapshot.test.ts`,
  `src/app/committee-report/report-draft.test.ts`

- [ ] **Step 1: Write the failing tests.** In `ai-dashboard-snapshot.test.ts`:

```ts
it("tells the model when a project has no active scope (open-followups §64)", () => {
  const snap = buildAiDashboardSnapshot(
    modelWith([taskCancelled(), taskCancelled()]),
  );
  expect(snap.progress.noActiveScope).toBe(true);
  expect(snap.progress.inScope).toBe(0);
});
```

In `report-draft.test.ts`:

```ts
it("does not tell the model an all-cancelled project is 0% complete (§64)", () => {
  const prompt = buildReportDraftPrompt(allCancelledModel(), "en-US");
  expect(prompt).not.toContain("0% complete");
  expect(prompt).toContain("no active scope");
});
```

★ Both tests must build their model with the file's own existing fixture/builder — read the top of
each test file and reuse it rather than importing a new one; the names above are placeholders for
whatever those files already call their model builder and their prompt entry point.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/app/ai-dashboard-snapshot.test.ts src/app/committee-report/report-draft.test.ts --reporter=dot`
Expected: FAIL — `noActiveScope` undefined; prompt contains `0% complete`

- [ ] **Step 3: Implement.** In `ai-dashboard-snapshot.ts`, extend the `progress` type and object:

```ts
  /** `total` is every task; `inScope` is the denominator `percent` divides by
   *  … (existing comment) … `noActiveScope` is true when the project HAS tasks
   *  but none are in scope, so the model is not handed a bare 0 that reads as
   *  "not started yet" (open-followups §64). */
  progress: { total: number; inScope: number; completed: number; percent: number; noActiveScope: boolean };
```

```ts
    progress: {
      total: model.progress.total,
      inScope: model.progress.inScope,
      completed: model.progress.completed,
      percent: model.progress.percent,
      noActiveScope: hasNoActiveScope(model.progress),
    },
```

  In `report-draft.ts`, branch the completion line:

```ts
    (hasNoActiveScope(model.progress)
      ? `- Completion: no active scope — all ${model.progress.total} tasks are cancelled\n`
      // inScope, NOT total: this pair sits inside the same sentence as the
      // percentage, and a model handed 100% beside "5 of 10" will contradict itself.
      : `- Completion: ${model.progress.percent}% complete ` +
        `(${model.progress.completed} of ${model.progress.inScope} tasks done)\n`) +
```

  Import `hasNoActiveScope` from `../dashboard` / `./dashboard` as the file's depth requires.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/ai-dashboard-snapshot.test.ts src/app/committee-report/report-draft.test.ts --reporter=dot`
→ PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-dashboard-snapshot.ts src/app/ai-dashboard-snapshot.test.ts src/app/committee-report/report-draft.ts src/app/committee-report/report-draft.test.ts
git commit -m "fix: tell the model a project has no active scope (open-followups §64)"
```

---

## Task 8: The register

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Close §65, §66 and §67** — strike each heading, strike its row in the index table at
      the top of the file, and move each to the provenance table.

- [ ] **Step 2: Half-close §64.** The presentation half (portfolio table, portfolio average, the two
      model feeds) is done. The persisted half is NOT: say so explicitly, naming `snapshot.ts`
      `pctComplete` and `dashboard-panel.tsx`'s landing-state `complete:`, and repeat the reason —
      a data-shape change that Trends charts over time and version history diffs.

- [ ] **Step 3: Record the three things this slice DISPROVED**, in the entries themselves:
      - §66's claim that the fix ripples via `overallComputed` — provably invariant, because
        out-of-scope tasks only ever added to `counts.G` and G is the fallback colour.
      - §64's surface list was missing `portfolio-rollup.ts`'s `avgCompletionPercent`.
      - §67's proposed printable stand-in (`|` or a space) was unnecessary — the ` ` escape keeps
        the separator byte-identical.

- [ ] **Step 4: Add a `### post-0.215.0` provenance block.**
      ★★ **Write no count anywhere** — not in the heading, not in the index row, not in prose. §64's
      own history is four wrong counts across four revisions, twice corrected by the commit that
      introduced the next wrong one.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: close open-followups §65, §66, §67; half-close §64"
```

---

## Gates before push

Serial, never piped, never two vitest processes at once:

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Errors" /tmp/cov.log
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
npm run docs:symbols:check; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Reports"; echo "EXIT=$?"
```

★ `test:shuffle` **is** required — this slice adds tests.
★ Axe **is** required, unlike slice 1: this changes rendered dashboard and reports markup. No
`globals.css` `@theme` edit, so the reused dev server is acceptable.
★★ Never read a gate's exit code through a pipe — `| tail` reports `tail`'s status and discards the
diagnostic. Redirect, `echo "EXIT=$?"` unpiped, then grep the file.

**Version bump:** the tile, the reports card and the portfolio table all change visibly, so this is
user-facing. Offer the bump (`version.ts` + `CHANGELOG.md` + the five ungated copies) rather than
assuming either way.
