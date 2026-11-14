// e2e/chat-threads-erasure-live.spec.ts
//
// The `chat_threads` erasure and retention statements against a REAL libSQL/Turso database: deleting
// one thread, deleting every thread of one owner, the per-owner cap (prune), retention expiry, the
// project hard-delete sweep and the per-owner select behind "find chats mentioning a person". The
// unit tests run the same builders on node:sqlite (`chat-threads-schema.execute.test.ts`); this
// checks that the server removes and returns exactly the same rows. Every expected id list below
// is the one that file pins, or follows from the SQL quoted beside it.
//
// ★★★ DROPS `chat_threads` on the throwaway database (every saved chat there goes), so it runs only
// in the `live-turso-destructive` project (`playwright.config.ts`), via `npm run e2e:live-destructive`,
// and skips without the throwaway pair (`live-turso-env.ts`). `afterAll` drops the table again; the
// app recreates it on first use. Credentials are never printed.
//
// ★★ The project sweep also runs the create-if-missing DDL of every other project side table and a
// DELETE for this spec's fake project id in each: the tables it creates are left in place (empty,
// app-shaped), and no row of a real project is touched.
import { test, expect } from "@playwright/test";
import { runTursoPipeline } from "../src/app/turso-pipeline";
import { rowObjects, type SqlStmt } from "../src/app/turso-schema";
import {
  CHAT_THREADS_DDL, upsertThreadStatements, deleteThreadStatements, deleteOwnerThreadsStatements,
  pruneThreadsStatements, expireThreadsStatements, retentionCutoff, ownerThreadsSelect, type StoredThreadRow,
} from "../src/app/chat-threads-schema";
import { projectSideTableSweepStatements } from "../src/app/project-side-tables";
import {
  THROWAWAY, LIVE, SKIP_NO_THROWAWAY, DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN, pipelineBase, txt,
} from "./live-turso-env";

const CONFIG = { httpUrl: pipelineBase(THROWAWAY.url), authToken: THROWAWAY.token };
const DDL: SqlStmt[] = CHAT_THREADS_DDL.map((sql) => ({ sql }));

const P = "erasure-live-project-p";
const Q = "erasure-live-project-q";
const A = "erasure-live-owner-a";
const B = "erasure-live-owner-b";
const HOUR_MS = 3_600_000;

/** An owned row as the app stores it (the sealed columns are opaque text to the database). */
const owned = (id: string, projectId: string, ownerId: string): StoredThreadRow => ({
  id, project_id: projectId, owner_id: ownerId, name: "c2.n", created_at: "", updated_at: "",
  history_json: "c2.h", display_json: "c2.d", key_owner: "c2.k", key_operator: "r1.k",
});

/** Seed one owned row through the app's own upsert. The upsert dates every write with the DATABASE
 *  clock (`CHAT_DB_NOW`) and ignores the row's `updated_at`, so a row that needs an age (prune order,
 *  expiry) gets it from a second, explicit UPDATE, bound as text like every other argument. The owner
 *  guard only fires on INSERT, so the UPDATE is allowed; this mirrors the unit tests' `seed`. */
function seedRow(id: string, projectId: string, ownerId: string, updatedAt?: string): SqlStmt[] {
  const stmts = upsertThreadStatements(owned(id, projectId, ownerId));
  if (updatedAt === undefined) return stmts;
  return [...stmts, { sql: "UPDATE chat_threads SET updated_at = ? WHERE id = ?", args: [txt(updatedAt), txt(id)] }];
}

/** The owner a legacy fixture is written under before it is made owner-less. */
const SEED_OWNER = "erasure-live-owner-seed";

/** Seed one LEGACY owner-less row, the way a row from before the owner guard looks. The guard
 *  (`chat_threads_owner_required` in `CHAT_THREADS_DDL`) is `BEFORE INSERT` only, so the row is
 *  written owned through the upsert and then made owner-less by an UPDATE — `''` or a real SQL NULL,
 *  the two forms `LEGACY_OWNER` matches. This mirrors the unit tests' `seed` (owner `''`) and
 *  `insertNullOwner` (owner NULL) in `chat-threads-schema.execute.test.ts`. */
function seedLegacy(id: string, projectId: string, owner: "" | null, updatedAt?: string): SqlStmt[] {
  const blank = owner === null ? "NULL" : "''";
  return [
    ...seedRow(id, projectId, SEED_OWNER, updatedAt),
    { sql: `UPDATE chat_threads SET owner_id = ${blank} WHERE id = ?`, args: [txt(id)] },
  ];
}

async function run(stmts: SqlStmt[]): Promise<void> {
  await runTursoPipeline(CONFIG, stmts);
}

async function ids(): Promise<string[]> {
  const [res] = await runTursoPipeline(CONFIG, [{ sql: "SELECT id FROM chat_threads ORDER BY id" }]);
  return rowObjects(res).map((r) => r.id);
}

const id = (suffix: string) => `erasure-live-${suffix}`;

test.describe("chat_threads erasure and retention on libSQL", () => {
  // Every test shares the one table and empties it first.
  test.describe.configure({ mode: "serial" });
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(!DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN);

  test.beforeAll(async () => {
    if (!LIVE || !DESTRUCTIVE_RUN) return;
    await run([{ sql: "DROP TABLE IF EXISTS chat_threads" }]);
    await run(DDL);
  });

  test.beforeEach(async () => {
    await run([{ sql: "DELETE FROM chat_threads" }]);
  });

  test.afterAll(async () => {
    if (!LIVE || !DESTRUCTIVE_RUN) return;
    await runTursoPipeline(CONFIG, [{ sql: "DROP TABLE IF EXISTS chat_threads" }]).catch((err: unknown) => {
      console.warn(`chat_threads cleanup failed (${err instanceof Error ? err.name : typeof err})`);
    });
  });

  // Unit pin: "delete is scoped to the owner: bob cannot delete alice's row, but can delete a legacy
  // one". `id` is the table's PRIMARY KEY, so one id cannot be stored under two owners: owner scoping
  // is shown by the other owner's delete of a row, and the project scoping by a delete naming the
  // wrong project. SQL: `DELETE … WHERE id = ? AND project_id = ? AND (owner_id = ? OR <legacy>)`.
  test("deleting one thread removes only that owner's row", async () => {
    await run([
      ...seedRow(id("del-a-p"), P, A),
      ...seedRow(id("del-a-q"), Q, A),
      ...seedRow(id("del-b-p"), P, B),
    ]);
    await run(deleteThreadStatements(id("del-b-p"), P, A));
    await run(deleteThreadStatements(id("del-a-p"), Q, A));
    expect(await ids()).toEqual([id("del-a-p"), id("del-a-q"), id("del-b-p")]);
    await run(deleteThreadStatements(id("del-a-p"), P, A));
    expect(await ids()).toEqual([id("del-a-q"), id("del-b-p")]);
  });

  // Unit pin, mirrored step for step: "delete is scoped to the owner: bob cannot delete alice's row,
  // but can delete a legacy one" — rows a (alice), n (NULL owner), e ('' owner), all in project p.
  // SQL: `DELETE … WHERE id = ? AND project_id = ? AND (owner_id = ? OR owner_id IS NULL OR owner_id = '')`,
  // so another owner's delete takes both legacy rows and leaves the owned one, and the owner's own
  // delete naming the wrong project takes nothing.
  test("deleting one thread can take a legacy owner-less row", async () => {
    await run([
      ...seedRow(id("leg-del-a"), P, A),
      ...seedLegacy(id("leg-del-n"), P, null),
      ...seedLegacy(id("leg-del-e"), P, ""),
    ]);
    expect(await ids()).toEqual([id("leg-del-a"), id("leg-del-e"), id("leg-del-n")]);
    await run(deleteThreadStatements(id("leg-del-a"), P, B));
    await run(deleteThreadStatements(id("leg-del-n"), P, B));
    await run(deleteThreadStatements(id("leg-del-e"), P, B));
    expect(await ids()).toEqual([id("leg-del-a")]);
    await run(deleteThreadStatements(id("leg-del-a"), Q, A));
    expect(await ids()).toEqual([id("leg-del-a")]);
    await run(deleteThreadStatements(id("leg-del-a"), P, A));
    expect(await ids()).toEqual([]);
  });

  // Unit pin: "deleteOwnerThreads removes one owner's rows in every project and nothing else".
  // SQL: `DELETE FROM chat_threads WHERE owner_id = ?`.
  test("delete all my chats removes every thread of one owner across projects", async () => {
    await run([
      ...seedRow(id("all-a-p"), P, A),
      ...seedRow(id("all-a-q"), Q, A),
      ...seedRow(id("all-b-p"), P, B),
      ...seedRow(id("all-b-q"), Q, B),
    ]);
    expect(await ids()).toEqual([id("all-a-p"), id("all-a-q"), id("all-b-p"), id("all-b-q")]);
    await run(deleteOwnerThreadsStatements(A));
    expect(await ids()).toEqual([id("all-b-p"), id("all-b-q")]);
  });

  // Unit pin: "prune keeps the newest 50 per owner and never deletes another owner's rows" (55 rows
  // there; 52 here, so exactly the two oldest go). SQL: delete the project+owner rows NOT IN the
  // newest `keep` by `updated_at DESC, id DESC`. Distinct ages come from the explicit UPDATE in
  // `seedRow`; owner B's rows are OLDER than all of A's, so a prune that ignored the owner would
  // take them first. As in the unit test, a legacy NULL-owner row older than every other row stays:
  // the owner prune names `owner_id = ?`, which an owner-less row never matches.
  test("prune keeps the newest 50 threads per owner", async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
    const pad = (i: number) => String(i).padStart(2, "0");
    const aP = Array.from({ length: 52 }, (_, i) => id(`prune-a-p-${pad(i)}`));
    const bP = Array.from({ length: 3 }, (_, i) => id(`prune-b-p-${i}`));
    const aQ = Array.from({ length: 10 }, (_, i) => id(`prune-a-q-${pad(i)}`));
    const legacy = id("prune-legacy");
    await run([
      ...aP.flatMap((rowId, i) => seedRow(rowId, P, A, at(1000 + i))),
      ...bP.flatMap((rowId, i) => seedRow(rowId, P, B, at(i))),
      ...aQ.flatMap((rowId, i) => seedRow(rowId, Q, A, at(500 + i))),
      ...seedLegacy(legacy, P, null, at(-1000)),
    ]);

    // Ten threads, under the cap of 50: nothing is deleted.
    await run(pruneThreadsStatements(Q, A, 50));
    expect(await ids()).toEqual([...aP, ...aQ, ...bP, legacy].sort());

    // 52 threads: the two oldest of A in P go; B's three, A's ten in Q and the legacy row stay.
    await run(pruneThreadsStatements(P, A, 50));
    expect(await ids()).toEqual([...aP.slice(2), ...aQ, ...bP, legacy].sort());
  });

  // Unit pin, mirrored with the same rows and relative ages: "prune of the legacy group touches only
  // owner-less rows" — n1 (NULL, 5 days old), n2 (NULL, 1 day), e1 ('', 9 days), a (owner A, 99 days),
  // pruned to 1. SQL (`ownerId` null): delete the project's `owner_id IS NULL OR owner_id = ''` rows
  // NOT IN the newest one by `updated_at DESC, id DESC`. So n2 alone of the three legacy rows stays,
  // and a stays although it is the oldest row of all.
  test("prune of the legacy group touches only owner-less rows", async () => {
    const base = Date.parse("2026-06-01T00:00:00.000Z");
    const daysBefore = (n: number) => new Date(base - n * 86_400_000).toISOString();
    await run([
      ...seedLegacy(id("leg-prune-n1"), P, null, daysBefore(5)),
      ...seedLegacy(id("leg-prune-n2"), P, null, daysBefore(1)),
      ...seedLegacy(id("leg-prune-e1"), P, "", daysBefore(9)),
      ...seedRow(id("leg-prune-a"), P, A, daysBefore(99)),
    ]);
    expect(await ids()).toEqual([id("leg-prune-a"), id("leg-prune-e1"), id("leg-prune-n1"), id("leg-prune-n2")]);
    await run(pruneThreadsStatements(P, null, 1));
    expect(await ids()).toEqual([id("leg-prune-a"), id("leg-prune-n2")]);
  });

  // Unit pins: "expire deletes a row 31 days old at 30, keeps one 29 days old, and deletes NULL or
  // empty updated_at" and "expire scoped to a project leaves other projects alone". `retentionCutoff`
  // only places the rows here. SQL: `updated_at < strftime(…,'now','-30 days')`
  // — a STRICT comparison against the DATABASE clock at the moment the DELETE runs.
  // ★ No unit test pins a row EXACTLY at the cutoff, and none can be pinned here: `retentionCutoff`
  // is the CLIENT clock (display only), the DELETE reads the server's, and the two differ by the
  // runner-to-server skew plus the time between the calls. So the boundary rows sit one hour either
  // side of `retentionCutoff(now, 30)` — the same side of the strict `<` as the unit test's 31 and 29
  // days, with an hour's tolerance for that skew.
  test("retention expiry deletes threads older than the cutoff", async () => {
    const days = 30;
    const now = new Date();
    const cutoff = retentionCutoff(now, days);
    const before = new Date(Date.parse(cutoff) - HOUR_MS).toISOString();
    const after = new Date(Date.parse(cutoff) + HOUR_MS).toISOString();
    await run([
      ...seedRow(id("exp-p-before"), P, A, before),
      ...seedRow(id("exp-p-after"), P, A, after),
      ...seedRow(id("exp-p-blank"), P, B, ""),
      // Dated by the database clock on write: today.
      ...seedRow(id("exp-p-stamped"), P, B),
      ...seedRow(id("exp-q-before"), Q, A, before),
    ]);
    expect(await ids()).toEqual([
      id("exp-p-after"), id("exp-p-before"), id("exp-p-blank"), id("exp-p-stamped"), id("exp-q-before"),
    ]);

    // One project: its stale and undated rows go; the other project's stale row stays.
    await run(expireThreadsStatements(days, P));
    expect(await ids()).toEqual([id("exp-p-after"), id("exp-p-stamped"), id("exp-q-before")]);

    // No project: every project.
    await run(expireThreadsStatements(days));
    expect(await ids()).toEqual([id("exp-p-after"), id("exp-p-stamped")]);
  });

  // Unit pin, mirrored with the same three rows: "expire deletes a date more than a day in the future by
  // the database clock, and keeps one an hour ahead" — far (now + 2 days), year9999, soon (now + 1 hour).
  // SQL: `updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now', '+1 days')`, by the DATABASE clock, so far
  // and year9999 go and soon stays. The dates are placed by the CLIENT clock: far is deleted while the
  // server is less than a day behind the runner, and soon kept while it is less than 23 hours ahead —
  // the same tolerance shape as the retention test above, only wider.
  test("retention expiry deletes threads dated more than a day in the future", async () => {
    const now = Date.now();
    await run([
      ...seedRow(id("fut-far"), P, A, new Date(now + 2 * 24 * HOUR_MS).toISOString()),
      ...seedRow(id("fut-year9999"), P, A, "9999-01-01T00:00:00.000Z"),
      ...seedRow(id("fut-soon"), P, A, new Date(now + HOUR_MS).toISOString()),
    ]);
    expect(await ids()).toEqual([id("fut-far"), id("fut-soon"), id("fut-year9999")]);
    await run(expireThreadsStatements(30));
    expect(await ids()).toEqual([id("fut-soon")]);
  });

  // `projectSideTableSweepStatements` ends with `DELETE FROM chat_threads WHERE project_id = ?`
  // (the `chat_threads` entry of `PROJECT_SCOPED_SIDE_TABLES`), whoever owns the row.
  test("the project hard-delete sweep removes the project's chat threads", async () => {
    await run([
      ...seedRow(id("sweep-a-p"), P, A),
      ...seedRow(id("sweep-b-p"), P, B),
      ...seedRow(id("sweep-a-q"), Q, A),
    ]);
    expect(await ids()).toEqual([id("sweep-a-p"), id("sweep-a-q"), id("sweep-b-p")]);
    await run(projectSideTableSweepStatements(P));
    expect(await ids()).toEqual([id("sweep-a-q")]);
  });

  // Unit pin: "ownerThreadsSelect returns one owner's rows in every project, and no legacy or other
  // owner's row". SQL: `SELECT * … WHERE owner_id = ? ORDER BY updated_at DESC`, so the order is
  // asserted too. The matching on names is client-side and stays unit-tested.
  test("an owner's threads are selectable for find and erase", async () => {
    await run([
      ...seedRow(id("sel-a-p"), P, A, "2026-02-01T00:00:00.000Z"),
      ...seedRow(id("sel-a-q"), Q, A, "2026-03-01T00:00:00.000Z"),
      ...seedRow(id("sel-b-p"), P, B, "2026-04-01T00:00:00.000Z"),
    ]);
    const [res] = await runTursoPipeline(CONFIG, ownerThreadsSelect(A));
    expect(rowObjects(res).map((r) => [r.id, r.project_id, r.owner_id])).toEqual([
      [id("sel-a-q"), Q, A],
      [id("sel-a-p"), P, A],
    ]);
  });
});
