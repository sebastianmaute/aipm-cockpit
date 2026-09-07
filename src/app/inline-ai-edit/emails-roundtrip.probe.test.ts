import { describe, expect, it } from "vitest";
import { describeEntityCalls, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { sanitizeEmailList } from "../sanitize-entities";
import type { Workspace } from "../workspace";

// ★ RETAINED DELIBERATELY — this is 422's reproduce, not a scratch script.
// The previous probe for this entry was a Playwright spec that was deleted,
// which is why the entry could not be acted on for months. It is a UNIT probe
// because the question is decided in pure code: `describeEntityCalls` builds
// `plan.updates` and `use-inline-entity-edit.ts` maps that array into the patch.
//
// ★★ WHAT THIS FILE ANSWERS, AND WHAT IT DOES NOT.
//  ANSWERS: whether a comma-bearing stored address is projected as a joined
//  string the writer re-splits (test 1); whether an `update_resource` naming
//  only ANOTHER field puts `emails` into `plan.updates` at all (test 2); and
//  what the writer does with the projected string when `emails` IS in the plan
//  (test 3).
//  DOES NOT ANSWER: anything about the model's behaviour. Whether a real model,
//  asked to change one field, echoes the whole row back with an `emails` key is
//  outside a unit test — these probes construct the tool-use block directly.
//  So test 2 refutes "applying ANY unrelated edit destroys it" only for edits
//  whose tool input does not carry `emails`; it says nothing about a model that
//  volunteers the key unbidden.
describe("422: does a comma-bearing address survive an inline edit", () => {
  const d = INLINE_DESCRIPTORS.resource;
  const row = { id: 1, firstName: "Ada", lastName: "Lovelace", emails: ["a,b@x.com"] };
  const ws = { resources: [row] } as unknown as Workspace;

  const planFor = (input: Record<string, unknown>) => {
    const block: ToolUseLike = { type: "tool_use", name: d.updateTool, input };
    return describeEntityCalls([block], { descriptor: d, item: row, ws });
  };

  it("projects the stored list as a joined string the writer will re-split", () => {
    const projected = d.fieldSanitizers.emails(row.emails, row);
    expect(projected).toBe("a,b@x.com");
  });

  it("says whether an edit naming only another field puts emails in the plan", () => {
    // The premise of §422 as written: applying ANY unrelated edit destroys the
    // address. The loop in `describeEntityCalls` is guarded by `if (!(f in
    // input)) continue`, and `use-inline-entity-edit.ts` builds its patch from
    // `plan.updates` alone — so a field the model did not name reaches neither.
    // MEASURED ANSWER: `emails` is NOT in the plan. §422's trigger claim is
    // REFUTED for any edit whose tool input omits the key.
    const plan = planFor({ id: 1, firstName: "Grace" });
    expect(plan.updates.map((u) => u.field)).not.toContain("emails");
    expect(plan.updates.map((u) => u.field)).toEqual(["firstName"]);
    // Anti-vacuity: the probe really did reach the diff loop for this entity,
    // rather than being rejected wholesale before any field was considered.
    expect(plan.rejected).toEqual([]);
  });

  it("says whether an edit that DOES name emails round-trips the comma", () => {
    // The narrower trigger the register entry should describe. When the model
    // supplies `emails` and changes it, `FieldDiff.raw` is the JOINED string,
    // and `coerce` (use-inline-entity-edit.ts) passes a non-`arrayFields` value
    // through untouched — pinned here by the descriptor assertion rather than
    // by calling `coerce`, which is not exported — so the writer's own
    // `sanitizeEmailList` receives that string and takes its `[;,]` branch.
    expect(d.arrayFields.has("emails")).toBe(false);
    const plan = planFor({ id: 1, emails: ["a,b@x.com", "c@y.com"] });
    const diff = plan.updates.find((u) => u.field === "emails");
    expect(diff?.raw).toBe("a,b@x.com, c@y.com");
    // The write path re-parses that string. One stored address containing a
    // comma comes back as two.
    expect(sanitizeEmailList(diff?.raw, undefined)).toEqual(["a", "b@x.com", "c@y.com"]);
  });

  it("says whether an unchanged emails key round-trips the comma", () => {
    // The other half of the narrower trigger: the model echoing the stored list
    // back verbatim. `before === after` short-circuits the diff loop, so an
    // echoed key is no more destructive than an omitted one.
    const plan = planFor({ id: 1, firstName: "Grace", emails: ["a,b@x.com"] });
    expect(plan.updates.map((u) => u.field)).toEqual(["firstName"]);
  });
});
