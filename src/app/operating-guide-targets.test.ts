// §701 — guide targets: the chat sees only chat guides, each AI action sees only
// the guides that name it, under a cap, and the forced-call envelope appends the
// text after the fixed prompt.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_TARGETS, ACTION_GUIDE_CHAR_CAP, actionGuideText, actionTargetsNotSent, actionTargetsNotSentByGuide, guideTargets, selectActionGuides, selectActiveGuides,
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

  it("drops a target id this build does not know, and reaches nothing when every id is unknown", () => {
    const unknown = (targets: string[]) => g({ scope: { targets: targets as never } });
    expect(guideTargets(unknown(["wbs", "futureAction"]))).toEqual(["wbs"]);
    expect(guideTargets(unknown(["futureAction"]))).toEqual([]);
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

  it("orders by the priority the user sees, built-in or not", () => {
    const r = selectActionGuides(
      [
        g({ id: "mine-late", priority: 50, scope: { targets: ["wbs"] } }),
        g({ id: "builtin", builtIn: true, priority: 25, scope: { targets: ["wbs"] } }),
        g({ id: "mine-early", priority: 10, scope: { targets: ["wbs"] } }),
      ],
      "wbs",
    );
    expect(r.map((x) => x.id)).toEqual(["mine-early", "builtin", "mine-late"]);
  });

  it("puts a default user guide ahead of every built-in action guide", () => {
    const mine = g({ id: "mine", priority: 10, scope: { targets: ["wbs"] } });
    const r = selectActionGuides([...builtinSeeds(), mine], "wbs");
    expect(r[0].id).toBe("mine");
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
    expect(text).toMatch(/never override this task's own instructions/);
    // No "above": the digest and committee report have no fixed prompt over it.
    expect(text).not.toMatch(/above/);
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

  // The guides ride their own LAST block. Only a caller that asks (a batching
  // runner) gets the cache marker: a single request would pay to write the
  // cache and never read it.
  const G = { type: "text", text: "G" };
  const CACHED = { type: "text", text: "G", cache_control: { type: "ephemeral" } };
  it("appends an unmarked guide block after a string prompt, after the last block, or alone", () => {
    expect(withGuideText("fixed", "G")).toEqual([{ type: "text", text: "fixed" }, G]);
    expect(withGuideText([{ type: "text", text: "fixed" }], "G")).toEqual([{ type: "text", text: "fixed" }, G]);
    expect(withGuideText(undefined, "G")).toEqual([G]);
  });
  it("marks the guide block for caching only when asked", () => {
    expect(withGuideText("fixed", "G", true)).toEqual([{ type: "text", text: "fixed" }, CACHED]);
    expect(withGuideText(undefined, "G", true)).toEqual([CACHED]);
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
    expect(body(m).system).toEqual([{ type: "text", text: "fixed" }, { type: "text", text: "G" }]);
  });

  it("with the cache marker when the caller asks for it", async () => {
    const m = stubFetch();
    await runForcedToolCall({ ...base, system: "fixed", guideText: "G", cacheGuides: true });
    expect(body(m).system).toEqual([
      { type: "text", text: "fixed" },
      { type: "text", text: "G", cache_control: { type: "ephemeral" } },
    ]);
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

// §701 review — "Applies to" on a built-in must survive the reload that
// refreshes built-ins, or the choice reverts the moment it is saved.
describe("reconcileBuiltins keeps the user's targets on a built-in", () => {
  it("keeps targets the user set on a built-in, refreshing everything else", () => {
    const seeds = builtinSeeds();
    const leadership = seeds[0];
    const stored = seeds.map((s) =>
      s.id === leadership.id ? { ...s, content: "stale", scope: { targets: ["chat" as const, "committeeReport" as const] } } : s,
    );
    const out = reconcileBuiltins(stored);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe(leadership.content);
    expect(out[0].scope.targets).toEqual(["chat", "committeeReport"]);
  });

  it("does not rewrite a built-in whose only difference from the seed is the user's targets", () => {
    const stored = builtinSeeds().map((s) => (s.id === "builtin-action-wbs" ? { ...s, scope: { targets: ["wbs" as const, "alloc" as const] } } : s));
    expect(reconcileBuiltins(stored)).toEqual([]);
  });
});

// §701 review 2 — a guide that targets an action but is never sent says so.
describe("actionTargetsNotSent", () => {
  it("names an action a guide over the cap alone will never reach", () => {
    const big = g({ id: "big", content: "x".repeat(ACTION_GUIDE_CHAR_CAP + 1), scope: { targets: ["chat", "wbs"] } });
    expect(actionTargetsNotSent([big], big)).toEqual(["wbs"]);
  });

  it("names an action where higher-priority guides crowd it out under the cap", () => {
    const first = g({ id: "a", priority: 1, content: "x".repeat(ACTION_GUIDE_CHAR_CAP - 10), scope: { targets: ["wbs", "raci"] } });
    const second = g({ id: "b", priority: 2, content: "x".repeat(20), scope: { targets: ["wbs", "raci"] } });
    const raciOnly = [{ ...first, scope: { targets: ["wbs" as const] } }, second];
    expect(actionTargetsNotSent([first, second], second)).toEqual(["wbs", "raci"]);
    expect(actionTargetsNotSent(raciOnly, second)).toEqual(["wbs"]);
  });

  it("reports nothing for a guide that is sent, disabled, or chat-only", () => {
    const ok = g({ id: "ok", scope: { targets: ["wbs"] } });
    expect(actionTargetsNotSent([ok], ok)).toEqual([]);
    const off = g({ id: "off", enabled: false, content: "x".repeat(ACTION_GUIDE_CHAR_CAP + 1), scope: { targets: ["wbs"] } });
    expect(actionTargetsNotSent([off], off)).toEqual([]);
    const chat = g({ id: "chat", content: "x".repeat(ACTION_GUIDE_CHAR_CAP + 1) });
    expect(actionTargetsNotSent([chat], chat)).toEqual([]);
  });
});

// §701 review 3 — scope is unvalidated stored JSON read during render: a
// malformed `targets` must not throw.
describe("guideTargets on malformed stored data", () => {
  it("reads a non-array targets as absent (chat only) and drops non-string entries", () => {
    const bad = (targets: unknown) => g({ scope: { targets: targets as never } });
    expect(guideTargets(bad("wbs"))).toEqual(["chat"]);
    expect(guideTargets(bad({ 0: "wbs" }))).toEqual(["chat"]);
    expect(guideTargets(bad(42))).toEqual(["chat"]);
    expect(guideTargets(bad(["wbs", 7, null]))).toEqual(["wbs"]);
  });

  it("never throws from the selection that runs while the app renders", () => {
    const bad = g({ id: "bad", scope: { targets: "wbs" as never } });
    expect(() => actionGuideText([bad], true, "wbs")).not.toThrow();
    expect(() => selectActiveGuides([bad], CTX)).not.toThrow();
  });
});

describe("actionTargetsNotSentByGuide", () => {
  it("maps every guide that misses a ticked action, and only those", () => {
    const big = g({ id: "big", priority: 1, content: "x".repeat(ACTION_GUIDE_CHAR_CAP + 1), scope: { targets: ["wbs", "raci"] } });
    const ok = g({ id: "ok", priority: 2, scope: { targets: ["wbs"] } });
    const m = actionTargetsNotSentByGuide([big, ok]);
    expect(m.get("big")).toEqual(["wbs", "raci"]);
    expect(m.has("ok")).toBe(false);
  });
});
