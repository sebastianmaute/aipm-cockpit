// src/app/operating-guide-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  OPERATING_GUIDE_DDL, upsertStatements, deleteStatements, rowsToGuides,
} from "./operating-guide-schema";
import { TABLE_NAMES } from "./turso-schema";
import type { OperatingGuide } from "./operating-guide";

const g: OperatingGuide = {
  id: "x", name: "N", content: "C", enabled: true, priority: 3,
  scope: { modes: ["advanced"] }, builtIn: false,
};

describe("operating_guides schema", () => {
  it("is OUT of TABLE_NAMES (workspace save must never wipe it)", () => {
    expect(TABLE_NAMES).not.toContain("operating_guides");
  });
  it("DDL creates the table if not exists", () => {
    expect(OPERATING_GUIDE_DDL[0]).toMatch(/CREATE TABLE IF NOT EXISTS operating_guides/);
  });
  it("upsert serializes scope as JSON and booleans/ints as strings", () => {
    const [stmt] = upsertStatements(g);
    const vals = (stmt.args ?? []).map((a) => a.value);
    expect(vals).toContain(JSON.stringify(g.scope));
    expect(vals).toContain("1"); // enabled -> "1"
    expect(vals).toContain("3"); // priority -> "3"
  });
  it("delete targets by id", () => {
    expect(deleteStatements("x")[0].sql).toMatch(/DELETE FROM operating_guides WHERE id = \?/);
  });
  it("rowsToGuides round-trips a stored row", () => {
    const res = {
      type: "ok" as const,
      response: { type: "resultsOk", result: {
        cols: [{ name: "id" }, { name: "name" }, { name: "content" }, { name: "enabled" },
                { name: "priority" }, { name: "scope" }, { name: "built_in" }],
        rows: [[{ value: "x" }, { value: "N" }, { value: "C" }, { value: "1" },
                { value: "3" }, { value: JSON.stringify({ modes: ["advanced"] }) }, { value: "0" }]],
      } },
    };
    const out = rowsToGuides(res);
    expect(out[0]).toMatchObject({ id: "x", name: "N", content: "C", enabled: true, priority: 3, builtIn: false });
    expect(out[0].scope).toEqual({ modes: ["advanced"] });
  });
});
