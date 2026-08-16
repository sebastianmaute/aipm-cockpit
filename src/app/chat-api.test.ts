import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  closeDanglingToolUses,
  maxOutputTokensFor,
  toolsFor,
  type ApiMessage,
  type ToolResultBlock,
} from "./chat-api";
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
  timezone: "UTC",
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
    const blocks = buildSystemPrompt("en-US", snapshotFixture({ activitySummary: summary }), [], false);
    expect(blocks[0].text).not.toContain("Recent project activity");
    expect(blocks[1].text).toContain("Recent project activity");
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("omits the recap entirely when there is no summary", () => {
    const blocks = buildSystemPrompt("en-US", snapshotFixture({ activitySummary: undefined }), [], false);
    expect(blocks[1].text).not.toContain("Recent project activity");
  });

  // ★ ANTI-VACUITY for the zone hand-off: 23:30Z on the 16th is 01:30 on the
  //   17th in Berlin, so a wiring that passed a hardcoded "UTC" — or reached
  //   for a clock — would still say 2026-08-16 here.
  it("renders latestAt in the SNAPSHOT's zone", () => {
    const blocks = buildSystemPrompt(
      "en-US",
      snapshotFixture({
        timezone: "Europe/Berlin",
        activitySummary: { ...summary, latestAt: "2026-08-16T23:30:00.000Z" },
      }),
      [],
      false,
    );
    expect(blocks[1].text).toContain("2026-08-17");
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
    expect(toolsFor(undefined).map((t) => t.name)).toContain("search_history");
  });

  it("removes search_history when the toggle is off", () => {
    // ★ REMOVED, not refused: a refused tool still costs its schema on every
    //   turn, which is most of what the toggle is for.
    expect(toolsFor(false).map((t) => t.name)).not.toContain("search_history");
  });

  it("drops exactly one tool and keeps every other name", () => {
    // ★ CONTROL for the test above: `not.toContain` also passes on an empty
    //   array, so pin that the filter removed one entry rather than gutting the
    //   list.
    const on = toolsFor(undefined).map((t) => t.name);
    const off = toolsFor(false).map((t) => t.name);
    expect(off).toHaveLength(on.length - 1);
    expect(off).toEqual(on.filter((n) => n !== "search_history"));
  });

  // ★★ The cache breakpoint rides the LAST element. Removing a tool must not
  //    leave the marker on an element that is no longer last, or the tools
  //    segment stops caching.
  it("keeps the cache breakpoint on the last element of BOTH variants", () => {
    for (const variant of [toolsFor(undefined), toolsFor(false)]) {
      expect(variant[variant.length - 1]).toHaveProperty("cache_control", { type: "ephemeral" });
      // `in` rather than `t.cache_control === undefined`: the unmarked entries
      // have no such key on their type at all, so the property read is a tsc
      // error even though vitest would run it.
      expect(variant.slice(0, -1).every((t) => !("cache_control" in t))).toBe(true);
    }
  });

  // ★ Referential stability: the arrays are module-level, not rebuilt per call.
  it("returns a STABLE reference for the same setting", () => {
    expect(toolsFor(undefined)).toBe(toolsFor(true));
    expect(toolsFor(false)).toBe(toolsFor(false));
  });
});
