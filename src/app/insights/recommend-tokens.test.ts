import { describe, it, expect } from "vitest";
import { stampRecommendationTokens, UPDATE_TARGET } from "./recommend-tokens";
import { entityToken } from "../ai-entity-token";
import { ALLOWED_REC_TOOLS, type InsightRecommendation } from "./insight";
import { TOOL_DEFS } from "../chat-tool-defs";
import { describeRecommendationPlan, type RecommendPlanWorkspace } from "./recommend-plan";

const task = { id: 42, taskName: "Fix login", status: "To Do", dueDate: "2026-08-12" };
const raidItem = { id: 7, category: "R", title: "Vendor risk", status: "Open" };
const milestone = { id: 3, name: "Go live", date: "2026-09-01", linkedTaskIds: [] };
const change = { id: 5, title: "Scope bump", status: "Proposed" };
const stakeholder = { id: 9, name: "Ada", category: "Sponsor" };

const ws = {
  tasks: [task], raid: [raidItem], milestones: [milestone],
  changes: [change], stakeholders: [stakeholder],
} as unknown as RecommendPlanWorkspace;

function rec(calls: { name: string; input: Record<string, unknown> }[]): InsightRecommendation {
  return { summary: "do the thing", proposedCalls: calls, generatedAt: "2026-09-03", status: "proposed" };
}

// ★★ EQUALITY, NEVER PRESENCE. A stamper that attached a constant, an empty
// string or the id would satisfy `toHaveProperty("expectedToken")` and then be
// REFUSED at runtime by requireToken — reintroducing, behind a green test, the
// exact breakage this threading exists to fix. Every case below compares
// against `entityToken` recomputed from the same row.
describe("stamps each update_* call with its target row's real token", () => {
  const cases = [
    ["update_task", 42, "task", task],
    ["update_raid_item", 7, "raid", raidItem],
    ["update_milestone", 3, "milestone", milestone],
    ["update_change", 5, "change", change],
    ["update_stakeholder", 9, "stakeholder", stakeholder],
  ] as const;

  for (const [name, id, kind, row] of cases) {
    it(`${name} carries entityToken("${kind}", row)`, () => {
      const out = stampRecommendationTokens(rec([{ name, input: { id, note: "x" } }]), ws);
      expect(out.proposedCalls[0].input.expectedToken).toBe(entityToken(kind, row));
    });
  }
});

it("keeps every other input field, and the recommendation's own fields, intact", () => {
  const out = stampRecommendationTokens(rec([{ name: "update_task", input: { id: 42, status: "Done" } }]), ws);
  expect(out.proposedCalls[0].input.id).toBe(42);
  expect(out.proposedCalls[0].input.status).toBe("Done");
  expect(out.summary).toBe("do the thing");
  expect(out.status).toBe("proposed");
});

it("leaves create_* calls untouched — a create has no stored row to token", () => {
  const call = { name: "create_task", input: { taskName: "New", assignee: "A", dueDate: "2026-09-09" } };
  const out = stampRecommendationTokens(rec([call]), ws);
  expect(out.proposedCalls[0].input).not.toHaveProperty("expectedToken");
});

// ★ Not-found stays unstamped ON PURPOSE: the replay then reports the
// dispatcher's own "not found", which is the more useful error than "changed
// since you read it" for a row that is simply gone.
it("leaves an update whose target row is gone unstamped", () => {
  const out = stampRecommendationTokens(rec([{ name: "update_task", input: { id: 999 } }]), ws);
  expect(out.proposedCalls[0].input).not.toHaveProperty("expectedToken");
});

it("leaves an update with a non-numeric id unstamped", () => {
  const out = stampRecommendationTokens(rec([{ name: "update_task", input: { id: "nope" } }]), ws);
  expect(out.proposedCalls[0].input).not.toHaveProperty("expectedToken");
});

// The token must track the row, not merely exist: an edited row yields a
// DIFFERENT token, which is the only reason the guard can ever refuse.
it("yields a different token once the target row changes", () => {
  const before = stampRecommendationTokens(rec([{ name: "update_task", input: { id: 42 } }]), ws);
  const movedWs = { ...ws, tasks: [{ ...task, status: "In Progress" }] } as unknown as RecommendPlanWorkspace;
  const after = stampRecommendationTokens(rec([{ name: "update_task", input: { id: 42 } }]), movedWs);
  expect(after.proposedCalls[0].input.expectedToken).not.toBe(before.proposedCalls[0].input.expectedToken);
});

// The stored recommendation feeds a reference-equality dirty check on save; an
// in-place stamp would be invisible to it.
it("does not mutate the recommendation it was given", () => {
  const original = rec([{ name: "update_task", input: { id: 42 } }]);
  const out = stampRecommendationTokens(original, ws);
  expect(original.proposedCalls[0].input).not.toHaveProperty("expectedToken");
  expect(out).not.toBe(original);
});

// ★★ THE STAMP MUST BE INVISIBLE TO THE REVIEW MODAL. `expectedToken` is a
// control value, not a field of any entity, so a user reviewing a
// recommendation must never be shown "expectedToken: → a1b2…" as a proposed
// change. It is kept out by `describeEntityCalls` iterating the descriptor's
// `diffFields` WHITELIST — pinned here because that is an invariant of another
// module, and a future rewrite to "diff whatever the model sent" would surface
// it with nothing else complaining.
it("does not surface the token as a proposed field change in the review preview", () => {
  const stamped = stampRecommendationTokens(rec([{ name: "update_task", input: { id: 42, status: "Done" } }]), ws);
  const plan = describeRecommendationPlan(stamped.proposedCalls, ws);
  expect(plan.updates.map((u) => u.field)).toEqual(["status"]);
  // Anti-vacuity: the token really was stamped onto the call being previewed,
  // so the assertion above is about filtering, not about an absent token.
  expect(stamped.proposedCalls[0].input.expectedToken).toBe(entityToken("task", task));
});

// ★★★ THE DRIFT THIS PINS IS UNRETRYABLE IN PRODUCTION, WHICH IS WHY IT IS
//   WORTH A TEST RATHER THAN A COMMENT. A tool that is both recommendable and
//   token-guarded, but missing from `UPDATE_TARGET`, is replayed with NO token
//   and refused every time — on the insight-recommendation path, which has no
//   human in the loop to re-read the row and retry. `recommend-tokens.ts` states
//   the invariant ("adding it to that allow-set means adding a row here in the
//   same commit") and, before this case, nothing enforced it.
// ★★ ENUMERATE THE GUARDED SET BY WHAT A SCHEMA ADVERTISES, NEVER BY THE
//   `update_*` NAME — `set_task_dependencies` is guarded and does not carry the
//   prefix, so a name-based enumeration would call this green while missing
//   exactly the tool whose addition to the allow-set is most plausible.
describe("every recommendable guarded tool can be stamped", () => {
  const guarded = new Set(
    TOOL_DEFS.filter(
      (d) =>
        "expectedToken" in
        ((d.input_schema as { properties?: Record<string, unknown> }).properties ?? {}),
    ).map((d) => d.name),
  );
  const recommendableGuarded = [...ALLOWED_REC_TOOLS].filter((t) => guarded.has(t)).sort();

  it("has a stamp target for each one", () => {
    // Anti-vacuity: an empty intersection would satisfy the subset assertion
    // below for the wrong reason. Five tools are recommendable AND guarded
    // today; the floor is deliberately loose so legitimately adding a sixth
    // does not turn this red, while a broken `guarded` enumeration (which would
    // collapse it to 0) does.
    expect(recommendableGuarded.length).toBeGreaterThanOrEqual(5);
    const unstampable = recommendableGuarded.filter((t) => !(t in UPDATE_TARGET));
    expect(unstampable).toEqual([]);
  });

  it("stamps a token onto every one of them, so no row is present but inert", () => {
    for (const name of recommendableGuarded) {
      const { kind, key } = UPDATE_TARGET[name];
      const row = (ws[key] as unknown as readonly { id: number }[])[0];
      const out = stampRecommendationTokens(rec([{ name, input: { id: row.id } }]), ws);
      expect(out.proposedCalls[0].input.expectedToken, `${name} must be stamped`).toBe(
        entityToken(kind, row),
      );
    }
  });
});
