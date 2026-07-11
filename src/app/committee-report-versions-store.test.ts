import { describe, it, expect, vi } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { saveVersion, loadVersions, deleteVersion } from "./committee-report-versions-store";
import { TABLE_NAMES } from "./turso-schema";

const cfg = {} as never;
const v = { id: "r-v-1", projectId: "p", meetingId: 3, html: "<p>b</p>", isAuto: false, capturedAt: "t" } as const;

describe("committee-report-versions-store", () => {
  it("committee_report_versions is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("committee_report_versions");
  });
  it("saveVersion prepends DDL and inserts the row", async () => {
    await saveVersion(cfg, v as never);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS committee_report_versions/i.test(s.sql))).toBe(true);
    const insert = stmts.find((s: { sql: string }) => /INSERT INTO committee_report_versions/i.test(s.sql));
    expect(insert).toBeTruthy();
    expect(insert.args.map((a: { value: string }) => a.value)).toEqual(["r-v-1", "p", "3", "<p>b</p>", "0", "t"]);
  });
  it("deleteVersion prepends DDL and deletes by id", async () => {
    await deleteVersion(cfg, "r-v-1");
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS committee_report_versions/i.test(s.sql))).toBe(true);
    const del = stmts.find((s: { sql: string }) => /DELETE FROM committee_report_versions WHERE id = \?/i.test(s.sql));
    expect(del).toBeTruthy();
    expect(del.args[0].value).toBe("r-v-1");
  });
  it("loadVersions selects by project + meeting, newest-first, and decodes rows", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" },
      { type: "ok", response: { type: "execute", result: {
        cols: [{ name: "id" }, { name: "project_id" }, { name: "meeting_id" }, { name: "html" }, { name: "is_auto" }, { name: "captured_at" }],
        rows: [
          [{ value: "r-v-2" }, { value: "p" }, { value: "3" }, { value: "<p>b2</p>" }, { value: "1" }, { value: "t2" }],
          [{ value: "r-v-1" }, { value: "p" }, { value: "3" }, { value: "<p>b1</p>" }, { value: "0" }, { value: "t1" }],
        ],
      } } },
    ]);
    const out = await loadVersions(cfg, "p", 3);
    const select = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]
      .find((s: { sql: string }) => /SELECT \* FROM committee_report_versions/i.test(s.sql));
    expect(select.sql).toMatch(/WHERE project_id = \? AND meeting_id = \? ORDER BY captured_at DESC/i);
    expect(select.args.map((a: { value: string }) => a.value)).toEqual(["p", "3"]);
    expect(out).toEqual([
      { id: "r-v-2", projectId: "p", meetingId: 3, html: "<p>b2</p>", isAuto: true, capturedAt: "t2" },
      { id: "r-v-1", projectId: "p", meetingId: 3, html: "<p>b1</p>", isAuto: false, capturedAt: "t1" },
    ]);
  });
});
