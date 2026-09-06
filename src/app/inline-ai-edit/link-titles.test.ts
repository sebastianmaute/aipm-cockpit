// src/app/inline-ai-edit/link-titles.test.ts
import { describe, it, expect } from "vitest";
import { resolveLinkTitles, UNKNOWN_ID_MARKER } from "./link-titles";
import { INLINE_DESCRIPTORS, type LinkField } from "./entity-descriptor";
import { type Workspace } from "../workspace";

const WS = { tasks: [{ id: 1, taskName: "Draft brief" }, { id: 2, taskName: "Ship" }] } as unknown as Workspace;
const LINK: LinkField = {
  wsKey: "tasks",
  kind: "list",
  titleOf: (r) => String(r.taskName),
  sanitize: (v) => (Array.isArray(v) ? v.map(Number) : []),
};

describe("resolveLinkTitles", () => {
  it("renders titles in the order given", () => {
    expect(resolveLinkTitles([2, 1], LINK, WS)).toBe("Ship, Draft brief");
  });

  it("marks an id with no row rather than dropping it", () => {
    // Dropping would launder a real problem: these paths store dangling ids and
    // nothing prunes them. A silent omission would read as "this link is gone".
    expect(resolveLinkTitles([1, 99], LINK, WS)).toBe(`Draft brief, ${UNKNOWN_ID_MARKER}99`);
  });

  it("renders an empty list as the empty string, so the card shows an em-dash", () => {
    expect(resolveLinkTitles([], LINK, WS)).toBe("");
  });

  it("falls back to the id when the row has a blank title", () => {
    const ws = { tasks: [{ id: 1, taskName: "   " }] } as unknown as Workspace;
    expect(resolveLinkTitles([1], LINK, ws)).toBe(`${UNKNOWN_ID_MARKER}1`);
  });

  it("renders the marker rather than throwing when the workspace array is absent", () => {
    expect(resolveLinkTitles([1], LINK, {} as unknown as Workspace)).toBe(`${UNKNOWN_ID_MARKER}1`);
  });

  // ★★★ THE ONLY TEST THAT CAN CATCH A ONE-ARG `titleOf` CALL. `LinkField.titleOf`
  //  is `(row, ws) => string` and the resource descriptor's `roleId` NEEDS the
  //  second argument: a `Role` has no `name`, so its label is discipline + grade
  //  resolved against two OTHER workspace arrays (`roleLabel`). An implementation
  //  calling `titleOf(row)` compiles, and passes every test above, and then throws
  //  or renders blank for every role — which on the preview card is
  //  indistinguishable from the link having been dropped. So this drives the REAL
  //  descriptor field, not a lookalike fixture.
  it("passes the workspace through to titleOf, so the real roleId label resolves", () => {
    const ws = {
      roles: [{ id: 3, disciplineId: 7, gradeId: 9 }],
      disciplines: [{ id: 7, name: "Design" }],
      grades: [{ id: 9, name: "Senior" }],
    } as unknown as Workspace;
    expect(resolveLinkTitles([3], INLINE_DESCRIPTORS.resource.linkFields.roleId, ws)).toBe("Design Senior");
  });
});
