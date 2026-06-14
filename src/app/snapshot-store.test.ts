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
  currency: "EUR", milestones: [], series: [],
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

describe("snapshot-store", () => {
  it("appendSnapshot prepends DDL then the append statements", async () => {
    const fetchMock = okFetch(20);
    await appendSnapshot(cfg, rec, "p1");
    const sqls = bodySqls(fetchMock);
    expect(sqls.some((s) => /CREATE TABLE IF NOT EXISTS snapshot/.test(s))).toBe(true);
    expect(sqls).toContain("BEGIN");
    expect(sqls).toContain("COMMIT");
  });

  it("loadSnapshots decodes the SELECT results into records", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { type: "ok" }, { type: "ok" }, // 2 DDL
        { type: "ok", response: { type: "execute", result: {
          cols: ["id","captured_at","bucket","cadence","trigger","is_baseline","remaining_hours","remaining_cost","pct_complete","forecast_end_date","plan_end_date","spi","cpi","overall_rag","schedule_rag","budget_rag","scope_rag","currency","milestones_json"].map((name) => ({ name })),
          rows: [["a","a","2026-W23","weekly","auto","1","","","10","2026-07-31","2026-07-31","","","G","","","","EUR","[]"].map((value) => ({ value }))],
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
