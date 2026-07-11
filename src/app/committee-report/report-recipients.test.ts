import { describe, it, expect } from "vitest";
import { committeeMemberEmails } from "./report-recipients";
import type { Resource, SteeringCommittee } from "../types";

function res(id: number, email?: string): Resource {
  return {
    id,
    firstName: `F${id}`,
    lastName: `L${id}`,
    email,
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
  } as Resource;
}

function committee(memberResourceIds: number[]): SteeringCommittee {
  return { name: "Board", memberResourceIds, meetings: [], infoSchedules: [] };
}

describe("committeeMemberEmails", () => {
  it("resolves member emails, skips members with no email, and dedupes case-insensitively", () => {
    const resources: Resource[] = [
      res(1, "a@x.com"),
      res(2, undefined), // no email -> skipped
      res(3, "c@x.com"),
      res(4, "A@X.com"), // case-insensitive dup of #1 -> dropped
    ];
    const emails = committeeMemberEmails(committee([1, 2, 3, 4]), resources);
    expect(emails).toEqual(["a@x.com", "c@x.com"]);
  });

  it("trims whitespace and skips members not in the directory", () => {
    const resources: Resource[] = [res(1, "  a@x.com  "), res(3, "c@x.com")];
    const emails = committeeMemberEmails(committee([1, 99, 3]), resources);
    expect(emails).toEqual(["a@x.com", "c@x.com"]);
  });

  it("returns an empty array when no members have emails", () => {
    const resources: Resource[] = [res(1, ""), res(2, "   ")];
    expect(committeeMemberEmails(committee([1, 2]), resources)).toEqual([]);
  });
});
