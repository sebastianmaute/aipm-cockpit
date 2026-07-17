import { describe, it, expect } from "vitest";
import { collectDocuments } from "./knowledge";

const doc = (name: string) => ({ name, url: `https://x/${name}`, kind: "file" as const });

describe("collectDocuments", () => {
  it("aggregates links across entities + project with source + index", () => {
    const refs = collectDocuments({
      tasks: [{ id: 1, taskName: "Ship", documentLinks: [doc("a"), doc("b")] }] as never,
      raid: [{ id: 7, title: "Risk", documentLinks: [doc("c")] }] as never,
      changes: [], milestones: [], stakeholders: [],
      project: { id: 0, name: "Demo", documentLinks: [doc("p")] } as never,
    });
    expect(refs).toHaveLength(4);
    expect(refs.find((r) => r.link.name === "b")).toMatchObject({ source: { kind: "task", id: 1, name: "Ship", view: "open-points" }, index: 1 });
    expect(refs.find((r) => r.link.name === "c")?.source).toMatchObject({ kind: "raid", id: 7, name: "Risk", view: "raid" });
    expect(refs.find((r) => r.link.name === "p")?.source).toMatchObject({ kind: "project", view: "projects" });
  });
  it("returns [] when nothing is linked", () => {
    expect(collectDocuments({ tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], project: undefined })).toEqual([]);
  });
});
