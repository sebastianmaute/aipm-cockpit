// e2e/chat-threads-owner-guard-live.spec.ts
//
// The `chat_threads` owner guard (`chat_threads_owner_required`, in `CHAT_THREADS_DDL`) against a REAL
// libSQL/Turso database. The unit tests run it on node:sqlite; this checks that the server accepts the
// trigger (`CREATE TRIGGER IF NOT EXISTS`, `RAISE(ABORT, …)`) and refuses what the previous release
// sends: an owner-less `INSERT OR REPLACE`, which would otherwise add a plain-text chat every
// colleague could read, or replace an encrypted one.
//
// ★★★ DROPS `chat_threads` on the throwaway database (every saved chat there goes), so it runs only
// in the `live-turso-destructive` project (`playwright.config.ts`), via `npm run e2e:live-destructive`,
// and skips without the throwaway pair (`live-turso-env.ts`). `afterAll` drops the table again; the
// app recreates it on first use. Credentials are never printed.
import { test, expect } from "@playwright/test";
import { runTursoPipeline } from "../src/app/turso-pipeline";
import { rowObjects, type SqlStmt } from "../src/app/turso-schema";
import { CHAT_THREADS_DDL, upsertThreadStatements, type StoredThreadRow } from "../src/app/chat-threads-schema";
import {
  THROWAWAY, LIVE, SKIP_NO_THROWAWAY, DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN, pipelineBase, txt,
} from "./live-turso-env";

const CONFIG = { httpUrl: pipelineBase(THROWAWAY.url), authToken: THROWAWAY.token };
const DDL: SqlStmt[] = CHAT_THREADS_DDL.map((sql) => ({ sql }));

/** The previous release's save: owner-less plain text, replacing any row with the same id. */
const previousReleaseInsert = (id: string): SqlStmt => ({
  sql: "INSERT OR REPLACE INTO chat_threads (id,project_id,name,created_at,updated_at,history_json,display_json) VALUES (?,?,?,?,?,?,?)",
  args: [txt(id), txt("probe"), txt("Plain"), txt("2026-11-01T00:00:00.000Z"), txt("2026-11-01T00:00:00.000Z"), txt("[]"), txt("[]")],
});

/** An owned row as the app stores it (the sealed columns are opaque text to the database). */
const owned = (id: string): StoredThreadRow => ({
  id, project_id: "probe", owner_id: "owner-probe", name: "c2.n", created_at: "", updated_at: "",
  history_json: "c2.h", display_json: "c2.d", key_owner: "c2.k", key_operator: "r1.k",
});

async function rows(): Promise<Record<string, string>[]> {
  const [res] = await runTursoPipeline(CONFIG, [{ sql: "SELECT * FROM chat_threads ORDER BY id" }]);
  return rowObjects(res);
}

test.describe("chat_threads owner guard on libSQL", () => {
  // The second test reads the table the first one built.
  test.describe.configure({ mode: "serial" });
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(!DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN);

  test.afterAll(async () => {
    if (!LIVE) return;
    await runTursoPipeline(CONFIG, [{ sql: "DROP TABLE IF EXISTS chat_threads" }]).catch((err: unknown) => {
      console.warn(`chat_threads cleanup failed (${err instanceof Error ? err.name : typeof err})`);
    });
  });

  test("the DDL creates the guard, refuses the previous release's inserts, and lets an owned write through", async () => {
    await runTursoPipeline(CONFIG, [{ sql: "DROP TABLE IF EXISTS chat_threads" }]);
    await runTursoPipeline(CONFIG, DDL);
    const [triggers] = await runTursoPipeline(CONFIG, [
      { sql: "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'chat_threads'" },
    ]);
    expect(rowObjects(triggers).map((r) => r.name)).toEqual(["chat_threads_owner_required"]);

    // (c) The app's own owned upsert succeeds.
    await runTursoPipeline(CONFIG, upsertThreadStatements(owned("t-owned")));
    const before = await rows();
    expect(before.map((r) => [r.id, r.owner_id])).toEqual([["t-owned", "owner-probe"]]);

    // (a) A new id from the previous release is refused, and no row is written.
    await expect(runTursoPipeline(CONFIG, [previousReleaseInsert("t-new")])).rejects.toThrow(/owner required/);
    // (b) The same against the owned row's id is refused, and the owned row is unchanged.
    await expect(runTursoPipeline(CONFIG, [previousReleaseInsert("t-owned")])).rejects.toThrow(/owner required/);
    expect(await rows()).toEqual(before);
  });

  test("running the DDL again is a no-op: one trigger, rows untouched", async () => {
    const before = await rows();
    await runTursoPipeline(CONFIG, DDL);
    const [triggers] = await runTursoPipeline(CONFIG, [
      { sql: "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'chat_threads'" },
    ]);
    expect(rowObjects(triggers).map((r) => r.name)).toEqual(["chat_threads_owner_required"]);
    expect(await rows()).toEqual(before);
  });
});
