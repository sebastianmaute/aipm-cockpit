import { describe, it, expect, vi, beforeEach } from "vitest";
import { TABLE_NAMES } from "./turso-schema";

const runTursoPipeline = vi.fn();
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: (...a: unknown[]) => runTursoPipeline(...a) }));

import {
  COLOR_SCHEMES_TABLE,
  loadSchemesAsync,
  upsertSchemeAsync,
  deleteSchemeAsync,
  rowsToSchemes,
} from "./color-schemes-store";
import type { ColorScheme } from "./color-schemes";

const CFG = { httpUrl: "https://x", authToken: "t" } as never;
const scheme = (id: string): ColorScheme => ({
  id, name: id, supportsDark: false, light: { "--ui-green": "#4d7000" }, branding: {},
});
type Stmt = { sql: string; args?: { value: string }[] };
const stmtsOf = (call: number): Stmt[] => runTursoPipeline.mock.calls[call][1] as Stmt[];
const hasWipe = (stmts: Stmt[]) =>
  stmts.some((s) => s.sql.trim().startsWith("DELETE FROM color_schemes") && !s.sql.includes("WHERE"));

beforeEach(() => {
  runTursoPipeline.mockReset();
  localStorage.clear();
});

describe("color-schemes-store", () => {
  it("keeps color_schemes OUT of TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain(COLOR_SCHEMES_TABLE);
    expect(TABLE_NAMES).not.toContain("color_schemes");
  });

  it("no config → load reads localStorage, upsert/delete no-op, no pipeline", async () => {
    localStorage.setItem(
      "aipm-cockpit:color-schemes",
      JSON.stringify({ schemes: [scheme("u-1")], activeId: "u-1" }),
    );
    const back = await loadSchemesAsync(null);
    await upsertSchemeAsync(null, scheme("u-2"));
    await deleteSchemeAsync(null, "u-1");
    expect(runTursoPipeline).not.toHaveBeenCalled();
    expect(back.map((s) => s.id)).toEqual(["u-1"]);
  });

  it("config → upsertSchemeAsync emits INSERT OR REPLACE with string args, no full-table wipe", async () => {
    runTursoPipeline.mockResolvedValue([]);
    await upsertSchemeAsync(CFG, scheme("u-1"));
    const stmts = stmtsOf(0);
    expect(stmts[0].sql).toContain("CREATE TABLE IF NOT EXISTS color_schemes");
    const ins = stmts.find((s) => s.sql.includes("INSERT OR REPLACE INTO color_schemes"))!;
    expect(ins).toBeTruthy();
    expect(typeof ins.args?.[0].value).toBe("string");
    expect(hasWipe(stmts)).toBe(false);
  });

  it("config → deleteSchemeAsync targets one id (WHERE id), never a wipe", async () => {
    runTursoPipeline.mockResolvedValue([]);
    await deleteSchemeAsync(CFG, "u-3");
    const del = stmtsOf(0).find((s) => s.sql.startsWith("DELETE FROM color_schemes"))!;
    expect(del.sql).toContain("WHERE id = ?");
    expect(del.args?.[0].value).toBe("u-3");
  });

  it("built-in scheme is never persisted", async () => {
    await upsertSchemeAsync(CFG, { ...scheme("harbor"), builtIn: true });
    expect(runTursoPipeline).not.toHaveBeenCalled();
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

  it("migration MERGES local-only schemes into a NON-empty DB (additive, dedupe by id)", async () => {
    localStorage.setItem(
      "aipm-cockpit:color-schemes",
      JSON.stringify({ schemes: [scheme("u-1"), scheme("u-2")], activeId: "u-1" }),
    );
    runTursoPipeline
      .mockResolvedValueOnce([
        undefined,
        { response: { result: { cols: [{ name: "id" }, { name: "data" }], rows: [
          [{ value: "u-1" }, { value: JSON.stringify(scheme("u-1")) }],
        ] } } },
      ])
      .mockResolvedValueOnce([]); // upsert of the local-only u-2
    const out = await loadSchemesAsync(CFG);
    expect(out.map((s) => s.id).sort()).toEqual(["u-1", "u-2"]);
    const migrate = stmtsOf(1);
    expect(migrate.some((s) => s.sql.includes("INSERT OR REPLACE INTO color_schemes"))).toBe(true);
    expect(hasWipe(migrate)).toBe(false); // additive, never wipes other devices' rows
  });

  it("no local-only schemes → no migration write, returns the DB set", async () => {
    localStorage.setItem(
      "aipm-cockpit:color-schemes",
      JSON.stringify({ schemes: [scheme("u-1")], activeId: "u-1" }),
    );
    runTursoPipeline.mockResolvedValueOnce([
      undefined,
      { response: { result: { cols: [{ name: "id" }, { name: "data" }], rows: [
        [{ value: "u-1" }, { value: JSON.stringify(scheme("u-1")) }],
      ] } } },
    ]);
    const out = await loadSchemesAsync(CFG);
    expect(out.map((s) => s.id)).toEqual(["u-1"]);
    expect(runTursoPipeline).toHaveBeenCalledTimes(1); // no migration write
  });
});

describe("color-schemes-store: shared-tenant DB hardening", () => {
  it("sanitizes a DB row — strips injection color tokens + SVG logo", async () => {
    const rogue = {
      id: "u-9",
      name: "Rogue",
      supportsDark: false,
      light: { "background-image": "url(https://evil/x.gif)", "--ui-green": "#4d7000" },
      branding: { logo: "data:image/svg+xml;base64,PHN2Zz4=" },
    };
    runTursoPipeline.mockResolvedValue([
      undefined,
      { response: { result: { cols: [{ name: "id" }, { name: "data" }], rows: [
        [{ value: "u-9" }, { value: JSON.stringify(rogue) }],
      ] } } },
    ]);
    const [out] = await loadSchemesAsync(CFG);
    expect(out.id).toBe("u-9");
    expect(out.light).not.toHaveProperty("background-image");
    expect(out.light["--ui-green"]).toBe("#4d7000");
    expect(out.branding.logo).toBeUndefined(); // SVG rejected by sanitizeBranding
  });
});

describe("rowsToSchemes", () => {
  it("returns [] for undefined result", () => {
    expect(rowsToSchemes(undefined)).toEqual([]);
  });
});
