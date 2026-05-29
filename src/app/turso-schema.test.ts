import { describe, it, expect } from "vitest";
import { SCHEMA_DDL, TABLE_NAMES, selectStatements } from "./turso-schema";

describe("turso-schema DDL", () => {
  it("creates a table per entity + plan, fx_rates, meta", () => {
    const joined = SCHEMA_DDL.join("\n");
    for (const t of ["tasks", "raid", "absences", "shifts", "resources", "roles", "disciplines", "grades", "budget_buckets", "plan", "fx_rates", "meta"]) {
      expect(joined).toContain(`CREATE TABLE IF NOT EXISTS ${t} `);
    }
    expect(joined).toContain("id INTEGER PRIMARY KEY");
  });
  it("selectStatements is one SELECT per table in TABLE_NAMES order", () => {
    expect(selectStatements().map((s) => s.sql)).toEqual(TABLE_NAMES.map((t) => `SELECT * FROM ${t}`));
  });
});
