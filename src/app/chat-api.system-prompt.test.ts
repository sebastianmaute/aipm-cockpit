import { describe, it, expect } from "vitest";
import { buildSystemPrompt, CACHED_TOOLS } from "./chat-api";
import { TOOL_DEFS } from "./chat-tool-defs";

function snapshot(over: Record<string, unknown> = {}) {
  return {
    today: "2026-08-05",
    language: "en-US",
    holidayCountries: [],
    storageKind: "indexeddb",
    taskCount: 3,
    knownGroups: [],
    knownLabels: [],
    mode: "advanced",
    enabledModules: [],
    currentView: "workload",
    insights: [],
    ...over,
  } as never;
}

// ★★★ The tools breakpoint is the ONLY thing keeping ~6.5k tokens of tool
// schemas out of the per-view cache churn. `stableText` changes on every view
// switch by default (groundInGuides defaults true; 20 of 21 builtin feature
// guides are view-scoped), so without a segment closing at the end of `tools`,
// that guide swap rewrites the schemas too. Deleting it breaks NOTHING visible.
describe("tools cache breakpoint", () => {
  it("marks exactly the LAST tool and leaves TOOL_DEFS itself unmutated", () => {
    const marked = CACHED_TOOLS.filter((d) => "cache_control" in d);
    expect(marked).toHaveLength(1);
    expect(CACHED_TOOLS[CACHED_TOOLS.length - 1]).toHaveProperty("cache_control", {
      type: "ephemeral",
    });
    expect(CACHED_TOOLS).toHaveLength(TOOL_DEFS.length);
    // CONTROL: the map must COPY. Mutating the shared TOOL_DEFS would leak a
    // cache_control field into every other consumer of the schemas.
    expect(TOOL_DEFS.some((d) => "cache_control" in d)).toBe(false);
  });
});

describe("buildSystemPrompt view scoping", () => {
  // ★★ THE SCOPE BLOCK SITS IN THE UNCACHED SUFFIX, and this test is the only
  // thing holding it there. It reads as though it were cacheable — it is
  // invariant for a given view — but caching rewards invariance per
  // CONVERSATION, not per view. ★ Placement is close to cost-neutral now that
  // `CACHED_TOOLS` carries the real saving, so treat this as pinning a decision
  // rather than a large win. Moving it back breaks nothing visible and
  // silently raises cost, exactly like the digest below.
  it("puts the view scope in the UNCACHED block, never the cached one", () => {
    const [stable, volatile] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(stable.text).not.toContain("VIEW SCOPE");
    expect(stable.text).not.toContain("capacity versus allocation");
    expect(volatile.cache_control).toBeUndefined();
    expect(volatile.text).toContain("VIEW SCOPE");
    expect(volatile.text).toContain("capacity versus allocation");
  });

  // Order matters for readability of the prompt: what the surface IS, then
  // what is currently on it.
  it("emits VIEW SCOPE before VIEW STATE", () => {
    const [, volatile] = buildSystemPrompt(
      "en-US",
      snapshot({ viewDigest: "3 people over capacity" }),
      [],
      false,
    );
    // Presence FIRST: `indexOf` returns -1 for an absent block, and -1 is less
    // than any real index, so the ordering assertion alone passes vacuously
    // against a scope block that was dropped entirely.
    expect(volatile.text).toContain("VIEW SCOPE");
    expect(volatile.text).toContain("VIEW STATE");
    expect(volatile.text.indexOf("VIEW SCOPE")).toBeLessThan(
      volatile.text.indexOf("VIEW STATE"),
    );
  });

  // THE test of this feature. Moving the digest into the cached prefix breaks
  // nothing visible — it just invalidates the cache on every filter change and
  // silently raises cost. Nothing else would catch that.
  it("puts the digest in the UNCACHED block, never the cached one", () => {
    const [stable, volatile] = buildSystemPrompt(
      "en-US",
      snapshot({ viewDigest: "3 people over capacity" }),
      [],
      false,
    );
    expect(stable.text).not.toContain("3 people over capacity");
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(volatile.cache_control).toBeUndefined();
    expect(volatile.text).toContain("VIEW STATE");
    expect(volatile.text).toContain("3 people over capacity");
  });

  it("omits the VIEW STATE block when the view contributes no digest", () => {
    const [, volatile] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(volatile.text).not.toContain("VIEW STATE");
  });

  // Load-bearing: the scope block must NOT sit behind the operating-guide
  // gate, or a user preference would silently switch off shipped behaviour.
  // Unchanged by the move to the volatile suffix — only the block it lands in.
  it("keeps the view scope when groundInGuides is off", () => {
    const [, volatile] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(volatile.text).toContain("VIEW SCOPE");
  });
});
