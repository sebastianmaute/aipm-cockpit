import { describe, it, expect, vi } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { upsertTemplate, deleteTemplate, setDefaultTemplate, loadTemplates } from "./comm-templates-store";
import { TABLE_NAMES } from "./turso-schema";

const cfg = {} as never;
const tpl = { id: "x", category: "status-inquiry", name: "N", body: "<p>b</p>", isDefault: true, createdAt: "t", updatedAt: "t" } as const;

describe("comm-templates-store", () => {
  it("comm_templates is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("comm_templates");
  });
  it("upsert prepends DDL and writes the row", async () => {
    await upsertTemplate(cfg, tpl as never);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS comm_templates/i.test(s.sql))).toBe(true);
    expect(stmts.some((s: { sql: string }) => /INSERT INTO comm_templates/i.test(s.sql))).toBe(true);
  });
  it("setDefault clears the category then sets one in a single pipeline", async () => {
    await setDefaultTemplate(cfg, "status-inquiry", "x");
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /UPDATE comm_templates SET is_default ?= ?0/i.test(s.sql))).toBe(true);
    expect(stmts.some((s: { sql: string }) => /is_default ?= ?1/i.test(s.sql))).toBe(true);
  });
  it("loadTemplates decodes rows after the DDL", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" }, // DDL result (1 DDL statement)
      { type: "ok", response: { type: "execute", result: {
        cols: [{ name: "id" }, { name: "category" }, { name: "name" }, { name: "body" }, { name: "is_default" }, { name: "created_at" }, { name: "updated_at" }],
        rows: [[{ value: "x" }, { value: "status-inquiry" }, { value: "N" }, { value: "<p>b</p>" }, { value: "1" }, { value: "t" }, { value: "t" }]],
      } } },
    ]);
    const out = await loadTemplates(cfg);
    expect(out).toEqual([{ id: "x", category: "status-inquiry", name: "N", body: "<p>b</p>", isDefault: true, createdAt: "t", updatedAt: "t" }]);
  });
});
