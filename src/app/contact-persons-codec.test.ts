import { describe, it, expect } from "vitest";
import { encodeContactPersons, decodeContactPersons } from "./csv-codecs";
import type { ContactPerson } from "./types";

describe("encodeContactPersons / decodeContactPersons resourceId", () => {
  it("encodes an unlinked contact to the exact 3-field string (byte-stable)", () => {
    const people: ContactPerson[] = [{ name: "Ann Lee", email: "a@x.com", synced: false }];
    expect(encodeContactPersons(people)).toBe("Ann Lee;a@x.com;0");
  });

  it("appends the 4th field for a linked contact and round-trips through decode", () => {
    const people: ContactPerson[] = [
      { name: "Ann Lee", email: "a@x.com", synced: true, resourceId: 7 },
    ];
    const encoded = encodeContactPersons(people);
    expect(encoded).toBe("Ann Lee;a@x.com;1;7");
    expect(decodeContactPersons(encoded)).toEqual(people);
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
