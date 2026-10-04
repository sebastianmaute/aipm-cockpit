import { describe, expect, it } from "vitest";
import { DOCX_SECTION_FIELDS, docxColumnWidths, docxSection } from "./export-docx-columns";
import { EXPORT_SECTION_FIELDS, type ExportSection } from "./export-sections";
import { EXPORT_SECTION_KEYS } from "./settings-types";

// open-followups §512 (a) — the Word export prints a curated set of columns per
// register, sized to their content, instead of every storage column at equal width.

function section(key: ExportSection["key"], rows: ExportSection["rows"]): ExportSection {
  const fields = EXPORT_SECTION_FIELDS[key];
  return { key, title: key, columns: fields.map((f) => `L:${f}`), rows };
}

describe("DOCX_SECTION_FIELDS", () => {
  it("names only fields the section really exports, each once", () => {
    for (const [key, fields = []] of Object.entries(DOCX_SECTION_FIELDS)) {
      const all = EXPORT_SECTION_FIELDS[key as ExportSection["key"]];
      for (const f of fields) expect(all, `${key}.${f}`).toContain(f);
      expect(new Set(fields).size, key).toBe(fields.length);
    }
  });

  it("drops the bookkeeping columns a reader of a Word document has no use for", () => {
    for (const fields of Object.values(DOCX_SECTION_FIELDS)) {
      if (!fields) continue;
      for (const f of ["localModifiedAt", "outlookEventId", "calendarOptOut", "knowledgeLinks", "lastSyncedAt"]) {
        expect(fields).not.toContain(f);
      }
    }
  });

  it("curates the wide registers and leaves the narrow ones whole", () => {
    expect(Object.keys(DOCX_SECTION_FIELDS).sort()).toEqual(
      ["absences", "budgets", "changes", "milestones", "raid", "resources", "roles", "shifts", "stakeholders", "tasks"],
    );
    // Every key a curated list could name is a real section key.
    for (const key of Object.keys(DOCX_SECTION_FIELDS)) expect(EXPORT_SECTION_KEYS).toContain(key);
  });
});

describe("docxSection", () => {
  it("keeps the curated columns in the curated order, with their labels and cells", () => {
    const fields = EXPORT_SECTION_FIELDS.milestones;
    const row = fields.map((f) => `v:${f}`);
    const out = docxSection(section("milestones", [row]));
    expect(out.columns).toEqual(DOCX_SECTION_FIELDS.milestones!.map((f) => `L:${f}`));
    expect(out.rows).toEqual([DOCX_SECTION_FIELDS.milestones!.map((f) => `v:${f}`)]);
    expect(out.columns.length).toBeLessThan(fields.length);
  });

  it("returns a section with no curated list unchanged", () => {
    const s = section("calendarEvents", [["a", "b", "c", "d"]]);
    expect(docxSection(s)).toBe(s);
  });

  it("prints a section not shaped like an exported one as given, rather than misaligned", () => {
    const s = { key: "tasks" as const, title: "Tasks", columns: ["Name", "Due"], rows: [["Kickoff", "2026-10-04"]] };
    expect(docxSection(s)).toBe(s);
  });

  it("does not modify the section it was given", () => {
    const s = section("tasks", [EXPORT_SECTION_FIELDS.tasks.map((f) => f)]);
    const before = JSON.stringify(s);
    docxSection(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// Post-merge review M2 — a role prints its discipline and grade NAMES, never their ids.
describe("docxSection — roles", () => {
  const refs = { disciplines: [{ id: 3, name: "Consulting" }], grades: [{ id: 2, name: "Senior" }], disciplineLabel: "Discipline", gradeLabel: "Grade" };
  const rolesRow = () => EXPORT_SECTION_FIELDS.roles.map((f) => (f === "disciplineId" ? "3" : f === "gradeId" ? "2" : f === "id" ? "17" : `v:${f}`));

  it("prints names under Discipline / Grade, and no internal role id", () => {
    const out = docxSection(section("roles", [rolesRow()]), refs);
    expect(out.columns.slice(0, 2)).toEqual(["Discipline", "Grade"]);
    expect(out.rows[0].slice(0, 2)).toEqual(["Consulting", "Senior"]);
    expect(out.columns).not.toContain("L:id");
    expect(out.rows[0]).not.toContain("17");
  });

  it("prints an id with no matching discipline or grade as stored", () => {
    const out = docxSection(section("roles", [rolesRow()]), { ...refs, grades: [] });
    expect(out.rows[0].slice(0, 2)).toEqual(["Consulting", "2"]);
  });

  it("leaves other sections alone when given the lookups", () => {
    const s = section("milestones", [EXPORT_SECTION_FIELDS.milestones.map((f) => `v:${f}`)]);
    expect(docxSection(s, refs)).toEqual(docxSection(s));
  });
});

describe("docxColumnWidths", () => {
  const WIDTH = 14400;

  it("sums to exactly the content width", () => {
    const widths = docxColumnWidths(["Id", "Name", "Description"], [["1", "Kickoff", "x".repeat(300)]], WIDTH);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(WIDTH);
  });

  it("gives a long-text column more room than a short code column", () => {
    const [id, name, description] = docxColumnWidths(["Id", "Name", "Description"], [["7", "Kickoff meeting", "A long description ".repeat(5)]], WIDTH);
    expect(description).toBeGreaterThan(name);
    expect(name).toBeGreaterThan(id);
  });

  it("caps a very long column, so it cannot squeeze the rest to nothing", () => {
    const [id, , description] = docxColumnWidths(["Id", "Name", "Description"], [["7", "Kickoff", "x".repeat(5000)]], WIDTH);
    // At the cap (40 chars) against a 4-char floor, the widest column is at most 10x the narrowest.
    expect(description / id).toBeLessThanOrEqual(10.01);
  });

  it("weighs a column by its longest header word, not only its cells", () => {
    const [a, b] = docxColumnWidths(["Responsible", "X"], [["1", "2"]], WIDTH);
    expect(a).toBeGreaterThan(b);
  });

  it("reads a rich cell by its text", () => {
    // 30 chars of text against a 20-char plain cell: measuring the object ("[object Object]", 15) would lose.
    const [plain, rich] = docxColumnWidths(["A", "B"], [["x".repeat(20), { html: "<p>" + "y".repeat(30) + "</p>", text: "y".repeat(30) }]], WIDTH);
    expect(rich).toBeGreaterThan(plain);
  });

  it("shares the width evenly when nothing distinguishes the columns", () => {
    expect(docxColumnWidths(["A", "B", "C"], [], 9000)).toEqual([3000, 3000, 3000]);
  });

  it("returns no widths for no columns", () => {
    expect(docxColumnWidths([], [], WIDTH)).toEqual([]);
  });
});
