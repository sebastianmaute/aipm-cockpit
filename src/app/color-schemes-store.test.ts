import { describe, it, expect, vi, beforeEach } from "vitest";
import { TABLE_NAMES } from "./turso-schema";

const runTursoPipeline = vi.fn();
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: (...a: unknown[]) => runTursoPipeline(...a) }));

import {
  COLOR_SCHEMES_TABLE, loadSchemesAsync, saveSchemesAsync, rowsToSchemes,
} from "./color-schemes-store";
import type { ColorScheme } from "./color-schemes";

const CFG = { databaseUrl: "libsql://x", authToken: "t" } as never;
const scheme = (id: string): ColorScheme => ({
  id, name: id, supportsDark: false, light: { "--AIPM-green": "#4d7000" }, branding: {},
});

beforeEach(() => {
  runTursoPipeline.mockReset();
  localStorage.clear();
});

describe("color-schemes-store", () => {
  it("keeps color_schemes OUT of TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain(COLOR_SCHEMES_TABLE);
    expect(TABLE_NAMES).not.toContain("color_schemes");
  });

  it("no config → reads/writes localStorage only, no pipeline", async () => {
    await saveSchemesAsync(null, [scheme("u-1")]);
    expect(runTursoPipeline).not.toHaveBeenCalled();
    const back = await loadSchemesAsync(null);
    expect(runTursoPipeline).not.toHaveBeenCalled();
    expect(back.map((s) => s.id)).toEqual(["u-1"]);
  });

  it("config → save emits DDL + DELETE + INSERT per scheme with string args", async () => {
    runTursoPipeline.mockResolvedValue([]);
    await saveSchemesAsync(CFG, [scheme("u-1"), scheme("u-2")]);
    const stmts = runTursoPipeline.mock.calls[0][1] as { sql: string; args?: { value: string }[] }[];
    expect(stmts[0].sql).toContain("CREATE TABLE IF NOT EXISTS color_schemes");
    expect(stmts.some((s) => s.sql.startsWith("DELETE FROM color_schemes"))).toBe(true);
    const inserts = stmts.filter((s) => s.sql.startsWith("INSERT INTO color_schemes"));
    expect(inserts).toHaveLength(2);
    expect(typeof inserts[0].args?.[0].value).toBe("string");
  });

  it("config → load decodes rows, skips unparseable", async () => {
    runTursoPipeline.mockResolvedValue([
      undefined,
      { response: { result: { cols: [{ name: "id" }, { name: "data" }], rows: [
        [{ value: "u-1" }, { value: JSON.stringify(scheme("u-1")) }],
        [{ value: "u-2" }, { value: "{not json" }],
      ] } } },
    ]);
    const out = await loadSchemesAsync(CFG);
    expect(out.map((s) => s.id)).toEqual(["u-1"]);
  });

  it("migration: local user schemes pushed to DB only when DB empty", async () => {
    localStorage.setItem("lop-app:color-schemes", JSON.stringify({ schemes: [scheme("u-1")], activeId: "u-1" }));
    // first pipeline call = load (empty rows), second = migration save
    runTursoPipeline
      .mockResolvedValueOnce([undefined, { response: { result: { cols: [{ name: "id" }, { name: "data" }], rows: [] } } }])
      .mockResolvedValueOnce([]);
    const out = await loadSchemesAsync(CFG);
    expect(out.map((s) => s.id)).toEqual(["u-1"]); // returned the migrated local set
    expect(runTursoPipeline).toHaveBeenCalledTimes(2); // load + migration save
  });
});

describe("rowsToSchemes", () => {
  it("returns [] for undefined result", () => {
    expect(rowsToSchemes(undefined)).toEqual([]);
  });
});
