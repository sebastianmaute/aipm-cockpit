import { describe, expect, it } from "vitest";
import { resolveInitialScope, scopeMismatch } from "./timelog-initial-scope";

const customers = [
  { id: 1, name: "Acme" },
  { id: 2, name: "Globex" },
];

describe("resolveInitialScope", () => {
  it("prefers the device picker scope over everything else", () => {
    const r = resolveInitialScope({
      picker: { customerId: 2, projectIds: [5] },
      links: { customerId: 1, projectIds: [9] },
      customers,
      customerName: "Acme",
    });
    expect(r).toEqual({ customerId: 2, projectIds: [5], source: "picker" });
  });

  it("falls back to the last-fetched links scope", () => {
    const r = resolveInitialScope({
      picker: {},
      links: { customerId: 1, projectIds: [9] },
      customers,
      customerName: "Globex",
    });
    expect(r).toEqual({ customerId: 1, projectIds: [9], source: "links" });
  });

  it("auto-resolves the project's customer name when nothing is persisted", () => {
    const r = resolveInitialScope({
      picker: {},
      links: {},
      customers,
      customerName: "Globex",
    });
    expect(r).toEqual({ customerId: 2, projectIds: [], source: "auto" });
  });

  it("reports none when the directory has not loaded yet", () => {
    const r = resolveInitialScope({
      picker: {},
      links: {},
      customers: [],
      customerName: "Globex",
    });
    expect(r).toEqual({ customerId: "", projectIds: [], source: "none" });
  });

  it("reports none when the customer name matches nothing", () => {
    const r = resolveInitialScope({
      picker: {},
      links: {},
      customers,
      customerName: "Initech",
    });
    expect(r.source).toBe("none");
  });

  it("treats a picker scope with no projects as still authoritative", () => {
    const r = resolveInitialScope({
      picker: { customerId: 2 },
      links: { customerId: 1, projectIds: [9] },
      customers,
      customerName: "Acme",
    });
    expect(r).toEqual({ customerId: 2, projectIds: [], source: "picker" });
  });
});

describe("scopeMismatch", () => {
  it("is true when the picker and the last fetch disagree", () => {
    expect(scopeMismatch(2, 1)).toBe(true);
  });

  it("is false when they agree", () => {
    expect(scopeMismatch(1, 1)).toBe(false);
  });

  it("is false when nothing has been fetched yet", () => {
    expect(scopeMismatch(2, undefined)).toBe(false);
  });

  it("is false when the picker is empty", () => {
    expect(scopeMismatch("", 1)).toBe(false);
  });
});
