// AI people protection: under protection the recommendation call does not
// offer the people tools that `ALLOWED_REC_TOOLS` admits (the stakeholder writers). The allowlist itself
// is a security boundary and stays as it is; the ADVERTISED schema is filtered per send.
import { describe, it, expect, vi } from "vitest";

const forced = vi.hoisted(() => vi.fn());
vi.mock("../ai-forced-call", () => ({ runForcedToolCallWithRetry: forced }));

import { PEOPLE_TOOLS, STAKEHOLDER_TOOLS } from "../chat-tool-defs";
import { ALLOWED_REC_TOOLS } from "./insight";
import { offeredRecTools, recommendToolFor } from "./recommend";
import { runInsightRecommendation } from "./recommend-call";
import { aiPrivacyFor } from "../ai-privacy";
import { emptyWorkspace } from "../workspace";

type Tool = { input_schema: { properties: { calls: { items: { anyOf: { properties: { name: { enum: string[] } } }[] } } } } };
const offered = (tool: unknown): string[] =>
  (tool as Tool).input_schema.properties.calls.items.anyOf.map((b) => b.properties.name.enum[0]!);

describe("the recommendation tool under people protection", () => {
  it("offers no people tool when protected, and every allowed tool when not", () => {
    expect(offered(recommendToolFor({ peopleProtected: true })).filter((n) => PEOPLE_TOOLS.has(n))).toEqual([]);
    expect(offered(recommendToolFor({ peopleProtected: true })).length).toBeGreaterThan(0);
    expect(new Set(offered(recommendToolFor({ peopleProtected: false })))).toEqual(new Set(ALLOWED_REC_TOOLS));
    // The allowlist is not shrunk: it still admits the stakeholder writers.
    expect(ALLOWED_REC_TOOLS.has("update_stakeholder")).toBe(true);
    // One identity per answer: the tool list is part of a cacheable prefix.
    expect(recommendToolFor({ peopleProtected: true })).toBe(recommendToolFor({ peopleProtected: true }));
  });

  it("the call sends the filtered tool, decided by the request's own privacy", async () => {
    forced.mockResolvedValue({ stopReason: "end_turn", input: {} });
    const protectedPrivacy = aiPrivacyFor([{ key: "p1", ws: emptyWorkspace() }]);
    expect(protectedPrivacy.protected).toBe(true);
    await runInsightRecommendation({
      apiKey: "k", model: "m", privacy: protectedPrivacy, context: "c",
      index: { "open-points": new Set(), raid: new Set(), milestones: new Set(), changes: new Set(), stakeholders: new Set() },
      today: "2026-10-30",
    }).catch(() => undefined);
    const sent = (forced.mock.calls[0]![0] as { tools: unknown[] }).tools[0];
    expect(offered(sent)).not.toContain("update_stakeholder");

    forced.mockClear();
    await runInsightRecommendation({
      apiKey: "k", model: "m", privacy: aiPrivacyFor([]), context: "c",
      index: { "open-points": new Set(), raid: new Set(), milestones: new Set(), changes: new Set(), stakeholders: new Set() },
      today: "2026-10-30",
    }).catch(() => undefined);
    expect(offered((forced.mock.calls[0]![0] as { tools: unknown[] }).tools[0])).toContain("update_stakeholder");
  });
});

// §810 — a hidden Stakeholders function withdraws the stakeholder writers, by chat's predicate; a hidden Resources
// function withdraws none of the offered tools (no Resources tool is in ALLOWED_REC_TOOLS).
describe("the recommendation tool with a hidden function (§810)", () => {
  const index = { "open-points": new Set<number>(), raid: new Set<number>(), milestones: new Set<number>(), changes: new Set<number>(), stakeholders: new Set<number>() };

  it("offers no stakeholder tool while Stakeholders is hidden, and every allowed tool while only Resources is", () => {
    expect(offered(recommendToolFor({ stakeholdersHidden: true })).filter((n) => STAKEHOLDER_TOOLS.has(n))).toEqual([]);
    expect(offered(recommendToolFor({ stakeholdersHidden: true })).length).toBeGreaterThan(0);
    expect(new Set(offered(recommendToolFor({ resourcesHidden: true })))).toEqual(new Set(ALLOWED_REC_TOOLS));
    expect(new Set(offered(recommendToolFor({ stakeholdersHidden: false })))).toEqual(new Set(ALLOWED_REC_TOOLS));
  });

  // The people-protected union drops exactly the people tools, so it is only the right answer while every allowed
  // tool a switch can withhold is one of them.
  // Withheld per tool by chat's predicate, never as a whole union: with a people tool that Stakeholders does not own
  // added to the allowed set (send_inquiry here, stubbed), a hidden Stakeholders function still offers it.
  it("withholds per tool: a hidden Stakeholders function never drops a tool it does not own", () => {
    const allowed = ["update_task", "update_stakeholder", "send_inquiry"];
    expect(offeredRecTools(allowed, { stakeholdersHidden: true })).toEqual(["update_task", "send_inquiry"]);
    expect(offeredRecTools(allowed, { peopleProtected: true })).toEqual(["update_task"]);
    expect(offeredRecTools(allowed, {})).toEqual(allowed);
  });

  it("the call sends the filtered tool when its args say Stakeholders is hidden", async () => {
    forced.mockClear();
    forced.mockResolvedValue({ stopReason: "end_turn", input: {} });
    await runInsightRecommendation({ apiKey: "k", model: "m", privacy: aiPrivacyFor([]), context: "c", index, today: "2026-10-30", stakeholdersHidden: true }).catch(() => undefined);
    expect(offered((forced.mock.calls[0]![0] as { tools: unknown[] }).tools[0])).not.toContain("update_stakeholder");
    forced.mockClear();
    await runInsightRecommendation({ apiKey: "k", model: "m", privacy: aiPrivacyFor([]), context: "c", index, today: "2026-10-30", stakeholdersHidden: false }).catch(() => undefined);
    expect(offered((forced.mock.calls[0]![0] as { tools: unknown[] }).tools[0])).toContain("update_stakeholder");
  });
});
