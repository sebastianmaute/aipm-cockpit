import { describe, it, expect } from "vitest";
import { autoMatchUsers, autoMatchProjects } from "./timelog-match";
import type { TimelogUser, TimelogLinks } from "./timelog-types";
import type { Resource, BudgetBucket } from "./types";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email, roleId: null, utilizationMode: "hours", utilization: {} } as Resource);
const tlUser = (userId: number, email: string, initials = "", firstName = "", lastName = ""): TimelogUser =>
  ({ userId, email, initials, firstName, lastName, isActive: true });

describe("autoMatchUsers", () => {
  it("matches by email case-insensitively", () => {
    const links = autoMatchUsers([tlUser(5, "Ada@Acme.com")], [res(2, "Ada", "L", "ada@acme.com")], { userLinks: [], projectLinks: [] });
    expect(links).toContainEqual({ timelogUserId: 5, resourceId: 2, manual: false });
  });
  it("falls back to initials then first+last when no email match", () => {
    const links = autoMatchUsers([tlUser(7, "", "AL")], [res(3, "Ada", "Lovelace")], { userLinks: [], projectLinks: [] });
    expect(links).toContainEqual({ timelogUserId: 7, resourceId: 3, manual: false });
  });
  it("PRESERVES a manual link and does NOT auto-override it", () => {
    const existing = { userLinks: [{ timelogUserId: 5, resourceId: 99, manual: true }], projectLinks: [] };
    const links = autoMatchUsers([tlUser(5, "ada@acme.com")], [res(2, "Ada", "L", "ada@acme.com")], existing);
    expect(links).toContainEqual({ timelogUserId: 5, resourceId: 99, manual: true });
    expect(links).not.toContainEqual({ timelogUserId: 5, resourceId: 2, manual: false });
  });
  it("does not emit a link when nothing matches", () => {
    const links = autoMatchUsers([tlUser(8, "nobody@x.com")], [res(2, "Ada", "L", "ada@acme.com")], { userLinks: [], projectLinks: [] });
    expect(links.find((l) => l.timelogUserId === 8)).toBeUndefined();
  });
});

describe("autoMatchProjects", () => {
  const bucket = (id: number, name: string, poNumber?: string): BudgetBucket =>
    ({ id, name, poNumber, type: "tm", currency: "EUR", startDate: "", endDate: "", status: "open", allocations: [] } as BudgetBucket);
  it("matches by project name case-insensitively, else PO number", () => {
    const links = autoMatchProjects([{ id: 9, name: "ForgeOps", no: "PO-42" }], [bucket(5, "forgeops")], { userLinks: [], projectLinks: [] });
    expect(links).toContainEqual({ timelogProjectId: 9, bucketId: 5, manual: false });
  });
  it("matches by PO number when name differs", () => {
    const links = autoMatchProjects([{ id: 9, name: "Other", no: "PO-42" }], [bucket(5, "forgeops", "PO-42")], { userLinks: [], projectLinks: [] });
    expect(links).toContainEqual({ timelogProjectId: 9, bucketId: 5, manual: false });
  });
  it("preserves a manual project link", () => {
    const existing = { userLinks: [], projectLinks: [{ timelogProjectId: 9, bucketId: 1, manual: true }] };
    const links = autoMatchProjects([{ id: 9, name: "ForgeOps", no: "" }], [bucket(5, "ForgeOps")], existing);
    expect(links).toContainEqual({ timelogProjectId: 9, bucketId: 1, manual: true });
  });
  it("preserves a manual null-bucket link and does NOT auto-override it", () => {
    const existing: TimelogLinks = { userLinks: [], projectLinks: [{ timelogProjectId: 9, bucketId: null, manual: true }] };
    const links = autoMatchProjects([{ id: 9, name: "ForgeOps", no: "" }], [bucket(5, "ForgeOps")], existing);
    expect(links).toContainEqual({ timelogProjectId: 9, bucketId: null, manual: true });
    expect(links).not.toContainEqual({ timelogProjectId: 9, bucketId: 5, manual: false });
  });
});
