// e2e/turso-ddl-probe-live.spec.ts
//
// §211 and §637 against a REAL Turso database: the pre-`idKind` DDL rejects a
// text id, a separate-`execute` pipeline commits around that failure, and
// `runTursoPipeline`'s one-batch transaction writes nothing. Moved out of
// `documents-images-interactive.spec.ts` because it DROPS `document_assets`, which
// is not partition-scoped: every project's asset metadata in the database goes.
//
// ★★★ IT RUNS ONLY IN THE `live-turso-destructive` PROJECT (`playwright.config.ts`),
// which runs its files one at a time (`workers: 1`), and which the `chromium`
// project ignores, so `npm run e2e` never runs it beside the specs that use the
// same throwaway database. It also skips unless `E2E_LIVE_DESTRUCTIVE=1`, which
// only `npm run e2e:live-destructive` sets (with `PLAYWRIGHT_NO_WEBSERVER=1`, as it
// needs no app server), so a bare `npx playwright test` running every project at
// once does not run it either.
//
// ★★★ It reads only the throwaway pair (`live-turso-env.ts`) and skips unless both
// values are set. Credentials are never printed.

import { test, expect } from "@playwright/test";
import { colDdl, ENTITY_SPECS, TABLE_NAMES } from "../src/app/turso-schema";
import { runTursoPipeline } from "../src/app/turso-pipeline";
import {
  THROWAWAY, LIVE, PIPELINE_URL, SKIP_NO_THROWAWAY, DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN,
  rawPipeline as pipeline, txt,
} from "./live-turso-env";

/** The throwaway pair: `live-turso-env.ts`. */
const ENV = THROWAWAY;

// ── §211: the idKind landmine, against a real SQLite engine ─────────────────
//
// ★★★ DELIBERATELY BREAKS A TABLE. It drops and recreates `document_assets` on
// the throwaway database, and `afterAll` DROPS it again (after a failing test
// too). It does not re-create it: the single-project shape it would build has no
// `project_id`, and the tenant-layout specs sharing this database would then fail
// on it, since the app's `CREATE TABLE IF NOT EXISTS` cannot reshape a table that
// exists. Whatever loads next creates it in its own layout.
//
// ★★★ WHY NO UNIT TEST CAN REACH THIS, WHICH IS THE WHOLE POINT.
// `colDdl` renders any column named `id` as `id INTEGER PRIMARY KEY` unless the
// spec declares `idKind: "text"` — a rowid alias, the ONE column type SQLite
// actually enforces. `DocumentAsset` is the first entity whose id is a
// `crypto.randomUUID()`, and `insertStmt` binds it as `{type:"text"}`. Against
// the pre-`idKind` DDL a real engine answers `datatype mismatch`; against
// `entity-persistence-registry.test.ts`, which MATCHES DDL STRINGS and never
// executes a statement, nothing happens at all. Only an engine can tell those
// two apart.
//
// ★★ THE HONEST SCOPE OF WHAT THIS REPRODUCES. It proves the ENGINE half: the
// bad DDL rejects the insert, and the batch KEEPS GOING — COMMIT still runs, so
// a co-resident write in the same batch SURVIVES. That is what the assertion
// below measures, and an earlier revision of this very comment claimed the
// opposite ("the transaction never commits, so a co-resident write is lost"),
// contradicting the test 120 lines beneath it. It does NOT drive the app into
// that state,
// because the workspace save only emits these statements when
// `settings.storageConfig.kind === "turso"`, and `e2e/seed.ts` seeds the
// BROWSER backend — asset METADATA rides IndexedDB there while only the BYTES
// go to Turso. Reproducing "every subsequent workspace save fails" through the
// UI needs a Turso-STORAGE workspace, which is a different seed. Stated rather
// than blurred.
test.describe("§211 — a text id against the pre-idKind DDL", () => {
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(!DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN);

  /** A co-resident write, standing in for the tasks/RAID/milestone inserts that
   *  share the workspace save's single transaction. Its survival is the
   *  observable separating "one row was rejected" from "the whole save was
   *  lost". */
  const MARKER_DDL = "CREATE TABLE IF NOT EXISTS e2e_probe_marker (id TEXT PRIMARY KEY, note TEXT)";

  /** The app's OWN spec and builders, imported rather than restated, so this
   *  probe cannot drift from the DDL production actually emits. */
  const assetSpec = ENTITY_SPECS.find((s) => s.table === "document_assets")!;

  /** Mirrors `insertStmt`'s binding rule for `idKind: "text"` — every column
   *  bound as TEXT, id included. That binding is the thing under test. */
  const assetInsertArgs = (id: string) =>
    assetSpec.columns.map((c) => txt(c === "id" ? id : c === "name" ? "probe.png" : ""));

  const assetInsertSql = () =>
    `INSERT INTO document_assets (${assetSpec.columns.map((c) => `"${c}"`).join(",")}) ` +
    `VALUES (${assetSpec.columns.map(() => "?").join(",")})`;

  /** One workspace-save-shaped transaction: a co-resident row plus one asset
   *  row, inside a single BEGIN…COMMIT. */
  const saveShapedTransaction = (note: string) =>
    pipeline([
      { sql: MARKER_DDL },
      { sql: "BEGIN" },
      { sql: "INSERT OR REPLACE INTO e2e_probe_marker (id, note) VALUES (?, ?)", args: [txt("m1"), txt(note)] },
      { sql: assetInsertSql(), args: assetInsertArgs("11111111-2222-3333-4444-555555555555") },
      { sql: "COMMIT" },
    ]);

  async function markerNote(): Promise<string | null> {
    const results = await pipeline([
      { sql: MARKER_DDL },
      { sql: "SELECT note FROM e2e_probe_marker WHERE id = ?", args: [txt("m1")] },
    ]);
    const rows = results[1]?.response?.result?.rows ?? [];
    return rows.length ? (rows[0][0]?.value ?? null) : null;
  }

  test.afterAll(async () => {
    if (!LIVE) return;
    // No probe leftovers, and no `document_assets` in either layout's shape (header).
    await pipeline([
      { sql: "DROP TABLE IF EXISTS e2e_probe_marker" },
      { sql: "DROP TABLE IF EXISTS document_assets" },
    ]).catch((err: unknown) => {
      console.warn(`§211 cleanup failed (${err instanceof Error ? err.name : typeof err})`);
    });
  });

  test("the spec declares a text id, and the bytes table stays out of TABLE_NAMES", async () => {
    // Two AGENTS.md claims checked against the code rather than restated: the
    // declaration that makes the DDL correct, and the exclusion that keeps a
    // workspace save's per-table DELETE sweep away from the image bytes.
    expect(assetSpec.idKind, "document_assets no longer declares a text id — §211 is live again").toBe("text");
    expect(TABLE_NAMES).toContain("document_assets");
    expect(
      TABLE_NAMES,
      "document_asset_data entered TABLE_NAMES — a workspace save would now wipe every image",
    ).not.toContain("document_asset_data");
  });

  test("the pre-idKind DDL rejects the insert — and the batch still COMMITS around it", async () => {
    await pipeline([
      { sql: "DROP TABLE IF EXISTS e2e_probe_marker" },
      { sql: "DROP TABLE IF EXISTS document_assets" },
      // The OLD shape, from the SAME builder with the default idKind — exactly
      // what production emitted before the fix, not an approximation of it.
      { sql: `CREATE TABLE document_assets (${colDdl(assetSpec.columns, "integer")})` },
    ]);

    const results = await saveShapedTransaction("before");
    const errors = results.map((r) => r?.error?.message ?? "").filter((m) => m !== "");

    // ── The §211 core, and it holds ─────────────────────────────────────────
    expect(
      errors.join(" | "),
      "a text id against `id INTEGER PRIMARY KEY` was accepted — SQLite's rowid-alias enforcement is " +
        "the only thing that makes idKind matter, so this probe is not reaching a real engine",
    ).toMatch(/datatype mismatch/i);

    // ── And here the measurement CONTRADICTS the documented mechanism ────────
    //
    // ★★★ `turso-schema.ts`'s own comment and AGENTS.md's `idKind` bullet both
    // say "COMMIT is never reached, and ONE such row stops the WHOLE workspace
    // from ever saving". Measured against this engine, the FIRST half is false
    // and that changes what the second half means. A libSQL `/v2/pipeline`
    // batch does NOT abort at a failing statement: it returns an error result
    // for that one and KEEPS EXECUTING, so the trailing COMMIT runs, returns
    // `ok`, and commits everything that succeeded. Reproduced standalone with
    // a two-table minimal case (`id INTEGER PRIMARY KEY` fed a text id inside
    // BEGIN…COMMIT): per-statement types came back
    // `ok, ok, error(datatype mismatch), ok` and the co-resident row was
    // readable afterwards over a fresh connection.
    //
    // ★★★ THE REAL FAILURE MODE WAS WORSE THAN THE DOCUMENTED ONE, not milder.
    // Until §637, `runTursoPipeline` scanned the results, saw the error, called
    // `rollbackBestEffort` — which ran against a transaction that had ALREADY
    // COMMITTED, so it changed nothing — and threw. The user is shown
    // a failed save while the workspace was in fact written, minus the one
    // rejected row. "Every save reports failure" is right; "nothing is saved"
    // is not, and a reader who believes the latter will not go looking for the
    // partially-written data.
    //
    // ★★ This assertion therefore pins the MEASURED behaviour, deliberately not
    // the documented one. If it ever goes red because the marker is absent, the
    // engine (or the pipeline protocol) started aborting batches at the first
    // error — at which point the docs became right and this comment is what
    // needs deleting.
    //
    // ★★★ §637: this is the ENGINE's behaviour for separate `execute`
    // requests, which this probe's raw `pipeline` helper still sends. The app no
    // longer does: `runTursoPipeline` sends a BEGIN…COMMIT list as one
    // conditional batch, which the next test pins.
    expect(
      await markerNote(),
      "the co-resident write did NOT survive — this engine aborted the batch at the failing " +
        "statement. That would make turso-schema.ts's 'COMMIT is never reached' correct and this " +
        "test's premise stale; re-measure and rewrite both.",
    ).toBe("before");
  });

  test("§637 — the same transaction through runTursoPipeline writes nothing, and reports the failure", async () => {
    await pipeline([
      { sql: "DROP TABLE IF EXISTS e2e_probe_marker" },
      { sql: MARKER_DDL },
      { sql: "DROP TABLE IF EXISTS document_assets" },
      { sql: `CREATE TABLE document_assets (${colDdl(assetSpec.columns, "integer")})` },
    ]);
    const config = { httpUrl: PIPELINE_URL.replace(/\/v2\/pipeline$/, ""), authToken: ENV.token };

    await expect(
      runTursoPipeline(config, [
        { sql: "BEGIN" },
        { sql: "INSERT OR REPLACE INTO e2e_probe_marker (id, note) VALUES (?, ?)", args: [txt("m1"), txt("atomic")] },
        { sql: assetInsertSql(), args: assetInsertArgs("11111111-2222-3333-4444-555555555555") },
        { sql: "COMMIT" },
      ]),
    ).rejects.toThrow(/datatype mismatch/i);
    expect(
      await markerNote(),
      "the co-resident write survived a failed runTursoPipeline save — the batch committed around " +
        "the rejected row again (§637)",
    ).toBeNull();
  });

  test("dropping the table is a real remedy — the same transaction then commits", async () => {
    // The documented repair. `turso-migrate.ts` self-heals a MISSING COLUMN by
    // PRAGMA-diff plus ALTER ADD COLUMN, but a wrong TYPE on the primary key is
    // not something ALTER can fix, so the table has to go.
    await pipeline([
      { sql: "DROP TABLE IF EXISTS document_assets" },
      { sql: `CREATE TABLE document_assets (${colDdl(assetSpec.columns, assetSpec.idKind)})` },
    ]);

    const results = await saveShapedTransaction("after");
    const errors = results.map((r) => r?.error?.message ?? "").filter((m) => m !== "");
    expect(errors, "the corrected DDL still rejected the insert").toEqual([]);
    expect(
      await markerNote(),
      "the transaction reported no error but the co-resident write is still missing",
    ).toBe("after");
  });
});
