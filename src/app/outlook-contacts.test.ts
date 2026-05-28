import { describe, it, expect } from "vitest";
import {
  mapGraphContact,
  parseGraphBirthday,
  mergeImportedResources,
  contactsFromImported,
  type GraphContact,
  type OutlookContact,
} from "./outlook-contacts";
import type { Resource } from "./types";

function res(partial: Partial<Resource> & { id: number }): Resource {
  return {
    firstName: "X",
    lastName: "",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...partial,
  };
}

describe("parseGraphBirthday", () => {
  it("keeps a real year as YYYY-MM-DD", () => {
    expect(parseGraphBirthday("1974-07-04T00:00:00Z")).toBe("1974-07-04");
  });
  it("drops the 0001 placeholder year to MM-DD", () => {
    expect(parseGraphBirthday("0001-12-31T00:00:00Z")).toBe("12-31");
  });
  it("returns undefined for missing/invalid", () => {
    expect(parseGraphBirthday(null)).toBeUndefined();
    expect(parseGraphBirthday(undefined)).toBeUndefined();
    expect(parseGraphBirthday("not-a-date")).toBeUndefined();
    expect(parseGraphBirthday("1974-13-40T00:00:00Z")).toBeUndefined();
  });
});

describe("mapGraphContact", () => {
  it("maps a full record", () => {
    const raw: GraphContact = {
      id: "abc",
      displayName: "Alex Example",
      givenName: "Sample",
      surname: "Dummy",
      emailAddresses: [{ address: "Sample.Dummy@example.com" }],
      jobTitle: "Architect",
      department: "Engineering",
      companyName: "Contoso",
      businessPhones: ["+49 123"],
      mobilePhone: "+49 999",
      officeLocation: "Berlin",
      birthday: "1980-03-02T00:00:00Z",
    };
    expect(mapGraphContact(raw, 0)).toEqual<OutlookContact>({
      sourceId: "abc",
      firstName: "Sample",
      lastName: "Dummy",
      displayName: "Alex Example",
      email: "Sample.Dummy@example.com",
      title: "Architect",
      department: "Engineering",
      company: "Contoso",
      phone: "+49 123",
      location: "Berlin",
      birthday: "1980-03-02",
    });
  });

  it("splits displayName when given/surname absent", () => {
    const c = mapGraphContact({ displayName: "Zoe Adams" }, 1)!;
    expect(c.firstName).toBe("Zoe");
    expect(c.lastName).toBe("Adams");
    expect(c.sourceId).toBe("graph-1");
  });

  it("falls back to email local-part when no name", () => {
    const c = mapGraphContact({ emailAddresses: [{ address: "ops@example.com" }] }, 2)!;
    expect(c.firstName).toBe("ops");
    expect(c.displayName).toBe("ops");
    expect(c.email).toBe("ops@example.com");
  });

  it("returns null when neither name nor email", () => {
    expect(mapGraphContact({ jobTitle: "Nobody" }, 3)).toBeNull();
  });

  it("prefers businessPhones[0] then mobilePhone", () => {
    expect(mapGraphContact({ givenName: "A", mobilePhone: "+1 5" }, 4)!.phone).toBe("+1 5");
    expect(
      mapGraphContact({ givenName: "A", businessPhones: ["+1 1"], mobilePhone: "+1 5" }, 5)!.phone,
    ).toBe("+1 1");
  });
});

describe("mergeImportedResources", () => {
  const contact: OutlookContact = {
    sourceId: "x",
    firstName: "Sample",
    lastName: "Dummy",
    displayName: "Alex Example",
    email: "Sample@example.com",
    title: "Architect",
  };

  it("appends a new resource with nextId", () => {
    const out = mergeImportedResources([res({ id: 5 })], [contact]);
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe(6);
    expect(out[1].email).toBe("Sample@example.com");
    expect(out[1].roleId).toBeNull();
    expect(out[1].utilizationMode).toBe("percent");
  });

  it("updates an existing resource matched by email (case-insensitive), preserving id/role/utilization", () => {
    const existing = res({
      id: 9,
      firstName: "S",
      lastName: "C",
      email: "Sample@Example.com",
      roleId: 3,
      utilization: { "2026-02": 100 },
      title: "Old",
    });
    const out = mergeImportedResources([existing], [contact]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(9);
    expect(out[0].roleId).toBe(3);
    expect(out[0].utilization).toEqual({ "2026-02": 100 });
    expect(out[0].title).toBe("Architect");
    expect(out[0].firstName).toBe("Sample");
  });

  it("assigns distinct ids across a multi-add batch", () => {
    const out = mergeImportedResources(
      [res({ id: 1 })],
      [
        { ...contact, email: "a@x.com" },
        { ...contact, email: "b@x.com" },
      ],
    );
    expect(out.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("clears a field on update when the contact leaves it blank", () => {
    const existing = res({ id: 1, email: "Sample@example.com", title: "Old" });
    const out = mergeImportedResources([existing], [{ ...contact, title: undefined }]);
    expect(out[0].title).toBeUndefined();
  });
});

describe("contactsFromImported", () => {
  it("maps displayName + email and skips blank-name contacts", () => {
    const out = contactsFromImported([
      { sourceId: "1", firstName: "A", lastName: "B", displayName: "A B", email: "ab@x.com" },
      { sourceId: "2", firstName: "", lastName: "", displayName: "", email: "x@x.com" },
    ]);
    expect(out).toEqual([{ name: "A B", email: "ab@x.com" }]);
  });
});
