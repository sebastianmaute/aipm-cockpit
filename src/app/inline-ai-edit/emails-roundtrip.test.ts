import { describe, expect, it } from "vitest";
import { describeEntityCalls, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { sanitizeEmailList } from "../sanitize-entities";
import { findDelimiterUnsafeEmail, isDelimiterSafeEmail } from "../sanitize";
import type { Workspace } from "../workspace";

// ★★★ open-followups §422 — THE REGRESSION TEST, converted from the retained
// probe (`emails-roundtrip.probe.test.ts`, committed as 66235c60).
// `resource.emails` crosses the inline edit as a ", "-joined string (the
// descriptor's `emails` entry), `coerce` passes it through untouched, and the
// writer's `sanitizeEmailList` re-splits it on `[;,]` — so an address carrying
// either delimiter lands as two. The transport itself stays lossy (test 1); the
// fix is that every WRITE boundary refuses such an address. This file pins the
// inline-edit half: a changed `emails` list that CARRIES one is refused as a
// field, and every other field in the same call still applies.
// ★ It constructs tool-use blocks directly, so it says nothing about MODEL
// behaviour — only about what the plan does with a given input.
describe("isDelimiterSafeEmail / findDelimiterUnsafeEmail", () => {
  it("refuses a comma or a semicolon and nothing else", () => {
    expect(isDelimiterSafeEmail("a@x.com")).toBe(true);
    expect(isDelimiterSafeEmail("  a@x.com  ")).toBe(true);
    expect(isDelimiterSafeEmail("not an address")).toBe(true); // no format validation
    expect(isDelimiterSafeEmail("a,b@x.com")).toBe(false);
    expect(isDelimiterSafeEmail("a;b@x.com")).toBe(false);
  });

  it("inspects an array only, returning the first unsafe member", () => {
    expect(findDelimiterUnsafeEmail(["a@x.com", "b,c@x.com", "d;e@x.com"])).toBe("b,c@x.com");
    expect(findDelimiterUnsafeEmail(["a@x.com"])).toBeUndefined();
    expect(findDelimiterUnsafeEmail([])).toBeUndefined();
    // A string IS a delimited list by definition — splitting it is the writer's design.
    expect(findDelimiterUnsafeEmail("a@x.com, b@y.com")).toBeUndefined();
    expect(findDelimiterUnsafeEmail(undefined)).toBeUndefined();
    expect(findDelimiterUnsafeEmail([42, "a@x.com"])).toBeUndefined();
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

  it("refuses a changed emails list that carries the comma-bearing address, so the patch never holds it", () => {
    const plan = planFor({ id: 1, emails: ["a,b@x.com", "c@y.com"] });
    // `use-inline-entity-edit.ts` builds its patch from `plan.updates` alone.
    expect(plan.updates.map((u) => u.field)).not.toContain("emails");
    expect(plan.rejected).toEqual([
      { toolName: d.updateTool, reason: "bad-input", detail: "emails=a,b@x.com, c@y.com" },
    ]);
  });

  it("still applies an unrelated field in the same call", () => {
    const plan = planFor({ id: 1, firstName: "Grace", emails: ["a,b@x.com", "c@y.com"] });
    expect(plan.updates.map((u) => u.field)).toEqual(["firstName"]);
    expect(plan.rejected.map((r) => r.detail)).toEqual(["emails=a,b@x.com, c@y.com"]);
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
    // ★ `detail` is built from the NORMALISED `after`, and `fieldSanitizers.emails`
    // always applies the writer's own split-then-", "-join round-trip to a STRING
    // input regardless of whether the field is ultimately accepted or refused —
    // so the rejected string shows "a, b@x.com" (already re-split), not the raw
    // "a,b@x.com" the model sent. That round-trip IS the defect §422 refuses to
    // let reach storage; seeing it in the rejection detail is expected, not a bug.
    expect(plan.rejected.map((r) => r.detail)).toEqual(["emails=a, b@x.com, c@y.com"]);
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
