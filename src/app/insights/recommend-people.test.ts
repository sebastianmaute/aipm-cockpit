// AI people protection, Task 5 review round 1 (I1): under protection the recommendation call does not
// offer the people tools that `ALLOWED_REC_TOOLS` admits (the stakeholder writers). The allowlist itself
// is a security boundary and stays as it is; the ADVERTISED schema is filtered per send.
import { describe, it, expect, vi } from "vitest";

const forced = vi.hoisted(() => vi.fn());
vi.mock("../ai-forced-call", () => ({ runForcedToolCallWithRetry: forced }));

import { PEOPLE_TOOLS } from "../chat-tool-defs";
import { ALLOWED_REC_TOOLS } from "./insight";
import { recommendToolFor } from "./recommend";
import { runInsightRecommendation } from "./recommend-call";
import { aiPrivacyFor } from "../ai-privacy";
import { emptyWorkspace } from "../workspace";

type Tool = { input_schema: { properties: { calls: { items: { anyOf: { properties: { name: { enum: string[] } } }[] } } } } };
const offered = (tool: unknown): string[] =>
  (tool as Tool).input_schema.properties.calls.items.anyOf.map((b) => b.properties.name.enum[0]!);

describe("the recommendation tool under people protection", () => {
  it("offers no people tool when protected, and every allowed tool when not", () => {
    expect(offered(recommendToolFor(true)).filter((n) => PEOPLE_TOOLS.has(n))).toEqual([]);
    expect(offered(recommendToolFor(true)).length).toBeGreaterThan(0);
    expect(new Set(offered(recommendToolFor(false)))).toEqual(new Set(ALLOWED_REC_TOOLS));
    // The allowlist is not shrunk: it still admits the stakeholder writers.
    expect(ALLOWED_REC_TOOLS.has("update_stakeholder")).toBe(true);
    // One identity per answer: the tool list is part of a cacheable prefix.
    expect(recommendToolFor(true)).toBe(recommendToolFor(true));
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
