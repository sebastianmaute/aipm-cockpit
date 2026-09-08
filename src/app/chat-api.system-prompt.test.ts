import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildStableSystemBlocks, buildTurnContext, CACHED_TOOLS } from "./chat-api";
import { TOOL_DEFS } from "./chat-tool-defs";
import type { Insight } from "./insights/insight";
import type { OperatingGuide } from "./operating-guide";

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
// switch by default (groundInGuides defaults true; most builtin feature guides
// are view-scoped — measured 23 guides / 22 view-scoped on 2026-09-08 by the
// reproduce command in `withCacheBreakpoint`'s docstring in chat-api.ts; this
// line said "20 of 21" for several releases, so run it rather than trusting
// any number here), so without a segment closing at the end of `tools`,
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

// ★★★ THE STAGED-WRITE PARAGRAPHS REPLACED A "confirm with the user in chat"
// INSTRUCTION, and the replacement is a MECHANISM change, not a rewording.
// Destructive turns are staged by `shouldStage` and reviewed on a card, so
// asking the model to seek confirmation in chat described a protocol the app no
// longer runs — and one nothing enforced when it did. Seven identical clauses in
// `chat-tool-defs.ts` went at the same time.
//
// ★★ ASSERTED IN BOTH DIRECTIONS ON PURPOSE. The presence checks alone would
// stay green if somebody re-added the old sentence alongside the new ones, which
// is the likely "fix" for a model that starts narrating an approval step the
// user never sees. The absence check is what makes that loud.
describe("buildSystemPrompt staged-write instructions", () => {
  function stableText() {
    return buildSystemPrompt("en-US", snapshot(), [], false, {})[0].text;
  }

  it("tells the model a staged result means nothing was written", () => {
    const text = stableText();
    expect(text).toContain("STAGED");
    expect(text).toContain("NOTHING was written");
    expect(text).toContain("Do not call that tool again for the same change");
  });

  it("tells the model reads still return committed state", () => {
    // Without this the model re-reads after a staged write, sees its change
    // missing, and either re-issues the call or reports failure to the user.
    expect(stableText()).toContain("read tools still return COMMITTED state");
  });

  it("discloses the provisional id as provisional, and forbids showing it", () => {
    const text = stableText();
    expect(text).toContain("PROVISIONAL id");
    expect(text).toContain("never show it to the user");
  });

  it("no longer asks the model to confirm deletions in chat", () => {
    // The gate stages the write whatever the model was told. A second, weaker
    // confirmation instruction trains it to narrate a step that does not exist.
    expect(stableText()).not.toContain("confirm with the user in chat");
  });

  it("keeps them in the CACHED prefix — they never interpolate per-call state", () => {
    // Anti-vacuity for the three presence checks above: they read `stable`, so a
    // regression that moved this text into the volatile suffix would leave them
    // red for the right reason, and this pins the placement decision itself.
    // ★ `buildSystemPrompt` now returns THREE blocks — [always-on stable,
    //   view-scoped stable, turn context] — since `buildStableSystemBlocks`
    //   split into two. The middle one is empty here (`guides` is `[]`), so
    //   skip it rather than destructuring positionally into `volatile`; every
    //   later `[stable, volatile] = buildSystemPrompt(...)` pattern in this
    //   file has the same fix for the same reason.
    const [stable, , volatile] = buildSystemPrompt("en-US", snapshot(), [], false, {});
    expect(stable.text).toContain("STAGED");
    expect(volatile.text).not.toContain("STAGED");
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
    const [stable, , volatile] = buildSystemPrompt("en-US", snapshot(), [], false, {});
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
    const [, , volatile] = buildSystemPrompt(
      "en-US",
      snapshot({ viewDigest: "3 people over capacity" }),
      [],
      false,
      {},
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
    const [stable, , volatile] = buildSystemPrompt(
      "en-US",
      snapshot({ viewDigest: "3 people over capacity" }),
      [],
      false,
      {},
    );
    expect(stable.text).not.toContain("3 people over capacity");
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(volatile.cache_control).toBeUndefined();
    expect(volatile.text).toContain("VIEW STATE");
    expect(volatile.text).toContain("3 people over capacity");
  });

  it("omits the VIEW STATE block when the view contributes no digest", () => {
    const [, , volatile] = buildSystemPrompt("en-US", snapshot(), [], false, {});
    expect(volatile.text).not.toContain("VIEW STATE");
  });

  // Load-bearing: the scope block must NOT sit behind the operating-guide
  // gate, or a user preference would silently switch off shipped behaviour.
  // Unchanged by the move to the volatile suffix — only the block it lands in.
  it("keeps the view scope when groundInGuides is off", () => {
    const [, , volatile] = buildSystemPrompt("en-US", snapshot(), [], false, {});
    expect(volatile.text).toContain("VIEW SCOPE");
  });
});

// ★★★ THE INSIGHTS BLOCK IS VOLATILE — detectors reconcile it, so anything it
// contains would invalidate the cached prefix on every pass. `insight-prompt.ts`
// says so in its header and `chat-api` says so at the call site, but until now
// NOTHING enforced it: this file guarded the tools, view-scope and digest
// breakpoints and was repeatedly cited as covering the insights block too. It
// did not. Moving the block into `stableText` breaks nothing visible — exactly
// like the digest above — which is why the assertion has to exist.
describe("buildSystemPrompt insight block placement", () => {
  // Both SECTIONS are probed, not just the header: the outcomes section was
  // added later, and a growth-vs-move mistake would land it in the wrong block
  // while the "Current project insights" header stayed put and green.
  const insights: Insight[] = [
    {
      id: 1,
      key: "k1",
      type: "milestoneSlip",
      severity: "high",
      data: { name: "CACHEPROBE", daysOverdue: 5 },
      status: "active",
      firstSeenAt: "2026-08-01",
      lastSeenAt: "2026-08-05",
      occurrences: 1,
    },
    {
      id: 2,
      key: "k2",
      type: "stalledWork",
      severity: "high",
      // A count no other block could emit, so a hit is proof of THIS section.
      data: { count: 4242 },
      status: "acted",
      firstSeenAt: "2026-08-01",
      lastSeenAt: "2026-08-05",
      occurrences: 1,
      outcome: { direction: "improved", baseline: 9, current: 3, delta: 6, measuredAt: "2026-08-04" },
    },
  ];

  it("puts both insight sections in the UNCACHED block, never the cached one", () => {
    const [stable, , volatile] = buildSystemPrompt("en-US", snapshot({ insights }), [], false, {});
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(stable.text).not.toContain("Current project insights");
    expect(stable.text).not.toContain("CACHEPROBE");
    expect(stable.text).not.toContain("Recent outcomes");
    expect(stable.text).not.toContain("4242 tasks stalled");
    // Presence FIRST on the volatile side, for the same reason the ordering
    // test above states it: a block dropped ENTIRELY satisfies every
    // `not.toContain` here, so the negatives alone would pass vacuously.
    expect(volatile.cache_control).toBeUndefined();
    expect(volatile.text).toContain("Current project insights");
    expect(volatile.text).toContain("CACHEPROBE");
    expect(volatile.text).toContain("Recent outcomes");
    expect(volatile.text).toContain("4242 tasks stalled");
  });
});

// ★★★ TASK 5 — pins `buildSystemPrompt` as a thin composition, NOT a
// byte-identity check against anything. `buildSystemPrompt`'s entire body IS
// `[...buildStableSystemBlocks(...args), { type: "text", text:
// buildTurnContext(...args) }]` — the test below builds `composed` the same
// way, over the same `args` tuple, so `expect(composed).toEqual(legacy)` is a
// TAUTOLOGY: it compares that expression to itself and cannot go red for any
// change inside either builder (verified by mutation — renaming the "Known
// groups: …" line in `buildTurnContext`'s return array changes both sides
// identically and THIS test stays green; the anti-vacuity test below is what
// turns the FILE red on that mutant, and it was added for exactly that
// reason). The property this once checked —
// that the split is byte-identical to the PRE-SPLIT, single-function
// `buildSystemPrompt` — was only ever checkable against that pre-split code,
// which no longer exists in the tree, so it is not reconstructable here.
// What the test below DOES still pin, and is worth pinning: that
// `buildSystemPrompt` stays a two-block
// composition, stable half first, one turn-context text block last — a
// regression that inlined new logic into `buildSystemPrompt` itself, or
// reordered the two halves, or dropped one, would turn it red. The fixture is
// deliberately NOT the file's minimal `snapshot()` default — an empty
// snapshot with no guides would let both new builders return near-empty text
// and the composition check would prove almost nothing. Every field that
// lands text in either half is populated here.
describe("buildSystemPrompt split into buildStableSystemBlocks + buildTurnContext", () => {
  const guides: OperatingGuide[] = [
    {
      id: "g1",
      name: "Budget guide",
      content: "Always double-check budget totals against the plan before reporting them.",
      enabled: true,
      priority: 1,
      scope: {},
      builtIn: true,
    },
  ];

  const insights: Insight[] = [
    {
      id: 1,
      key: "k1",
      type: "milestoneSlip",
      severity: "high",
      data: { name: "SPLITPROBE", daysOverdue: 5 },
      status: "active",
      firstSeenAt: "2026-08-01",
      lastSeenAt: "2026-08-05",
      occurrences: 1,
    },
  ];

  const richSnapshot = snapshot({
    knownGroups: ["Migration", "Onboarding"],
    knownLabels: ["urgent", "blocked"],
    insights,
    viewDigest: "3 people over capacity",
    activitySummary: {
      total: 3,
      byActor: { user: 2, ai: 1, integration: 0, unknown: 0 },
      latestAt: "2026-08-05T09:00:00.000Z",
      days: 14,
    },
    chatPointer: {
      count: 2,
      recent: [{ title: "budget review", at: "2026-08-04T10:00:00Z" }],
    },
  });

  it("keeps buildSystemPrompt a thin two-block composition of the split halves", () => {
    const args = ["en-US", richSnapshot, guides, true, {}] as const;
    const legacy = buildSystemPrompt(...args);
    const composed = [
      ...buildStableSystemBlocks(...args),
      { type: "text" as const, text: buildTurnContext(...args) },
    ];
    expect(composed).toEqual(legacy);
  });

  // Anti-vacuity for the composition check above: a fixture that produces
  // empty text on either side would let `toEqual` pass trivially. Both
  // halves must carry real content — and this is also the ONLY place that
  // pins the actual substance of `buildTurnContext`'s output, since the
  // composition check above cannot fail on a change inside either builder.
  it("gives the fixture real, non-empty text on both sides of the split", () => {
    // ★ `buildSystemPrompt` returns THREE blocks now (see the note in the
    //   "staged-write instructions" describe above): skip the middle
    //   view-scoped stable block (empty here — this fixture's one guide has
    //   `scope: {}`, i.e. always-on) to reach the real turn context.
    const [stable, , volatile] = buildSystemPrompt("en-US", richSnapshot, guides, true, {});
    expect(stable.text.length).toBeGreaterThan(0);
    expect(volatile.text.length).toBeGreaterThan(0);
    // Confirm the enriched fields actually landed, not just SOME text.
    expect(stable.text).toContain("Budget guide");
    expect(volatile.text).toContain("SPLITPROBE");
    expect(volatile.text).toContain("3 people over capacity");
    expect(volatile.text).toContain("budget review");
    // Fixed (non-fixture-derived) content `buildTurnContext` always emits,
    // read off its actual return array rather than guessed: the "Today
    // is …"/"Known groups: …" lines and the APP CONTEXT header. NOTE:
    // "Active language code: …" is deliberately NOT asserted here — it is
    // emitted by `buildStableSystemBlocks`'s `stableInstructions`, not by
    // `buildTurnContext`, so it lands in `stable.text`, not `volatile.text`.
    expect(volatile.text).toContain("Today is");
    expect(volatile.text).toContain("Known groups");
    expect(volatile.text).toContain("APP CONTEXT");
  });
});

describe("buildStableSystemBlocks two-block split", () => {
  const guides: OperatingGuide[] = [
    {
      id: "always", name: "Leadership", content: "ALWAYSPROBE", enabled: true,
      priority: 1, scope: {}, builtIn: true,
    },
    {
      id: "budget", name: "Budget guide", content: "BUDGETPROBE", enabled: true,
      priority: 3, scope: { views: ["budget"] }, builtIn: true,
    },
  ];

  it("returns two blocks with cache_control on the FIRST only", () => {
    const blocks = buildStableSystemBlocks("en-US", snapshot({ currentView: "budget" }), guides, true, {});
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("puts the always-on guide in block 0 and the view guide in block 1", () => {
    const blocks = buildStableSystemBlocks("en-US", snapshot({ currentView: "budget" }), guides, true, {});
    // Positive on BOTH sides first: a block dropped entirely satisfies every
    // `not.toContain` below, so the negatives alone would pass vacuously.
    expect(blocks[0].text).toContain("ALWAYSPROBE");
    expect(blocks[1].text).toContain("BUDGETPROBE");
    expect(blocks[0].text).not.toContain("BUDGETPROBE");
    expect(blocks[1].text).not.toContain("ALWAYSPROBE");
  });

  it("still returns two blocks when the view contributes no guide", () => {
    const blocks = buildStableSystemBlocks("en-US", snapshot({ currentView: "workload" }), guides, true, {});
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("ALWAYSPROBE");
    expect(blocks[1].text).toBe("");
  });
});

describe("block 0 is byte-identical across every view", () => {
  // A fixture spanning all three guide-count shapes the real app produces
  // (some views get 0 view-scoped guides, some 1, some 2). If block 0's
  // header counted the view-scoped guides, these would differ.
  const guides: OperatingGuide[] = [
    { id: "lead", name: "Leadership", content: "LEADPROBE", enabled: true, priority: 1, scope: {}, builtIn: true },
    { id: "overview", name: "App overview", content: "OVERVIEWPROBE", enabled: true, priority: 2, scope: {}, builtIn: true },
    { id: "budget", name: "Budget", content: "BUDGETPROBE", enabled: true, priority: 3, scope: { views: ["budget"] }, builtIn: true },
    { id: "raid1", name: "RAID a", content: "RAIDPROBEA", enabled: true, priority: 4, scope: { views: ["raid"] }, builtIn: true },
    { id: "raid2", name: "RAID b", content: "RAIDPROBEB", enabled: true, priority: 5, scope: { views: ["raid"] }, builtIn: true },
  ];
  // 0 view-scoped, 1 view-scoped, 2 view-scoped — the three real shapes.
  const views = ["workload", "budget", "raid"];

  it("emits the same block 0 on every view", () => {
    const blocks0 = views.map(
      (view) => buildStableSystemBlocks("en-US", snapshot({ currentView: view }), guides, true, {})[0].text,
    );
    expect(new Set(blocks0).size).toBe(1);
  });

  it("emits a DIFFERENT block 1 per view, so the sweep above is not comparing empty strings", () => {
    const blocks1 = views.map(
      (view) => buildStableSystemBlocks("en-US", snapshot({ currentView: view }), guides, true, {})[1].text,
    );
    expect(new Set(blocks1).size).toBe(3);
    expect(blocks1[1]).toContain("BUDGETPROBE");
    expect(blocks1[2]).toContain("RAIDPROBEA");
    expect(blocks1[2]).toContain("RAIDPROBEB");
  });
});
