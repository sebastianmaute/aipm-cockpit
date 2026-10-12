// §701 — guide targets: the chat sees only chat guides, each AI action sees only
// the guides that name it, under a cap, and the forced-call envelope appends the
// text after the fixed prompt.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_TARGETS, ACTION_GUIDE_CHAR_CAP, actionGuideText, guideTargets, selectActionGuides, selectActiveGuides,
  type OperatingGuide,
} from "./operating-guide";
import { runForcedToolCall, withGuideText } from "./ai-forced-call";
import { builtinSeeds, reconcileBuiltins } from "./use-operating-guides";
import { BUILTIN_ACTION_GUIDES } from "./operating-guide-builtin.generated";
import { parseActionGuides, VALID_ACTION_TARGETS } from "../../scripts/gen-operating-guide.mjs";

const g = (over: Partial<OperatingGuide>): OperatingGuide => ({
  id: "g", name: "G", content: "body", enabled: true, priority: 10, scope: {}, builtIn: false, ...over,
});
const CTX = { mode: "advanced" as const, modules: [], view: "open-points" as const };

describe("guideTargets", () => {
  it("reads a guide with no targets, or an empty list, as the chat only", () => {
    expect(guideTargets(g({}))).toEqual(["chat"]);
    expect(guideTargets(g({ scope: { targets: [] } }))).toEqual(["chat"]);
    expect(guideTargets(g({ scope: { targets: ["wbs", "raci"] } }))).toEqual(["wbs", "raci"]);
  });
});

describe("selectActiveGuides (chat)", () => {
  it("keeps an untargeted guide and one that names the chat, drops one that does not", () => {
    const r = selectActiveGuides(
      [g({ id: "a" }), g({ id: "b", scope: { targets: ["chat", "wbs"] } }), g({ id: "c", scope: { targets: ["wbs"] } })],
      CTX,
    );
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("selectActionGuides", () => {
  it("picks only enabled guides that name the action — an untargeted guide never reaches one", () => {
    const r = selectActionGuides(
      [
        g({ id: "untargeted" }),
        g({ id: "wbs", scope: { targets: ["wbs"] } }),
        g({ id: "off", enabled: false, scope: { targets: ["wbs"] } }),
        g({ id: "raci", scope: { targets: ["raci"] } }),
      ],
      "wbs",
    );
    expect(r.map((x) => x.id)).toEqual(["wbs"]);
  });

  it("ignores views, modes and modules: an action has none to match", () => {
    const r = selectActionGuides([g({ id: "v", scope: { targets: ["wbs"], views: ["budget"], modes: ["simple"] } })], "wbs");
    expect(r.map((x) => x.id)).toEqual(["v"]);
  });

  it("puts the user's own guides ahead of built-ins whatever their priority, then orders by priority", () => {
    const r = selectActionGuides(
      [
        g({ id: "builtin", builtIn: true, priority: 1, scope: { targets: ["wbs"] } }),
        g({ id: "mine-late", priority: 50, scope: { targets: ["wbs"] } }),
        g({ id: "mine-early", priority: 40, scope: { targets: ["wbs"] } }),
      ],
      "wbs",
    );
    expect(r.map((x) => x.id)).toEqual(["mine-early", "mine-late", "builtin"]);
  });

  it("skips a guide that would pass the cap whole, and still takes a later one that fits", () => {
    const r = selectActionGuides(
      [
        g({ id: "a", priority: 1, content: "x".repeat(6), scope: { targets: ["wbs"] } }),
        g({ id: "big", priority: 2, content: "x".repeat(5), scope: { targets: ["wbs"] } }),
        g({ id: "small", priority: 3, content: "x".repeat(4), scope: { targets: ["wbs"] } }),
      ],
      "wbs",
      10,
    );
    expect(r.map((x) => x.id)).toEqual(["a", "small"]);
  });

  it("admits a guide exactly at the cap", () => {
    expect(selectActionGuides([g({ content: "x".repeat(10), scope: { targets: ["wbs"] } })], "wbs", 10)).toHaveLength(1);
  });

  it("defaults to the 12,000-character cap", () => {
    expect(ACTION_GUIDE_CHAR_CAP).toBe(12_000);
    const r = selectActionGuides([g({ content: "x".repeat(12_001), scope: { targets: ["wbs"] } })], "wbs");
    expect(r).toEqual([]);
  });
});

describe("actionGuideText", () => {
  const wbs = g({ name: "Team rules", content: "Split anything over 3 days.", scope: { targets: ["wbs"] } });

  it("returns empty when grounding is off, or when nothing targets the action", () => {
    expect(actionGuideText([wbs], false, "wbs")).toBe("");
    expect(actionGuideText([wbs], true, "raci")).toBe("");
  });

  it("carries the guide's name and content under a header that keeps the fixed rules in charge", () => {
    const text = actionGuideText([wbs], true, "wbs");
    expect(text).toContain('"Team rules"');
    expect(text).toContain("Split anything over 3 days.");
    expect(text).toMatch(/never override the instructions above/);
  });
});

describe("withGuideText", () => {
  it("leaves the system prompt untouched when there is no guide text", () => {
    const blocks = [{ type: "text" as const, text: "fixed" }];
    expect(withGuideText("fixed", "")).toBe("fixed");
    expect(withGuideText("fixed", undefined)).toBe("fixed");
    expect(withGuideText(blocks, "")).toBe(blocks);
    expect(withGuideText(undefined, "")).toBeUndefined();
  });

  it("appends after a string prompt, after the last block, or stands alone", () => {
    expect(withGuideText("fixed", "G")).toBe("fixed\n\nG");
    expect(withGuideText([{ type: "text", text: "fixed" }], "G")).toEqual([
      { type: "text", text: "fixed" },
      { type: "text", text: "G" },
    ]);
    expect(withGuideText(undefined, "G")).toBe("G");
  });
});

describe("runForcedToolCall sends the guide text", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch() {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "tool_use", name: "t", input: {} }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const body = (m: ReturnType<typeof stubFetch>) =>
    JSON.parse(((m.mock.calls[0] as unknown[])[1] as RequestInit).body as string) as { system?: unknown };
  const base = { apiKey: "k", model: "m", tools: [], toolName: "t", messages: [], maxTokens: 10 };

  it("after the fixed prompt", async () => {
    const m = stubFetch();
    await runForcedToolCall({ ...base, system: "fixed", guideText: "G" });
    expect(body(m).system).toBe("fixed\n\nG");
  });

  it("not at all when there is none", async () => {
    const m = stubFetch();
    await runForcedToolCall({ ...base, system: "fixed" });
    expect(body(m).system).toBe("fixed");
  });
});

describe("built-in action guides", () => {
  it("match lib/ai-action-guides.md (run `node scripts/gen-operating-guide.mjs` if this fails)", () => {
    const src = readFileSync("lib/ai-action-guides.md", "utf8");
    expect(BUILTIN_ACTION_GUIDES).toEqual(parseActionGuides(src, VALID_ACTION_TARGETS));
  });

  it("the script's target list mirrors AI_TARGETS without the chat", () => {
    expect([...VALID_ACTION_TARGETS].sort()).toEqual(AI_TARGETS.filter((x) => x !== "chat").sort());
  });

  it("are seeded enabled, built in, and never reach the chat", () => {
    const seeds = builtinSeeds().filter((s) => s.id.startsWith("builtin-action-"));
    expect(seeds.map((s) => s.id)).toEqual(BUILTIN_ACTION_GUIDES.map((a) => a.id));
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) {
      expect(s.enabled && s.builtIn).toBe(true);
      expect(guideTargets(s)).not.toContain("chat");
    }
    expect(selectActiveGuides(builtinSeeds(), CTX).some((s) => s.id.startsWith("builtin-action-"))).toBe(false);
  });

  it("include a work-breakdown guide that reaches Optimize with AI", () => {
    expect(actionGuideText(builtinSeeds(), true, "wbs")).toMatch(/100% rule/);
  });

  it("are seeded into a store that predates them, keeping nothing else", () => {
    const old = builtinSeeds().filter((s) => !s.id.startsWith("builtin-action-"));
    expect(reconcileBuiltins(old).map((s) => s.id)).toEqual(BUILTIN_ACTION_GUIDES.map((a) => a.id));
  });
});

describe("parseActionGuides", () => {
  const valid = ["wbs", "raci"];
  it("parses a tagged section and skips the preamble", () => {
    const out = parseActionGuides("# T\n\npreamble\n\n## WBS\n<!-- targets: wbs, raci -->\n\n- rule\n", valid);
    expect(out).toEqual([{ id: "builtin-action-wbs", name: "AI action: WBS", content: "## WBS\n\n- rule", scope: { targets: ["wbs", "raci"] } }]);
  });
  it("throws on an untagged section, an unknown target, or a repeated first target", () => {
    expect(() => parseActionGuides("## A\n- x\n", valid)).toThrow(/no "<!-- targets/);
    expect(() => parseActionGuides("## A\n<!-- targets: nope -->\n", valid)).toThrow(/unknown target "nope"/);
    expect(() => parseActionGuides("## A\n<!-- targets: wbs -->\n## B\n<!-- targets: wbs -->\n", valid)).toThrow(/two sections/);
  });
});
