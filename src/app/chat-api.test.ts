import { describe, it, expect } from "vitest";
import { asTimeZoneForTests } from "./timezone";
import {
  buildSystemPrompt,
  closeDanglingToolUses,
  maxOutputTokensFor,
  toolsFor,
  toolNamesFor,
  type ApiMessage,
  type ToolResultBlock,
} from "./chat-api";
import { historySearchEnabled } from "./settings-types";
import type { ToolDispatcher } from "./chat-tools";
import { RECAP_WINDOW_DAYS } from "./history-search";

type Snapshot = ReturnType<ToolDispatcher["getSnapshot"]>;

const snapshotFixture = (over: Partial<Snapshot> = {}): Snapshot => ({
  today: "2026-08-16",
  language: "en-US",
  holidayCountries: [],
  storageKind: "browser",
  taskCount: 3,
  mode: "advanced",
  enabledModules: [],
  currentView: "chat",
  timezone: asTimeZoneForTests("UTC"),
  ...over,
});

describe("buildSystemPrompt — the activity recap block", () => {
  const summary: NonNullable<Snapshot["activitySummary"]> = {
    total: 3,
    byActor: { user: 3, ai: 0, integration: 0, unknown: 0 },
    latestAt: "2026-08-16T09:00:00.000Z",
    days: RECAP_WINDOW_DAYS,
  };

  // ★★★ THE PLACEMENT TEST. Asserting the text appears "somewhere in the
  //    prompt" PASSES with the block in the CACHED prefix — which is the
  //    defect, since activity changes every turn and would invalidate the
  //    prompt cache on every message. Assert the BLOCK INDEX.
  it("puts the activity recap in the VOLATILE block, never the cached prefix", () => {
    const blocks = buildSystemPrompt("en-US", snapshotFixture({ activitySummary: summary }), [], false, {});
    expect(blocks[0].text).not.toContain("Recent project activity");
    expect(blocks[1].text).toContain("Recent project activity");
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("omits the recap entirely when there is no summary", () => {
    const blocks = buildSystemPrompt("en-US", snapshotFixture({ activitySummary: undefined }), [], false, {});
    expect(blocks[1].text).not.toContain("Recent project activity");
  });

  // ★ ANTI-VACUITY for the zone hand-off: 23:30Z on the 16th is 01:30 on the
  //   17th in Berlin, so a wiring that passed a hardcoded "UTC" — or reached
  //   for a clock — would still say 2026-08-16 here.
  it("renders latestAt in the SNAPSHOT's zone", () => {
    const blocks = buildSystemPrompt(
      "en-US",
      snapshotFixture({
        timezone: asTimeZoneForTests("Europe/Berlin"),
        activitySummary: { ...summary, latestAt: "2026-08-16T23:30:00.000Z" },
      }),
      [],
      false,
      {},
    );
    expect(blocks[1].text).toContain("2026-08-17");
  });
});

// ★★★ THE WHOLE-PROMPT INVARIANT, and the reason it is stated over the ASSEMBLED
// text rather than per-surface: `historySearch: false` correctly dropped
// `search_history` from the tools array while THREE separate surfaces went on
// instructing the model to call it — the recap sentence, Activity's `reading`,
// and its `toolHints` line. Each had its own unit test and each was green. Only
// a test that reads what actually ships can catch the fourth surface someone
// adds next, so assert over the concatenated blocks and never narrow this to a
// single builder.
describe("buildSystemPrompt never advertises a tool the request will not carry", () => {
  // ★ TWO non-zero buckets, deliberately: `buildActivityRecapBlock` omits the
  //   breakdown when only one bucket is populated (it would restate the total),
  //   so a single-actor fixture cannot show that the actor split survives the
  //   switch — which is the assertion that matters below.
  const summary: NonNullable<Snapshot["activitySummary"]> = {
    total: 3,
    byActor: { user: 2, ai: 1, integration: 0, unknown: 0 },
    latestAt: "2026-08-16T09:00:00.000Z",
    days: RECAP_WINDOW_DAYS,
  };
  // The Activity view is where all three surfaces coincide, so it is the one
  // that can fail for three different reasons.
  const onActivity = (historySearch: boolean | undefined) =>
    buildSystemPrompt(
      "en-US",
      snapshotFixture({ currentView: "activity", activitySummary: summary }),
      [],
      false,
      { historySearch },
    )
      .map((b) => b.text)
      .join("\n");

  // ★★ THE POSITIVE CONTROL, and it carries this pair. Without it the negative
  // below passes against a prompt that lost the recap, the reading and the hint
  // line outright — i.e. against a regression, not a fix. All three phrasings
  // are asserted separately so a partial suppression cannot hide.
  it("names search_history on all three surfaces while the tool is offered", () => {
    const text = onActivity(undefined);
    expect(text).toContain("Use search_history to read them.");
    expect(text).toContain("search_history reads this log");
    expect(text).toContain("Relevant tools here: search_history.");
  });

  it("names it nowhere at all once the kill switch is thrown", () => {
    expect(onActivity(false)).not.toContain("search_history");
  });

  // ★★ `true` and `undefined` are the two LIVE on-states (`sanitizeAiConfig`
  //    stores only an explicit false), so an implementation that tested
  //    truthiness would suppress the tool for every user who never opened the
  //    setting — the default-on-by-absence trap this repo hits repeatedly.
  it("treats an explicit true and an absent setting identically", () => {
    expect(onActivity(true)).toBe(onActivity(undefined));
    expect(onActivity(true)).toContain("search_history");
  });

  // ★★★ SUPPRESSION, NOT AMPUTATION — the counts are the part worth keeping.
  // A "fix" that emitted "" for the whole recap satisfies the negative above
  // while deleting the actor split, which is what stops the model reading its
  // own edits back as new user information.
  it("keeps the recap's counts and actor split without the tool", () => {
    const text = onActivity(false);
    expect(text).toContain("Recent project activity: 3 changes");
    expect(text).toContain("2 by the user");
    expect(text).toContain("1 by the AI assistant");
  });

  // ★ The invariant is about ONE tool's advertisement, not about muting the
  //   prompt. Every other view's hints must survive the switch.
  it("leaves the tools every other view names untouched", () => {
    const text = buildSystemPrompt(
      "en-US",
      snapshotFixture({ currentView: "open-points" }),
      [],
      false,
      { historySearch: false },
    )
      .map((b) => b.text)
      .join("\n");
    expect(text).toContain("Relevant tools here: list_tasks, get_task.");
  });
});

describe("maxOutputTokensFor", () => {
  it("floors the legacy Claude 3.0 trio at 4096 (their hard cap)", () => {
    expect(maxOutputTokensFor("claude-3-haiku-20240307")).toBe(4096);
    expect(maxOutputTokensFor("claude-3-opus-20240229")).toBe(4096);
    expect(maxOutputTokensFor("claude-3-sonnet-20240229")).toBe(4096);
  });
  it("uses 8192 for 3.5+/4.x and unknown/future models", () => {
    expect(maxOutputTokensFor("claude-3-5-sonnet-20241022")).toBe(8192);
    expect(maxOutputTokensFor("claude-3-7-sonnet-20250219")).toBe(8192);
    expect(maxOutputTokensFor("claude-sonnet-4")).toBe(8192);
    expect(maxOutputTokensFor("claude-opus-4-8")).toBe(8192);
    expect(maxOutputTokensFor("claude-haiku-4-5-20251001")).toBe(8192);
    expect(maxOutputTokensFor("claude-something-new")).toBe(8192);
  });
});

// A conversation is invalid to the Anthropic API when an assistant message with
// `tool_use` blocks is not immediately followed by a user message carrying a
// `tool_result` for each id (400 invalid_request_error). This happens when a
// turn is truncated at max_tokens mid-tool-use, or the user stops mid-turn, so
// the tool loop never ran/appended the results. closeDanglingToolUses repairs
// history by injecting synthetic (is_error) tool_result blocks.

const toolUseMsg = (ids: string[]): ApiMessage => ({
  role: "assistant",
  content: ids.map((id) => ({ type: "tool_use" as const, id, name: "create_task", input: {} })),
});

const resultsOf = (msg: ApiMessage | undefined): ToolResultBlock[] =>
  msg?.role === "user" && Array.isArray(msg.content)
    ? (msg.content.filter((b) => (b as ToolResultBlock).type === "tool_result") as ToolResultBlock[])
    : [];

describe("closeDanglingToolUses", () => {
  it("inserts a synthetic tool_result when a tool_use is followed by a user text turn", () => {
    const input: ApiMessage[] = [
      { role: "user", content: "create tasks" },
      toolUseMsg(["a1"]),
      { role: "user", content: "why no output?" },
    ];
    const out = closeDanglingToolUses(input);
    expect(out).toHaveLength(4);
    // The injected carrier sits immediately after the assistant tool_use.
    const carrier = resultsOf(out[2]);
    expect(carrier).toHaveLength(1);
    expect(carrier[0].tool_use_id).toBe("a1");
    expect(carrier[0].is_error).toBe(true);
    // The user's follow-up text is preserved, now at the end.
    expect(out[3]).toEqual({ role: "user", content: "why no output?" });
  });

  it("appends a synthetic carrier when the tool_use is the last message", () => {
    const input: ApiMessage[] = [{ role: "user", content: "go" }, toolUseMsg(["x1", "x2"])];
    const out = closeDanglingToolUses(input);
    expect(out).toHaveLength(3);
    const ids = resultsOf(out[2]).map((r) => r.tool_use_id);
    expect(ids).toEqual(["x1", "x2"]);
  });

  it("leaves a well-formed tool_use → tool_result pair unchanged", () => {
    const input: ApiMessage[] = [
      { role: "user", content: "go" },
      toolUseMsg(["ok1"]),
      { role: "user", content: [{ type: "tool_result", tool_use_id: "ok1", content: "done" }] },
    ];
    expect(closeDanglingToolUses(input)).toEqual(input);
  });

  it("merges missing results into a partial carrier instead of splitting across two user turns", () => {
    // Defensive: the current tool loop is all-or-nothing, but as an exported
    // helper it must still heal a partial carrier into ONE user message that
    // covers every id (not assistant → user(B) → user(A), which stays invalid).
    const input: ApiMessage[] = [
      { role: "user", content: "go" },
      toolUseMsg(["a", "b"]),
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "done" }] },
    ];
    const out = closeDanglingToolUses(input);
    expect(out).toHaveLength(3); // no extra message inserted
    const ids = resultsOf(out[2]).map((r) => r.tool_use_id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("is an identity for histories with no tool_use blocks", () => {
    const input: ApiMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];
    expect(closeDanglingToolUses(input)).toEqual(input);
  });
});

describe("tool list gating", () => {
  it("includes search_history by default", () => {
    expect(toolsFor({}).map((t) => t.name)).toContain("search_history");
  });

  it("removes search_history when the toggle is off", () => {
    // ★ REMOVED, not refused: a refused tool still costs its schema on every
    //   turn, which is most of what the toggle is for.
    expect(toolsFor({ historySearch: false }).map((t) => t.name)).not.toContain("search_history");
  });

  it("drops exactly one tool and keeps every other name", () => {
    // ★ CONTROL for the test above: `not.toContain` also passes on an empty
    //   array, so pin that the filter removed one entry rather than gutting the
    //   list.
    const on = toolsFor({}).map((t) => t.name);
    const off = toolsFor({ historySearch: false }).map((t) => t.name);
    expect(off).toHaveLength(on.length - 1);
    expect(off).toEqual(on.filter((n) => n !== "search_history"));
  });

  // ★★ The cache breakpoint rides the LAST element. Removing a tool must not
  //    leave the marker on an element that is no longer last, or the tools
  //    segment stops caching.
  it("keeps the cache breakpoint on the last element of BOTH variants", () => {
    for (const variant of [toolsFor({}), toolsFor({ historySearch: false })]) {
      expect(variant[variant.length - 1]).toHaveProperty("cache_control", { type: "ephemeral" });
      // `in` rather than `t.cache_control === undefined`: the unmarked entries
      // have no such key on their type at all, so the property read is a tsc
      // error even though vitest would run it.
      expect(variant.slice(0, -1).every((t) => !("cache_control" in t))).toBe(true);
    }
  });

  // ★ Referential stability: the arrays are module-level, not rebuilt per call.
  it("returns a STABLE reference for the same setting", () => {
    expect(toolsFor({})).toBe(toolsFor({ historySearch: true }));
    expect(toolsFor({ historySearch: false })).toBe(toolsFor({ historySearch: false }));
  });

  // ★★★ §162 DRIFT GUARD. The kill switch is now enforced in TWO places —
  //   here (what the model is offered) and `runTool`'s `case "search_history"`
  //   (what the executor will serve). Defence in depth is only worth having
  //   while both layers agree, and two hand-spelled `=== false` checks are one
  //   config slip from a switch that advertises OFF and serves ON. Both read
  //   `historySearchEnabled`, and this pins that the advertisement follows it
  //   for every input shape the sanitizer can produce — including the garbage
  //   ones, where "only an explicit false disables" is the whole contract.
  it("advertises exactly what historySearchEnabled says, for every input shape", () => {
    const inputs = [undefined, true, false, null, 0, 1, "", "no", NaN];
    for (const raw of inputs) {
      const v = raw as boolean | undefined;
      const enabled = historySearchEnabled(v);
      expect(toolsFor({ historySearch: v }).map((t) => t.name).includes("search_history")).toBe(enabled);
      expect(toolNamesFor({ historySearch: v }).has("search_history")).toBe(enabled);
    }
    // The control: the set really does split, so the loop is not asserting
    // `true === true` nine times over.
    expect(historySearchEnabled(false)).toBe(false);
    expect(historySearchEnabled(undefined)).toBe(true);
  });
});

describe("tool variants", () => {
  const ALL = {};
  const NO_HISTORY = { historySearch: false };
  const NO_CHAT = { chatSearch: false };
  const NEITHER = { historySearch: false, chatSearch: false };

  it("offers search_history by default and drops it when disabled", () => {
    expect(toolNamesFor(ALL).has("search_history")).toBe(true);
    expect(toolNamesFor(NO_HISTORY).has("search_history")).toBe(false);
  });

  // ★★★ THE TRANSPOSITION GUARD (§159). Two same-typed `boolean | undefined`
  //   predicates side by side is the shape that silently swapped and passed 337
  //   tests plus tsc. The flags travel as a NAMED slice so a swap cannot be
  //   spelled — and this asserts each flag INDEPENDENTLY, so if the two names
  //   were ever read into each other's slot the first line here goes red.
  it("leaves search_history alone when only the chat flag is off", () => {
    expect(toolNamesFor(NO_CHAT).has("search_history")).toBe(true);
    expect(toolNamesFor(NEITHER).has("search_history")).toBe(false);
  });

  it("returns ONE array identity per settings combination", () => {
    // ★ The property the two frozen constants used to provide. The list ships on
    //   every request, so a fresh array per call would destroy referential
    //   stability for a value that is constant for the whole conversation.
    expect(toolsFor(ALL)).toBe(toolsFor({}));
    expect(toolsFor({ historySearch: true })).toBe(toolsFor(ALL));
    expect(toolsFor(NO_HISTORY)).toBe(toolsFor({ historySearch: false }));
    expect(toolsFor(NO_HISTORY)).not.toBe(toolsFor(ALL));
  });

  it("returns ONE name-set identity per settings combination", () => {
    // Same rule for the derived sets: `buildSystemPrompt` reads one per send.
    expect(toolNamesFor(ALL)).toBe(toolNamesFor({}));
    expect(toolNamesFor(NO_HISTORY)).toBe(toolNamesFor({ historySearch: false }));
    expect(toolNamesFor(NO_HISTORY)).not.toBe(toolNamesFor(ALL));
  });

  it("recomputes the cache breakpoint per variant", () => {
    // A lost breakpoint is invisible except as a bill.
    // ★★ THE EXPECTED LENGTH IS WHAT MAKES THE LOOP FOUR CASES. Until
    //   `search_chats` existed, bit 2 removed nothing, so NO_CHAT and NEITHER
    //   built the SAME list as ALL and NO_HISTORY — the loop ran four times over
    //   two variants and would have stayed green with the whole chat bit gone.
    //   `full` is read from the default variant so the numbers track TOOL_DEFS.
    const full = toolsFor(ALL).length;
    for (const [flags, expected] of [
      [ALL, full],
      [NO_HISTORY, full - 1],
      [NO_CHAT, full - 1],
      [NEITHER, full - 2],
    ] as const) {
      const defs = toolsFor(flags);
      expect(defs).toHaveLength(expected);
      expect(defs.filter((d) => "cache_control" in d)).toHaveLength(1);
      expect(defs[defs.length - 1]).toHaveProperty("cache_control");
    }
  });

  it("offers search_chats by default and drops it when disabled", () => {
    expect(toolNamesFor(ALL).has("search_chats")).toBe(true);
    expect(toolNamesFor(NO_CHAT).has("search_chats")).toBe(false);
  });

  it("drops each tool independently", () => {
    // The combination that matters: one off, one on, in both directions.
    expect(toolNamesFor(NO_HISTORY).has("search_chats")).toBe(true);
    expect(toolNamesFor(NO_CHAT).has("search_history")).toBe(true);
    expect(toolNamesFor(NEITHER).has("search_chats")).toBe(false);
  });
});
