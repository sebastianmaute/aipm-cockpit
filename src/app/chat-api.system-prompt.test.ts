import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./chat-api";

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

describe("buildSystemPrompt view scoping", () => {
  it("puts the view scope in the CACHED block", () => {
    const [stable] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(stable.text).toContain("VIEW SCOPE");
    expect(stable.text).toContain("capacity versus allocation");
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

  it("keeps the view scope when groundInGuides is off", () => {
    const [stable] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(stable.text).toContain("VIEW SCOPE");
  });
});
