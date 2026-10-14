// baselineHistory (§476) across ALL SIX write paths, one `it` per path.
//
// ★★ `Workspace.baselineHistory` is a META-BLOB slice — no `ENTITY_SPECS` row,
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
import type { BaselineEntry } from "./baseline-currency";
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

const PROJECT_ID = "proj-baseline-1";

function history(): readonly BaselineEntry[] {
  return [
    { from: "2026-01-05", at: "2026-01-05T08:00:00.000Z", currency: "GBP" },
    { from: "2026-03-02", at: "2026-03-02T09:30:00.000Z", currency: "USD", perPrevious: 1.3 },
  ];
}

const withHistory = (): Workspace => ({ ...emptyWorkspace(), baselineHistory: history() });
const withoutHistory = (): Workspace => ({ ...emptyWorkspace(), baselineHistory: [] });

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

/** How many statements INSERT a meta row keyed `baselineHistory`. */
const baselineMetaInserts = (statements: readonly SqlStmt[]): number =>
  statements.filter((s) => /^INSERT INTO meta /.test(s.sql) && s.args?.[0]?.value === "baselineHistory").length;

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
  const { setTasks, baselineHistory, setBaselineHistory } = useWorkspace();
  return { ...backend, setTasks, baselineHistory, setBaselineHistory };
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

describe("baselineHistory round-trips on every write path (§476)", () => {
  it("JSON", () => {
    expect(jsonToWorkspace(workspaceToJson(withHistory())).baselineHistory).toEqual(history());
  });

  it("CSV", () => {
    expect(csvToWorkspace(workspaceToCsv(withHistory())).baselineHistory).toEqual(history());
  });

  it("Markdown", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(withHistory())).baselineHistory).toEqual(history());
  });

  it("Turso single-tenant", () => {
    expect(singleRoundTrip(withHistory()).baselineHistory).toEqual(history());
  });

  it("Turso tenant", () => {
    expect(tenantRoundTrip(withHistory()).baselineHistory).toEqual(history());
  });

  it("IndexedDB", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task], baselineHistory: history() });
    expect((await readBack()).baselineHistory).toEqual(history());
  });
});

describe("a workspace without baselineHistory writes nothing for it (§476)", () => {
  it("JSON: no key", () => {
    expect(JSON.parse(workspaceToJson(withHistory()))).toHaveProperty("baselineHistory"); // positive control
    expect(JSON.parse(workspaceToJson(withoutHistory()))).not.toHaveProperty("baselineHistory");
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
    expect(baselineMetaInserts(workspaceToStatements(withHistory()))).toBe(1); // positive control
    expect(baselineMetaInserts(tenantWorkspaceToStatements(withHistory(), PROJECT_ID))).toBe(1);
    expect(baselineMetaInserts(workspaceToStatements(withoutHistory()))).toBe(0);
    expect(baselineMetaInserts(tenantWorkspaceToStatements(withoutHistory(), PROJECT_ID))).toBe(0);
    expect(singleRoundTrip(withoutHistory()).baselineHistory).toBeUndefined();
    expect(tenantRoundTrip(withoutHistory()).baselineHistory).toBeUndefined();
  });

  it("IndexedDB: clearing it deletes the stored value, so it cannot reload stale", async () => {
    const backend = new BrowserBackend();
    backend.forceNextSave();
    await backend.save({ ...emptyWorkspace(), tasks: [task], baselineHistory: history() });
    expect((await readBack()).baselineHistory).toEqual(history()); // positive control
    await backend.save({ ...emptyWorkspace(), tasks: [task], baselineHistory: [] });
    expect((await readBack()).baselineHistory).toBeUndefined();
  });
});

describe("baselineHistory through the storage hook (§476)", () => {
  async function settle(result: { current: { workspaceLoaded: boolean } }) {
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await new Promise((r) => setTimeout(r, 700));
  }

  it("fires a save when baselineHistory is the ONLY thing that changed (`outgoing` + deps)", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task] });
    const { result } = renderBackend();
    await settle(result);
    expect((await readBack()).baselineHistory).toBeUndefined();

    act(() => {
      result.current.setBaselineHistory(history());
    });

    await waitFor(async () => {
      expect((await readBack()).baselineHistory).toEqual(history());
    }, { timeout: 5000 });
  });

  it("loads a stored baselineHistory into workspace state", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task], baselineHistory: history() });
    const { result } = renderBackend();
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await waitFor(() => expect(result.current.baselineHistory).toEqual(history()));
  });

  it("registers a `baselineHistory` broadcast-sync channel", () => {
    renderBackend();
    const kinds = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(kinds).toContain("budgetHistory"); // positive control: the spy records channels at all
    expect(kinds).toContain("baselineHistory");
  });
});
