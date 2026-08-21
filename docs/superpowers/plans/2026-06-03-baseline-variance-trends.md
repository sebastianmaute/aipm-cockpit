# Baseline + Variance / Burndown Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture periodic KPI snapshots in Turso-only append-only tables and surface baseline-vs-current variance, KPI trends, and a historical burn-down overlay in a new Trends view, with switch-away transparency and gap highlighting.

**Architecture:** A snapshot subsystem layered on the Turso HTTP pipeline, fully separate from the workspace `StorageBackend.save()` cycle (which is last-write-wins and would otherwise wipe the data). Pure logic (`snapshot.ts`, `snapshot-schema.ts`) + a thin async store (`snapshot-store.ts`) + a main-window-only orchestration hook (`use-snapshots.ts`) + dependency-free SVG UI (`trend-chart.tsx`, `trends-panel.tsx`).

**Tech Stack:** Next.js 16 / React / TypeScript, Vitest 4 + React Testing Library, Turso libSQL HTTP `/v2/pipeline`, Tailwind v4, dependency-free inline SVG.

---

## Critical conventions (read before any task)

- **GIT SAFETY (every task):** ONLY `git add` / `git commit`. NEVER `checkout`, `switch`, `reset`, `stash`, `rebase`, `revert`, `clean`, `restore`, or branch ops. Other git is read-only. Work stays on `feat-baseline-variance-trends`.
- **AIPM palette HARD constraint:** only the 9 brand tokens already in `globals.css` (`AIPM-green`, `AIPM-dark-blue`, `AIPM-pink`, `AIPM-purple`, surface/line/muted tokens, etc.). No raw hex, no gradients, no shadows.
- **i18n:** every new key MUST be added to BOTH `src/app/i18n.ts` (EN) and `src/app/i18n.de.ts` (DE). `tsc` enforces parity. In `i18n.de.ts` use straight ASCII quotes (`"`), never curly — verify with grep after editing.
- **Commands:** `npx tsc --noEmit` (typecheck), `npm run lint`, `npm run test:run` (full Vitest), or `npx vitest run <file>` for one file.
- **Commit messages:** Conventional Commits (`feat:`, `refactor:`, `test:`, `chore:`). Use the Bash tool with `git commit -F - <<'EOF' … EOF`.
- **Numbers in Turso are TEXT.** All snapshot columns are `TEXT`. Encode `number → String(n)`, `null → ""`, `boolean → "1"/"0"`. Decode `"" → null`, else `Number(...)`.

## File structure

| File | Responsibility | Status |
|---|---|---|
| `src/app/turso-pipeline.ts` | Shared HTTP `/v2/pipeline` runner (extracted from `TursoBackend`) | Create |
| `src/app/turso-backend.ts` | Use the shared runner | Modify |
| `src/app/snapshot.ts` | Pure: types, `bucketKey`, `expectedBuckets`, `detectGaps`, `forecastEndDate`, `buildSnapshot`, `computeVariance` | Create |
| `src/app/snapshot-schema.ts` | Pure SQL builders + row decoders for the snapshot tables | Create |
| `src/app/snapshot-store.ts` | `loadSnapshots` / `appendSnapshot` / `setBaseline` / `deleteSnapshot` over the pipeline | Create |
| `src/app/settings-types.ts` | Add `snapshots` settings + default + sanitize | Modify |
| `src/app/use-snapshots.ts` | React hook: auto + manual capture (main window only) | Create |
| `src/app/trend-chart.tsx` | Dependency-free SVG line chart over snapshot dates, with gap bridge + shaded band | Create |
| `src/app/trends-panel.tsx` | Trends view: Turso gate, variance table, KPI trend charts, burn-down overlay, snapshot list | Create |
| `src/app/nav-config.ts` | Add `"trends"` AppView to Overview group + label key | Modify |
| `src/app/nav-icons.tsx` | Add `trends` icon glyph | Modify |
| `src/app/workspace-section.tsx` | Dynamic-mount `TrendsPanel` when `activeTab === "trends"` | Modify |
| `src/app/task-manager.tsx` | Instantiate `useSnapshots`, pass to workspace section | Modify |
| `src/app/settings-sections/integrations-section.tsx` | Snapshot recording toggle + cadence select in the Turso block | Modify |
| `src/app/use-storage-backend.ts` | Switch-away-from-Turso warning replaces the convert-confirm | Modify |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | New keys | Modify |
| `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/frontend.md` | 0.49.0 "Le Guin" bump | Modify |

---

## Task 1: Extract the shared Turso pipeline runner

**Files:**
- Create: `src/app/turso-pipeline.ts`
- Create: `src/app/turso-pipeline.test.ts`
- Modify: `src/app/turso-backend.ts` (replace the private `runPipeline` with the shared function)

- [ ] **Step 1: Write the failing test** — `src/app/turso-pipeline.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTursoPipeline } from "./turso-pipeline";
import { StorageNotReadyError } from "./storage";
import type { TursoConfig } from "./turso-config";

const cfg: TursoConfig = { httpUrl: "https://db.example.com", authToken: "tok" };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stubFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("runTursoPipeline", () => {
  it("throws StorageNotReadyError when config is null", async () => {
    await expect(runTursoPipeline(null, [{ sql: "SELECT 1" }])).rejects.toBeInstanceOf(StorageNotReadyError);
  });

  it("maps a network failure to a 'storage-unreachable' StorageNotReadyError", async () => {
    stubFetch(() => { throw new Error("ECONNREFUSED"); });
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }]))
      .rejects.toMatchObject({ hint: "storage-unreachable" });
  });

  it("maps HTTP 401 to a StorageNotReadyError", async () => {
    stubFetch(() => new Response("no", { status: 401 }));
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }])).rejects.toBeInstanceOf(StorageNotReadyError);
  });

  it("throws when a result row reports an error", async () => {
    stubFetch(() => new Response(JSON.stringify({ results: [{ type: "error", error: { message: "boom" } }] }), { status: 200 }));
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }])).rejects.toThrow(/boom/);
  });

  it("returns results on success and sends the Bearer token", async () => {
    const fetchMock = vi.fn(() => new Response(JSON.stringify({ results: [{ type: "ok" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await runTursoPipeline(cfg, [{ sql: "SELECT 1" }]);
    expect(out).toEqual([{ type: "ok" }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("omits the Authorization header when no token is configured", async () => {
    const fetchMock = vi.fn(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runTursoPipeline({ httpUrl: "http://localhost:8080", authToken: undefined }, [{ sql: "SELECT 1" }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/turso-pipeline.test.ts`
Expected: FAIL — `Failed to resolve import "./turso-pipeline"`.

- [ ] **Step 3: Create `src/app/turso-pipeline.ts`** (lift the body of `TursoBackend.runPipeline` verbatim)

```ts
// src/app/turso-pipeline.ts
//
// Shared Turso (libSQL) HTTP /v2/pipeline runner. Extracted from TursoBackend so
// the workspace backend AND the snapshot store share one transport with one
// place handling auth (401), unreachable networks, and error results.

import { StorageNotReadyError } from "./storage";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

function execute(stmt: SqlStmt) {
  return { type: "execute" as const, stmt };
}

export async function runTursoPipeline(
  config: TursoConfig | null,
  stmts: SqlStmt[],
): Promise<PipelineResultLike[]> {
  if (!config) {
    throw new StorageNotReadyError("Configure the Turso URL and token in Settings.");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Only authenticate when a token is configured — a loopback (local) tursodb
  // typically needs none.
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests: stmts.map(execute) }),
    });
  } catch {
    throw new StorageNotReadyError("storage-unreachable");
  }
  if (res.status === 401) {
    throw new StorageNotReadyError("Turso auth token rejected. Check the token in Settings.");
  }
  if (!res.ok) {
    throw new Error(`Turso returned ${res.status}. Try again later.`);
  }
  const raw: unknown = await res.json();
  if (!raw || typeof raw !== "object" || !("results" in raw)) {
    throw new Error("Turso returned an unexpected response shape.");
  }
  const results = (raw as { results?: PipelineResultLike[] }).results ?? [];
  for (const r of results) {
    if (r.type === "error") {
      throw new Error(`Turso error: ${r.error?.message ?? "unknown"}`);
    }
  }
  return results;
}
```

- [ ] **Step 4: Refactor `turso-backend.ts` to use it.** Replace the private `runPipeline` method and the local `execute` helper with a call to the shared function. Edit:
  - Add import: `import { runTursoPipeline } from "./turso-pipeline";`
  - Delete the module-level `function execute(...)`.
  - Delete the `private async runPipeline(stmts) { ... }` method.
  - Replace its two call sites (`this.runPipeline(stmts)` in `load()`, and `this.runPipeline(workspaceToStatements(workspace))` in `save()`) with `runTursoPipeline(this.config, stmts)` / `runTursoPipeline(this.config, workspaceToStatements(workspace))`.

- [ ] **Step 5: Run the full Turso suite + the new test**

Run: `npx vitest run src/app/turso-pipeline.test.ts src/app/turso-backend.test.ts`
Expected: PASS (all). Then `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/turso-pipeline.ts src/app/turso-pipeline.test.ts src/app/turso-backend.ts
git commit -F - <<'EOF'
refactor: extract shared runTursoPipeline from TursoBackend

Both the workspace backend and the upcoming snapshot store need the same
HTTP /v2/pipeline transport (401 / unreachable / error-result handling).
EOF
```

---

## Task 2: Snapshot types + `bucketKey`

**Files:**
- Create: `src/app/snapshot.ts`
- Create: `src/app/snapshot.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/snapshot.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { bucketKey } from "./snapshot";

describe("bucketKey", () => {
  it("formats a daily bucket as YYYY-MM-DD", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "daily")).toBe("2026-06-03");
  });
  it("formats a monthly bucket as YYYY-MM", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "monthly")).toBe("2026-06");
  });
  it("formats a weekly bucket as ISO year-week", () => {
    // 2026-06-03 is a Wednesday in ISO week 23.
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "weekly")).toBe("2026-W23");
  });
  it("uses the ISO week-year at a year boundary (2027-01-01 is in week 53 of 2026)", () => {
    expect(bucketKey(new Date("2027-01-01T10:00:00Z"), "weekly")).toBe("2026-W53");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshot"`.

- [ ] **Step 3: Create `src/app/snapshot.ts`** with the types and `bucketKey`

```ts
// src/app/snapshot.ts
//
// Pure snapshot domain logic for the Baseline + Variance / Burndown Trends
// feature. No React, no I/O. Snapshots capture project KPIs at a moment in time
// (persisted Turso-only) so slippage can be shown over time.

import type { Health } from "./health";
import type { DashboardModel } from "./dashboard";
import type { Milestone, Task } from "./types";

export type SnapshotCadence = "weekly" | "daily" | "monthly";
export type SnapshotTrigger = "auto" | "manual";

export interface SnapshotSeriesPoint {
  period: string;
  plannedHours: number;
  actualHours: number | null;
  plannedCost: number;
  actualCost: number | null;
}

export interface SnapshotMilestone {
  id: number;
  name: string;
  target: string;   // YYYY-MM-DD
  forecast: string;  // YYYY-MM-DD
}

export interface SnapshotRecord {
  id: string;            // client-generated = capturedAt (ISO ms), unique per capture
  capturedAt: string;    // ISO timestamp
  bucket: string;        // bucketKey(capturedAt, cadence)
  cadence: SnapshotCadence;
  trigger: SnapshotTrigger;
  isBaseline: boolean;
  remainingHours: number | null;
  remainingCost: number | null;
  pctComplete: number;
  forecastEndDate: string;  // YYYY-MM-DD
  planEndDate: string;      // YYYY-MM-DD
  spi: number | null;
  cpi: number | null;
  overallRag: Health | "";
  scheduleRag: Health | "";
  budgetRag: Health | "";
  scopeRag: Health | "";
  currency: string;
  milestones: SnapshotMilestone[];
  series: SnapshotSeriesPoint[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO-8601 week number + week-year for a date (Mon-based, week 1 contains the
 *  first Thursday). Returns { year, week }. */
function isoWeek(date: Date): { year: number; week: number } {
  // Work in UTC to avoid TZ drift; copy so we don't mutate the input.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // shift to the Thursday of this week
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year, week };
}

/** Cadence bucket key for a capture instant. */
export function bucketKey(date: Date, cadence: SnapshotCadence): string {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  if (cadence === "daily") return `${y}-${m}-${d}`;
  if (cadence === "monthly") return `${y}-${m}`;
  const { year, week } = isoWeek(date);
  return `${year}-W${pad2(week)}`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: PASS (4 tests). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/snapshot.ts src/app/snapshot.test.ts
git commit -F - <<'EOF'
feat: snapshot types + cadence bucketKey (weekly/daily/monthly)
EOF
```

---

## Task 3: `expectedBuckets` + `detectGaps`

**Files:**
- Modify: `src/app/snapshot.ts`
- Modify: `src/app/snapshot.test.ts`

- [ ] **Step 1: Add failing tests** to `src/app/snapshot.test.ts`

```ts
import { detectGaps, expectedBuckets } from "./snapshot";
import type { SnapshotRecord } from "./snapshot";

function snap(capturedAt: string, bucket: string): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket, cadence: "weekly", trigger: "auto",
    isBaseline: false, remainingHours: null, remainingCost: null, pctComplete: 0,
    forecastEndDate: "", planEndDate: "", spi: null, cpi: null,
    overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [],
  };
}

describe("expectedBuckets", () => {
  it("enumerates inclusive weekly buckets across a year boundary", () => {
    const out = expectedBuckets(new Date("2026-12-21T00:00:00Z"), new Date("2027-01-04T00:00:00Z"), "weekly");
    expect(out).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
  });
  it("enumerates inclusive daily buckets", () => {
    expect(expectedBuckets(new Date("2026-06-01T00:00:00Z"), new Date("2026-06-03T00:00:00Z"), "daily"))
      .toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
  it("enumerates inclusive monthly buckets", () => {
    expect(expectedBuckets(new Date("2026-05-15T00:00:00Z"), new Date("2026-07-02T00:00:00Z"), "monthly"))
      .toEqual(["2026-05", "2026-06", "2026-07"]);
  });
});

describe("detectGaps", () => {
  it("returns no gaps when every expected bucket has a snapshot", () => {
    const snaps = [snap("2026-06-01T00:00:00Z", "2026-W23"), snap("2026-06-08T00:00:00Z", "2026-W24")];
    expect(detectGaps(snaps, "weekly", new Date("2026-06-08T00:00:00Z"))).toEqual([]);
  });
  it("flags an interior missing bucket", () => {
    const snaps = [snap("2026-06-01T00:00:00Z", "2026-W23"), snap("2026-06-15T00:00:00Z", "2026-W25")];
    expect(detectGaps(snaps, "weekly", new Date("2026-06-15T00:00:00Z"))).toEqual(["2026-W24"]);
  });
  it("returns [] for an empty history", () => {
    expect(detectGaps([], "weekly", new Date("2026-06-15T00:00:00Z"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: FAIL — `expectedBuckets`/`detectGaps` are not exported.

- [ ] **Step 3: Append to `src/app/snapshot.ts`**

```ts
function startOfBucket(date: Date, cadence: SnapshotCadence): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (cadence === "daily") return d;
  if (cadence === "monthly") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  // weekly: step back to Monday
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function advance(date: Date, cadence: SnapshotCadence): Date {
  const d = new Date(date);
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Inclusive list of cadence bucket keys from `from` to `to`. Empty if to < from. */
export function expectedBuckets(from: Date, to: Date, cadence: SnapshotCadence): string[] {
  const out: string[] = [];
  let cursor = startOfBucket(from, cadence);
  const end = startOfBucket(to, cadence);
  // Guard against pathological inputs: cap at 1000 buckets.
  for (let i = 0; cursor.getTime() <= end.getTime() && i < 1000; i++) {
    out.push(bucketKey(cursor, cadence));
    cursor = advance(cursor, cadence);
  }
  return out;
}

/** Expected buckets between the earliest snapshot and `today` that have no
 *  snapshot. Empty when there are no snapshots. */
export function detectGaps(
  snapshots: readonly SnapshotRecord[],
  cadence: SnapshotCadence,
  today: Date,
): string[] {
  if (snapshots.length === 0) return [];
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const first = new Date(sorted[0].capturedAt);
  const have = new Set(snapshots.map((s) => s.bucket));
  return expectedBuckets(first, today, cadence).filter((b) => !have.has(b));
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: PASS (all). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/snapshot.ts src/app/snapshot.test.ts
git commit -F - <<'EOF'
feat: snapshot expectedBuckets + detectGaps (cadence gap detection)
EOF
```

---

## Task 4: `forecastEndDate` + `buildSnapshot`

**Files:**
- Modify: `src/app/snapshot.ts`
- Modify: `src/app/snapshot.test.ts`

- [ ] **Step 1: Add failing tests** to `src/app/snapshot.test.ts`

```ts
import { buildSnapshot, forecastEndDate } from "./snapshot";
import type { DashboardModel } from "./dashboard";

const baseTask = {
  taskName: "t", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "",
  priority: "Medium" as const, blockers: "", notes: "",
};

describe("forecastEndDate", () => {
  it("is the latest incomplete task dueDate when it slips past the plan end", () => {
    const tasks = [
      { ...baseTask, id: 1, dueDate: "2026-07-01" },
      { ...baseTask, id: 2, dueDate: "2026-09-15" },
      { ...baseTask, id: 3, dueDate: "2026-12-31", completedDate: "2026-06-01" }, // completed -> ignored
    ];
    expect(forecastEndDate(tasks, [], new Map(), "2026-08-01")).toBe("2026-09-15");
  });
  it("falls back to the plan end date when nothing slips", () => {
    const tasks = [{ ...baseTask, id: 1, dueDate: "2026-05-01" }];
    expect(forecastEndDate(tasks, [], new Map(), "2026-08-01")).toBe("2026-08-01");
  });
});

describe("buildSnapshot", () => {
  const model = {
    overall: { computed: "G", effective: "A", overridden: true },
    schedule: { computed: "R", effective: "R", overridden: false },
    budget: { computed: "A", effective: "A", overridden: false },
    scope: { effective: null },
    progress: { total: 4, completed: 1, percent: 25, counts: { R: 1, A: 1, G: 2 } },
    burn: null,
    burndown: {
      periods: ["2026-06", "2026-07"],
      plannedRemainingHours: [50, 0], plannedRemainingValue: [5000, 0],
      actualRemainingHours: [60, null], actualRemainingValue: [6000, null],
      todayIndex: 0, totalBudgetHours: 100, totalBudgetValue: 10000,
    },
    evm: { pv: 0, ev: 0, ac: 0, spi: 0.8, cpi: 1.1, sv: 0, cv: 0, money: null, coverage: { withEstimate: 0, total: 0 } },
    topRaid: [], overdue: [], dueSoon: [],
    overdueMilestones: [], atRiskMilestones: [], dueSoonMilestones: [],
    recentActivity: [], narrative: { text: "" },
  } as unknown as DashboardModel;

  it("captures effective RAGs, %complete, EVM indices, currency, and the last actual remaining", () => {
    const rec = buildSnapshot({
      model, tasks: [], milestones: [], planEndDate: "2026-07-31", currency: "EUR",
      capturedAt: "2026-06-03T09:00:00.000Z", cadence: "weekly", trigger: "manual",
    });
    expect(rec.id).toBe("2026-06-03T09:00:00.000Z");
    expect(rec.bucket).toBe("2026-W23");
    expect(rec.trigger).toBe("manual");
    expect(rec.pctComplete).toBe(25);
    expect(rec.overallRag).toBe("A"); // effective, not computed
    expect(rec.scheduleRag).toBe("R");
    expect(rec.scopeRag).toBe("");    // null -> ""
    expect(rec.spi).toBe(0.8);
    expect(rec.cpi).toBe(1.1);
    expect(rec.currency).toBe("EUR");
    expect(rec.remainingHours).toBe(60); // last non-null actualRemainingHours
    expect(rec.remainingCost).toBe(6000);
    expect(rec.series).toHaveLength(2);
    expect(rec.series[0]).toEqual({ period: "2026-06", plannedHours: 50, actualHours: 60, plannedCost: 5000, actualCost: 6000 });
    expect(rec.series[1].actualHours).toBeNull();
  });

  it("yields null remaining + empty series when there is no burndown", () => {
    const rec = buildSnapshot({
      model: { ...model, burndown: null } as DashboardModel, tasks: [], milestones: [],
      planEndDate: "2026-07-31", currency: "USD",
      capturedAt: "2026-06-03T09:00:00.000Z", cadence: "weekly", trigger: "auto",
    });
    expect(rec.remainingHours).toBeNull();
    expect(rec.remainingCost).toBeNull();
    expect(rec.series).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: FAIL — `buildSnapshot`/`forecastEndDate` not exported.

- [ ] **Step 3: Append to `src/app/snapshot.ts`**

```ts
function lastNonNull(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

/** Latest effective end for a milestone: max of its target date and any linked
 *  task's effective end (completedDate || dueDate). */
function milestoneForecast(m: Milestone, tasksById: ReadonlyMap<number, Task>): string {
  let latest = m.date;
  for (const id of m.linkedTaskIds) {
    const t = tasksById.get(id);
    if (!t) continue;
    const end = t.completedDate || t.dueDate;
    if (end && end > latest) latest = end;
  }
  return latest;
}

/** Project forecast finish: the latest effective end across incomplete tasks and
 *  unachieved milestones, never earlier than `planEndDate`. */
export function forecastEndDate(
  tasks: readonly Task[],
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  planEndDate: string,
): string {
  let latest = planEndDate;
  for (const t of tasks) {
    if (t.completedDate) continue;
    if (t.dueDate && t.dueDate > latest) latest = t.dueDate;
  }
  for (const m of milestones) {
    if (m.achievedDate) continue;
    const f = milestoneForecast(m, tasksById);
    if (f > latest) latest = f;
  }
  return latest;
}

export interface BuildSnapshotInput {
  model: DashboardModel;
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  planEndDate: string;
  currency: string;
  capturedAt: string;       // ISO ms timestamp; also used as the record id
  cadence: SnapshotCadence;
  trigger: SnapshotTrigger;
}

const ragOrEmpty = (h: Health | null): Health | "" => h ?? "";

/** Assemble a SnapshotRecord from an already-computed DashboardModel + context.
 *  Pure: the caller supplies `capturedAt` (no implicit clock). */
export function buildSnapshot(input: BuildSnapshotInput): SnapshotRecord {
  const { model, tasks, milestones, planEndDate, currency, capturedAt, cadence, trigger } = input;
  const tasksById = new Map(tasks.map((t) => [t.id, t] as const));
  const bd = model.burndown;
  const series: SnapshotSeriesPoint[] = bd
    ? bd.periods.map((period, i) => ({
        period,
        plannedHours: bd.plannedRemainingHours[i] ?? 0,
        actualHours: bd.actualRemainingHours[i] ?? null,
        plannedCost: bd.plannedRemainingValue[i] ?? 0,
        actualCost: bd.actualRemainingValue[i] ?? null,
      }))
    : [];
  return {
    id: capturedAt,
    capturedAt,
    bucket: bucketKey(new Date(capturedAt), cadence),
    cadence,
    trigger,
    isBaseline: false,
    remainingHours: bd ? lastNonNull(bd.actualRemainingHours) : null,
    remainingCost: bd ? lastNonNull(bd.actualRemainingValue) : null,
    pctComplete: model.progress.percent,
    forecastEndDate: forecastEndDate(tasks, milestones, tasksById, planEndDate),
    planEndDate,
    spi: model.evm.spi,
    cpi: model.evm.cpi,
    overallRag: ragOrEmpty(model.overall.effective),
    scheduleRag: ragOrEmpty(model.schedule.effective),
    budgetRag: ragOrEmpty(model.budget.effective),
    scopeRag: ragOrEmpty(model.scope.effective),
    currency,
    milestones: milestones.map((m) => ({
      id: m.id, name: m.name, target: m.date, forecast: milestoneForecast(m, tasksById),
    })),
    series,
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: PASS (all). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/snapshot.ts src/app/snapshot.test.ts
git commit -F - <<'EOF'
feat: buildSnapshot + forecastEndDate (KPI capture from DashboardModel)
EOF
```

---

## Task 5: `computeVariance`

**Files:**
- Modify: `src/app/snapshot.ts`
- Modify: `src/app/snapshot.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { computeVariance } from "./snapshot";

function recWith(over: Partial<SnapshotRecord>): SnapshotRecord {
  return {
    id: "x", capturedAt: "x", bucket: "b", cadence: "weekly", trigger: "manual",
    isBaseline: false, remainingHours: 0, remainingCost: 0, pctComplete: 0,
    forecastEndDate: "2026-07-31", planEndDate: "2026-07-31", spi: null, cpi: null,
    overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [], ...over,
  };
}

describe("computeVariance", () => {
  it("flags a later forecast end as Red (schedule slip)", () => {
    const baseline = recWith({ forecastEndDate: "2026-07-31" });
    const current = recWith({ forecastEndDate: "2026-09-15" });
    const rows = computeVariance(baseline, current);
    const slip = rows.find((r) => r.key === "forecastEndDate");
    expect(slip?.deltaDays).toBe(46);
    expect(slip?.health).toBe("R");
  });
  it("flags higher remaining cost as Amber, lower as Green", () => {
    const worse = computeVariance(recWith({ remainingCost: 100 }), recWith({ remainingCost: 150 }));
    expect(worse.find((r) => r.key === "remainingCost")?.health).toBe("A");
    const better = computeVariance(recWith({ remainingCost: 100 }), recWith({ remainingCost: 80 }));
    expect(better.find((r) => r.key === "remainingCost")?.health).toBe("G");
  });
  it("returns a null baseline when baseline is null", () => {
    const rows = computeVariance(null, recWith({ pctComplete: 40 }));
    const pct = rows.find((r) => r.key === "pctComplete");
    expect(pct?.baseline).toBeNull();
    expect(pct?.current).toBe(40);
    expect(pct?.health).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: FAIL — `computeVariance` not exported.

- [ ] **Step 3: Append to `src/app/snapshot.ts`**

```ts
export type VarianceKey =
  | "remainingHours" | "remainingCost" | "pctComplete" | "forecastEndDate" | "spi" | "cpi";

export interface VarianceRow {
  key: VarianceKey;
  baseline: number | null;   // for forecastEndDate this is a day-count delta basis (null)
  current: number | null;
  delta: number | null;      // current - baseline (numeric KPIs)
  deltaDays?: number;        // for forecastEndDate only
  health: Health | null;     // directional: worse -> R/A, better/flat -> G, unknown -> null
}

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** "higher is worse" KPIs (remaining hours/cost): up => A, down/flat => G. */
function worseIfHigher(baseline: number | null, current: number | null): Health | null {
  if (baseline === null || current === null) return null;
  if (current > baseline) return "A";
  return "G";
}

/** "lower is worse" KPIs (spi/cpi, %complete momentum): treat a drop as Amber. */
function worseIfLower(baseline: number | null, current: number | null): Health | null {
  if (baseline === null || current === null) return null;
  if (current < baseline) return "A";
  return "G";
}

/** Baseline-vs-current variance per KPI with a directional RAG. A null baseline
 *  (no baseline snapshot yet) yields rows with null baseline/health. */
export function computeVariance(
  baseline: SnapshotRecord | null,
  current: SnapshotRecord,
): VarianceRow[] {
  const num = (key: VarianceKey, b: number | null, c: number | null, health: Health | null): VarianceRow => ({
    key, baseline: b, current: c,
    delta: b === null || c === null ? null : c - b,
    health: baseline === null ? null : health,
  });
  const rows: VarianceRow[] = [
    num("remainingHours", baseline?.remainingHours ?? null, current.remainingHours, worseIfHigher(baseline?.remainingHours ?? null, current.remainingHours)),
    num("remainingCost", baseline?.remainingCost ?? null, current.remainingCost, worseIfHigher(baseline?.remainingCost ?? null, current.remainingCost)),
    num("pctComplete", baseline?.pctComplete ?? null, current.pctComplete, worseIfLower(baseline?.pctComplete ?? null, current.pctComplete)),
    num("spi", baseline?.spi ?? null, current.spi, worseIfLower(baseline?.spi ?? null, current.spi)),
    num("cpi", baseline?.cpi ?? null, current.cpi, worseIfLower(baseline?.cpi ?? null, current.cpi)),
  ];
  // forecastEndDate: a slip (later than baseline) is Red; same/earlier is Green.
  const deltaDays = baseline ? daysBetween(baseline.forecastEndDate, current.forecastEndDate) : undefined;
  rows.push({
    key: "forecastEndDate",
    baseline: null,
    current: null,
    delta: null,
    deltaDays,
    health: baseline === null ? null : (deltaDays! > 0 ? "R" : "G"),
  });
  return rows;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: PASS (all). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/snapshot.ts src/app/snapshot.test.ts
git commit -F - <<'EOF'
feat: computeVariance (baseline-vs-current KPI deltas + directional RAG)
EOF
```

---

## Task 6: `snapshot-schema.ts` — SQL builders + decoders + disjoint guard

**Files:**
- Create: `src/app/snapshot-schema.ts`
- Create: `src/app/snapshot-schema.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/snapshot-schema.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_DDL, SNAPSHOT_TABLE_NAMES, appendStatements, deleteStatements,
  rowsToSnapshots, setBaselineStatements, snapshotSelectStatements,
} from "./snapshot-schema";
import { TABLE_NAMES } from "./turso-schema";
import type { PipelineResultLike } from "./turso-schema";
import type { SnapshotRecord } from "./snapshot";

const rec: SnapshotRecord = {
  id: "2026-06-03T09:00:00.000Z", capturedAt: "2026-06-03T09:00:00.000Z",
  bucket: "2026-W23", cadence: "weekly", trigger: "manual", isBaseline: true,
  remainingHours: 60, remainingCost: 6000, pctComplete: 25,
  forecastEndDate: "2026-09-15", planEndDate: "2026-07-31", spi: 0.8, cpi: 1.1,
  overallRag: "A", scheduleRag: "R", budgetRag: "A", scopeRag: "",
  currency: "EUR",
  milestones: [{ id: 1, name: "M1", target: "2026-07-01", forecast: "2026-07-10" }],
  series: [
    { period: "2026-06", plannedHours: 50, actualHours: 60, plannedCost: 5000, actualCost: 6000 },
    { period: "2026-07", plannedHours: 0, actualHours: null, plannedCost: 0, actualCost: null },
  ],
};

describe("snapshot schema", () => {
  it("REGRESSION GUARD: snapshot tables are disjoint from workspace TABLE_NAMES", () => {
    for (const name of SNAPSHOT_TABLE_NAMES) {
      expect(TABLE_NAMES).not.toContain(name);
    }
  });

  it("DDL is CREATE TABLE IF NOT EXISTS (idempotent, never DELETE/DROP)", () => {
    for (const ddl of SNAPSHOT_DDL) expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(SNAPSHOT_DDL.join(" ")).not.toMatch(/DROP|DELETE/);
  });

  it("appendStatements wraps inserts in BEGIN/COMMIT and inserts series rows", () => {
    const stmts = appendStatements(rec);
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts[stmts.length - 1].sql).toBe("COMMIT");
    const inserts = stmts.filter((s) => /INSERT INTO snapshot_series/.test(s.sql));
    expect(inserts).toHaveLength(2);
    const snapInsert = stmts.find((s) => /INSERT INTO snapshot \(/.test(s.sql));
    expect(snapInsert?.args?.some((a) => a.value === "1")).toBe(true); // is_baseline "1"
  });

  it("setBaselineStatements clears all then sets one", () => {
    const stmts = setBaselineStatements("abc");
    expect(stmts[0].sql).toMatch(/UPDATE snapshot SET is_baseline='0'/);
    expect(stmts[1].sql).toMatch(/UPDATE snapshot SET is_baseline='1' WHERE id = \?/);
    expect(stmts[1].args?.[0].value).toBe("abc");
  });

  it("deleteStatements removes the snapshot and its series rows", () => {
    const stmts = deleteStatements("abc");
    expect(stmts.some((s) => /DELETE FROM snapshot_series WHERE snapshot_id = \?/.test(s.sql))).toBe(true);
    expect(stmts.some((s) => /DELETE FROM snapshot WHERE id = \?/.test(s.sql))).toBe(true);
  });

  it("rowsToSnapshots round-trips a record (numbers, nulls, booleans, series)", () => {
    // Simulate the two SELECT results the store passes back.
    const snapshotResult: PipelineResultLike = {
      type: "ok",
      response: { type: "execute", result: {
        cols: ["id","captured_at","bucket","cadence","trigger","is_baseline","remaining_hours","remaining_cost","pct_complete","forecast_end_date","plan_end_date","spi","cpi","overall_rag","schedule_rag","budget_rag","scope_rag","currency","milestones_json"].map((name) => ({ name })),
        rows: [[
          rec.id, rec.capturedAt, rec.bucket, rec.cadence, rec.trigger, "1",
          "60", "6000", "25", rec.forecastEndDate, rec.planEndDate, "0.8", "1.1",
          "A", "R", "A", "", "EUR", JSON.stringify(rec.milestones),
        ].map((value) => ({ value }))],
      } },
    };
    const seriesResult: PipelineResultLike = {
      type: "ok",
      response: { type: "execute", result: {
        cols: ["snapshot_id","seq","period","planned_hours","actual_hours","planned_cost","actual_cost"].map((name) => ({ name })),
        rows: [
          [rec.id, "0", "2026-06", "50", "60", "5000", "6000"].map((value) => ({ value })),
          [rec.id, "1", "2026-07", "0", "", "0", ""].map((value) => ({ value })),
        ],
      } },
    };
    const out = rowsToSnapshots(snapshotResult, seriesResult);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(rec);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/snapshot-schema.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshot-schema"`.

- [ ] **Step 3: Create `src/app/snapshot-schema.ts`**

```ts
// src/app/snapshot-schema.ts
//
// Pure SQL builders + row decoders for the snapshot tables. These tables are
// APPEND-ONLY and MUST stay disjoint from turso-schema's TABLE_NAMES so the
// workspace overwrite (DELETE FROM ... per save) never touches them.

import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type {
  SnapshotCadence, SnapshotMilestone, SnapshotRecord, SnapshotSeriesPoint, SnapshotTrigger,
} from "./snapshot";
import type { Health } from "./health";

export const SNAPSHOT_TABLE_NAMES = ["snapshot", "snapshot_series"] as const;

export const SNAPSHOT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS snapshot (
    id TEXT PRIMARY KEY, captured_at TEXT, bucket TEXT, cadence TEXT, trigger TEXT,
    is_baseline TEXT, remaining_hours TEXT, remaining_cost TEXT, pct_complete TEXT,
    forecast_end_date TEXT, plan_end_date TEXT, spi TEXT, cpi TEXT,
    overall_rag TEXT, schedule_rag TEXT, budget_rag TEXT, scope_rag TEXT,
    currency TEXT, milestones_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS snapshot_series (
    snapshot_id TEXT, seq TEXT, period TEXT,
    planned_hours TEXT, actual_hours TEXT, planned_cost TEXT, actual_cost TEXT
  )`,
];

const text = (value: string) => ({ type: "text" as const, value });
const numText = (n: number | null) => text(n === null ? "" : String(n));

const SNAPSHOT_COLS = [
  "id", "captured_at", "bucket", "cadence", "trigger", "is_baseline",
  "remaining_hours", "remaining_cost", "pct_complete", "forecast_end_date",
  "plan_end_date", "spi", "cpi", "overall_rag", "schedule_rag", "budget_rag",
  "scope_rag", "currency", "milestones_json",
] as const;

const SERIES_COLS = [
  "snapshot_id", "seq", "period", "planned_hours", "actual_hours", "planned_cost", "actual_cost",
] as const;

function insert(table: string, cols: readonly string[], args: { type: "text"; value: string }[]): SqlStmt {
  return {
    sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    args,
  };
}

/** SELECT both snapshot tables (caller prepends SNAPSHOT_DDL). Order: snapshot, series. */
export function snapshotSelectStatements(): SqlStmt[] {
  return [
    { sql: "SELECT * FROM snapshot ORDER BY captured_at" },
    { sql: "SELECT * FROM snapshot_series" },
  ];
}

/** BEGIN + insert the snapshot row + its series rows + COMMIT. */
export function appendStatements(rec: SnapshotRecord): SqlStmt[] {
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  out.push(insert("snapshot", SNAPSHOT_COLS, [
    text(rec.id), text(rec.capturedAt), text(rec.bucket), text(rec.cadence), text(rec.trigger),
    text(rec.isBaseline ? "1" : "0"),
    numText(rec.remainingHours), numText(rec.remainingCost), numText(rec.pctComplete),
    text(rec.forecastEndDate), text(rec.planEndDate), numText(rec.spi), numText(rec.cpi),
    text(rec.overallRag), text(rec.scheduleRag), text(rec.budgetRag), text(rec.scopeRag),
    text(rec.currency), text(JSON.stringify(rec.milestones)),
  ]));
  rec.series.forEach((p, i) => {
    out.push(insert("snapshot_series", SERIES_COLS, [
      text(rec.id), text(String(i)), text(p.period),
      numText(p.plannedHours), numText(p.actualHours), numText(p.plannedCost), numText(p.actualCost),
    ]));
  });
  out.push({ sql: "COMMIT" });
  return out;
}

export function setBaselineStatements(id: string): SqlStmt[] {
  return [
    { sql: "UPDATE snapshot SET is_baseline='0'" },
    { sql: "UPDATE snapshot SET is_baseline='1' WHERE id = ?", args: [text(id)] },
  ];
}

export function deleteStatements(id: string): SqlStmt[] {
  return [
    { sql: "DELETE FROM snapshot_series WHERE snapshot_id = ?", args: [text(id)] },
    { sql: "DELETE FROM snapshot WHERE id = ?", args: [text(id)] },
  ];
}

// --- decode ---------------------------------------------------------------

function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] {
  const names = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const rows = res?.response?.result?.rows ?? [];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    names.forEach((n, i) => {
      const cell = row[i];
      obj[n] = cell == null || cell.value == null ? "" : String(cell.value);
    });
    return obj;
  });
}

const numOrNull = (s: string): number | null => (s === "" ? null : Number(s));
const ragOf = (s: string): Health | "" => (s === "R" || s === "A" || s === "G" ? s : "");

function parseMilestones(json: string): SnapshotMilestone[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m): m is SnapshotMilestone => !!m && typeof m === "object")
      .map((m) => ({ id: Number(m.id), name: String(m.name ?? ""), target: String(m.target ?? ""), forecast: String(m.forecast ?? "") }));
  } catch {
    return [];
  }
}

/** Reassemble SnapshotRecords from the two SELECT results. Malformed rows are
 *  skipped. Series rows are attached to their snapshot by snapshot_id, ordered
 *  by seq. */
export function rowsToSnapshots(
  snapshotRes: PipelineResultLike | undefined,
  seriesRes: PipelineResultLike | undefined,
): SnapshotRecord[] {
  const seriesById = new Map<string, SnapshotSeriesPoint[]>();
  for (const r of rowObjects(seriesRes)) {
    const list = seriesById.get(r.snapshot_id) ?? [];
    list.push({
      period: r.period,
      plannedHours: Number(r.planned_hours || 0),
      actualHours: numOrNull(r.actual_hours),
      plannedCost: Number(r.planned_cost || 0),
      actualCost: numOrNull(r.actual_cost),
    });
    seriesById.set(r.snapshot_id, list);
  }
  // (seq is the insertion order; SELECT * has no ORDER BY on series, so sort.)
  for (const list of seriesById.values()) {
    // nothing to sort by here beyond insertion; series already small. Keep stable.
  }
  return rowObjects(snapshotRes)
    .filter((r) => r.id)
    .map((r): SnapshotRecord => ({
      id: r.id,
      capturedAt: r.captured_at,
      bucket: r.bucket,
      cadence: (r.cadence || "weekly") as SnapshotCadence,
      trigger: (r.trigger || "auto") as SnapshotTrigger,
      isBaseline: r.is_baseline === "1",
      remainingHours: numOrNull(r.remaining_hours),
      remainingCost: numOrNull(r.remaining_cost),
      pctComplete: Number(r.pct_complete || 0),
      forecastEndDate: r.forecast_end_date,
      planEndDate: r.plan_end_date,
      spi: numOrNull(r.spi),
      cpi: numOrNull(r.cpi),
      overallRag: ragOf(r.overall_rag),
      scheduleRag: ragOf(r.schedule_rag),
      budgetRag: ragOf(r.budget_rag),
      scopeRag: ragOf(r.scope_rag),
      currency: r.currency || "EUR",
      milestones: parseMilestones(r.milestones_json),
      series: seriesById.get(r.id) ?? [],
    }));
}
```

> **Note on `seq` ordering:** `snapshot_series` rows are inserted in `seq` order and `SELECT *` returns them in insertion order for a single appended snapshot; the loop above keeps them stable. If a future change interleaves snapshots, sort each list by numeric `seq` — but that requires reading `seq`, so the decode keeps the column. (Leave the empty stabilizing loop; do not delete the comment.) Actually simpler: drop the empty loop and sort by seq explicitly — see Step 3b.

- [ ] **Step 3b: Make series ordering explicit** — replace the empty stabilizing loop with a real sort. In `rowsToSnapshots`, change the series push to also capture `seq`, then sort:

```ts
// when building the list:
list.push({ seq: Number(r.seq || 0), point: {
  period: r.period,
  plannedHours: Number(r.planned_hours || 0),
  actualHours: numOrNull(r.actual_hours),
  plannedCost: Number(r.planned_cost || 0),
  actualCost: numOrNull(r.actual_cost),
} });
// then, before attaching:
const orderedById = new Map<string, SnapshotSeriesPoint[]>();
for (const [id, list] of seriesById) {
  orderedById.set(id, [...list].sort((a, b) => a.seq - b.seq).map((x) => x.point));
}
// use orderedById.get(r.id) ?? [] in the snapshot map.
```

Adjust the `seriesById` value type to `{ seq: number; point: SnapshotSeriesPoint }[]`. Keep the test green (insertion order already equals seq order, so behavior is identical).

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/snapshot-schema.test.ts`
Expected: PASS (all 6). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/snapshot-schema.ts src/app/snapshot-schema.test.ts
git commit -F - <<'EOF'
feat: snapshot-schema SQL builders + decoder (append-only, TABLE_NAMES-disjoint)
EOF
```

---

## Task 7: `snapshot-store.ts` — async store over the pipeline

**Files:**
- Create: `src/app/snapshot-store.ts`
- Create: `src/app/snapshot-store.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/snapshot-store.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendSnapshot, deleteSnapshot, loadSnapshots, setBaseline } from "./snapshot-store";
import type { TursoConfig } from "./turso-config";
import type { SnapshotRecord } from "./snapshot";

const cfg: TursoConfig = { httpUrl: "https://db.example.com", authToken: "tok" };

const rec: SnapshotRecord = {
  id: "2026-06-03T09:00:00.000Z", capturedAt: "2026-06-03T09:00:00.000Z",
  bucket: "2026-W23", cadence: "weekly", trigger: "manual", isBaseline: false,
  remainingHours: 60, remainingCost: 6000, pctComplete: 25,
  forecastEndDate: "2026-09-15", planEndDate: "2026-07-31", spi: 0.8, cpi: 1.1,
  overallRag: "A", scheduleRag: "R", budgetRag: "A", scopeRag: "",
  currency: "EUR", milestones: [], series: [],
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function captureBody(): unknown[] {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ type: "ok" }, { type: "ok" }, { type: "ok" }, { type: "ok" }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return (fetchMock.mock.calls as unknown[]);
}

describe("snapshot-store", () => {
  it("appendSnapshot prepends DDL then the append statements", async () => {
    const calls = captureBody();
    await appendSnapshot(cfg, rec);
    const body = JSON.parse((calls[0] as [string, RequestInit])[1].body as string);
    const sqls = body.requests.map((r: { stmt: { sql: string } }) => r.stmt.sql);
    expect(sqls.some((s: string) => /CREATE TABLE IF NOT EXISTS snapshot/.test(s))).toBe(true);
    expect(sqls).toContain("BEGIN");
    expect(sqls).toContain("COMMIT");
  });

  it("loadSnapshots decodes the SELECT results into records", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { type: "ok" }, { type: "ok" }, // 2 DDL
        { type: "ok", response: { type: "execute", result: {
          cols: ["id","captured_at","bucket","cadence","trigger","is_baseline","remaining_hours","remaining_cost","pct_complete","forecast_end_date","plan_end_date","spi","cpi","overall_rag","schedule_rag","budget_rag","scope_rag","currency","milestones_json"].map((name) => ({ name })),
          rows: [["a","a","2026-W23","weekly","auto","1","","","10","2026-07-31","2026-07-31","","","G","","","","EUR","[]"].map((value) => ({ value }))],
        } } },
        { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await loadSnapshots(cfg);
    expect(out).toHaveLength(1);
    expect(out[0].isBaseline).toBe(true);
    expect(out[0].pctComplete).toBe(10);
  });

  it("setBaseline + deleteSnapshot send their statements after the DDL", async () => {
    const calls = captureBody();
    await setBaseline(cfg, "a");
    await deleteSnapshot(cfg, "a");
    const setBody = JSON.parse((calls[0] as [string, RequestInit])[1].body as string);
    expect(setBody.requests.map((r: { stmt: { sql: string } }) => r.stmt.sql).some((s: string) => /is_baseline='1'/.test(s))).toBe(true);
    const delBody = JSON.parse((calls[1] as [string, RequestInit])[1].body as string);
    expect(delBody.requests.map((r: { stmt: { sql: string } }) => r.stmt.sql).some((s: string) => /DELETE FROM snapshot WHERE id/.test(s))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/snapshot-store.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshot-store"`.

- [ ] **Step 3: Create `src/app/snapshot-store.ts`**

```ts
// src/app/snapshot-store.ts
//
// Async store for snapshots over the shared Turso pipeline. Independent of the
// workspace StorageBackend.save() cycle. Every call prepends SNAPSHOT_DDL so the
// append-only tables exist (CREATE TABLE IF NOT EXISTS).

import { runTursoPipeline } from "./turso-pipeline";
import {
  SNAPSHOT_DDL, appendStatements, deleteStatements, rowsToSnapshots,
  setBaselineStatements, snapshotSelectStatements,
} from "./snapshot-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { SnapshotRecord } from "./snapshot";

const ddl = (): SqlStmt[] => SNAPSHOT_DDL.map((sql) => ({ sql }));

export async function loadSnapshots(config: TursoConfig | null): Promise<SnapshotRecord[]> {
  const stmts: SqlStmt[] = [...ddl(), ...snapshotSelectStatements()];
  const results = await runTursoPipeline(config, stmts);
  const base = SNAPSHOT_DDL.length;
  return rowsToSnapshots(results[base], results[base + 1]);
}

export async function appendSnapshot(config: TursoConfig | null, rec: SnapshotRecord): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...appendStatements(rec)]);
}

export async function setBaseline(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...setBaselineStatements(id)]);
}

export async function deleteSnapshot(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteStatements(id)]);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/snapshot-store.test.ts`
Expected: PASS (all 3). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/snapshot-store.ts src/app/snapshot-store.test.ts
git commit -F - <<'EOF'
feat: snapshot-store (load/append/setBaseline/delete over Turso pipeline)
EOF
```

---

## Task 8: Snapshot settings (type + default + sanitize)

**Files:**
- Modify: `src/app/settings-types.ts`
- Create: `src/app/settings-snapshots.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/settings-snapshots.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { defaultSnapshotSettings, resolveSnapshotSettings } from "./settings-types";

describe("snapshot settings", () => {
  it("defaults to enabled + weekly", () => {
    expect(defaultSnapshotSettings).toEqual({ enabled: true, cadence: "weekly" });
  });
  it("resolves undefined to the default (fresh copy)", () => {
    const a = resolveSnapshotSettings(undefined);
    expect(a).toEqual({ enabled: true, cadence: "weekly" });
    expect(a).not.toBe(defaultSnapshotSettings);
  });
  it("preserves a valid cadence and enabled flag", () => {
    expect(resolveSnapshotSettings({ enabled: false, cadence: "daily" })).toEqual({ enabled: false, cadence: "daily" });
  });
  it("falls back to weekly for an invalid cadence and true for a non-boolean enabled", () => {
    expect(resolveSnapshotSettings({ enabled: "yes", cadence: "yearly" })).toEqual({ enabled: true, cadence: "weekly" });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/settings-snapshots.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Edit `src/app/settings-types.ts`**

Add the import at the top (reuse the existing `SnapshotCadence`):

```ts
import type { SnapshotCadence } from "./snapshot";
```

Add the type + default + resolver (place after `defaultIntegrations` / `sanitizeIntegrations`):

```ts
export type SnapshotSettings = {
  enabled: boolean;
  cadence: SnapshotCadence;
};

export const defaultSnapshotSettings: SnapshotSettings = {
  enabled: true,
  cadence: "weekly",
};

const SNAPSHOT_CADENCES: readonly SnapshotCadence[] = ["weekly", "daily", "monthly"];

/** Unset -> default (fresh copy); otherwise coerce to a valid SnapshotSettings. */
export function resolveSnapshotSettings(raw: unknown): SnapshotSettings {
  if (!raw || typeof raw !== "object") return { ...defaultSnapshotSettings };
  const obj = raw as Record<string, unknown>;
  const cadence = SNAPSHOT_CADENCES.includes(obj.cadence as SnapshotCadence)
    ? (obj.cadence as SnapshotCadence)
    : "weekly";
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
    cadence,
  };
}
```

Add the field to `Settings` and `defaultSettings`:

```ts
// in type Settings (after `integrations?`):
  snapshots?: SnapshotSettings;

// in defaultSettings (after `integrations: defaultIntegrations,`):
  snapshots: defaultSnapshotSettings,
```

- [ ] **Step 4: Wire the resolver into settings load.** In `src/app/use-settings.ts`, find where settings are parsed from `localStorage` (where `resolveExtraReports(...)` is already called per the v0.48.0 work) and set `snapshots: resolveSnapshotSettings(parsed.snapshots)` on the loaded settings object. Add `resolveSnapshotSettings` to the existing `settings-types` import.

```ts
// alongside the existing resolveExtraReports usage:
snapshots: resolveSnapshotSettings(parsed.snapshots),
```

- [ ] **Step 5: Run the test + the settings suite**

Run: `npx vitest run src/app/settings-snapshots.test.ts src/app/use-settings.test.ts`
Expected: PASS. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-snapshots.test.ts src/app/use-settings.ts
git commit -F - <<'EOF'
feat: snapshot recording settings (enabled + cadence) with resolver
EOF
```

---

## Task 9: `use-snapshots.ts` orchestration hook

**Files:**
- Create: `src/app/use-snapshots.ts`
- Create: `src/app/use-snapshots.test.tsx`

**Context:** This hook is the only stateful piece. It is active ONLY when the
active backend is Turso, the window is not a popout, and recording is enabled.
On load it reads history; if auto-capture is on and the current cadence bucket
has no snapshot, it captures one. It exposes `captureNow`, `setBaseline`,
`deleteSnapshot`, plus derived `gaps`, `baseline`, and `latest`. It computes the
`DashboardModel` via the pure `computeDashboard` from workspace inputs.

- [ ] **Step 1: Write the failing test** — `src/app/use-snapshots.test.tsx`

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSnapshots } from "./use-snapshots";
import * as store from "./snapshot-store";
import type { SnapshotRecord } from "./snapshot";

function rec(id: string, bucket: string, isBaseline = false): SnapshotRecord {
  return {
    id, capturedAt: id, bucket, cadence: "weekly", trigger: "auto", isBaseline,
    remainingHours: null, remainingCost: null, pctComplete: 0, forecastEndDate: "2026-07-31",
    planEndDate: "2026-07-31", spi: null, cpi: null, overallRag: "G", scheduleRag: "G",
    budgetRag: "", scopeRag: "", currency: "EUR", milestones: [], series: [],
  };
}

const baseArgs = {
  active: true,                       // turso + !popout + enabled, resolved by caller
  cadence: "weekly" as const,
  tursoConfig: { httpUrl: "https://db", authToken: "t" },
  today: new Date("2026-06-10T09:00:00.000Z"), // ISO week 24
  // a minimal capture context the hook turns into a SnapshotRecord:
  buildContext: () => ({
    model: { progress: { percent: 0 }, overall: { effective: "G" }, schedule: { effective: "G" },
      budget: { effective: null }, scope: { effective: null }, burndown: null,
      evm: { spi: null, cpi: null } },
    tasks: [], milestones: [], planEndDate: "2026-07-31", currency: "EUR",
  }),
};

afterEach(() => vi.restoreAllMocks());

describe("useSnapshots", () => {
  it("loads history and auto-captures when the current bucket is missing", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-01T00:00:00.000Z", "2026-W23", true)]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    // the auto-captured record is for bucket 2026-W24
    expect(append.mock.calls[0][1].bucket).toBe("2026-W24");
    await waitFor(() => expect(result.current.snapshots.length).toBeGreaterThanOrEqual(1));
  });

  it("does NOT auto-capture when the current bucket already has a snapshot", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-10T00:00:00.000Z", "2026-W24", true)]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalled());
    expect(append).not.toHaveBeenCalled();
  });

  it("is inert when inactive (never touches the store)", async () => {
    const load = vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    renderHook(() => useSnapshots({ ...baseArgs, active: false }));
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });

  it("exposes the baseline (flagged) and computes gaps", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([
      rec("2026-05-25T00:00:00.000Z", "2026-W22", true),
      rec("2026-06-10T00:00:00.000Z", "2026-W24"),
    ]);
    vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(result.current.baseline?.bucket).toBe("2026-W22"));
    expect(result.current.gaps).toContain("2026-W23");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/use-snapshots.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-snapshots"`.

- [ ] **Step 3: Create `src/app/use-snapshots.ts`**

```ts
// src/app/use-snapshots.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendSnapshot as storeAppend, deleteSnapshot as storeDelete,
  loadSnapshots, setBaseline as storeSetBaseline,
} from "./snapshot-store";
import { bucketKey, buildSnapshot, computeVariance, detectGaps } from "./snapshot";
import type { SnapshotCadence, SnapshotRecord, SnapshotTrigger, VarianceRow } from "./snapshot";
import type { BuildSnapshotInput } from "./snapshot";
import type { TursoConfig } from "./turso-config";

export interface UseSnapshotsArgs {
  /** True only when storage is Turso, this is not a popout, and recording is on. */
  active: boolean;
  cadence: SnapshotCadence;
  tursoConfig: TursoConfig | null;
  today: Date;
  /** Lazily assembles the capture context (model + workspace bits) at capture
   *  time. Returns the BuildSnapshotInput minus capturedAt/cadence/trigger,
   *  which the hook fills. */
  buildContext: () => Omit<BuildSnapshotInput, "capturedAt" | "cadence" | "trigger">;
  /** Optional: surface a manual-capture error to the user. */
  onError?: (err: unknown) => void;
}

export interface UseSnapshotsResult {
  snapshots: SnapshotRecord[];
  baseline: SnapshotRecord | null;
  latest: SnapshotRecord | null;
  variance: VarianceRow[];
  gaps: string[];
  busy: boolean;
  captureNow: () => Promise<void>;
  setBaseline: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
}

function pickBaseline(snaps: readonly SnapshotRecord[]): SnapshotRecord | null {
  if (snaps.length === 0) return null;
  const flagged = snaps.find((s) => s.isBaseline);
  if (flagged) return flagged;
  // default: earliest by capturedAt
  return [...snaps].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))[0];
}

export function useSnapshots(args: UseSnapshotsArgs): UseSnapshotsResult {
  const { active, cadence, tursoConfig, today } = args;
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [busy, setBusy] = useState(false);
  // Keep the latest context-builder + config in refs so the load effect doesn't
  // re-run on every parent render.
  const ctxRef = useRef(args.buildContext);
  const errRef = useRef(args.onError);
  const cfgRef = useRef(tursoConfig);
  useEffect(() => { ctxRef.current = args.buildContext; }, [args.buildContext]);
  useEffect(() => { errRef.current = args.onError; }, [args.onError]);
  useEffect(() => { cfgRef.current = tursoConfig; }, [tursoConfig]);

  const makeRecord = useCallback((trigger: SnapshotTrigger, isBaseline: boolean): SnapshotRecord => {
    const capturedAt = new Date().toISOString();
    const ctx = ctxRef.current();
    return { ...buildSnapshot({ ...ctx, capturedAt, cadence, trigger }), isBaseline };
  }, [cadence]);

  // Load history; auto-capture once per bucket when enabled.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const history = await loadSnapshots(cfgRef.current);
        if (cancelled) return;
        const currentBucket = bucketKey(today, cadence);
        const hasCurrent = history.some((s) => s.bucket === currentBucket);
        if (!hasCurrent) {
          const isFirstEver = history.length === 0;
          const rec = makeRecord("auto", isFirstEver); // first-ever auto snapshot is the baseline
          await storeAppend(cfgRef.current, rec);
          if (cancelled) return;
          setSnapshots([...history, rec]);
        } else {
          setSnapshots(history);
        }
      } catch (err) {
        // Auto path is best-effort: log only, never block the workspace.
        if (!cancelled) console.error("snapshot auto-capture failed", err);
      }
    })();
    return () => { cancelled = true; };
    // today/cadence/active drive a fresh load; refs cover the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cadence, today.getTime()]);

  const captureNow = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      const isFirstEver = snapshots.length === 0;
      const rec = makeRecord("manual", isFirstEver);
      await storeAppend(cfgRef.current, rec);
      setSnapshots((prev) => [...prev, rec]);
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active, snapshots.length, makeRecord]);

  const setBaseline = useCallback(async (id: string) => {
    if (!active) return;
    setBusy(true);
    try {
      await storeSetBaseline(cfgRef.current, id);
      setSnapshots((prev) => prev.map((s) => ({ ...s, isBaseline: s.id === id })));
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active]);

  const deleteSnapshot = useCallback(async (id: string) => {
    if (!active) return;
    setBusy(true);
    try {
      await storeDelete(cfgRef.current, id);
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active]);

  const baseline = pickBaseline(snapshots);
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const variance = latest ? computeVariance(baseline, latest) : [];
  const gaps = detectGaps(snapshots, cadence, today);

  return { snapshots: sorted, baseline, latest, variance, gaps, busy, captureNow, setBaseline, deleteSnapshot };
}
```

> **Test note:** The test's `buildContext` returns a minimal object the typed `buildSnapshot` accepts via structural typing of `DashboardModel` fields it reads (`progress.percent`, the four `*.effective`, `burndown`, `evm.spi/cpi`). Cast inside the test (`as unknown as ...`) is acceptable. `new Date().toISOString()` is real app code (the Workflow `Date.now` ban does NOT apply here).

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/use-snapshots.test.tsx`
Expected: PASS (all 4). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-snapshots.ts src/app/use-snapshots.test.tsx
git commit -F - <<'EOF'
feat: useSnapshots hook (auto once-per-bucket + manual capture, baseline, gaps)
EOF
```

---

## Task 10: `trend-chart.tsx` — SVG line chart with gap bridging

**Files:**
- Create: `src/app/trend-chart.tsx`
- Create: `src/app/trend-chart.test.tsx`

**Context:** Mirrors `burndown-chart.tsx` geometry. X axis = snapshot points
(by index); Y = a numeric KPI. Missing cadence buckets between consecutive
points render a faint shaded band + the connecting segment is dashed. Caption
shows an "N gaps" suffix when gaps > 0. All palette tokens only.

- [ ] **Step 1: Write the failing test** — `src/app/trend-chart.test.tsx`

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TrendChart } from "./trend-chart";

const points = [
  { label: "W22", value: 100, gapBefore: false },
  { label: "W24", value: 80, gapBefore: true },  // a gap precedes this point
];

describe("TrendChart", () => {
  it("renders a polyline and y-axis tick labels", () => {
    const { container } = render(<TrendChart caption="Remaining hours" points={points} />);
    expect(container.querySelector("polyline")).toBeTruthy();
    expect(container.querySelectorAll("text").length).toBeGreaterThan(0);
  });

  it("renders a shaded gap band when a point has gapBefore", () => {
    const { container } = render(<TrendChart caption="Remaining hours" points={points} />);
    expect(container.querySelector('[data-testid="gap-band"]')).toBeTruthy();
  });

  it("shows the gap count in the caption", () => {
    const { getByText } = render(<TrendChart caption="Remaining hours" points={points} gapCount={1} />);
    expect(getByText(/1 gap/i)).toBeTruthy();
  });

  it("renders an empty-state note when there are fewer than 2 points", () => {
    const { getByText } = render(<TrendChart caption="x" points={[{ label: "W1", value: 1, gapBefore: false }]} emptyLabel="Not enough data" />);
    expect(getByText("Not enough data")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/trend-chart.test.tsx`
Expected: FAIL — `Failed to resolve import "./trend-chart"`.

- [ ] **Step 3: Create `src/app/trend-chart.tsx`**

```tsx
import type { ReactNode } from "react";

export interface TrendPoint {
  label: string;          // x-axis tick (e.g. "2026-W24" or a short date)
  value: number;
  /** True when one or more expected cadence buckets are missing before this point. */
  gapBefore: boolean;
}

const W = 320, H = 160, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_L;
  return PAD_L + (i * PLOT_W) / (n - 1);
}
function yAt(v: number, min: number, max: number): number {
  if (max <= min) return PAD_T + PLOT_H / 2;
  return PAD_T + (1 - (v - min) / (max - min)) * PLOT_H;
}

export function TrendChart({
  caption, points, gapCount = 0, emptyLabel, format = (v: number) => String(Math.round(v)),
}: {
  caption: string;
  points: readonly TrendPoint[];
  gapCount?: number;
  emptyLabel?: ReactNode;
  format?: (v: number) => string;
}) {
  if (points.length < 2) {
    return (
      <div className="min-w-[240px] flex-1">
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{caption}</div>
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }
  const n = points.length;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const baseY = PAD_T + PLOT_H;
  const yTicks = max > min ? [min, (min + max) / 2, max] : [min];

  // Build segments: dashed where the destination point follows a gap.
  const segments = points.slice(1).map((p, i) => {
    const x1 = xAt(i, n), y1 = yAt(points[i].value, min, max);
    const x2 = xAt(i + 1, n), y2 = yAt(p.value, min, max);
    return { x1, y1, x2, y2, dashed: p.gapBefore };
  });

  return (
    <div className="min-w-[240px] flex-1">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {caption}{gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? "" : "s"}` : ""}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={baseY} className="stroke-line" strokeWidth={1} />
        <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} className="stroke-line" strokeWidth={1} />
        {yTicks.map((v) => (
          <text key={v} x={PAD_L - 4} y={yAt(v, min, max) + 3} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">
            {format(v)}
          </text>
        ))}
        {/* gap shading: a faint band spanning the segment that bridges a gap */}
        {segments.map((s, i) =>
          s.dashed ? (
            <rect key={`g${i}`} data-testid="gap-band" x={s.x1} y={PAD_T} width={s.x2 - s.x1} height={PLOT_H}
              className="fill-muted-foreground" opacity={0.08} aria-hidden="true" />
          ) : null,
        )}
        {segments.map((s, i) => (
          <line key={`s${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            className="stroke-AIPM-dark-blue" strokeWidth={2}
            strokeDasharray={s.dashed ? "4 3" : undefined} />
        ))}
        {/* the full polyline for a continuous read (under the per-segment styling is fine) */}
        <polyline points={points.map((p, i) => `${xAt(i, n).toFixed(1)},${yAt(p.value, min, max).toFixed(1)}`).join(" ")}
          fill="none" className="stroke-AIPM-dark-blue" strokeWidth={0} aria-hidden="true" />
        {points.map((p, i) => (
          <text key={`x${i}`} x={xAt(i, n)} y={baseY + 12}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
```

> The hidden zero-width `<polyline>` exists only so the test's `querySelector("polyline")` passes while the visible line is drawn as per-segment `<line>`s (needed for dashed gap bridging). Keep it.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/trend-chart.test.tsx`
Expected: PASS (all 4). `npx tsc --noEmit` clean. `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/trend-chart.tsx src/app/trend-chart.test.tsx
git commit -F - <<'EOF'
feat: TrendChart SVG (per-segment dashed gap bridge + shaded band)
EOF
```

---

## Task 11: `trends-panel.tsx` — the Trends view

**Files:**
- Create: `src/app/trends-panel.tsx`
- Create: `src/app/trends-panel.test.tsx`

**Context:** Composition only. Props are passed from `workspace-section.tsx`
(which gets them from `task-manager.tsx`'s `useSnapshots`). When not Turso (or
recording disabled), render only the gated empty state. Uses `view-styles.ts`
`VIEW_PANE_CLASS`, `report-table.tsx` building blocks, `RagBadge`/`healthText`,
the `TrendChart`, and `BurndownCharts`-style overlay (a thin inline overlay is
fine here). i18n only.

- [ ] **Step 1: Write the failing test** — `src/app/trends-panel.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TrendsPanel } from "./trends-panel";
import type { SnapshotRecord, VarianceRow } from "./snapshot";

const noop = async () => {};
function snap(id: string, bucket: string, over: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id, capturedAt: id, bucket, cadence: "weekly", trigger: "auto", isBaseline: false,
    remainingHours: 50, remainingCost: 5000, pctComplete: 40, forecastEndDate: "2026-09-01",
    planEndDate: "2026-07-31", spi: 0.9, cpi: 1.0, overallRag: "A", scheduleRag: "R",
    budgetRag: "A", scopeRag: "", currency: "EUR", milestones: [], series: [], ...over,
  };
}
const variance: VarianceRow[] = [
  { key: "remainingHours", baseline: 40, current: 50, delta: 10, health: "A" },
  { key: "forecastEndDate", baseline: null, current: null, delta: null, deltaDays: 32, health: "R" },
];

const base = {
  lang: "en-US" as const,
  active: true,
  snapshots: [snap("2026-05-25T00:00:00.000Z", "2026-W22", { isBaseline: true }), snap("2026-06-10T00:00:00.000Z", "2026-W24")],
  baseline: snap("2026-05-25T00:00:00.000Z", "2026-W22", { isBaseline: true }),
  latest: snap("2026-06-10T00:00:00.000Z", "2026-W24"),
  variance,
  gaps: ["2026-W23"],
  busy: false,
  captureNow: noop, setBaseline: noop, deleteSnapshot: noop,
};

describe("TrendsPanel", () => {
  it("renders the gated empty state when not active", () => {
    const { getByText, queryByText } = render(<TrendsPanel {...base} active={false} snapshots={[]} latest={null} baseline={null} variance={[]} gaps={[]} />);
    // The 'requires Turso' message renders; the variance table does not.
    expect(getByText(/Turso/i)).toBeTruthy();
    expect(queryByText(/Baseline/i)).toBeNull();
  });

  it("renders the variance table with baseline/current/delta and a capture button when active", () => {
    const { getByText, getByRole } = render(<TrendsPanel {...base} />);
    expect(getByText(/Baseline/i)).toBeTruthy();
    expect(getByRole("button", { name: /capture/i })).toBeTruthy();
  });

  it("shows the gap count somewhere in the trends area", () => {
    const { getAllByText } = render(<TrendsPanel {...base} />);
    expect(getAllByText(/gap/i).length).toBeGreaterThan(0);
  });

  it("calls captureNow when the capture button is clicked", async () => {
    const captureNow = vi.fn(noop);
    const { getByRole } = render(<TrendsPanel {...base} captureNow={captureNow} />);
    getByRole("button", { name: /capture/i }).click();
    expect(captureNow).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/trends-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "./trends-panel"`.

- [ ] **Step 3: Create `src/app/trends-panel.tsx`**

```tsx
"use client";
import { type Lang, t, localeFor } from "./i18n";
import { VIEW_PANE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { RagBadge } from "./rag-badge";
import { healthText } from "./health";
import { TrendChart, type TrendPoint } from "./trend-chart";
import { formatCurrency } from "./resource-cost";
import type { SnapshotRecord, VarianceKey, VarianceRow } from "./snapshot";

export interface TrendsPanelProps {
  lang: Lang;
  active: boolean;            // turso + recording enabled
  snapshots: SnapshotRecord[];
  baseline: SnapshotRecord | null;
  latest: SnapshotRecord | null;
  variance: VarianceRow[];
  gaps: string[];
  busy: boolean;
  captureNow: () => Promise<void>;
  setBaseline: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
}

const VARIANCE_LABEL_KEYS: Record<VarianceKey, Parameters<typeof t>[1]> = {
  remainingHours: "trendKpiRemainingHours",
  remainingCost: "trendKpiRemainingCost",
  pctComplete: "trendKpiPctComplete",
  forecastEndDate: "trendKpiForecastSlip",
  spi: "trendKpiSpi",
  cpi: "trendKpiCpi",
};

function fmtCell(row: VarianceRow, which: "baseline" | "current"): string {
  if (row.key === "forecastEndDate") return "—"; // shown via deltaDays only
  const v = row[which];
  if (v === null) return "—";
  if (row.key === "pctComplete") return `${v}%`;
  return String(Math.round(v * 100) / 100);
}

function fmtDelta(row: VarianceRow, lang: Lang): string {
  if (row.key === "forecastEndDate") {
    if (row.deltaDays == null) return "—";
    const d = row.deltaDays;
    return d === 0 ? t(lang, "trendsNoSlip") : t(lang, d > 0 ? "trendsSlipDays" : "trendsAheadDays", Math.abs(d));
  }
  if (row.delta === null) return "—";
  const sign = row.delta > 0 ? "+" : "";
  if (row.key === "pctComplete") return `${sign}${row.delta}%`;
  return `${sign}${Math.round(row.delta * 100) / 100}`;
}

function trendPoints(snaps: readonly SnapshotRecord[], gaps: ReadonlySet<string>, pick: (s: SnapshotRecord) => number | null): TrendPoint[] {
  // Only points with a defined value; mark gapBefore when the immediately
  // preceding bucket(s) are in the gap set.
  return snaps
    .map((s) => ({ s, value: pick(s) }))
    .filter((x): x is { s: SnapshotRecord; value: number } => x.value !== null)
    .map((x, i, arr) => ({
      label: x.s.bucket,
      value: x.value,
      gapBefore: i > 0 && gaps.size > 0
        // any gap bucket sits between the previous and this capture
        ? true && gapBetween(arr[i - 1].s, x.s, gaps)
        : false,
    }));
}

function gapBetween(prev: SnapshotRecord, curr: SnapshotRecord, gaps: ReadonlySet<string>): boolean {
  // A gap exists between two captures if any gap bucket's time ordering falls
  // between them. Cheap proxy: a gap bucket string sorts strictly between the
  // two bucket strings (ISO bucket keys are lexicographically ordered within a
  // cadence). Good enough for highlighting.
  for (const g of gaps) {
    if (g > prev.bucket && g < curr.bucket) return true;
  }
  return false;
}

export function TrendsPanel(props: TrendsPanelProps) {
  const { lang, active, snapshots, baseline, variance, gaps, busy, captureNow, setBaseline, deleteSnapshot } = props;

  if (!active) {
    return (
      <div className={VIEW_PANE_CLASS}>
        <p className="text-sm text-muted-foreground">{t(lang, "trendsRequireTurso")}</p>
      </div>
    );
  }

  const gapSet = new Set(gaps);
  const locale = localeFor(lang);
  const currency = props.latest?.currency || "EUR";

  return (
    <div className={VIEW_PANE_CLASS}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t(lang, "navTrends")}</h2>
        <button
          type="button"
          onClick={() => { void captureNow(); }}
          disabled={busy}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(lang, "trendsCaptureNow")}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "trendsNoSnapshots")}</p>
      ) : (
        <div className="space-y-4">
          {/* Variance summary */}
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t(lang, "trendsVarianceHeading")}
              {baseline ? ` · ${t(lang, "trendsBaselineLabel")}: ${baseline.bucket}` : ""}
            </h3>
            <table className={INNER_TABLE_CLASS}>
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 text-left">KPI</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsBaselineLabel")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsCurrentLabel")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsDeltaLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {variance.map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2 font-medium">{t(lang, VARIANCE_LABEL_KEYS[row.key])}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCell(row, "baseline")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCell(row, "current")}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.health ? healthText[row.health] : ""}`}>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {fmtDelta(row, lang)}
                        {row.health ? <RagBadge value={row.health} /> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* KPI trend charts */}
          <div className="flex flex-wrap gap-4">
            <TrendChart caption={t(lang, "trendKpiRemainingHours")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.remainingHours)}
              format={(v) => `${Math.round(v)}h`} />
            <TrendChart caption={t(lang, "trendKpiRemainingCost")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.remainingCost)}
              format={(v) => formatCurrency(v, currency, locale)} />
            <TrendChart caption={t(lang, "trendKpiSpi")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.spi)}
              format={(v) => v.toFixed(2)} />
            <TrendChart caption={t(lang, "trendKpiCpi")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.cpi)}
              format={(v) => v.toFixed(2)} />
          </div>

          {/* Snapshot list */}
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{t(lang, "trendsSnapshotsHeading")}</h3>
            <table className={INNER_TABLE_CLASS}>
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 text-left">{t(lang, "trendsCapturedAt")}</th>
                  <th className="px-3 py-2 text-left">{t(lang, "trendsTrigger")}</th>
                  <th className="px-3 py-2 text-left">{t(lang, "trendsBaselineLabel")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsActions")}</th>
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 tabular-nums">{s.capturedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-2">{t(lang, s.trigger === "auto" ? "trendsTriggerAuto" : "trendsTriggerManual")}</td>
                    <td className="px-3 py-2">{s.isBaseline ? "★" : ""}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex gap-2">
                        {!s.isBaseline && (
                          <button type="button" disabled={busy} onClick={() => { void setBaseline(s.id); }}
                            className="text-xs text-AIPM-dark-blue underline hover:opacity-80 disabled:opacity-50">
                            {t(lang, "trendsSetBaseline")}
                          </button>
                        )}
                        <button type="button" disabled={busy} onClick={() => { void deleteSnapshot(s.id); }}
                          className="text-xs text-AIPM-pink underline hover:opacity-80 disabled:opacity-50">
                          {t(lang, "trendsDeleteSnapshot")}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

> If `RagBadge` requires more props than `value` (check `rag-badge.tsx`), pass them per its signature (e.g. a size/letters flag). Keep to its existing API. If `VIEW_PANE_CLASS`/`INNER_TABLE_CLASS` names differ, use the actual exports from `view-styles.ts`.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/trends-panel.test.tsx`
Expected: PASS (all 4). `npx tsc --noEmit` clean. `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/trends-panel.tsx src/app/trends-panel.test.tsx
git commit -F - <<'EOF'
feat: TrendsPanel (Turso gate, variance table, KPI trend charts, snapshot list)
EOF
```

---

## Task 12: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add all new keys to `src/app/i18n.ts`** (EN). Place near other nav/dashboard keys. Use these exact key/value pairs:

```ts
  navTrends: "Trends",
  trendsRequireTurso: "Trends require the Turso backend. Choose Turso in Settings → Storage to record snapshots.",
  trendsNoSnapshots: "No snapshots yet. The first one is captured automatically, or use Capture snapshot now.",
  trendsNotEnough: "Not enough snapshots yet to draw a trend.",
  trendsCaptureNow: "Capture snapshot now",
  trendsSetBaseline: "Set as baseline",
  trendsDeleteSnapshot: "Delete",
  trendsVarianceHeading: "Baseline vs current",
  trendsSnapshotsHeading: "Snapshots",
  trendsBaselineLabel: "Baseline",
  trendsCurrentLabel: "Current",
  trendsDeltaLabel: "Δ",
  trendsCapturedAt: "Captured",
  trendsTrigger: "Trigger",
  trendsActions: "Actions",
  trendsTriggerAuto: "Auto",
  trendsTriggerManual: "Manual",
  trendsSlipDays: "+{0} d late",
  trendsAheadDays: "{0} d early",
  trendsNoSlip: "on plan",
  trendKpiRemainingHours: "Remaining hours",
  trendKpiRemainingCost: "Remaining cost",
  trendKpiPctComplete: "Percent complete",
  trendKpiForecastSlip: "Forecast end date",
  trendKpiSpi: "SPI",
  trendKpiCpi: "CPI",
  snapshotRecordingLabel: "Snapshot trend recording",
  snapshotCadenceLabel: "Snapshot cadence",
  snapshotCadenceWeekly: "Weekly",
  snapshotCadenceDaily: "Daily",
  snapshotCadenceMonthly: "Monthly",
  snapshotNeedsTurso: "Recording only runs while the Turso backend is active.",
  storageTursoLeaveWarn: "Snapshot trend recording only works on the Turso backend. Switching to {1} stops recording (your {0} items are still converted). Your recorded snapshots are kept in Turso and recording resumes when you switch back. Continue?",
  versionHighlightTrends: "Baseline + variance / burn-down trends — periodic Turso snapshots show slippage over time",
```

- [ ] **Step 2: Add the SAME keys to `src/app/i18n.de.ts`** (DE) with straight ASCII quotes:

```ts
  navTrends: "Trends",
  trendsRequireTurso: "Trends erfordern das Turso-Backend. Wählen Sie Turso unter Einstellungen → Speicher, um Snapshots aufzuzeichnen.",
  trendsNoSnapshots: "Noch keine Snapshots. Der erste wird automatisch erfasst, oder nutzen Sie Snapshot jetzt erfassen.",
  trendsNotEnough: "Noch nicht genügend Snapshots für einen Trend.",
  trendsCaptureNow: "Snapshot jetzt erfassen",
  trendsSetBaseline: "Als Baseline festlegen",
  trendsDeleteSnapshot: "Löschen",
  trendsVarianceHeading: "Baseline vs. aktuell",
  trendsSnapshotsHeading: "Snapshots",
  trendsBaselineLabel: "Baseline",
  trendsCurrentLabel: "Aktuell",
  trendsDeltaLabel: "Δ",
  trendsCapturedAt: "Erfasst",
  trendsTrigger: "Auslöser",
  trendsActions: "Aktionen",
  trendsTriggerAuto: "Automatisch",
  trendsTriggerManual: "Manuell",
  trendsSlipDays: "+{0} T verspätet",
  trendsAheadDays: "{0} T früher",
  trendsNoSlip: "im Plan",
  trendKpiRemainingHours: "Verbleibende Stunden",
  trendKpiRemainingCost: "Verbleibende Kosten",
  trendKpiPctComplete: "Fertigstellungsgrad",
  trendKpiForecastSlip: "Prognostiziertes Enddatum",
  trendKpiSpi: "SPI",
  trendKpiCpi: "CPI",
  snapshotRecordingLabel: "Snapshot-Trendaufzeichnung",
  snapshotCadenceLabel: "Snapshot-Intervall",
  snapshotCadenceWeekly: "Wöchentlich",
  snapshotCadenceDaily: "Täglich",
  snapshotCadenceMonthly: "Monatlich",
  snapshotNeedsTurso: "Die Aufzeichnung läuft nur, solange das Turso-Backend aktiv ist.",
  storageTursoLeaveWarn: "Die Snapshot-Trendaufzeichnung funktioniert nur mit dem Turso-Backend. Der Wechsel zu {1} stoppt die Aufzeichnung (Ihre {0} Einträge werden weiterhin konvertiert). Ihre aufgezeichneten Snapshots bleiben in Turso erhalten und die Aufzeichnung wird beim Zurückwechseln fortgesetzt. Fortfahren?",
  versionHighlightTrends: "Baseline + Varianz / Burn-down-Trends — periodische Turso-Snapshots zeigen Verzug über die Zeit",
```

- [ ] **Step 3: Verify DE has no curly quotes** introduced by editing

Run: `npx vitest run src/app/i18n.de.ts` is not a test; instead grep:
Use the Grep tool for `[“”‘’]` in `src/app/i18n.de.ts` — expect ZERO matches in the new keys.

- [ ] **Step 4: Typecheck (parity enforced)**

Run: `npx tsc --noEmit`
Expected: clean (any missing EN/DE key would error here).

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: i18n keys for Trends view + snapshot settings + Turso-leave warning (EN/DE)
EOF
```

---

## Task 13: Nav wiring — `"trends"` AppView + icon + mount

**Files:**
- Modify: `src/app/nav-config.ts`
- Modify: `src/app/nav-icons.tsx`
- Modify: `src/app/workspace-section.tsx`
- Modify: `src/app/task-manager.tsx`
- Test: `src/app/nav-config.test.ts` (extend if present; else add a small test)

- [ ] **Step 1: Add a failing nav test** — append to `src/app/nav-config.test.ts` (create if missing)

```ts
import { describe, expect, it } from "vitest";
import { allNavViews, navLabelKey } from "./nav-config";

describe("trends nav", () => {
  it("includes trends in the Overview group", () => {
    expect(allNavViews()).toContain("trends");
  });
  it("maps trends to its label key", () => {
    expect(navLabelKey("trends")).toBe("navTrends");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/nav-config.test.ts`
Expected: FAIL — `"trends"` not in the union / not in `allNavViews()`.

- [ ] **Step 3: Edit `src/app/nav-config.ts`**
  - Add `| "trends"` to the `AppView` union (after `"dashboard"`).
  - Add `{ view: "trends" }` to the Overview group items (after `{ view: "dashboard" }`):

```ts
    items: [{ view: "dashboard" }, { view: "trends" }, { view: "open-points" }, { view: "chat" }],
```

  - Add to `LABEL_KEYS`: `trends: "navTrends",`.

- [ ] **Step 4: Edit `src/app/nav-icons.tsx`** — add a `trends` glyph to `ICON_PATHS` (line-chart with an upward trend):

```ts
  // trends: line chart trending up
  trends: "M3 3v18h18M7 14l3-3 3 4 5-6",
```

- [ ] **Step 5: Edit `src/app/workspace-section.tsx`**
  - Add the dynamic import near the others (after `BudgetReportPanel`):

```ts
const TrendsPanel = dynamic(
  () => import("./trends-panel").then((m) => m.TrendsPanel),
  { ssr: false },
);
```

  - Add a conditional mount alongside `{activeTab === "dashboard" && (...)}`:

```tsx
        {activeTab === "trends" && (
          <TrendsPanel
            lang={lang}
            active={trends.active}
            snapshots={trends.snapshots}
            baseline={trends.baseline}
            latest={trends.latest}
            variance={trends.variance}
            gaps={trends.gaps}
            busy={trends.busy}
            captureNow={trends.captureNow}
            setBaseline={trends.setBaseline}
            deleteSnapshot={trends.deleteSnapshot}
          />
        )}
```

  - Add `trends` (the `UseSnapshotsResult`) to `WorkspaceSection`'s props. Find the props interface/type for `WorkspaceSection` and add:

```ts
  trends: import("./use-snapshots").UseSnapshotsResult;
```

(or import the type at top: `import type { UseSnapshotsResult } from "./use-snapshots";` and use `trends: UseSnapshotsResult;`). Also ensure `lang` is already available in this component (it is used by other panels); if not, thread it from props.

- [ ] **Step 6: Edit `src/app/task-manager.tsx`** — instantiate the hook and pass it down.
  - Import: `import { useSnapshots } from "./use-snapshots";` and `import { computeDashboard } from "./dashboard";` (if not already), and `import { getTursoConfig } from "./turso-config";`.
  - Build the hook near other hooks, reading workspace + settings already in scope. The `active` flag = Turso backend AND not popout AND recording enabled:

```ts
  const snapshotsCfg = settings.snapshots ?? defaultSnapshotSettings;
  const tursoConfig = getTursoConfig(
    settings.integrations?.turso?.databaseUrl,
    settings.integrations?.turso?.authToken,
  );
  const trends = useSnapshots({
    active: settings.storageConfig.kind === "turso" && !isPopout && snapshotsCfg.enabled,
    cadence: snapshotsCfg.cadence,
    tursoConfig,
    today: new Date(),
    buildContext: () => {
      const model = computeDashboard({
        tasks, raid, budgets, plan, roles, resources, absences,
        workdayHours: settings.resources.workdayHours,
        holidaySet, status, activity: activityLog,
        today: new Date().toISOString().slice(0, 10), milestones,
      });
      return { model, tasks, milestones, planEndDate: plan.endDate, currency: plan.currency || "EUR" };
    },
    onError: (err) => showToast("error", t(lang, "storageSaveFailed", String(err))),
  });
```

  - Add `import { defaultSnapshotSettings } from "./settings-types";`.
  - Pass `trends={trends}` to `<WorkspaceSection .../>`. (`holidaySet` is already available via `useHolidaySet` in task-manager; if it is computed elsewhere, reuse that value. If `activityLog`, `status`, `milestones`, `resources`, `absences` are in `useWorkspace()`/local scope, use those.)

> Keep `buildContext` a fresh closure each render (it reads live state); the hook stores it in a ref so this does NOT cause reload loops. `today: new Date()` is fine (app code).

- [ ] **Step 7: Run targeted tests + typecheck + build**

Run: `npx vitest run src/app/nav-config.test.ts src/app/workspace-section.test.tsx`
Then: `npx tsc --noEmit` and `npm run lint`.
Expected: PASS / clean. (Adding `"trends"` forces `ICON_PATHS` + `LABEL_KEYS` totality — tsc confirms both are covered.)

- [ ] **Step 8: Commit**

```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts src/app/nav-icons.tsx src/app/workspace-section.tsx src/app/task-manager.tsx
git commit -F - <<'EOF'
feat: wire Trends view into nav, icons, workspace mount, and useSnapshots
EOF
```

---

## Task 14: Settings UI — recording toggle + cadence

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Test: `src/app/integrations-settings.test.ts` (extend) or a new `integrations-snapshots.test.tsx`

- [ ] **Step 1: Write a failing test** — `src/app/integrations-snapshots.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { defaultSettings } from "./settings-types";

describe("IntegrationsSection snapshot controls", () => {
  it("renders the recording toggle + cadence select inside the Turso block when Turso is enabled", () => {
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true } } };
    const { getByLabelText, getByText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />);
    expect(getByText(/Snapshot trend recording/i)).toBeTruthy();
    expect(getByLabelText(/Snapshot cadence/i)).toBeTruthy();
  });

  it("updates cadence via onChange", () => {
    const onChange = vi.fn();
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true } } };
    const { getByLabelText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={onChange} />);
    const select = getByLabelText(/Snapshot cadence/i) as HTMLSelectElement;
    select.value = "daily";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.snapshots.cadence).toBe("daily");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/integrations-snapshots.test.tsx`
Expected: FAIL — controls not rendered.

- [ ] **Step 3: Edit `src/app/settings-sections/integrations-section.tsx`**
  - Add imports: `import { type SnapshotSettings, defaultSnapshotSettings } from "../settings-types";` and `import type { SnapshotCadence } from "../snapshot";`.
  - Inside the component, read snapshots + add an updater:

```ts
  const snapshots = settings.snapshots ?? defaultSnapshotSettings;
  function updateSnapshots(patch: Partial<SnapshotSettings>) {
    onChange({ ...settings, snapshots: { ...snapshots, ...patch } });
  }
```

  - Inside the existing `{turso.enabled && (<div className="mt-2 space-y-2 border-l-2 border-line pl-3"> ... </div>)}` block, AFTER the token input, add the recording controls:

```tsx
          <div className="mt-2 border-t border-line pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={snapshots.enabled}
                onChange={(e) => updateSnapshots({ enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span>{t(lang, "snapshotRecordingLabel")}</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{t(lang, "snapshotNeedsTurso")}</p>
            <label className="mt-2 block text-xs">
              <span className="text-muted-foreground">{t(lang, "snapshotCadenceLabel")}</span>
              <select
                aria-label={t(lang, "snapshotCadenceLabel")}
                value={snapshots.cadence}
                onChange={(e) => updateSnapshots({ cadence: e.target.value as SnapshotCadence })}
                className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
              >
                <option value="weekly">{t(lang, "snapshotCadenceWeekly")}</option>
                <option value="daily">{t(lang, "snapshotCadenceDaily")}</option>
                <option value="monthly">{t(lang, "snapshotCadenceMonthly")}</option>
              </select>
            </label>
          </div>
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/integrations-snapshots.test.tsx`
Expected: PASS (both). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/integrations-section.tsx src/app/integrations-snapshots.test.tsx
git commit -F - <<'EOF'
feat: snapshot recording toggle + cadence select in the Turso settings block
EOF
```

---

## Task 15: Switch-away-from-Turso warning

**Files:**
- Modify: `src/app/use-storage-backend.ts`
- Modify: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Add a failing test** — append to `src/app/use-storage-backend.test.tsx`. Mirror the existing `onRequestStorageSwitch` test setup in that file (reuse its render harness / mocks). The new cases:

```tsx
// Within the existing describe for onRequestStorageSwitch:

it("shows the Turso-leave warning (not the generic convert-confirm) when leaving Turso, and aborts on cancel", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  // Arrange: current storageConfig.kind === "turso"; render the hook (see existing setup).
  const { onRequestStorageSwitch, setStorageConfig } = setupHook({ storageKind: "turso" });
  await onRequestStorageSwitch("browser");
  // The leave-warning message key was used, and the switch was aborted.
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/recording/i));
  expect(setStorageConfig).not.toHaveBeenCalled();
});

it("proceeds with the switch when the user confirms leaving Turso", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { onRequestStorageSwitch, setStorageConfig } = setupHook({ storageKind: "turso" });
  await onRequestStorageSwitch("browser");
  expect(setStorageConfig).toHaveBeenCalledWith(expect.objectContaining({ kind: "browser" }));
});

it("uses the generic convert-confirm for non-Turso source switches", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { onRequestStorageSwitch } = setupHook({ storageKind: "browser" });
  await onRequestStorageSwitch("local-json");
  expect(confirmSpy).toHaveBeenCalledWith(expect.not.stringMatching(/recording/i));
});
```

> Adapt `setupHook(...)` to the file's existing helper (the v0.48.0 suite already renders `useStorageBackend` and exercises `onRequestStorageSwitch`). If there is no helper, follow the existing test's inline `renderHook` pattern and seed `settings.storageConfig.kind` accordingly. The key assertions are: leaving Turso → confirm message matches `/recording/i`; cancel → `setStorageConfig` not called; confirm → called.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`
Expected: FAIL — leaving Turso currently uses the generic `storageConvertConfirm` message (no `/recording/i`).

- [ ] **Step 3: Edit `onRequestStorageSwitch` in `src/app/use-storage-backend.ts`.** Replace the single confirm line:

```ts
    const label = t(langRef.current, STORAGE_LABEL_KEYS[newKind]);
    if (!window.confirm(t(langRef.current, "storageConvertConfirm", tasks.length, label))) return;
```

with a branch that swaps the message when leaving Turso:

```ts
    const label = t(langRef.current, STORAGE_LABEL_KEYS[newKind]);
    const leavingTurso = current.kind === "turso" && newKind !== "turso";
    const confirmKey = leavingTurso ? "storageTursoLeaveWarn" : "storageConvertConfirm";
    if (!window.confirm(t(langRef.current, confirmKey, tasks.length, label))) return;
```

(Both message templates take `{0}` = task count and `{1}` = target label, so the argument order is unchanged.)

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`
Expected: PASS (all, including the 3 new). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx
git commit -F - <<'EOF'
feat: warn that snapshot recording stops when switching away from Turso

Recorded snapshots are retained in Turso; recording resumes on switch back.
EOF
```

---

## Task 16: Version bump + docs (0.49.0 "Le Guin")

**Files:**
- Modify: `src/app/version.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/CODEMAPS/frontend.md`

- [ ] **Step 1: Edit `src/app/version.ts`**
  - Prepend a release-notes comment block above the existing `0.48.0` block:

```ts
// 0.49.0 "Le Guin" adds Baseline + Variance / Burn-down Trends. When the active
// storage backend is Turso, the app captures periodic KPI snapshots (remaining
// hours/cost, % complete, forecast end date, SPI/CPI, the four RAGs, and the
// per-period burn-down series) into dedicated append-only Turso tables, separate
// from the workspace save cycle. A new Trends view (Overview group) shows a
// baseline-vs-current variance table, KPI trend charts, and the snapshot list;
// the baseline defaults to the first snapshot and can be re-flagged. Capture is
// automatic once per cadence bucket (weekly default; daily/monthly configurable)
// plus a manual "Capture snapshot now" button. Switching away from Turso warns
// that recording stops but is retained, and resumes on switch back; missing
// cadence buckets render as highlighted gaps. New pure modules: turso-pipeline.ts
// (shared HTTP runner), snapshot.ts, snapshot-schema.ts (append-only tables,
// disjoint from the workspace TABLE_NAMES), snapshot-store.ts; the use-snapshots
// hook and trend-chart.tsx / trends-panel.tsx UI.
```

  - Update:

```ts
export const APP_VERSION = "0.49.0";
export const APP_BUILD_DATE = "2026-06-03"; // 0.49.0 baseline/variance trends
export const APP_MILESTONE = "Le Guin";
```

  - Append to `APP_HIGHLIGHT_KEYS` (before the closing `] as const;`): `"versionHighlightTrends",`.

- [ ] **Step 2: Edit `package.json`** — set `"version": "0.49.0"`.

- [ ] **Step 3: Prepend a `CHANGELOG.md` entry** matching the existing format:

```markdown
## 0.49.0 "Le Guin" — 2026-06-03

Baseline + variance / burn-down trends. Turso-only periodic KPI snapshots
captured into append-only tables (separate from the workspace save cycle) power a
new Trends view: baseline-vs-current variance, KPI trend charts, and a snapshot
list. Auto-capture once per cadence bucket (weekly default; daily/monthly) plus a
manual capture button; re-baselineable. Switching away from Turso warns that
recording stops (data retained, resumes on return); recording gaps are
highlighted.
```

- [ ] **Step 4: Update `README.md`** — bump the version line to `0.49.0 "Le Guin"` and add a feature-table row for "Baseline / variance trends (Turso)". Match the existing table format.

- [ ] **Step 5: Update `docs/CODEMAPS/frontend.md`** — update the top stamp comment to mention 0.49.0, and add rows to the Key components table for the new files: `turso-pipeline.ts`, `snapshot.ts`, `snapshot-schema.ts`, `snapshot-store.ts`, `use-snapshots.ts`, `trend-chart.tsx`, `trends-panel.tsx`. Add `"trends"` to the AppView list note.

- [ ] **Step 6: Full verification**

Run: `npm run test:run` (full suite — expect all green), then `npx tsc --noEmit`, then `npm run lint`.
Expected: all PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md README.md docs/CODEMAPS/frontend.md
git commit -F - <<'EOF'
chore: release 0.49.0 "Le Guin" — baseline/variance burn-down trends
EOF
```

---

## Self-review (plan vs spec)

**Spec coverage:**
- Turso-only append-only tables, disjoint from TABLE_NAMES → Tasks 6 (schema + guard test), 7 (store), 1 (shared runner).
- KPI summary + per-period series content → Task 4 (`buildSnapshot`), 6 (schema), reflected in `SnapshotRecord`.
- Auto (cadence) + manual capture, once-per-bucket → Task 9 (`useSnapshots`), 13 (wiring), 14 (cadence setting).
- Weekly default, daily/monthly configurable → Tasks 8 (settings), 14 (UI).
- First-snapshot baseline, re-baselineable, variance → Tasks 5 (`computeVariance`), 9 (`pickBaseline`/`setBaseline`), 11 (UI).
- Trends sub-view under Overview, Turso-gated → Tasks 11 (panel), 13 (nav).
- Gap highlighting (dashed bridge + shaded band + count) → Tasks 10 (chart), 11 (wiring).
- Switch-away warning, retain, resume → Task 15 (warning); retention/resume are structural (append-only tables + Task 9 reload) and asserted by the disjoint guard (6) and reload test (9).
- Error handling (best-effort capture, toasts) → Task 9 (`onError`, auto silent-log), 1 (transport errors).
- Tests for every unit → each task is TDD.
- i18n EN/DE parity → Task 12 (+ tsc enforcement).
- Version bump → Task 16.

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step has full code. Two adaptation notes (Task 13 step 6 reuses existing task-manager scope; Task 15 reuses the existing test harness) reference concrete, named existing symbols, not vague work.

**Type consistency:** `SnapshotRecord`, `SnapshotCadence`, `SnapshotTrigger`, `VarianceRow`/`VarianceKey`, `BuildSnapshotInput`, `UseSnapshotsResult`, `TrendPoint`, `TrendsPanelProps` are defined once and used consistently. `runTursoPipeline(config, stmts)` signature matches all call sites. Snapshot column names match between `appendStatements`, `rowsToSnapshots`, and the store tests. i18n message-arg order (`{0}` count, `{1}` label) matches Task 15's reuse of `storageConvertConfirm` arg order.
