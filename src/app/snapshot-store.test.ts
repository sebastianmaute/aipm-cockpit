import { afterEach, describe, expect, it, vi } from "vitest";
import { appendSnapshot, deleteSnapshot, deleteSnapshots, loadSnapshots, setBaseline } from "./snapshot-store";
import type { TursoConfig } from "./turso-config";
import type { SnapshotRecord } from "./snapshot";

const cfg: TursoConfig = { httpUrl: "https://db.example.com", authToken: "tok" };

const rec: SnapshotRecord = {
  id: "2026-06-03T09:00:00.000Z", capturedAt: "2026-06-03T09:00:00.000Z",
  bucket: "2026-W23", cadence: "weekly", trigger: "manual", isBaseline: false,
  remainingHours: 60, remainingCost: 6000, pctComplete: 25,
  forecastEndDate: "2026-09-15", planEndDate: "2026-07-31", spi: 0.8, cpi: 1.1,
  overallRag: "A", scheduleRag: "R", budgetRag: "A", scopeRag: "",
  milestones: [], series: [], bucketProgress: [],
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function okFetch(n: number) {
  const results = Array.from({ length: n }, () => ({ type: "ok" }));
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodySqls(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): string[] {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
  const body = JSON.parse(init.body as string);
  return body.requests.map((r: { stmt: { sql: string } }) => r.stmt.sql);
}

/** A PRAGMA table_info result naming `names`, in libSQL's wire shape. */
function pragmaResult(names: readonly string[]) {
  return {
    type: "ok",
    response: { type: "execute", result: {
      cols: ["cid", "name", "type", "notnull", "dflt_value", "pk"].map((name) => ({ name })),
      rows: names.map((n, i) => [String(i), n, "TEXT", "0", null, "0"].map((value) => ({ value }))),
    } },
  };
}

// The snapshot table as created before `bucket_progress_json` existed.
const OLD_SNAPSHOT_COLS = [
  "id", "captured_at", "bucket", "cadence", "trigger", "is_baseline",
  "remaining_hours", "remaining_cost", "pct_complete", "forecast_end_date",
  "plan_end_date", "spi", "cpi", "overall_rag", "schedule_rag", "budget_rag",
  "scope_rag", "currency", "milestones_json", "project_id",
];

/** Two responses in order: DDL×2 + PRAGMA, then the ensure+insert pipeline. */
function appendFetch(existing: readonly string[]) {
  const responses = [
    { results: [{ type: "ok" }, { type: "ok" }, pragmaResult(existing)] },
    { results: Array.from({ length: 20 }, () => ({ type: "ok" })) },
  ];
  let call = 0;
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses[call++]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("snapshot-store", () => {
  it("appendSnapshot reads the table's columns in a DDL pipeline BEFORE inserting", async () => {
    const fetchMock = appendFetch([...OLD_SNAPSHOT_COLS, "bucket_progress_json"]);
    await appendSnapshot(cfg, rec, "p1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = bodySqls(fetchMock, 0);
    expect(first.some((s) => /CREATE TABLE IF NOT EXISTS snapshot/.test(s))).toBe(true);
    expect(first[first.length - 1]).toBe("PRAGMA table_info(\"snapshot\")");
    expect(first).not.toContain("BEGIN");
    const second = bodySqls(fetchMock, 1);
    expect(second[0]).toBe("BEGIN");
    expect(second).toContain("COMMIT");
    expect(second.some((s) => /^ALTER/.test(s))).toBe(false);
  });

  // ★★ A libSQL pipeline does NOT abort at a failing statement, so an INSERT
  // naming a column the table lacks would fail alone while COMMIT still ran.
  // The ALTER must therefore precede the INSERT — inside the transaction, since
  // runTursoPipeline only rolls back a batch whose FIRST statement is BEGIN.
  it("appendSnapshot adds a missing bucket_progress_json column ahead of the insert", async () => {
    const fetchMock = appendFetch(OLD_SNAPSHOT_COLS);
    await appendSnapshot(cfg, rec, "p1");
    const second = bodySqls(fetchMock, 1);
    expect(second[0]).toBe("BEGIN");
    expect(second[1]).toBe("ALTER TABLE \"snapshot\" ADD COLUMN \"bucket_progress_json\" TEXT");
    expect(second.some((s) => /INSERT INTO snapshot \(.*bucket_progress_json/.test(s))).toBe(true);
  });

  it("loadSnapshots decodes the SELECT results into records", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { type: "ok" }, { type: "ok" }, // 2 DDL
        { type: "ok", response: { type: "execute", result: {
          cols: ["id","captured_at","bucket","cadence","trigger","is_baseline","remaining_hours","remaining_cost","pct_complete","forecast_end_date","plan_end_date","spi","cpi","overall_rag","schedule_rag","budget_rag","scope_rag","milestones_json"].map((name) => ({ name })),
          rows: [["a","a","2026-W23","weekly","auto","1","","","10","2026-07-31","2026-07-31","","","G","","","","[]"].map((value) => ({ value }))],
        } } },
        { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await loadSnapshots(cfg, "p1");
    expect(out).toHaveLength(1);
    expect(out[0].isBaseline).toBe(true);
    expect(out[0].pctComplete).toBe(10);
  });

  it("setBaseline + deleteSnapshot send their statements after the DDL", async () => {
    const fetchMock = okFetch(20);
    await setBaseline(cfg, "a", "p1");
    await deleteSnapshot(cfg, "a", "p1");
    expect(bodySqls(fetchMock, 0).some((s) => /is_baseline='1'/.test(s))).toBe(true);
    expect(bodySqls(fetchMock, 1).some((s) => /DELETE FROM snapshot WHERE id/.test(s))).toBe(true);
  });

  it("loadSnapshots issues project-scoped selects", async () => {
    const fetchMock = okFetch(4);
    await loadSnapshots(cfg, "p1");
    const sqls = bodySqls(fetchMock);
    expect(sqls.some((s) => /WHERE project_id = \?/.test(s))).toBe(true);
  });

  it("setBaseline forwards projectId (scoped clear of is_baseline)", async () => {
    const fetchMock = okFetch(20);
    await setBaseline(cfg, "s1", "p1");
    const sqls = bodySqls(fetchMock);
    expect(sqls.some((s) => /is_baseline='0' WHERE project_id = \?/.test(s))).toBe(true);
  });

  it("deleteSnapshots runs ONE pipeline containing a DELETE for each id", async () => {
    const fetchMock = okFetch(20);
    await deleteSnapshots(cfg, ["id-a", "id-b", "id-c"], "p1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sqls = bodySqls(fetchMock, 0);
    expect(sqls.some((s) => /CREATE TABLE IF NOT EXISTS snapshot/.test(s))).toBe(true);
    const deleteSqls = sqls.filter((s) => /DELETE FROM snapshot WHERE id/.test(s));
    expect(deleteSqls).toHaveLength(3);
  });

  it("deleteSnapshots is a no-op when ids is empty (no pipeline call)", async () => {
    const fetchMock = okFetch(20);
    await deleteSnapshots(cfg, [], "p1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
