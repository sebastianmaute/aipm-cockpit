import { describe, expect, test } from "vitest";
import type { Resource } from "../types";
import {
  canonicalPair,
  matchPeople,
  usableEmails,
  type OtherProjectPeople,
  type PersonLinkRow,
} from "./person-match";

function res(id: number, firstName: string, lastName: string, extra: Partial<Resource> = {}): Resource {
  return { id, firstName, lastName, ...extra } as Resource;
}

function other(projectId: string, resources: Resource[]): OtherProjectPeople {
  return { projectId, projectName: `Name ${projectId}`, resources };
}

function row(over: Partial<PersonLinkRow> & Pick<PersonLinkRow, "verdict">): PersonLinkRow {
  return {
    projectA: "p-here",
    resourceA: 1,
    projectB: "p-other",
    resourceB: 10,
    firstA: "Ann",
    lastA: "Lee",
    firstB: "Ann",
    lastB: "Lee",
    emailsA: "",
    emailsB: "",
    decidedAt: "2026-10-31T00:00:00Z",
    decidedBy: "me",
    ...over,
  };
}

const HERE = "p-here";

describe("usableEmails", () => {
  test("an email without @ is not usable", () => {
    expect(usableEmails(res(1, "A", "B", { email: "nobody", emails: [" X@Y.com ", ""] }))).toEqual(["x@y.com"]);
  });
});

describe("canonicalPair", () => {
  test("orders by project id", () => {
    expect(canonicalPair("b", 2, "a", 1)).toEqual({ projectA: "a", resourceA: 1, projectB: "b", resourceB: 2 });
    expect(canonicalPair("a", 1, "b", 2)).toEqual({ projectA: "a", resourceA: 1, projectB: "b", resourceB: 2 });
  });
});

describe("matchPeople", () => {
  test("every here-resource is present, possibly empty", () => {
    const m = matchPeople(HERE, [res(1, "Ann", "Lee")], [], []);
    expect(m.get(1)).toEqual({ matched: [], suggestions: [], rejected: [] });
  });

  test("the same email matches automatically, across email and emails, case-insensitive", () => {
    const here = [res(1, "Ann", "Lee", { email: "Ann@X.com" })];
    const others = [other("p-other", [res(10, "Zed", "Q", { emails: ["a@b.c", " ANN@x.com"] })])];
    const m = matchPeople(HERE, here, others, []).get(1)!;
    expect(m.matched).toEqual([{ projectId: "p-other", projectName: "Name p-other", resourceId: 10, via: "email" }]);
  });

  test("a different row overrides an email match", () => {
    const here = [res(1, "Ann", "Lee", { email: "a@x.com" })];
    const others = [other("p-other", [res(10, "Ann", "Lee", { email: "a@x.com" })])];
    const m = matchPeople(HERE, here, others, [row({ verdict: "different" })]).get(1)!;
    expect(m.matched).toEqual([]);
    expect(m.rejected).toEqual([{ projectId: "p-other", projectName: "Name p-other", resourceId: 10 }]);
  });

  test("equal names with no usable email on one side is a suggestion, not a match", () => {
    const here = [res(1, "Ann", "Lee", { email: "a@x.com" })];
    const others = [other("p-other", [res(10, " ann ", "LEE")])];
    const m = matchPeople(HERE, here, others, []).get(1)!;
    expect(m.matched).toEqual([]);
    expect(m.suggestions).toEqual([{ projectId: "p-other", projectName: "Name p-other", resourceId: 10 }]);
  });

  test("two usable emails that differ give no suggestion even with equal names", () => {
    const here = [res(1, "Ann", "Lee", { email: "a@x.com" })];
    const others = [other("p-other", [res(10, "Ann", "Lee", { email: "b@x.com" })])];
    const m = matchPeople(HERE, here, others, []).get(1)!;
    expect(m).toEqual({ matched: [], suggestions: [], rejected: [] });
  });

  test("a confirmed same row matches by name", () => {
    const here = [res(1, "Ann", "Lee")];
    const others = [other("p-other", [res(10, "Ann", "Lee")])];
    const m = matchPeople(HERE, here, others, [row({ verdict: "same" })]).get(1)!;
    expect(m.matched).toEqual([{ projectId: "p-other", projectName: "Name p-other", resourceId: 10, via: "confirmed" }]);
    expect(m.suggestions).toEqual([]);
  });

  test("a same row is ignored once either resource's first+last name changed", () => {
    const others = [other("p-other", [res(10, "Ann", "Lee")])];
    const renamedHere = matchPeople(HERE, [res(1, "Anna", "Lee")], others, [row({ verdict: "same" })]).get(1)!;
    expect(renamedHere).toEqual({ matched: [], suggestions: [], rejected: [] });
    const renamedOther = matchPeople(HERE, [res(1, "Ann", "Lee")], [other("p-other", [res(10, "Ann", "Li")])], [
      row({ verdict: "same" }),
    ]).get(1)!;
    expect(renamedOther.matched).toEqual([]);
    // falls back to the remaining rules: equal names here, so a suggestion
    const sameNames = matchPeople(HERE, [res(1, "ANN", " lee")], others, [row({ verdict: "same", firstA: "Old", lastA: "Name" })]).get(1)!;
    expect(sameNames.matched).toEqual([]);
    expect(sameNames.suggestions).toHaveLength(1);
  });

  test("a row naming a project not in the list or a missing resource id is ignored", () => {
    const here = [res(1, "Ann", "Lee")];
    const others = [other("p-other", [res(10, "Ann", "Lee")])];
    const noProject = matchPeople(HERE, here, others, [row({ verdict: "same", projectB: "p-gone", resourceB: 10 })]).get(1)!;
    expect(noProject.matched).toEqual([]);
    const noResource = matchPeople(HERE, here, others, [row({ verdict: "same", resourceB: 99 })]).get(1)!;
    expect(noResource.matched).toEqual([]);
    expect(noResource.suggestions).toHaveLength(1);
  });

  test("two resources in one other project both match", () => {
    const here = [res(1, "Ann", "Lee", { email: "a@x.com" })];
    const others = [other("p-other", [res(10, "A", "One", { email: "a@x.com" }), res(11, "A", "Two", { emails: ["a@x.com"] })])];
    const m = matchPeople(HERE, here, others, []).get(1)!;
    expect(m.matched.map((r) => r.resourceId)).toEqual([10, 11]);
  });

  test("emails matches emails, case-insensitive", () => {
    const here = [res(1, "Ann", "Lee", { emails: ["x@y.com", "ANN@X.com"] })];
    const others = [other("p-other", [res(10, "Zed", "Q", { emails: ["ann@x.COM"] })])];
    const m = matchPeople(HERE, here, others, []).get(1)!;
    expect(m.matched.map((r) => r.via)).toEqual(["email"]);
  });

  test("a first/last re-split with the same joined name makes a same row stale", () => {
    const others = [other("p-other", [res(10, "Ann", "Lee")])];
    const links = [row({ verdict: "same", firstA: "Mary Ann", lastA: "Lee" })];
    const resplit = matchPeople(HERE, [res(1, "Mary", "Ann Lee")], others, links).get(1)!;
    expect(resplit.matched).toEqual([]);
    const sameFields = matchPeople(HERE, [res(1, "Mary Ann", "Lee")], others, links).get(1)!;
    expect(sameFields.matched).toHaveLength(1);
  });

  test("a different row still rejects after a rename, even with overlapping emails", () => {
    const here = [res(1, "Annabel", "Lee", { email: "a@x.com" })];
    const others = [other("p-other", [res(10, "Ann", "Leigh", { email: "A@x.com" })])];
    const m = matchPeople(HERE, here, others, [row({ verdict: "different" })]).get(1)!;
    expect(m.matched).toEqual([]);
    expect(m.rejected).toEqual([{ projectId: "p-other", projectName: "Name p-other", resourceId: 10 }]);
  });

  test("a row stored in either order is found", () => {
    const here = [res(1, "Ann", "Lee")];
    const others = [other("p-other", [res(10, "Ann", "Lee")])];
    const flipped = row({ verdict: "same", projectA: "p-other", resourceA: 10, projectB: HERE, resourceB: 1 });
    const m = matchPeople(HERE, here, others, [flipped]).get(1)!;
    expect(m.matched).toHaveLength(1);
    const canonical = row({ verdict: "same", projectA: "p-a", resourceA: 10, projectB: "p-z", resourceB: 1 });
    const m2 = matchPeople("p-z", here, [other("p-a", [res(10, "Ann", "Lee")])], [canonical]).get(1)!;
    expect(m2.matched).toHaveLength(1);
  });
});
