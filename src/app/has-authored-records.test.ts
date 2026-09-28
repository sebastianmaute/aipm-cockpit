import { describe, it, expect } from "vitest";
import { emptyWorkspace, hasAuthoredRecords, jsonToWorkspace, type Workspace } from "./workspace";
import { seedDisciplines, seedGrades } from "./resource-foundation";

// §601 — the empty-load refusal's question is "does this workspace hold anything the user made?",
// and decoding a record-free file seeds the preset reference lists, which `isWorkspaceEmpty` counts.
const seeded = (): Workspace => ({ ...emptyWorkspace(), disciplines: seedDisciplines(), grades: seedGrades() });

describe("hasAuthoredRecords (§601)", () => {
  it("is false for a blank workspace", () => {
    expect(hasAuthoredRecords(emptyWorkspace())).toBe(false);
  });

  it("is false for a workspace holding only the preset disciplines and grades", () => {
    expect(hasAuthoredRecords(seeded())).toBe(false);
  });

  it("is false for what decoding a structurally valid, record-free file returns", () => {
    const decoded = jsonToWorkspace(JSON.stringify({ tasks: [], raid: [], absences: [], shifts: [] }), { strict: true });
    expect(decoded.disciplines.length).toBeGreaterThan(0); // the premise: decoding seeds them
    expect(hasAuthoredRecords(decoded)).toBe(false);
  });

  it("ignores the order the preset lists come back in and a localModifiedAt stamp", () => {
    const ws = seeded();
    expect(hasAuthoredRecords({
      ...ws,
      disciplines: [...ws.disciplines].reverse(),
      grades: ws.grades.map((g) => ({ ...g, localModifiedAt: "2026-09-28T00:00:00Z" })),
    })).toBe(false);
  });

  it("is true once any other slice holds a record", () => {
    expect(hasAuthoredRecords({ ...seeded(), tasks: [{ id: 1 } as never] })).toBe(true);
    expect(hasAuthoredRecords({ ...seeded(), documents: [{ id: 1 } as never] })).toBe(true);
    expect(hasAuthoredRecords({ ...emptyWorkspace(), roles: [{ id: 1 } as never] })).toBe(true);
    // counted by workspaceRecordCount but not by isWorkspaceEmpty (review I1)
    expect(hasAuthoredRecords({ ...seeded(), knowledgeItems: [{ id: "k1" } as never] })).toBe(true);
    expect(hasAuthoredRecords({ ...seeded(), documentAssets: [{ id: "a1" } as never] })).toBe(true);
  });

  it("is true when the disciplines or grades differ from the presets", () => {
    const ws = seeded();
    expect(hasAuthoredRecords({ ...ws, disciplines: [...ws.disciplines, { id: 99, name: "Architect" }] })).toBe(true);
    expect(hasAuthoredRecords({ ...ws, disciplines: ws.disciplines.slice(1) })).toBe(true);
    expect(hasAuthoredRecords({ ...ws, grades: ws.grades.map((g, i) => (i === 0 ? { ...g, name: "Trainee" } : g)) })).toBe(true);
    expect(hasAuthoredRecords({ ...ws, grades: ws.grades.map((g, i) => (i === 0 ? { ...g, id: 42 } : g)) })).toBe(true);
    expect(hasAuthoredRecords({ ...emptyWorkspace(), disciplines: [{ id: 1, name: "Architect" }] })).toBe(true);
    // two entries on one seeded id: the count still matches, the content does not
    expect(hasAuthoredRecords({ ...ws, disciplines: ws.disciplines.map((d, i) => (i === 1 ? ws.disciplines[0] : d)) })).toBe(true);
  });

  it("tolerates missing arrays (partial object)", () => {
    expect(hasAuthoredRecords({} as unknown as Workspace)).toBe(false);
  });
});
