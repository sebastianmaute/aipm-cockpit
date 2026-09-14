import { describe, expect, it } from "vitest";
import {
  emailWriteRefusal,
  findTornEmail,
  isWriteSafeEmail,
  normalizeEmailListShape,
  normalizeEmailShape,
  sanitizeLoadedEmail,
  summarizeUnsafeEmailRecords,
  templateSeedEmailScope,
  withNormalizedEmailField,
  withNormalizedResourceEmails,
} from "./sanitize";
import { applyTemplate } from "./template-apply";
import { emptyWorkspace } from "./workspace";

describe("isWriteSafeEmail", () => {
  it("accepts a plain address and refuses a malformed or delimiter-bearing one", () => {
    expect(isWriteSafeEmail("ada@example.com")).toBe(true);
    expect(isWriteSafeEmail("  ada@example.com  ")).toBe(true);
    expect(isWriteSafeEmail("ada")).toBe(false);
    expect(isWriteSafeEmail("a,b@x.com")).toBe(false);
    expect(isWriteSafeEmail("a;b@x.com")).toBe(false);
    expect(isWriteSafeEmail("")).toBe(false);
  });
});

describe("emailWriteRefusal — the one scalar rule", () => {
  it("never refuses a blank value (clearing is legal)", () => {
    expect(emailWriteRefusal("", "a,b@x.com")).toBeNull();
    expect(emailWriteRefusal("   ", undefined)).toBeNull();
  });

  it("never refuses an unchanged value, even when the stored value is unsafe", () => {
    expect(emailWriteRefusal("a,b@x.com", "a,b@x.com")).toBeNull();
    expect(emailWriteRefusal(" not-an-email ", "not-an-email")).toBeNull();
  });

  it("refuses a CHANGED malformed value as invalid", () => {
    expect(emailWriteRefusal("nope", "ada@example.com")).toBe("invalid");
    expect(emailWriteRefusal("nope", undefined)).toBe("invalid");
  });

  it("refuses a CHANGED delimiter-bearing value as delimiter, since isValidEmail accepts it", () => {
    expect(emailWriteRefusal("a,b@x.com", undefined)).toBe("delimiter");
    expect(emailWriteRefusal("a;b@x.com", "ada@example.com")).toBe("delimiter");
  });

  it("accepts a changed write-safe value on create and on update", () => {
    expect(emailWriteRefusal("grace@example.com", undefined)).toBeNull();
    expect(emailWriteRefusal("grace@example.com", "ada@example.com")).toBeNull();
  });

  it("exempts a copy of a source's stored email (decision 2) and nothing else", () => {
    expect(emailWriteRefusal("a,b@x.com", "old@x.com", ["a,b@x.com"])).toBeNull();
    expect(emailWriteRefusal(" a,b@x.com ", undefined, [undefined, "a,b@x.com "])).toBeNull();
    expect(emailWriteRefusal("c,d@x.com", "old@x.com", ["a,b@x.com"])).toBe("delimiter");
  });
});

describe("findTornEmail — the list form of the same rule", () => {
  it("refuses a NEW array member that is not write-safe, malformed ones included", () => {
    expect(findTornEmail(["a@x.com", "not-an-email"], undefined)).toBe("not-an-email");
    expect(findTornEmail(["a@x.com", "b,c@x.com"], ["a@x.com"])).toBe("b,c@x.com");
  });

  it("never refuses a member already stored, or a blank member", () => {
    expect(findTornEmail(["not-an-email", ""], ["not-an-email"])).toBeUndefined();
    expect(findTornEmail([" a,b@x.com "], ["a,b@x.com"])).toBeUndefined();
  });

  it("for a STRING, still refuses a contained stored unsafe address", () => {
    expect(findTornEmail("a,b@x.com, c@y.com", ["a,b@x.com"])).toBe("a,b@x.com");
  });

  it("for a STRING, refuses a new split member that is not write-safe", () => {
    expect(findTornEmail("x,y@z.com", undefined)).toBe("x");
    expect(findTornEmail("c@y.com; nope", ["c@y.com"])).toBe("nope");
  });

  it("for a STRING, accepts a delimited list of write-safe addresses", () => {
    expect(findTornEmail("a@x.com, b@y.com", undefined)).toBeUndefined();
    expect(findTornEmail("", ["a,b@x.com"])).toBeUndefined();
  });
});

describe("normalizeEmailShape — load clean-up, provably equivalent only", () => {
  it("unwraps Name <addr> when the inner address is write-safe", () => {
    expect(normalizeEmailShape("Ada Lovelace <ada@x.com>")).toBe("ada@x.com");
    expect(normalizeEmailShape("  <ada@x.com>  ")).toBe("ada@x.com");
  });
  it("returns everything else unchanged", () => {
    expect(normalizeEmailShape("ada@x.com")).toBe("ada@x.com");
    expect(normalizeEmailShape("Name <a,b@x.com>")).toBe("Name <a,b@x.com>");
    expect(normalizeEmailShape("Name <nope>")).toBe("Name <nope>");
    expect(normalizeEmailShape("not-an-email")).toBe("not-an-email");
    expect(normalizeEmailShape("")).toBe("");
  });
});

describe("normalizeEmailListShape", () => {
  it("splits a member holding several write-safe addresses and unwraps names", () => {
    expect(normalizeEmailListShape(["a@x.com, b@y.com", "Ann <c@z.com>"])).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });
  it("keeps a member whose parts are not all write-safe", () => {
    expect(normalizeEmailListShape(["a,b@x.com"])).toEqual(["a,b@x.com"]);
  });
});

describe("withNormalizedEmailField / withNormalizedResourceEmails", () => {
  it("return the SAME reference when nothing changes", () => {
    const row = { id: 1, ownerEmail: "a@x.com" };
    expect(withNormalizedEmailField(row, "ownerEmail")).toBe(row);
    const res = { id: 1, email: "a@x.com", emails: ["b@y.com"] };
    expect(withNormalizedResourceEmails(res)).toBe(res);
  });
  it("return a new row carrying the normalised value", () => {
    expect(withNormalizedEmailField({ id: 1, ownerEmail: "Ann <a@x.com>" }, "ownerEmail")).toEqual({ id: 1, ownerEmail: "a@x.com" });
    expect(withNormalizedResourceEmails({ id: 1, email: "Ann <a@x.com>", emails: ["b@y.com; c@z.com"] })).toEqual({ id: 1, email: "a@x.com", emails: ["b@y.com", "c@z.com"] });
  });
  it("matches sanitizeResource: drops the primary from the list and never invents an emails key (fix round 1)", () => {
    const deduped = withNormalizedResourceEmails({ id: 1, email: "Ann <a@x.com>", emails: ["a@x.com"] });
    expect(deduped).toEqual({ id: 1, email: "a@x.com" });
    expect(Object.prototype.hasOwnProperty.call(deduped, "emails")).toBe(false);
    const noList = withNormalizedResourceEmails({ id: 1, email: "Ann <a@x.com>" });
    expect(noList).toEqual({ id: 1, email: "a@x.com" });
    expect(Object.prototype.hasOwnProperty.call(noList, "emails")).toBe(false);
  });
});

describe("sanitizeLoadedEmail — normalise, THEN cap (fix round 1)", () => {
  it("unwraps a Name <addr> longer than the cap instead of storing it torn", () => {
    const long = `Ann ${"x".repeat(196)} <a@x.com>`;
    expect(long.length).toBeGreaterThan(200);
    expect(sanitizeLoadedEmail(long, 200)).toBe("a@x.com");
  });
  it("still trims and caps a plain value, and blanks a non-string", () => {
    expect(sanitizeLoadedEmail("  a@x.com  ")).toBe("a@x.com");
    expect(sanitizeLoadedEmail("x".repeat(400))).toHaveLength(320);
    expect(sanitizeLoadedEmail(42)).toBe("");
  });
});

describe("summarizeUnsafeEmailRecords", () => {
  it("counts and names records holding a present unsafe address, never a blank or safe one", () => {
    expect(summarizeUnsafeEmailRecords({
      tasks: [{ taskName: "T1", assigneeEmail: "a,b@x.com" }, { taskName: "T2", assigneeEmail: "" }] as never,
      stakeholders: [{ name: "Sam", email: "sam@x.com" }] as never,
      project: { contactPersons: [{ name: "Cleo", email: "nope", synced: false }] } as never,
    })).toEqual({ count: 2, names: "T1, Cleo" });
    expect(summarizeUnsafeEmailRecords({ tasks: [] })).toBeNull();
  });
  it("reads every slice it is given", () => {
    expect(summarizeUnsafeEmailRecords({
      raid: [{ title: "R1", ownerEmail: "nope" }] as never,
      absences: [{ assignee: "Abe", assigneeEmail: "nope" }] as never,
      shifts: [{ assignee: "Shay", assigneeEmail: "nope" }] as never,
      resources: [{ firstName: "Res", lastName: "One", emails: ["ok@x.com", "a;b@x.com"] }, { firstName: "Res", lastName: "Two", email: "ok@x.com" }] as never,
      stakeholders: [{ name: "Stan", email: "nope" }] as never,
    })).toEqual({ count: 5, names: "R1, Abe, Shay, Res One, Stan" });
  });
  it("caps the names at five", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ taskName: `T${i}`, assigneeEmail: "nope" }));
    expect(summarizeUnsafeEmailRecords({ tasks: tasks as never })?.names).toBe("T0, T1, T2, T3, T4, …");
  });
});

describe("templateSeedEmailScope — the template-apply notice counts only the seed (pre-flight I4)", () => {
  const row = (id: number, taskName: string, assigneeEmail: string) => ({
    id, taskName, assignee: "A", assigneeEmail, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01",
    priority: "Medium", status: "To Do", createdDate: "2026-06-01",
  });

  it("names the seed's unsafe row and never the current project's", () => {
    const current = { ...emptyWorkspace(), tasks: [row(1, "Existing", "old,bad@x.com")] as never };
    const tpl = { id: "tpl-unsafe", name: "T", features: [], fieldVisibility: {}, seed: { tasks: [row(1, "Seeded", "a,b@x.com")] } } as never;
    const next = applyTemplate(current, tpl, { includeSeed: true });
    expect(next.tasks).toHaveLength(2); // control: the seed really landed beside the existing row
    expect(summarizeUnsafeEmailRecords(next)).toEqual({ count: 2, names: "Existing, Seeded" }); // what summarising `next` would announce
    expect(summarizeUnsafeEmailRecords(templateSeedEmailScope(current, next))).toEqual({ count: 1, names: "Seeded" });
  });
});
