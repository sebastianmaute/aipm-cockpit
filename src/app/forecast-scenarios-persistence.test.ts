// forecastScenarios (§502) across ALL SIX write paths, one `it` per path.
//
// ★★ `Workspace.forecastScenarios` is a META-BLOB slice — no `ENTITY_SPECS` row,
// so it buys nothing for free and each path is hand-written. The Turso TENANT
// writer is the one a previous meta-blob slice (`activityLog`) missed, caught
// only in review; it gets its own `it` here so a miss is a named red test.
//
// Turso is exercised through the REAL engine (`node:sqlite`), the way
// `turso-schema.execute.test.ts` does — string-matching the generated SQL cannot
// see a row that is written but never read back. The IndexedDB round-trips call
// `BrowserBackend` directly over `fake-indexeddb`; the last describe then drives
// the storage HOOK, the way `forecast-history-persistence.test.ts` does, because
// the backend alone cannot see the hook's wiring — the slice is OPTIONAL on
// `Workspace`: dropping it from `outgoing`, the save deps or `applyWorkspaceFromLoad`
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
import type { ForecastScenario } from "./forecast-scenarios";
import { peekMintId, resetMintState } from "./id-mint-session";
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

const PROJECT_ID = "proj-scenarios-1";

/** One scenario holding all three change kinds and both `who` shapes, plus a bare one. */
function scenarios(): readonly ForecastScenario[] {
  return [
    {
      id: 3,
      name: "Hire two contractors",
      changes: [
        { kind: "availability", percent: 80, from: "2026-11-02", until: "2026-12-18" },
        { kind: "addPeople", who: { resourceId: 7, hoursPerWeek: 20 }, from: "2026-11-09", until: "", rampWeeks: 2 },
        {
          kind: "addPeople",
          who: { label: "Contractor", count: 2, rate: 95, currency: "EUR", hoursPerWeek: 40 },
          from: "2026-11-16", until: "2027-01-29", rampWeeks: 4,
        },
        { kind: "scope", tasks: 12, on: "2026-11-20", milestoneId: 5 },
        { kind: "scope", tasks: -3, on: "2026-12-01" },
      ],
    },
    { id: 9, name: "Baseline", changes: [] },
  ];
}

const withScenarios = (): Workspace => ({ ...emptyWorkspace(), forecastScenarios: scenarios() });
const withoutScenarios = (): Workspace => ({ ...emptyWorkspace(), forecastScenarios: [] });

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

/** How many statements INSERT a meta row keyed `forecastScenarios`. */
const scenarioMetaInserts = (statements: readonly SqlStmt[]): number =>
  statements.filter((s) => /^INSERT INTO meta /.test(s.sql) && s.args?.[0]?.value === "forecastScenarios").length;

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
  const { setTasks, forecastScenarios, setForecastScenarios } = useWorkspace();
  return { ...backend, setTasks, forecastScenarios, setForecastScenarios };
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

describe("forecastScenarios round-trips on every write path (§502)", () => {
  it("JSON", () => {
    expect(jsonToWorkspace(workspaceToJson(withScenarios())).forecastScenarios).toEqual(scenarios());
  });

  it("CSV", () => {
    expect(csvToWorkspace(workspaceToCsv(withScenarios())).forecastScenarios).toEqual(scenarios());
  });

  it("Markdown", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(withScenarios())).forecastScenarios).toEqual(scenarios());
  });

  it("Turso single-tenant", () => {
    expect(singleRoundTrip(withScenarios()).forecastScenarios).toEqual(scenarios());
  });

  it("Turso tenant", () => {
    expect(tenantRoundTrip(withScenarios()).forecastScenarios).toEqual(scenarios());
  });

  it("IndexedDB", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task], forecastScenarios: scenarios() });
    expect((await readBack()).forecastScenarios).toEqual(scenarios());
  });
});

describe("a workspace without forecastScenarios writes nothing for it (§502)", () => {
  it("JSON: no key", () => {
    expect(JSON.parse(workspaceToJson(withScenarios()))).toHaveProperty("forecastScenarios"); // positive control
    expect(JSON.parse(workspaceToJson(withoutScenarios()))).not.toHaveProperty("forecastScenarios");
  });

  it("CSV: no section — byte-identical to the empty workspace", () => {
    expect(workspaceToCsv(withScenarios())).not.toBe(workspaceToCsv(emptyWorkspace())); // positive control
    expect(workspaceToCsv(withoutScenarios())).toBe(workspaceToCsv(emptyWorkspace()));
  });

  it("Markdown: no section — byte-identical to the empty workspace", () => {
    expect(workspaceToMarkdown(withScenarios())).not.toBe(workspaceToMarkdown(emptyWorkspace())); // positive control
    expect(workspaceToMarkdown(withoutScenarios())).toBe(workspaceToMarkdown(emptyWorkspace()));
  });

  it("Turso single-tenant and tenant: no meta row", () => {
    expect(scenarioMetaInserts(workspaceToStatements(withScenarios()))).toBe(1); // positive control
    expect(scenarioMetaInserts(tenantWorkspaceToStatements(withScenarios(), PROJECT_ID))).toBe(1);
    expect(scenarioMetaInserts(workspaceToStatements(withoutScenarios()))).toBe(0);
    expect(scenarioMetaInserts(tenantWorkspaceToStatements(withoutScenarios(), PROJECT_ID))).toBe(0);
    expect(singleRoundTrip(withoutScenarios()).forecastScenarios).toBeUndefined();
    expect(tenantRoundTrip(withoutScenarios()).forecastScenarios).toBeUndefined();
  });

  it("IndexedDB: clearing it deletes the stored value, so it cannot reload stale", async () => {
    const backend = new BrowserBackend();
    backend.forceNextSave();
    await backend.save({ ...emptyWorkspace(), tasks: [task], forecastScenarios: scenarios() });
    expect((await readBack()).forecastScenarios).toEqual(scenarios()); // positive control
    await backend.save({ ...emptyWorkspace(), tasks: [task], forecastScenarios: [] });
    expect((await readBack()).forecastScenarios).toBeUndefined();
  });
});

describe("forecastScenarios through the storage hook (§502)", () => {
  async function settle(result: { current: { workspaceLoaded: boolean } }) {
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await new Promise((r) => setTimeout(r, 700));
  }

  it("fires a save when forecastScenarios is the ONLY thing that changed (`outgoing` + deps)", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task] });
    const { result } = renderBackend();
    await settle(result);
    expect((await readBack()).forecastScenarios).toBeUndefined();

    act(() => {
      result.current.setForecastScenarios(scenarios());
    });

    await waitFor(async () => {
      expect((await readBack()).forecastScenarios).toEqual(scenarios());
    }, { timeout: 5000 });
  });

  it("loads stored scenarios into workspace state", async () => {
    await forcedSave({ ...emptyWorkspace(), tasks: [task], forecastScenarios: scenarios() });
    const { result } = renderBackend();
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await waitFor(() => expect(result.current.forecastScenarios).toEqual(scenarios()));
  });

  it("registers a `forecastScenarios` broadcast-sync channel", () => {
    renderBackend();
    const kinds = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(kinds).toContain("forecastHistory"); // positive control: the spy records channels at all
    expect(kinds).toContain("forecastScenarios");
  });

  it("a load REPLACES the scenarios (a project switch never carries them over)", async () => {
    // A same-project reload applies with logMode "merge" — the mode that keeps the local activity log.
    // Scenarios must be replaced even there, so a stored workspace without them empties the list.
    await forcedSave({ ...emptyWorkspace(), tasks: [task], forecastScenarios: scenarios() });
    const { result } = renderBackend();
    await settle(result);
    expect(result.current.forecastScenarios).toEqual(scenarios()); // positive control: the first load applied them

    await forcedSave({ ...emptyWorkspace(), tasks: [task] });
    await act(async () => { await result.current.reloadCurrentProject(); });

    expect(result.current.forecastScenarios).toEqual([]);
  });

  it("a loaded workspace seeds the scenario id minter, so the next mint is above its largest id", async () => {
    resetMintState();
    expect(peekMintId("forecastScenario", [])).toBe(1); // control: nothing seeded yet
    await forcedSave({ ...emptyWorkspace(), tasks: [task], forecastScenarios: scenarios() });
    const { result } = renderBackend();
    await waitFor(() => expect(result.current.forecastScenarios).toEqual(scenarios()));
    expect(peekMintId("forecastScenario", [])).toBe(10); // largest stored id is 9
  });
});
