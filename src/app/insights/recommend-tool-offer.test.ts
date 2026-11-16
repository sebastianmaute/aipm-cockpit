// §810 — `recommendToolFor` builds the forced tool from exactly the allowed tools chat's predicate offers, one tool
// per offered set. The real allowlist has only one partial state per flag combination, so a people tool that the
// Stakeholders function does not own (send_inquiry) is added to the allowlist here, to drive the partial path end to
// end: the cache key, the schema built from the partial name list, and one identity per answer.
import { describe, expect, it, vi } from "vitest";

vi.mock("./insight", async (orig) => {
  const real = await orig<typeof import("./insight")>();
  return { ...real, ALLOWED_REC_TOOLS: new Set([...real.ALLOWED_REC_TOOLS, "send_inquiry"]) };
});

import { RECOMMEND_TOOL, recommendToolFor } from "./recommend";

type Tool = { input_schema: { properties: { calls: { items: { anyOf: { properties: { name: { enum: string[] } } }[] } } } } };
const offered = (tool: unknown): string[] =>
  (tool as Tool).input_schema.properties.calls.items.anyOf.map((b) => b.properties.name.enum[0]!);

describe("recommendToolFor with an extra allowed people tool", () => {
  it("a hidden Stakeholders function keeps the tool it does not own; protection drops every people tool", () => {
    const stk = offered(recommendToolFor({ stakeholdersHidden: true }));
    expect(stk).toContain("send_inquiry");
    expect(stk).not.toContain("update_stakeholder");
    expect(stk).toContain("update_task");
    const prot = offered(recommendToolFor({ peopleProtected: true }));
    expect(prot).not.toContain("send_inquiry");
    expect(prot).not.toContain("update_stakeholder");
    expect(offered(recommendToolFor({}))).toContain("send_inquiry");
  });

  it("keeps one identity per offered set, and different sets get different tools", () => {
    expect(recommendToolFor({ stakeholdersHidden: true })).toBe(recommendToolFor({ stakeholdersHidden: true }));
    expect(recommendToolFor({ peopleProtected: true })).toBe(recommendToolFor({ peopleProtected: true }));
    expect(recommendToolFor({ stakeholdersHidden: true })).not.toBe(recommendToolFor({ peopleProtected: true }));
    expect(recommendToolFor({})).toBe(RECOMMEND_TOOL);
  });
});
