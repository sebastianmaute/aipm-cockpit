// src/app/storage.documentlinks.backends.test.ts
//
// Round-trip tests proving knowledgeLinks survives the BrowserBackend (IndexedDB)
// and Turso single-tenant statement save→load paths.
//
// Multi-tenant path: the existing turso-tenant-schema.test.ts already confirms
// the DDL column exists for every TABLE_NAMES entry (incl. tasks). The
// single-tenant path below is sufficient as a round-trip guard because
// tenantWorkspaceToStatements delegates to the same TASK_CSV_COLUMNS constant
// and encodeKnowledgeLinks codec, so if the single-tenant path passes the
// multi-tenant serialisation is also correct.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createBackend, emptyWorkspace } from "./storage";
import {
  TABLE_NAMES,
  workspaceToStatements,
  rowsToWorkspace,
  type PipelineResultLike,
} from "./turso-schema";
import type { KnowledgeLink } from "./document-link";

// Fixture – the canonical two-link shape used across Tasks 3-9.
const links: KnowledgeLink[] = [
  { id: "01", name: "Spec", url: "https://c.sharepoint.com/x", kind: "file" },
  { id: "02", name: "Folder", url: "https://c.sharepoint.com/y", kind: "folder" },
];

// ---------------------------------------------------------------------------
// Turso single-tenant helpers (mirror turso-schema.test.ts)
// ---------------------------------------------------------------------------
function resultsFromStatements(
  stmts: { sql: string; args?: { value?: string }[] }[],
): PipelineResultLike[] {
  const byTable: Record<string, { cols: string[]; rows: { value: string }[][] }> = {};
  for (const s of stmts) {
    const m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES/.exec(s.sql);
    if (!m) continue;
    const table = m[1];
    const cols = m[2].split(", ").map((c) => c.replace(/"/g, ""));
    (byTable[table] ??= { cols, rows: [] }).rows.push(
      (s.args ?? []).map((a) => ({ value: a.value ?? "" })),
    );
  }
  return TABLE_NAMES.map((t) => ({
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols: (byTable[t]?.cols ?? []).map((name) => ({ name })),
        rows: byTable[t]?.rows ?? [],
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// BrowserBackend (IndexedDB) round-trip
// ---------------------------------------------------------------------------
describe("BrowserBackend knowledgeLinks round-trip", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("Task.knowledgeLinks survives save → load", async () => {
    const ws = {
      ...emptyWorkspace(),
      tasks: [
        {
          id: 1,
          taskName: "Linked task",
          assignee: "Alice",
          assigneeEmail: "",
          dueDate: "2026-07-01",
          lastUpdateDate: "2026-07-01",
          status: "To Do" as const,
          priority: "Medium" as const,
          blockers: "",
          description: "",
          labels: [],
          dependencies: [],
          knowledgeLinks: links,
        },
      ],
    };

    await createBackend({ kind: "browser" }).save(ws);
    const loaded = await createBackend({ kind: "browser" }).load();

    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0].knowledgeLinks).toEqual(links);
  });
});

// ---------------------------------------------------------------------------
// Turso single-tenant round-trip
// ---------------------------------------------------------------------------
describe("Turso single-tenant knowledgeLinks round-trip", () => {
  it("Task.knowledgeLinks survives workspaceToStatements → rowsToWorkspace", () => {
    const ws = {
      ...emptyWorkspace(),
      tasks: [
        {
          id: 1,
          taskName: "Linked task",
          assignee: "Alice",
          assigneeEmail: "",
          dueDate: "2026-07-01",
          lastUpdateDate: "2026-07-01",
          status: "To Do" as const,
          priority: "Medium" as const,
          blockers: "",
          description: "",
          labels: [],
          dependencies: [],
          knowledgeLinks: links,
        },
      ],
    };

    const out = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));

    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].knowledgeLinks).toEqual(links);
  });
});
