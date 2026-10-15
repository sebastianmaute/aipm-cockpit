// forecastHistory (§502) across ALL SIX write paths, one `it` per path.
//
// ★★ `Workspace.forecastHistory` is a META-BLOB slice — no `ENTITY_SPECS` row,
// so it buys nothing for free and each path is hand-written. The Turso TENANT
// writer is the one a previous meta-blob slice (`activityLog`) missed, caught
// only in review; it gets its own `it` here so a miss is a named red test.
//
// Turso is exercised through the REAL engine (`node:sqlite`), the way
// `turso-schema.execute.test.ts` does — string-matching the generated SQL cannot
// see a row that is written but never read back. IndexedDB is driven through
// the storage HOOK over `fake-indexeddb`, the way
// `budget-history-persistence.test.ts` does, because the slice is OPTIONAL on
// `Workspace`: dropping it from `outgoing`, the save deps or `applyWorkspace`
// compiles clean and silently loses it on the next autosave.
import "fake-indexeddb/auto";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { Task } from "./types";
import type { ForecastHistoryEntry } from "./forecast-history";
import {
  emptyWorkspace,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
  workspaceToJson,
  jsonToWorkspace,
} from "./storage";
import {
  SCHEMA_DDL, selectStatements, workspaceToStatements, rowsToWorkspace,
  type PipelineResultLike, type SqlStmt,
} from "./turso-schema";
import { tenantSchemaDdl, tenantSelectStatements, tenantWorkspaceToStatements } from "./turso-tenant-schema";
import type { Workspace } from "./workspace";

// Cross-tab broadcast needs a BroadcastChannel — stub it, and read the channels back.
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn(), useRevisionSync: vi.fn(), postRevision: vi.fn() }));

import { useBroadcastSync } from "./broadcast-sync";
import { BrowserBackend } from "./browser-backend";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

const PROJECT_ID = "proj-forecast-1";

function history(): readonly ForecastHistoryEntry[] {
  return [
    { date: "2026-10-01", p50: "2026-11-02", p80: "2026-11-09", p95: "2026-11-20", chanceOnTime: 0.62 },
    { date: "2026-10-02", p50: null, p80: null, p95: null, chanceOnTime: null },
  ];
}

const withHistory = (): Workspace => ({ ...emptyWorkspace(), forecastHistory: history() });
const withoutHistory = (): Workspace => ({ ...emptyWorkspace(), forecastHistory: [] });

// --- the Turso engine (same pivot as turso-schema.execute.test.ts) ---------

function bindArg(arg: { type: string; value?: string }): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}

function runStatements(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) { db.exec(s.sql); continue; }
    db.prepare(s.sql).run(...s.args.map(bindArg));
  }
}

function toResults(sqls: readonly SqlStmt[], db: DatabaseSync, ...params: string[]): PipelineResultLike[] {
  return sqls.map((s) => {
    const rows = db.prepare(s.sql).all(...params) as Record<string, unknown>[];
    const cols = rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [];
    return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => ({ value: r[c.name] }))) } } };
  });
}

function singleRoundTrip(ws: Workspace): Workspace {
  const db = new DatabaseSync(":memory:");
  try {
    for (const ddl of SCHEMA_DDL) db.exec(ddl);
    runStatements(db, workspaceToStatements(ws));
    return rowsToWorkspace(toResults(selectStatements(), db));
  } finally {
    db.close();
  }
}

function tenantRoundTrip(ws: Workspace): Workspace {
  const db = new DatabaseSync(":memory:");
  try {
    for (const ddl of tenantSchemaDdl()) db.exec(ddl);
    runStatements(db, tenantWorkspaceToStatements(ws, PROJECT_ID));
    runStatements(db, tenantWorkspaceToStatements(emptyWorkspace(), "proj-other")); // another project's save leaves this row alone
    return rowsToWorkspace(toResults(tenantSelectStatements(PROJECT_ID), db, PROJECT_ID));
  } finally {
    db.close();
  }
}

/** How many statements INSERT a meta row keyed `forecastHistory`. */
const forecastMetaInserts = (statements: readonly SqlStmt[]): number =>
  statements.filter((s) => /^INSERT INTO meta /.test(s.sql) && s.args?.[0]?.value === "forecastHistory").length;

// --- IndexedDB, through the storage hook -----------------------------------

const task = {
  id: 1, taskName: "Build the thing", assignee: "Ada", priority: "Medium",
  startDate: "2026-01-01", dueDate: "2026-01-05",
} as unknown as Task;

function makeArgs(): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig: { kind: "browser" } } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}

function useProbe(args: Parameters<typeof useStorageBackend>[0]) {
  const backend = useStorageBackend(args);
  const { setTasks, forecastHistory, setForecastHistory } = useWorkspace();
  return { ...backend, setTasks, forecastHistory, setForecastHistory };
}

function renderBackend() {
  const args = makeArgs();
  return renderHook(() => useProbe(args), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(TestProviders, null, children),
  });
}

async function forcedSave(ws: Workspace): Promise<void> {
  const backend = new BrowserBackend();
  backend.forceNextSave();
  await backend.save(ws);
}

const readBack = async (): Promise<Workspace> => await new BrowserBackend().load();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

describe("forecastHistory round-trips on every write path (§502)", () => {
  it("JSON", () => {
    expect(jsonToWorkspace(workspaceToJson(withHistory())).forecastHistory).toEqual(history());
  });

  it("CSV", () => {
    expect(csvToWorkspace(workspaceToCsv(withHistory())).forecastHistory).toEqual(history());
  });

  it("Markdown", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(withHistory())).forecastHistory).toEqual(history());
  });

  it("Turso single-tenant", () => {
    expect(singleRoundTrip(withHistory()).forecastHistory).toEqual(history());
  });

  it("Turso tenant", () => {
    expect(tenantRoundTrip(withHistory()).forecastHistory).toEqual(history());
  });

  it("IndexedDB", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task], forecastHistory: history() });
    expect((await readBack()).forecastHistory).toEqual(history());
  });
});

describe("a workspace without forecastHistory writes nothing for it (§502)", () => {
  it("JSON: no key", () => {
    expect(JSON.parse(workspaceToJson(withHistory()))).toHaveProperty("forecastHistory"); // positive control
    expect(JSON.parse(workspaceToJson(withoutHistory()))).not.toHaveProperty("forecastHistory");
  });

  it("CSV: no section — byte-identical to the empty workspace", () => {
    expect(workspaceToCsv(withHistory())).not.toBe(workspaceToCsv(emptyWorkspace())); // positive control
    expect(workspaceToCsv(withoutHistory())).toBe(workspaceToCsv(emptyWorkspace()));
  });

  it("Markdown: no section — byte-identical to the empty workspace", () => {
    expect(workspaceToMarkdown(withHistory())).not.toBe(workspaceToMarkdown(emptyWorkspace())); // positive control
    expect(workspaceToMarkdown(withoutHistory())).toBe(workspaceToMarkdown(emptyWorkspace()));
  });

  it("Turso single-tenant and tenant: no meta row", () => {
    expect(forecastMetaInserts(workspaceToStatements(withHistory()))).toBe(1); // positive control
    expect(forecastMetaInserts(tenantWorkspaceToStatements(withHistory(), PROJECT_ID))).toBe(1);
    expect(forecastMetaInserts(workspaceToStatements(withoutHistory()))).toBe(0);
    expect(forecastMetaInserts(tenantWorkspaceToStatements(withoutHistory(), PROJECT_ID))).toBe(0);
    expect(singleRoundTrip(withoutHistory()).forecastHistory).toBeUndefined();
    expect(tenantRoundTrip(withoutHistory()).forecastHistory).toBeUndefined();
  });

  it("IndexedDB: clearing it deletes the stored value, so it cannot reload stale", async () => {
    const backend = new BrowserBackend();
    backend.forceNextSave();
    await backend.save({ ...emptyWorkspace(), tasks: [task], forecastHistory: history() });
    expect((await readBack()).forecastHistory).toEqual(history()); // positive control
    await backend.save({ ...emptyWorkspace(), tasks: [task], forecastHistory: [] });
    expect((await readBack()).forecastHistory).toBeUndefined();
  });
});

describe("forecastHistory through the storage hook (§502)", () => {
  async function settle(result: { current: { workspaceLoaded: boolean } }) {
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await new Promise((r) => setTimeout(r, 700));
  }

  it("fires a save when forecastHistory is the ONLY thing that changed (`outgoing` + deps)", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task] });
    const { result } = renderBackend();
    await settle(result);
    expect((await readBack()).forecastHistory).toBeUndefined();

    act(() => {
      result.current.setForecastHistory(history());
    });

    await waitFor(async () => {
      expect((await readBack()).forecastHistory).toEqual(history());
    }, { timeout: 5000 });
  });

  it("loads a stored forecastHistory into workspace state", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task], forecastHistory: history() });
    const { result } = renderBackend();
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await waitFor(() => expect(result.current.forecastHistory).toEqual(history()));
  });

  it("registers a `forecastHistory` broadcast-sync channel", () => {
    renderBackend();
    const kinds = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(kinds).toContain("budgetHistory"); // positive control: the spy records channels at all
    expect(kinds).toContain("forecastHistory");
  });
});
