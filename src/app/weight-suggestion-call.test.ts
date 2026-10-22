import { describe, it, expect, vi, afterEach } from "vitest";
import { runWeightSuggestion } from "./weight-suggestion-call";
import { defaultNextActionsConfig } from "./settings-types";

// §763 — under auto tool choice the model thinks on the same output budget. A reply cut at it carries
// `{}` (read as "no change suggested") or only its first suggestions, and both parse without an error,
// so a cut reply is never read: it is asked for once more with 8192, and a cut retry is the parse error.
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
const reply = (stop: string, input: unknown) =>
  ok({ stop_reason: stop, content: [{ type: "tool_use", name: "suggest_weights", input }] });
const WHOLE = {
  suggestions: [{ field: "clarityBonus", suggested: 20, rationale: "Acted on clear actions." }],
  overallRationale: "Favour clear actions.",
};
const budgets = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).max_tokens as number);
const run = () => runWeightSuggestion("ctx", { apiKey: "k", model: "m" }, defaultNextActionsConfig, "weights");

describe("runWeightSuggestion output budget (§763)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks for 4096 tokens and reads a reply that was not cut", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply("tool_use", WHOLE));
    const out = await run();
    expect(out.suggestions.map((s) => s.field)).toEqual(["clarityBonus"]);
    expect(budgets(spy)).toEqual([4096]);
  });

  it("asks once more with 8192 tokens when the reply was cut with an empty input, and returns that answer", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reply("max_tokens", {}))
      .mockResolvedValueOnce(reply("tool_use", WHOLE));
    const out = await run();
    expect(out.suggestions.map((s) => s.field)).toEqual(["clarityBonus"]);
    expect(budgets(spy)).toEqual([4096, 8192]);
  });

  it("never reads a cut reply, even one that parses; a cut retry is the parse error", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reply("max_tokens", WHOLE))
      .mockResolvedValueOnce(reply("max_tokens", WHOLE));
    await expect(run()).rejects.toThrow(/^parse$/);
    expect(budgets(spy)).toEqual([4096, 8192]);
  });

  it("does not retry a reply that was not cut", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply("tool_use", {}));
    const out = await run();
    expect(out.suggestions).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
