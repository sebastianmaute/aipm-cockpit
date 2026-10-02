import { describe, it, expect } from "vitest";
import { encodeContactPersons, decodeContactPersons } from "./csv-codecs";
import type { ContactPerson } from "./types";

describe("encodeContactPersons / decodeContactPersons resourceId", () => {
  // §537 — the id is a FIFTH positional field; `resourceId` keeps the fourth
  //  slot, written EMPTY for an unlinked contact so the id is not misread as one.
  it("encodes an unlinked contact with an empty resourceId slot before its id", () => {
    const people: ContactPerson[] = [{ id: 1, name: "Ann Lee", email: "a@x.com", synced: false }];
    expect(encodeContactPersons(people)).toBe("Ann Lee;a@x.com;0;;1");
    expect(decodeContactPersons("Ann Lee;a@x.com;0;;1")).toEqual(people);
  });

  it("encodes a linked contact's resourceId fourth and its id fifth, and round-trips", () => {
    const people: ContactPerson[] = [
      { id: 2, name: "Ann Lee", email: "a@x.com", synced: true, resourceId: 7 },
    ];
    const encoded = encodeContactPersons(people);
    expect(encoded).toBe("Ann Lee;a@x.com;1;7;2");
    expect(decodeContactPersons(encoded)).toEqual(people);
  });

  it("decodes a pre-§537 4-field linked cell with no id (the load funnel mints one)", () => {
    expect(decodeContactPersons("Ann Lee;a@x.com;1;7")).toEqual([
      { name: "Ann Lee", email: "a@x.com", synced: true, resourceId: 7 },
    ]);
  });

  it("decodes a legacy 3-field string with resourceId undefined", () => {
    const [person] = decodeContactPersons("Ann Lee;a@x.com;0");
    expect(person).toEqual({ name: "Ann Lee", email: "a@x.com", synced: false });
    expect(person.resourceId).toBeUndefined();
  });

  it("treats an empty 4th field as no resourceId", () => {
    const [person] = decodeContactPersons("Ann Lee;a@x.com;0;");
    expect(person.resourceId).toBeUndefined();
  });
});
