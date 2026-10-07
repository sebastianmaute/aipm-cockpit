import { describe, expect, it } from "vitest";
import { isPersonEntity, namesNewPerson, reassignEmail, withReassignFields } from "./person-reassign";
import type { Resource } from "./types";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email }) as Resource;

const DIRECTORY = [res(1, "Sofia", "Ramirez", "sofia@x.com"), res(2, "Noah", "Bennett", "noah@x.com")];

describe("person-reassign", () => {
  it("knows exactly the three person entities", () => {
    expect(["task", "raid", "absence"].every(isPersonEntity)).toBe(true);
    expect(isPersonEntity("change")).toBe(false);
    // An inherited key is not an entity.
    expect(isPersonEntity("toString")).toBe(false);
  });

  it("only a string naming someone else is a new person", () => {
    const stored = { assignee: "Sofia Ramirez" };
    expect(namesNewPerson("task", { assignee: "Noah Bennett" }, stored)).toBe(true);
    expect(namesNewPerson("task", { assignee: " Sofia Ramirez " }, stored)).toBe(false);
    expect(namesNewPerson("task", { assignee: 42 }, stored)).toBe(false);
    expect(namesNewPerson("task", {}, stored)).toBe(false);
  });

  it("derives the matched person's address, or blank", () => {
    expect(reassignEmail("noah bennett", DIRECTORY)).toBe("noah@x.com");
    expect(reassignEmail("Charlie Nobody", DIRECTORY)).toBe("");
    expect(reassignEmail("Noah Bennett", [res(2, "Noah", "Bennett")])).toBe("");
    // Never an address the email guards would refuse, so deriving cannot make a write throw.
    expect(reassignEmail("Noah Bennett", [res(2, "Noah", "Bennett", "a;b@x.com")])).toBe("");
  });

  it("fills in only what the model left out, and returns the same input when nothing changes", () => {
    const stored = { owner: "Sofia Ramirez", ownerEmail: "sofia@x.com" };
    const same = { owner: "Sofia Ramirez" };
    expect(withReassignFields("raid", same, stored, DIRECTORY)).toBe(same);
    expect(withReassignFields("raid", { owner: "Noah Bennett" }, stored, DIRECTORY)).toEqual({ owner: "Noah Bennett", ownerEmail: "noah@x.com" });
    expect(withReassignFields("raid", { owner: "Noah Bennett", ownerEmail: "n@y.com" }, stored, DIRECTORY)).toEqual({ owner: "Noah Bennett", ownerEmail: "n@y.com" });
  });

  it("gives an absence the matching link as well, unless the model named one", () => {
    const stored = { assignee: "Sofia Ramirez", assigneeEmail: "sofia@x.com", resourceId: 1 };
    expect(withReassignFields("absence", { assignee: "Noah Bennett" }, stored, DIRECTORY)).toEqual({
      assignee: "Noah Bennett", assigneeEmail: "noah@x.com", resourceId: 2,
    });
    expect(withReassignFields("absence", { assignee: "Charlie Nobody" }, stored, DIRECTORY)).toMatchObject({ resourceId: null });
    expect(withReassignFields("absence", { assignee: "Noah Bennett", resourceId: 1 }, stored, DIRECTORY)).toMatchObject({ resourceId: 1 });
    // A task's link is not a model field, so it is never projected.
    expect(withReassignFields("task", { assignee: "Noah Bennett" }, { assignee: "Sofia Ramirez" }, DIRECTORY)).not.toHaveProperty("resourceId");
  });
});
