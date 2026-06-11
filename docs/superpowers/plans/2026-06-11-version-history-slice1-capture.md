# Version History — Slice 1 (Capture & Timeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-project workspace versions to a Turso `project_versions` table (idle-debounced auto + manual checkpoints, with retention pruning) and show them in a minimal read-only History timeline. Compare/diff and restore come in later slices.

**Architecture:** A new append-only Turso table holds full-JSON workspace snapshots per project. Pure SQL builders (`version-schema.ts`) + an async store (`version-store.ts`) mirror the existing snapshot subsystem. A hook (`use-version-history.ts`) lists versions and captures one on idle after a successful Turso save (rapid saves coalesce; identical payloads are skipped), keeping the most recent N auto-versions plus all manual ones. A `history-panel.tsx` view renders the timeline behind a Turso-gated nav entry.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + RTL (fake timers), Tailwind (AIPM palette), Turso via `runTursoPipeline`.

**Spec:** `docs/superpowers/specs/2026-06-11-version-history-design.md`. **Branch:** `feat-version-history` (already created). Do NOT edit `eslint.config.mjs` (hook-blocked).

**Scope of THIS slice:** capture + store + retention prune + a read-only timeline (time, trigger, label) + "Save version now". OUT of this slice: diff/compare UI, selective restore, the configurable-retention Settings stepper (prune uses a constant `DEFAULT_VERSION_RETENTION = 50` here; the stepper lands in Slice 4), the `history` feature-module toggle (Slice 4 — here the nav entry is gated on the Turso backend only), and rich change-summaries (Slice 2; `summary` is stored as `null` here).

**Patterns to mirror (read these first):** `src/app/snapshot-schema.ts` (DDL + `text()` helper + `insert()` + `rowObjects`/`rowsToSnapshots` decoder), `src/app/snapshot-store.ts` (async store over `runTursoPipeline`), `src/app/use-snapshots.ts` (Turso-gated hook), and how `useSnapshots` is wired in `src/app/task-manager.tsx` (~lines 260–388: `getTursoConfig`, `tursoProjectId`, `settings.storageConfig.kind === "turso" && !isPopout`).

**Verified facts:**
- `runTursoPipeline(config: TursoConfig | null, stmts: SqlStmt[]): Promise<PipelineResultLike[]>`. `SqlStmt = { sql: string; args?: {type:"text";value:string}[] }`. Text arg helper: `const text = (value: string) => ({ type: "text" as const, value })`.
- `rowObjects(res)` (private in snapshot-schema) maps a `PipelineResultLike` to `Record<string,string>[]`. Copy the same helper into `version-schema.ts` (it is not exported).
- `TABLE_NAMES` (turso-schema.ts:81) is the array the workspace save clears (`DELETE FROM` per table). Snapshot tables are deliberately NOT in it. `project_versions` must likewise NEVER be added to `TABLE_NAMES`.
- The Turso save-success signal is `onStorageOutcome(null)` (use-storage-backend.ts:191/239); `onStorageOutcome(err)` on failure. task-manager already passes `reportStorageOutcome` there.
- `Workspace` JSON codec: `workspaceToJson(ws): string` and `jsonToWorkspace(str): Workspace` in `src/app/workspace.ts` (confirm exact names by grepping `export function workspaceToJson` / `jsonToWorkspace`).

---

## Task 1: Types + SQL schema for `project_versions`

**Files:**
- Create: `src/app/version-history.ts`
- Create: `src/app/version-schema.ts`
- Test: `src/app/version-schema.test.ts`

- [ ] **Step 1: Write `version-history.ts` (types + constant)**

```ts
// src/app/version-history.ts
// Types for per-project data version history (Turso-only). A version is a full
// JSON copy of a project's workspace at a point in time. See the spec.

export type VersionTrigger = "auto" | "manual";

/** Timeline metadata for one version (payload loaded separately/on demand). */
export interface ProjectVersionMeta {
  id: string;
  projectId: string;
  capturedAt: string; // ISO
  trigger: VersionTrigger;
  label: string | null; // manual checkpoint name; null for auto
  summary: string | null; // human caption; null until Slice 2's diff engine
}

/** A version with its serialized-workspace payload. */
export interface ProjectVersion extends ProjectVersionMeta {
  payload: string; // workspaceToJson(...) output
}

/** Default auto-version retention. Slice 4 replaces this with a Settings value. */
export const DEFAULT_VERSION_RETENTION = 50;
```

- [ ] **Step 2: Write the failing schema test**

```ts
// src/app/version-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  VERSION_TABLE_NAME, VERSION_DDL,
  appendVersionStatements, versionListStatements, versionPayloadStatements,
  pruneStatements, deleteVersionStatements, rowsToVersionMeta,
} from "./version-schema";
import type { ProjectVersion } from "./version-history";

const v: ProjectVersion = {
  id: "v1", projectId: "p1", capturedAt: "2026-06-11T10:00:00.000Z",
  trigger: "manual", label: "Before review", summary: null, payload: '{"tasks":[]}',
};

describe("version-schema", () => {
  it("names the table project_versions and keeps it out of the workspace tables", async () => {
    const { TABLE_NAMES } = await import("./turso-schema");
    expect(VERSION_TABLE_NAME).toBe("project_versions");
    expect(TABLE_NAMES).not.toContain("project_versions");
  });

  it("append inserts all columns including the payload and project_id", () => {
    const stmts = appendVersionStatements(v, "p1");
    const insert = stmts.find((s) => s.sql.startsWith("INSERT INTO project_versions"));
    expect(insert).toBeTruthy();
    const values = (insert!.args ?? []).map((a) => a.value);
    expect(values).toContain("v1");
    expect(values).toContain('{"tasks":[]}'); // payload persisted
    expect(values).toContain("p1");
    expect(values).toContain("manual");
  });

  it("list selects metadata WITHOUT the payload column, newest first, scoped to project", () => {
    const [sel] = versionListStatements("p1");
    expect(sel.sql).toMatch(/SELECT .* FROM project_versions/);
    expect(sel.sql).not.toMatch(/payload/); // metadata only — payloads are big
    expect(sel.sql).toMatch(/WHERE project_id = \?/);
    expect(sel.sql).toMatch(/ORDER BY captured_at DESC/);
    expect(sel.args?.[0].value).toBe("p1");
  });

  it("payload select fetches one row's payload by id + project", () => {
    const [sel] = versionPayloadStatements("v1", "p1");
    expect(sel.sql).toMatch(/SELECT payload FROM project_versions WHERE id = \? AND project_id = \?/);
    expect(sel.args?.map((a) => a.value)).toEqual(["v1", "p1"]);
  });

  it("prune deletes auto rows beyond the newest N, never manual rows", () => {
    const [del] = pruneStatements("p1", 50);
    expect(del.sql).toMatch(/DELETE FROM project_versions/);
    expect(del.sql).toMatch(/trigger = 'auto'/);
    expect(del.sql).toMatch(/project_id = \?/);
    // keeps newest 50 auto: delete those whose id is NOT in the newest-50 auto set
    expect(del.sql).toMatch(/NOT IN/);
    expect(del.args?.some((a) => a.value === "50")).toBe(true);
  });

  it("rowsToVersionMeta maps rows and coerces trigger/label", () => {
    const rows = { rows: [["v1", "p1", "2026-06-11T10:00:00.000Z", "auto", "", ""]],
      cols: ["id", "project_id", "captured_at", "trigger", "label", "summary"] };
    const metas = rowsToVersionMeta(rows as never);
    expect(metas[0]).toMatchObject({ id: "v1", projectId: "p1", trigger: "auto", label: null, summary: null });
  });
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `npx vitest run src/app/version-schema.test.ts`
Expected: FAIL (module `./version-schema` not found).

- [ ] **Step 4: Implement `version-schema.ts`**

First open `src/app/snapshot-schema.ts` and copy its private `rowObjects` helper verbatim (it converts a `PipelineResultLike` into `Record<string,string>[]` handling the `cols`/`rows` shape). Then:

```ts
// src/app/version-schema.ts
// Pure SQL builders + decoders for the append-only project_versions table.
// MUST stay disjoint from turso-schema TABLE_NAMES so the per-save workspace
// overwrite never clears version history. Mirrors snapshot-schema.ts.

import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { ProjectVersion, ProjectVersionMeta, VersionTrigger } from "./version-history";

export const VERSION_TABLE_NAME = "project_versions";

export const VERSION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS project_versions (
    id TEXT PRIMARY KEY, project_id TEXT, captured_at TEXT, trigger TEXT,
    label TEXT, summary TEXT, payload TEXT
  )`,
];

const text = (value: string) => ({ type: "text" as const, value });

const META_COLS = ["id", "project_id", "captured_at", "trigger", "label", "summary"] as const;

// Copy rowObjects verbatim from snapshot-schema.ts (private helper there).
function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] {
  if (!res) return [];
  const cols: string[] = (res as { cols?: string[] }).cols ?? [];
  const rows: unknown[][] = (res as { rows?: unknown[][] }).rows ?? [];
  return rows.map((r) => {
    const o: Record<string, string> = {};
    cols.forEach((c, i) => { o[c] = r[i] == null ? "" : String(r[i]); });
    return o;
  });
}

export function appendVersionStatements(v: ProjectVersion, projectId: string): SqlStmt[] {
  return [{
    sql: `INSERT INTO ${VERSION_TABLE_NAME} (id, project_id, captured_at, trigger, label, summary, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      text(v.id), text(projectId), text(v.capturedAt), text(v.trigger),
      text(v.label ?? ""), text(v.summary ?? ""), text(v.payload),
    ],
  }];
}

/** Metadata only (no payload) — payloads can be large; newest first. */
export function versionListStatements(projectId: string): SqlStmt[] {
  return [{
    sql: `SELECT ${META_COLS.join(", ")} FROM ${VERSION_TABLE_NAME} WHERE project_id = ? ORDER BY captured_at DESC`,
    args: [text(projectId)],
  }];
}

export function versionPayloadStatements(id: string, projectId: string): SqlStmt[] {
  return [{
    sql: `SELECT payload FROM ${VERSION_TABLE_NAME} WHERE id = ? AND project_id = ?`,
    args: [text(id), text(projectId)],
  }];
}

/** Delete auto rows for this project except the newest `keep` (by captured_at).
 *  Manual rows are never touched. */
export function pruneStatements(projectId: string, keep: number): SqlStmt[] {
  return [{
    sql: `DELETE FROM ${VERSION_TABLE_NAME}
          WHERE project_id = ? AND trigger = 'auto' AND id NOT IN (
            SELECT id FROM ${VERSION_TABLE_NAME}
            WHERE project_id = ? AND trigger = 'auto'
            ORDER BY captured_at DESC LIMIT ?
          )`,
    args: [text(projectId), text(projectId), text(String(keep))],
  }];
}

export function deleteVersionStatements(id: string, projectId: string): SqlStmt[] {
  return [{
    sql: `DELETE FROM ${VERSION_TABLE_NAME} WHERE id = ? AND project_id = ?`,
    args: [text(id), text(projectId)],
  }];
}

export function rowsToVersionMeta(res: PipelineResultLike | undefined): ProjectVersionMeta[] {
  return rowObjects(res).filter((r) => r.id).map((r): ProjectVersionMeta => ({
    id: r.id,
    projectId: r.project_id,
    capturedAt: r.captured_at,
    trigger: (r.trigger === "manual" ? "manual" : "auto") as VersionTrigger,
    label: r.label ? r.label : null,
    summary: r.summary ? r.summary : null,
  }));
}

export function payloadFromResult(res: PipelineResultLike | undefined): string | null {
  const rows = rowObjects(res);
  return rows.length ? rows[0].payload ?? null : null;
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx vitest run src/app/version-schema.test.ts`
Expected: PASS (6 tests). If `rowObjects` shape differs, align it with the verbatim helper in snapshot-schema.ts.

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit` (0 errors).
```bash
git add src/app/version-history.ts src/app/version-schema.ts src/app/version-schema.test.ts
git commit -m "feat: project_versions schema + types (version history slice 1)"
```

---

## Task 2: Async `version-store.ts` over the Turso pipeline

**Files:**
- Create: `src/app/version-store.ts`
- Test: `src/app/version-store.test.ts`

- [ ] **Step 1: Write the failing test (Turso pipeline spy-mock)**

```ts
// src/app/version-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as pipeline from "./turso-pipeline";
import { listVersionMeta, loadVersionPayload, appendVersion, pruneVersions } from "./version-store";
import type { ProjectVersion } from "./version-history";

vi.mock("./turso-pipeline", { spy: true });

const cfg = { url: "libsql://x", authToken: "t" } as never;

beforeEach(() => vi.restoreAllMocks());

describe("version-store", () => {
  it("appendVersion prepends DDL then the insert", async () => {
    const spy = vi.spyOn(pipeline, "runTursoPipeline").mockResolvedValue([] as never);
    const v: ProjectVersion = { id: "v1", projectId: "p1", capturedAt: "t", trigger: "manual",
      label: "x", summary: null, payload: "{}" };
    await appendVersion(cfg, v, "p1");
    const stmts = spy.mock.calls[0][1];
    expect(stmts.some((s) => s.sql.includes("CREATE TABLE IF NOT EXISTS project_versions"))).toBe(true);
    expect(stmts.some((s) => s.sql.startsWith("INSERT INTO project_versions"))).toBe(true);
  });

  it("listVersionMeta returns decoded metadata", async () => {
    vi.spyOn(pipeline, "runTursoPipeline").mockResolvedValue([
      undefined, // DDL result slot
      { cols: ["id","project_id","captured_at","trigger","label","summary"],
        rows: [["v1","p1","2026-06-11T10:00:00Z","auto","",""]] },
    ] as never);
    const metas = await listVersionMeta(cfg, "p1");
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ id: "v1", trigger: "auto", label: null });
  });

  it("loadVersionPayload returns the payload string", async () => {
    vi.spyOn(pipeline, "runTursoPipeline").mockResolvedValue([
      undefined, { cols: ["payload"], rows: [['{"tasks":[]}']] },
    ] as never);
    const p = await loadVersionPayload(cfg, "v1", "p1");
    expect(p).toBe('{"tasks":[]}');
  });

  it("pruneVersions passes the keep count", async () => {
    const spy = vi.spyOn(pipeline, "runTursoPipeline").mockResolvedValue([] as never);
    await pruneVersions(cfg, "p1", 50);
    const stmts = spy.mock.calls[0][1];
    expect(stmts.some((s) => s.sql.includes("DELETE FROM project_versions") && s.sql.includes("NOT IN"))).toBe(true);
  });

  it("no-ops on a null config (off-Turso)", async () => {
    const spy = vi.spyOn(pipeline, "runTursoPipeline");
    expect(await listVersionMeta(null, "p1")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/version-store.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `version-store.ts`**

```ts
// src/app/version-store.ts
// Async store for project_versions over the shared Turso pipeline. Independent
// of the workspace StorageBackend.save() cycle. Every call prepends VERSION_DDL
// (CREATE TABLE IF NOT EXISTS). No-ops when config is null (off-Turso). Mirrors
// snapshot-store.ts.

import { runTursoPipeline } from "./turso-pipeline";
import {
  VERSION_DDL, appendVersionStatements, versionListStatements,
  versionPayloadStatements, pruneStatements, deleteVersionStatements,
  rowsToVersionMeta, payloadFromResult,
} from "./version-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { ProjectVersion, ProjectVersionMeta } from "./version-history";

const ddl = (): SqlStmt[] => VERSION_DDL.map((sql) => ({ sql }));

export async function listVersionMeta(config: TursoConfig | null, projectId: string): Promise<ProjectVersionMeta[]> {
  if (!config) return [];
  const stmts = [...ddl(), ...versionListStatements(projectId)];
  const results = await runTursoPipeline(config, stmts);
  return rowsToVersionMeta(results[VERSION_DDL.length]);
}

export async function loadVersionPayload(config: TursoConfig | null, id: string, projectId: string): Promise<string | null> {
  if (!config) return null;
  const results = await runTursoPipeline(config, [...ddl(), ...versionPayloadStatements(id, projectId)]);
  return payloadFromResult(results[VERSION_DDL.length]);
}

export async function appendVersion(config: TursoConfig | null, v: ProjectVersion, projectId: string): Promise<void> {
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...appendVersionStatements(v, projectId)]);
}

export async function pruneVersions(config: TursoConfig | null, projectId: string, keep: number): Promise<void> {
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...pruneStatements(projectId, keep)]);
}

export async function deleteVersion(config: TursoConfig | null, id: string, projectId: string): Promise<void> {
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...deleteVersionStatements(id, projectId)]);
}
```

- [ ] **Step 4: Run — expect PASS; then tsc + commit**

Run: `npx vitest run src/app/version-store.test.ts` → PASS. Then `npx tsc --noEmit` (0).
```bash
git add src/app/version-store.ts src/app/version-store.test.ts
git commit -m "feat: version-store CRUD over Turso pipeline (version history slice 1)"
```

---

## Task 3: Guard — `project_versions` survives a workspace save

**Files:**
- Test: `src/app/turso-schema.test.ts` (extend existing)

- [ ] **Step 1: Add a guard test**

Open `src/app/turso-schema.test.ts`. Find the existing test that asserts snapshot tables are excluded from `TABLE_NAMES` (grep `snapshot` / `TABLE_NAMES`). Add an analogous test right after it:

```ts
it("excludes project_versions from TABLE_NAMES so a workspace save cannot clear history", () => {
  expect(TABLE_NAMES).not.toContain("project_versions");
});
```
(Ensure `TABLE_NAMES` is already imported in this file; it is used by the neighboring tests.)

- [ ] **Step 2: Run — expect PASS**

Run: `npx vitest run src/app/turso-schema.test.ts`
Expected: PASS (the table was never added to `TABLE_NAMES`, so this guard holds and will fail loudly if someone adds it later).

- [ ] **Step 3: Commit**

```bash
git add src/app/turso-schema.test.ts
git commit -m "test: guard project_versions out of the workspace-clear table set"
```

---

## Task 4: `use-version-history.ts` — list + idle-debounced capture + manual + prune

**Files:**
- Create: `src/app/use-version-history.ts`
- Test: `src/app/use-version-history.test.tsx`

- [ ] **Step 1: Write the failing hook test (fake timers)**

```tsx
// src/app/use-version-history.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as store from "./version-store";
import { useVersionHistory } from "./use-version-history";

vi.mock("./version-store", { spy: true });
const cfg = { url: "x", authToken: "t" } as never;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function args(over = {}) {
  return {
    config: cfg, projectId: "p1", enabled: true, idleMs: 1000, retention: 50,
    getPayload: () => '{"tasks":[1]}', onError: vi.fn(), ...over,
  };
}

describe("useVersionHistory", () => {
  it("coalesces rapid saves into ONE auto capture after the idle window", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    act(() => { result.current.notifySaved(); result.current.notifySaved(); result.current.notifySaved(); });
    expect(append).not.toHaveBeenCalled(); // still within idle window
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1].trigger).toBe("auto");
  });

  it("skips capture when the payload is unchanged since the last version", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    // first capture
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1);
    // identical payload again → no second capture
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("captureNow writes a manual version immediately with the label", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    await act(async () => { await result.current.captureNow("Before review"); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1]).toMatchObject({ trigger: "manual", label: "Before review" });
  });

  it("is inert when disabled (off-Turso)", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    const list = vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args({ enabled: false })));
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(append).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/use-version-history.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement `use-version-history.ts`**

Generate ids without `Date.now`/`Math.random` collisions by combining the ISO timestamp with a monotonic counter ref (the codebase forbids bare random ids in some contexts; a timestamp + counter is deterministic enough and unique per capture).

```ts
// src/app/use-version-history.ts
// Turso-only per-project version history: lists versions, captures one on idle
// after a successful save (coalescing rapid saves; skipping unchanged payloads),
// supports manual checkpoints, and prunes auto-versions to `retention`. Inert
// when `enabled` is false (non-Turso backends / popout).

import { useCallback, useEffect, useRef, useState } from "react";
import { appendVersion, listVersionMeta, pruneVersions } from "./version-store";
import type { TursoConfig } from "./turso-config";
import type { ProjectVersion, ProjectVersionMeta } from "./version-history";

export interface UseVersionHistoryArgs {
  config: TursoConfig | null;
  projectId: string;
  enabled: boolean;
  idleMs: number;
  retention: number;
  /** Lazily serialize the CURRENT workspace at capture time. */
  getPayload: () => string;
  onError?: (err: unknown) => void;
}

export interface UseVersionHistoryResult {
  versions: ProjectVersionMeta[];
  busy: boolean;
  notifySaved: () => void;
  captureNow: (label: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useVersionHistory(args: UseVersionHistoryArgs): UseVersionHistoryResult {
  const { config, projectId, enabled, idleMs, retention, getPayload, onError } = args;
  const [versions, setVersions] = useState<ProjectVersionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayload = useRef<string | null>(null);
  const counter = useRef(0);

  const active = enabled && !!config && !!projectId;

  const refresh = useCallback(async () => {
    if (!active) { setVersions([]); return; }
    try { setVersions(await listVersionMeta(config, projectId)); }
    catch (err) { onError?.(err); }
  }, [active, config, projectId, onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const writeVersion = useCallback(async (trigger: "auto" | "manual", label: string | null) => {
    if (!active) return;
    const payload = getPayload();
    if (trigger === "auto" && payload === lastPayload.current) return; // no-op
    const capturedAt = new Date().toISOString();
    counter.current += 1;
    const v: ProjectVersion = {
      id: `${capturedAt}-${counter.current}`, projectId, capturedAt, trigger, label, summary: null, payload,
    };
    setBusy(true);
    try {
      await appendVersion(config, v, projectId);
      lastPayload.current = payload;
      await pruneVersions(config, projectId, retention);
      await refresh();
    } catch (err) { onError?.(err); }
    finally { setBusy(false); }
  }, [active, config, projectId, retention, getPayload, refresh]);

  const notifySaved = useCallback(() => {
    if (!active) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void writeVersion("auto", null); }, idleMs);
  }, [active, idleMs, writeVersion]);

  const captureNow = useCallback(async (label: string) => { await writeVersion("manual", label); }, [writeVersion]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { versions, busy, notifySaved, captureNow, refresh };
}
```

- [ ] **Step 4: Run — expect PASS; tsc; commit**

Run: `npx vitest run src/app/use-version-history.test.tsx` → PASS (4 tests). `npx tsc --noEmit` (0).
```bash
git add src/app/use-version-history.ts src/app/use-version-history.test.tsx
git commit -m "feat: useVersionHistory — idle-debounced capture + manual + prune (slice 1)"
```

---

## Task 5: `history-panel.tsx` — read-only timeline + "Save version now"

**Files:**
- Create: `src/app/history-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/history-panel.test.tsx`

- [ ] **Step 1: Add i18n keys (EN then DE)**

In `src/app/i18n.ts`, add near other view keys (match the surrounding object style):
```ts
  historyTitle: "Version history",
  historyEmpty: "No versions yet — changes you make will be captured here.",
  historySaveNow: "Save version now",
  historyManualLabelPrompt: "Name this version",
  historyAuto: "Auto",
  historyManual: "Checkpoint",
```
Add the SAME keys to `src/app/i18n.de.ts` with German values:
```ts
  historyTitle: "Versionsverlauf",
  historyEmpty: "Noch keine Versionen — Ihre Änderungen werden hier erfasst.",
  historySaveNow: "Version jetzt speichern",
  historyManualLabelPrompt: "Diese Version benennen",
  historyAuto: "Automatisch",
  historyManual: "Checkpoint",
```
(After editing `i18n.de.ts`, verify no curly-quote corruption: `grep -n 'historyTitle' src/app/i18n.de.ts` and confirm straight ASCII quotes.)

- [ ] **Step 2: Write the failing panel test**

```tsx
// src/app/history-panel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryPanel } from "./history-panel";
import type { ProjectVersionMeta } from "./version-history";

const metas: ProjectVersionMeta[] = [
  { id: "v2", projectId: "p1", capturedAt: "2026-06-11T12:00:00.000Z", trigger: "manual", label: "Before review", summary: null },
  { id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: null },
];

it("lists versions newest-first with label/trigger", () => {
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} />);
  expect(screen.getByText("Before review")).toBeInTheDocument();
  expect(screen.getByText(/Auto/)).toBeInTheDocument();
});

it("shows the empty state when there are no versions", () => {
  render(<HistoryPanel lang="en-US" versions={[]} busy={false} onCaptureNow={vi.fn()} />);
  expect(screen.getByText(/No versions yet/)).toBeInTheDocument();
});

it("calls onCaptureNow with the entered label", () => {
  const onCaptureNow = vi.fn();
  vi.spyOn(window, "prompt").mockReturnValue("My checkpoint");
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={onCaptureNow} />);
  fireEvent.click(screen.getByRole("button", { name: "Save version now" }));
  expect(onCaptureNow).toHaveBeenCalledWith("My checkpoint");
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run src/app/history-panel.test.tsx` → FAIL (module not found).

- [ ] **Step 4: Implement `history-panel.tsx`**

Reuse shared table/panel styling where natural (read a neighbor like `trends-panel.tsx` for the section wrapper + `TABLE_HEAD_CLASS` import from `table-styles.ts`). Keep it read-only (no diff/restore yet — those are later slices).

```tsx
// src/app/history-panel.tsx
// Read-only version-history timeline (Slice 1). Compare/diff + restore land in
// later slices. Turso-gated by the parent; this component is presentational.

import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { ProjectVersionMeta } from "./version-history";

interface HistoryPanelProps {
  lang: Lang;
  versions: ProjectVersionMeta[];
  busy: boolean;
  onCaptureNow: (label: string) => void;
}

export function HistoryPanel({ lang, versions, busy, onCaptureNow }: HistoryPanelProps) {
  const handleSave = () => {
    const label = window.prompt(t(lang, "historyManualLabelPrompt"));
    if (label && label.trim()) onCaptureNow(label.trim());
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t(lang, "historyTitle")}</h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t(lang, "historySaveNow")}
        </button>
      </div>

      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${v.trigger === "manual" ? "bg-AIPM-green/15 text-AIPM-green" : "bg-surface-muted text-muted-foreground"}`}>
                  {v.trigger === "manual" ? `★ ${t(lang, "historyManual")}` : t(lang, "historyAuto")}
                </span>
                <span className="text-foreground">{v.label ?? new Date(v.capturedAt).toLocaleString()}</span>
              </span>
              <span className="text-xs text-muted-foreground">{new Date(v.capturedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run — expect PASS; tsc; lint; commit**

Run: `npx vitest run src/app/history-panel.test.tsx` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/history-panel.tsx src/app/history-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: read-only history timeline panel + i18n (slice 1)"
```

---

## Task 6: Wire the History view — nav entry, Turso gating, hook in task-manager

**Files:**
- Modify: `src/app/nav-config.ts` (or `.tsx` — grep), `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`
- Test: extend `src/app/nav-config` test if one exists; otherwise rely on the build + a task-manager smoke render

- [ ] **Step 1: Register the `history` view in nav-config**

Grep `nav-config` for how an existing Turso-ish/optional view (e.g. `trends`) is registered (`grep -n "trends" src/app/nav-config.*`). Add a `history` view entry the same way (id `"history"`, an icon consistent with the others, label key `historyTitle`). If nav entries are filtered elsewhere by storage kind / module, follow that path; otherwise the gating happens at render (Step 3).

- [ ] **Step 2: Instantiate the hook in task-manager**

In `src/app/task-manager.tsx`, mirror the `useSnapshots` wiring (~line 350). After the snapshots block add:
```ts
  const versionHistory = useVersionHistory({
    config: tursoConfig,
    projectId: portfolioMode === "turso" ? (tursoProjectId ?? "") : "",
    enabled: settings.storageConfig.kind === "turso" && !isPopout,
    idleMs: 180_000, // 3-minute idle coalescing window
    retention: DEFAULT_VERSION_RETENTION,
    getPayload: () => workspaceToJson(workspace),
    onError: reportStorageOutcome,
  });
```
Add imports: `useVersionHistory` from `./use-version-history`, `DEFAULT_VERSION_RETENTION` from `./version-history`, and confirm `workspaceToJson` + the current `workspace` value are in scope (grep; `workspace` is the assembled Workspace the panels consume). Define `idleMs` as a named const `VERSION_IDLE_MS = 180_000` at module top rather than inline if that matches the file's style.

- [ ] **Step 3: Trigger capture on successful save**

`reportStorageOutcome` is the `onStorageOutcome` callback. Wrap it so a successful save (`err == null`) also notifies version history. Find `reportStorageOutcome` (grep) and add, right after it records the (null) outcome:
```ts
    if (err == null) versionHistory.notifySaved();
```
If `reportStorageOutcome` is defined before `versionHistory`, instead pass a small wrapper into `useStorageBackend`'s `onStorageOutcome` that calls both, or store `notifySaved` in a ref. Keep the existing storage-error behavior intact (do not change the error path).

- [ ] **Step 4: Render the panel, Turso-gated**

In the view-routing render (grep where `trends`/`TrendsPanel` is rendered in `workspace-section.tsx` or `task-manager.tsx`), add a branch for the `history` view that renders:
```tsx
<HistoryPanel
  lang={lang}
  versions={versionHistory.versions}
  busy={versionHistory.busy}
  onCaptureNow={(label) => void versionHistory.captureNow(label)}
/>
```
Gate the nav entry/route so `history` is only reachable when `settings.storageConfig.kind === "turso"` (mirror how `trends` is gated to Turso — grep `trendsActive` / `storageConfig.kind === "turso"`). Thread `versionHistory` to `workspace-section` as a prop if the render lives there (mirror how `trends` is threaded).

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit` (0 — fixes any missed prop threading), `npm run lint` (0), `npx vitest run src/app` (report counts; all green), `npm run build` (succeeds).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire Turso-gated History view + capture-on-save (slice 1)"
```

---

## Task 7: Release 0.66.0 "Egan"

**Files:** `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version bump**

`package.json`: `0.65.0` → `0.66.0`. `src/app/version.ts`: `APP_VERSION = "0.66.0"`, update `APP_BUILD_DATE` comment, set `APP_MILESTONE = "Egan"` (Greg Egan) and update the codename JSDoc to say the 0.66.x line is "Egan".

- [ ] **Step 2: CHANGELOG entry**

Prepend above `## [0.65.0]`:
```markdown
## [0.66.0] - 2026-06-11 "Egan"

Data version history — capture & timeline (Turso only; first slice).

### Added
- On the Turso backend, the app now keeps a per-project version history. Edits
  are captured automatically a few minutes after they settle (rapid changes
  coalesce into one version), and you can save a named checkpoint at any time
  via "Save version now". A new **History** view (shown only on Turso) lists the
  timeline. Comparing versions and restoring are coming in the next releases.
- Automatic versions are pruned to the most recent 50 per project; named
  checkpoints are kept. (A configurable retention setting arrives in a later
  slice.)
```

- [ ] **Step 3: Full gates + build**

Run: `npm run lint` (0), `npx tsc --noEmit` (0), `npx vitest run` (full suite green — report counts; confirm golden fixtures unchanged), `npm run build` (succeeds).

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.66.0 \"Egan\" — version history capture & timeline (slice 1)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean; `npm run lint` clean; full `npx vitest run` green; `npm run build` succeeds; golden fixtures unchanged.
- [ ] Manual sanity (mental trace, Turso backend): edit data → after the idle window one auto-version appears in History; rapid edits make ONE version, not many; identical-state save makes none; "Save version now" adds a named checkpoint immediately; switching to a file backend hides the History nav entry.

## Notes / landmines

- `project_versions` MUST stay out of `turso-schema` `TABLE_NAMES` (Task 3 guards it) — otherwise the per-save workspace overwrite would wipe history (same rule as the snapshot tables).
- `vi.mock("./turso-pipeline", { spy: true })` and `vi.mock("./version-store", { spy: true })` are required for the store/hook tests — a bare factory that spreads `importOriginal` silently un-mocks (known vitest-4 gotcha).
- No new entity column anywhere → no Turso column-add write-break, no workspace schema-version bump, golden fixtures untouched (separate table).
- `i18n.de.ts` edits can corrupt ASCII quotes via the Edit tool — verify after editing.
- Capture/prune are best-effort: route their errors through `onError` (→ the existing storage-error reporter); never throw into the save path.
- Slice boundaries: NO diff/compare, NO restore, NO retention Settings stepper, NO `history` feature-module toggle here — those are Slices 2–4.
