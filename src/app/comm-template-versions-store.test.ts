import { describe, it, expect, vi } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { saveVersion, loadVersions } from "./comm-template-versions-store";
import { TABLE_NAMES } from "./turso-schema";

const cfg = {} as never;
const v = { id: "x-v-1", templateId: "x", name: "v1", body: "<p>b</p>", isAuto: false, createdAt: "t" } as const;

describe("comm-template-versions-store", () => {
  it("comm_template_versions is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("comm_template_versions");
  });
  it("saveVersion prepends DDL and inserts the row", async () => {
    await saveVersion(cfg, v as never);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS comm_template_versions/i.test(s.sql))).toBe(true);
    expect(stmts.some((s: { sql: string }) => /INSERT INTO comm_template_versions/i.test(s.sql))).toBe(true);
  });
  it("loadVersions decodes rows after the DDL, ordered as returned", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" },
      { type: "ok", response: { type: "execute", result: {
        cols: [{ name: "id" }, { name: "template_id" }, { name: "name" }, { name: "body" }, { name: "is_auto" }, { name: "created_at" }],
        rows: [[{ value: "x-v-1" }, { value: "x" }, { value: "v1" }, { value: "<p>b</p>" }, { value: "1" }, { value: "t" }]],
      } } },
    ]);
    const out = await loadVersions(cfg, "x");
    expect(out).toEqual([{ id: "x-v-1", templateId: "x", name: "v1", body: "<p>b</p>", isAuto: true, createdAt: "t" }]);
  });
});
