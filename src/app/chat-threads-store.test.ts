// src/app/chat-threads-store.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { loadThreads, saveThread, deleteThread } from "./chat-threads-store";
import { TABLE_NAMES } from "./turso-schema";
import type { ChatThread } from "./chat-threads";

const cfg = {} as never;
const th: ChatThread = {
  id: "t1",
  projectId: "p",
  name: "Q1 budget",
  createdAt: "c",
  updatedAt: "u",
  history: [{ role: "user", content: "hi" }],
  display: [{ kind: "user", text: "hi" }],
};

describe("chat-threads-store", () => {
  it("chat_threads is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("chat_threads");
  });

  it("saveThread prepends DDL, upserts the row atomically, and prunes beyond the cap", async () => {
    await saveThread(cfg, th);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS chat_threads/i.test(s.sql))).toBe(true);

    const insert = stmts.find((s: { sql: string }) => /INSERT OR REPLACE INTO chat_threads/i.test(s.sql));
    expect(insert).toBeTruthy();
    expect(insert.args.map((a: { value: string }) => a.value)).toEqual([
      "t1", "p", "Q1 budget", "c", "u",
      JSON.stringify(th.history), JSON.stringify(th.display),
    ]);

    const prune = stmts.find((s: { sql: string }) => /DELETE FROM chat_threads WHERE project_id = \? AND id NOT IN/i.test(s.sql));
    expect(prune).toBeTruthy();
    expect(prune.args.map((a: { value: string }) => a.value)).toEqual(["p", "p", "50"]);
  });

  it("saveThread emits no standalone row-delete — the upsert must be one atomic statement", async () => {
    await saveThread(cfg, th);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    // A bare `DELETE ... WHERE id = ?` before the insert would reopen the data-loss
    // window: runTursoPipeline only opens a transaction when statement 1 is `BEGIN`,
    // so a failed insert after a successful delete would destroy the thread.
    expect(stmts.some((s: { sql: string }) => /^DELETE FROM chat_threads WHERE id = \?$/i.test(s.sql))).toBe(false);
  });

  it("deleteThread prepends DDL and deletes by id", async () => {
    await deleteThread(cfg, "t1");
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS chat_threads/i.test(s.sql))).toBe(true);
    const del = stmts.find((s: { sql: string }) => /DELETE FROM chat_threads WHERE id = \?/i.test(s.sql));
    expect(del).toBeTruthy();
    expect(del.args[0].value).toBe("t1");
  });

  it("loadThreads selects by project, newest-first, and decodes rows incl. JSON columns", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" },
      {
        type: "ok",
        response: {
          type: "execute",
          result: {
            cols: [
              { name: "id" }, { name: "project_id" }, { name: "name" },
              { name: "created_at" }, { name: "updated_at" },
              { name: "history_json" }, { name: "display_json" },
            ],
            rows: [
              [{ value: "t2" }, { value: "p" }, { value: "Later" }, { value: "c2" }, { value: "u2" }, { value: "[]" }, { value: "[]" }],
              [
                { value: "t1" }, { value: "p" }, { value: "Earlier" }, { value: "c1" }, { value: "u1" },
                { value: JSON.stringify(th.history) }, { value: JSON.stringify(th.display) },
              ],
            ],
          },
        },
      },
    ]);
    const out = await loadThreads(cfg, "p");
    const select = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]
      .find((s: { sql: string }) => /SELECT \* FROM chat_threads/i.test(s.sql));
    expect(select.sql).toMatch(/WHERE project_id = \? ORDER BY updated_at DESC/i);
    expect(select.args[0].value).toBe("p");
    expect(out).toEqual([
      { id: "t2", projectId: "p", name: "Later", createdAt: "c2", updatedAt: "u2", history: [], display: [] },
      { id: "t1", projectId: "p", name: "Earlier", createdAt: "c1", updatedAt: "u1", history: th.history, display: th.display },
    ]);
  });

  it("rowsToThreads falls back to [] for a malformed JSON column", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" },
      {
        type: "ok",
        response: {
          type: "execute",
          result: {
            cols: [
              { name: "id" }, { name: "project_id" }, { name: "name" },
              { name: "created_at" }, { name: "updated_at" },
              { name: "history_json" }, { name: "display_json" },
            ],
            rows: [[{ value: "t1" }, { value: "p" }, { value: "N" }, { value: "c" }, { value: "u" }, { value: "not json" }, { value: "[]" }]],
          },
        },
      },
    ]);
    const out = await loadThreads(cfg, "p");
    expect(out[0].history).toEqual([]);
    expect(out[0].display).toEqual([]);
  });
});
