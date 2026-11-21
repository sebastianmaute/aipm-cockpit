import { describe, it, expect } from "vitest";
import { buildChatPromptLayout, buildStableSystemBlocks, buildTurnContext } from "./chat-api";
import type { OperatingGuide } from "./operating-guide";

// §702 — the two layouts of the chat prompt's view guides. "system" is the shipped layout (the view's guides are
// `system` block 1); "turn" is slice G2, which the cost harness measured (`scripts/ai-eval.ts`, variant "g2"): the
// view's guides lead the turn context, so `system` no longer moves with the view.

function snapshot(view: string) {
  return {
    today: "2026-11-21", language: "en-US", holidayCountries: [], storageKind: "indexeddb", taskCount: 3,
    knownGroups: [], knownLabels: [], mode: "advanced", enabledModules: [], currentView: view, insights: [],
  } as never;
}

const guides: OperatingGuide[] = [
  { id: "always", name: "Leadership", content: "ALWAYSPROBE", enabled: true, priority: 1, scope: {}, builtIn: true },
  {
    id: "budget", name: "Budget guide", content: "BUDGETPROBE", enabled: true,
    priority: 3, scope: { views: ["budget"] }, builtIn: true,
  },
];

describe("buildChatPromptLayout (§702)", () => {
  it("system layout: exactly the shipped blocks and turn context", () => {
    const snap = snapshot("budget");
    const layout = buildChatPromptLayout("en-US", snap, guides, true, {}, false);
    expect(layout.system).toEqual(buildStableSystemBlocks("en-US", snap, guides, true, {}));
    expect(layout.turnContext).toBe(buildTurnContext("en-US", snap, guides, true, {}));
    expect(layout.system).toHaveLength(2);
    expect(layout.viewText).toBe(layout.system[1].text);
    expect(layout.viewText).toContain("BUDGETPROBE");
  });

  it("turn layout: system is block 0 alone, and the view guide leads the turn context as the harness measured", () => {
    const snap = snapshot("budget");
    const shipped = buildStableSystemBlocks("en-US", snap, guides, true, {});
    const turn = buildTurnContext("en-US", snap, guides, true, {});
    const layout = buildChatPromptLayout("en-US", snap, guides, true, {}, true);
    expect(layout.system).toEqual([shipped[0]]);
    expect(layout.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(layout.viewText).toBe(shipped[1].text);
    // The harness's g2 arm: `[...viewScoped.map((b) => b.text), turn].join("\n\n")`.
    expect(layout.turnContext).toBe(`${shipped[1].text}\n\n${turn}`);
    expect(JSON.stringify(layout.system)).not.toContain("BUDGETPROBE");
  });

  it("turn layout: system is byte-identical across views, so a view switch leaves the cached prefix alone", () => {
    const a = buildChatPromptLayout("en-US", snapshot("budget"), guides, true, {}, true);
    const b = buildChatPromptLayout("en-US", snapshot("workload"), guides, true, {}, true);
    expect(a.viewText).not.toBe(b.viewText);
    expect(a.system).toEqual(b.system);
  });

  it("turn layout on a view without a guide: the turn context is unchanged and viewText is empty", () => {
    const snap = snapshot("workload");
    const layout = buildChatPromptLayout("en-US", snap, guides, true, {}, true);
    expect(layout.viewText).toBe("");
    expect(layout.turnContext).toBe(buildTurnContext("en-US", snap, guides, true, {}));
  });

  it("guides off: no view guide in either layout", () => {
    for (const inTurn of [false, true]) {
      const layout = buildChatPromptLayout("en-US", snapshot("budget"), guides, false, {}, inTurn);
      expect(layout.viewText).toBe("");
      expect(JSON.stringify(layout)).not.toContain("BUDGETPROBE");
    }
  });
});
