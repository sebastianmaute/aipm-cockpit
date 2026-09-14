import { describe, expect, it } from "vitest";
import { describeEntityCalls, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { sanitizeEmailList } from "../sanitize-entities";
import { findTornEmail, isDelimiterSafeEmail } from "../sanitize";
import type { Workspace } from "../workspace";

// ★★★ open-followups §422 — THE REGRESSION TEST, converted from the retained
// probe (`emails-roundtrip.probe.test.ts`, committed as 66235c60).
// The card renders `resource.emails` as a ", "-joined string, and the writer's
// `sanitizeEmailList` re-splits any STRING on `[;,]` — so an address carrying
// either delimiter lands as two whenever it reaches the writer inside a string.
// The fix is ONE rule, `findTornEmail`, asked by every write boundary. This
// file pins the predicate and the plan half; `emails-write-parity.test.ts`
// pins that the plan, `updateResource` and the inline write agree cell by cell.
// ★ It constructs tool-use blocks directly, so it says nothing about MODEL
// behaviour — only about what the plan does with a given input.
describe("isDelimiterSafeEmail", () => {
  it("refuses a comma or a semicolon and nothing else", () => {
    expect(isDelimiterSafeEmail("a@x.com")).toBe(true);
    expect(isDelimiterSafeEmail("  a@x.com  ")).toBe(true);
    expect(isDelimiterSafeEmail("not an address")).toBe(true); // no format validation
    expect(isDelimiterSafeEmail("a,b@x.com")).toBe(false);
    expect(isDelimiterSafeEmail("a;b@x.com")).toBe(false);
  });
});

describe("findTornEmail — the one §422 rule", () => {
  it("ARRAY: returns the first unsafe member not already stored, trimmed", () => {
    expect(findTornEmail(["a@x.com", "b,c@x.com", "d;e@x.com"], undefined)).toBe("b,c@x.com");
    expect(findTornEmail(["a,b@x.com"], ["a,b@x.com"])).toBeUndefined();
    expect(findTornEmail([" a,b@x.com "], ["a,b@x.com "])).toBeUndefined();
    expect(findTornEmail(["a,b@x.com", "c;d@x.com"], ["a,b@x.com"])).toBe("c;d@x.com");
    expect(findTornEmail(["a@x.com"], ["a,b@x.com"])).toBeUndefined();
    expect(findTornEmail([], ["a,b@x.com"])).toBeUndefined();
    expect(findTornEmail([42, "a@x.com"], undefined)).toBeUndefined();
  });

  it("ARRAY with no stored list refuses every unsafe member", () => {
    expect(findTornEmail(["a,b@x.com"], undefined)).toBe("a,b@x.com");
    expect(findTornEmail(["a,b@x.com"], [])).toBe("a,b@x.com");
  });

  it("STRING: returns a stored unsafe address the string contains, or a new split member that is not write-safe, else undefined", () => {
    expect(findTornEmail("a,b@x.com, c@y.com", ["a,b@x.com"])).toBe("a,b@x.com");
    expect(findTornEmail("c@y.com", [" a,b@x.com "])).toBeUndefined();
    expect(findTornEmail("", ["a,b@x.com"])).toBeUndefined();
    // A new comma inside a string IS a delimited list — splitting it is the writer's
    // design, but a new split member must now be write-safe too: "x" is not an address.
    expect(findTornEmail("x,y@z.com", ["a,b@x.com"])).toBe("x");
    expect(findTornEmail("a@x.com, b@y.com", ["a@x.com"])).toBeUndefined();
    expect(findTornEmail("a,b@x.com", undefined)).toBe("a");
  });

  it("anything else returns undefined", () => {
    expect(findTornEmail(undefined, ["a,b@x.com"])).toBeUndefined();
    expect(findTornEmail(42, ["a,b@x.com"])).toBeUndefined();
    expect(findTornEmail(null, ["a,b@x.com"])).toBeUndefined();
  });
});

describe("§422: a comma-bearing address cannot be torn in two by an inline edit", () => {
  const d = INLINE_DESCRIPTORS.resource;
  const row = { id: 1, firstName: "Ada", lastName: "Lovelace", emails: ["a,b@x.com"] };
  const ws = { resources: [row] } as unknown as Workspace;

  const planFor = (input: Record<string, unknown>) => {
    const block: ToolUseLike = { type: "tool_use", name: d.updateTool, input };
    return describeEntityCalls([block], { descriptor: d, item: row, ws });
  };

  it("the transport is still lossy — which is why the plan must refuse, not pass through", () => {
    expect(d.fieldSanitizers.emails(row.emails, row)).toBe("a,b@x.com");
    expect(d.arrayFields.has("emails")).toBe(false);
    expect(sanitizeEmailList("a,b@x.com, c@y.com", undefined)).toEqual(["a", "b@x.com", "c@y.com"]);
  });

  it("refuses a changed emails list that carries a NEW comma-bearing address, so the patch never holds it", () => {
    const plan = planFor({ id: 1, emails: ["a,b@x.com", "c;d@y.com"] });
    // `use-inline-entity-edit.ts` builds its patch from `plan.updates` alone.
    expect(plan.updates.map((u) => u.field)).not.toContain("emails");
    expect(plan.rejected).toEqual([
      { toolName: d.updateTool, reason: "bad-input", detail: "emails=a,b@x.com, c;d@y.com" },
    ]);
  });

  it("still applies an unrelated field in the same call", () => {
    const plan = planFor({ id: 1, firstName: "Grace", emails: ["a,b@x.com", "c;d@y.com"] });
    expect(plan.updates.map((u) => u.field)).toEqual(["firstName"]);
    expect(plan.rejected.map((r) => r.detail)).toEqual(["emails=a,b@x.com, c;d@y.com"]);
  });

  it("accepts an array that KEEPS the stored comma-bearing address, carrying the raw array for the write", () => {
    // An array is stored verbatim, so keeping an address the row already holds
    // tears nothing — and the inline write replays this array, not the joined
    // preview string (`rawInput`).
    const plan = planFor({ id: 1, emails: ["a,b@x.com", "c@y.com"] });
    expect(plan.rejected).toEqual([]);
    expect(plan.updates).toEqual([
      { entity: "resource", field: "emails", before: "a,b@x.com", after: "a,b@x.com, c@y.com", raw: "a,b@x.com, c@y.com", rawInput: ["a,b@x.com", "c@y.com"] },
    ]);
  });

  it("does not refuse a changed list of delimiter-safe addresses (control)", () => {
    // The stored comma address is REMOVED here, visibly, by the proposed list —
    // nothing is split, so there is nothing to refuse.
    const plan = planFor({ id: 1, emails: ["c@y.com"] });
    expect(plan.rejected).toEqual([]);
    expect(plan.updates.map((u) => u.field)).toEqual(["emails"]);
  });

  it("refuses a changed emails STRING while the stored list holds a comma-bearing address (controller ruling)", () => {
    const plan = planFor({ id: 1, firstName: "Grace", emails: "a,b@x.com, c@y.com" });
    expect(plan.updates.map((u) => u.field)).toEqual(["firstName"]);
    // ★ `detail` is built from the RAW incoming value (`str(input[f])`), never
    // the normalised `after` — `after` has already been through
    // `fieldSanitizers.emails`, which re-splits a STRING on `[;,]` and rejoins
    // it, so using it here would show the model an address it never sent.
    expect(plan.rejected.map((r) => r.detail)).toEqual(["emails=a,b@x.com, c@y.com"]);
  });

  it("does not refuse a changed emails STRING when the stored list is delimiter-safe (control)", () => {
    const safeRow = { ...row, emails: ["a@x.com"] };
    const block: ToolUseLike = { type: "tool_use", name: d.updateTool, input: { id: 1, emails: "a@x.com, c@y.com" } };
    const plan = describeEntityCalls([block], { descriptor: d, item: safeRow, ws: { resources: [safeRow] } as unknown as Workspace });
    expect(plan.rejected).toEqual([]);
    expect(plan.updates.map((u) => u.field)).toEqual(["emails"]);
  });

  it("leaves emails out of the plan when the call omits it or echoes it unchanged", () => {
    expect(planFor({ id: 1, firstName: "Grace" }).updates.map((u) => u.field)).toEqual(["firstName"]);
    const echoed = planFor({ id: 1, firstName: "Grace", emails: ["a,b@x.com"] });
    expect(echoed.updates.map((u) => u.field)).toEqual(["firstName"]);
    expect(echoed.rejected).toEqual([]);
  });
});
