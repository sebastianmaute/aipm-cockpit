// src/app/chat-api.ts — the AI chat's wire layer: Anthropic message/content types,
// the system-prompt assembler, the fetch call, and small pure helpers. Non-React +
// i18n-free (per the repo's "engines live in plain modules; React surfaces import
// them" pattern); `chat-panel.tsx` consumes everything here.
import { TOOL_DEFS, type ToolDispatcher } from "./chat-tools";
import { AiHttpError, safeAiErrorType, safeAiErrorMessage } from "./ai-errors";
import type { Lang } from "./i18n";
import { selectActiveGuides, assembleGuideBlock, type OperatingGuide } from "./operating-guide";
import type { AttachmentBlock } from "./chat-attachments";
import { buildInsightsPromptBlock } from "./insights/insight-prompt";
import { buildViewScopeBlock, buildViewStateBlock } from "./view-ai-scope-block";
import { buildActivityRecapBlock } from "./activity-recap";
import { buildChatPointerBlock } from "./chat-recap";
import { chatSearchEnabled, historySearchEnabled, type AiConfig } from "./settings-types";

// Re-export so chat consumers can catch the typed HTTP failure without a second import.
export { AiHttpError } from "./ai-errors";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | AttachmentBlock;

export type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

export type ApiMessage =
  | { role: "user"; content: string | ContentBlock[] }
  | { role: "assistant"; content: ContentBlock[] };

export type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "notice"; text: string }
  | {
      kind: "tool";
      name: string;
      input: unknown;
      result: string;
      error: boolean;
    }
  /**
   * A staged-proposal MARKER — the review card's place in the transcript.
   *
   * ★★★ IT CARRIES NO PLAN, AND THAT IS THE WHOLE POINT. Both halves of a
   * `ChatConversation` are persisted (to the per-project in-memory store, and
   * in Turso mode to the thread row), so anything on a `DisplayItem` can be
   * restored arbitrarily later. A restored PLAN would offer to apply writes
   * staged against a workspace that has since moved; every row's token would be
   * stale so `applyProposal` would refuse it, but the card would still invite a
   * click that cannot succeed. The live plan therefore lives in component state
   * keyed by `id`, and this marker survives instead.
   *
   * ★★ A MARKER WITH NO MATCHING LIVE PLAN RENDERS AS EXPIRED, and that rule
   * clears a pending proposal on EVERY transcript reset for free — the
   * synchronous project-switch reconcile AND every asynchronous Turso thread
   * path, which replaces `display` from several sites — count them with
   * `grep -c "^\s*setDisplay(" src/app/use-chat-threads.ts` rather than trusting
   * a number here. Nothing has to remember to clear the plan, which is the
   * failure mode `panel-chat` invites: it is mounted unconditionally and never
   * remounts.
   *
   * ★ `count` is kept so the expired form can still say how many writes were
   * proposed there. It is display-only and nothing derives behaviour from it.
   */
  | { kind: "proposal"; id: string; count: number };

export type ApiUsage = { input_tokens: number; output_tokens: number };

export const ANTHROPIC_VERSION = "2023-06-01";

/** Per-request output-token ceiling for a model. The Anthropic API requires a
 *  `max_tokens`; the legacy Claude 3.0 trio (haiku/opus/sonnet) hard-caps at
 *  4096 (a higher value 400s), while everything from 3.5 onward supports >=8192.
 *  Unknown/future ids default to the 8192 floor every current model accepts. */
export function maxOutputTokensFor(model: string): number {
  return /^claude-3-(haiku|opus|sonnet)\b/.test(model) ? 4096 : 8192;
}

/** Injected (invisible) user turn that resumes a response the model cut off at
 *  max_tokens, so the loop can stitch the full answer without the user prodding. */
export const CONTINUE_NUDGE =
  "Your previous message was cut off at the length limit. Continue exactly where you left off — do not repeat anything you already wrote.";

export function buildSystemPrompt(
  lang: Lang,
  snapshot: ReturnType<ToolDispatcher["getSnapshot"]>,
  guides: readonly OperatingGuide[],
  groundInGuides: boolean,
  /** `settings.ai`'s tool flags — the SAME value `callClaude` is given, so the
   *  prompt advertises exactly the tools the request carries. See
   *  `toolNamesFor`; only an explicit false drops one. */
  toolFlags: ToolFlags,
): SystemBlock[] {
  // ★★ Resolved ONCE and shared by both advertising surfaces below. Two
  //    independent reads of the setting is how they drifted apart before.
  const offeredTools = toolNamesFor(toolFlags);
  const groups = (snapshot.knownGroups ?? []).join(", ") || "(none)";
  const labels = (snapshot.knownLabels ?? []).join(", ") || "(none)";
  // STABLE prefix (cached): fixed instructions that never interpolate per-call
  // state, plus the (large) guide text. Anthropic prompt-cache is prefix-based,
  // so this must come FIRST and contain only call-invariant content.
  const stableInstructions = [
    "You are an assistant embedded in AI PM Cockpit, an AI-assisted project management app for tracking open project items (tasks, RAID, changes, milestones, budget).",
    "The user is a project lead tracking open tasks. Each task has: id, taskName, assignee, assigneeEmail, dueDate (YYYY-MM-DD), lastUpdateDate, priority (Low/Medium/High/Urgent), status (To Do/In Progress/On Hold/In Review/Cancelled/Done), blockers, notes, group (single optional category), labels (zero or more tags).",
    "Use the provided tools to read and modify the app's state. Prefer calling tools over guessing. After modifying state, briefly confirm what changed.",
    "Beyond tasks you can also read and write RAID items (Risks/Assumptions/Issues/Dependencies), change-control items, milestones, and stakeholders via their list_/create_/update_/delete_ tools. RAID category is R/A/I/D; status must match the category. Dates are YYYY-MM-DD.",
    "You can also manage the resource directory: list_resources, get_resource, create_resource (firstName/lastName), update_resource, and delete_resource. IMPORTANT: assigning a task to a person by name does NOT add them to the directory — when a document describes a team or resource plan, call create_resource for each person so they appear in the directory, not just as task assignees.",
    "When the user attaches a document, read it and, when they ask, extract the relevant items (tasks, risks, milestones, stakeholders, people/resources) and create them with the matching create_ tool. Summarise what you created and ask before bulk-creating many records.",
    "Before deleting anything (delete_task, delete_all_tasks, delete_raid_item, delete_change, delete_milestone, delete_stakeholder, delete_resource) confirm with the user in chat unless they were already explicit.",
    "When the user references a record by name or fragment, call the matching list_ tool to find its ID first.",
    `Active language code: ${lang}.`,
  ].join("\n");
  const guideBlock = groundInGuides
    ? assembleGuideBlock(selectActiveGuides(guides, {
        mode: snapshot.mode, modules: snapshot.enabledModules, view: snapshot.currentView,
      }))
    : "";
  const stableText = [stableInstructions, guideBlock].filter(Boolean).join("\n\n");

  // VOLATILE suffix (uncached): per-call state + the APP CONTEXT block. Placed
  // AFTER the cached prefix so it never invalidates the cache.
  const appContext = [
    "APP CONTEXT — adapt your behavior to this.",
    `Mode: ${snapshot.mode}. Enabled modules: ${snapshot.enabledModules.join(", ") || "(none)"}.`,
    `Current view: ${snapshot.currentView}.`,
    "In simple mode keep actions minimal and never reference disabled modules.",
    "You are acting as a senior project & program manager.",
  ].join("\n");
  // Active insights are VOLATILE (change as detectors reconcile) → this block
  // MUST stay in the uncached suffix, or it would invalidate the cached prefix.
  const insightsBlock = buildInsightsPromptBlock(snapshot.insights ?? []);
  // The digest (what is on screen right now) is per-call and changes on every
  // filter/sort tweak — it MUST stay in the uncached suffix too, or it would
  // silently invalidate the cache on every interaction. See view-ai-scope-block.ts.
  const viewStateBlock = buildViewStateBlock(snapshot.viewDigest);
  // ★★ VIEW SCOPE IS VOLATILE TOO: it is invariant per VIEW, which is NOT the
  // property prompt caching rewards — that is invariance per CONVERSATION.
  // ★ The cache SAVING comes from CACHED_TOOLS below, not from this placement;
  // do not re-derive a per-message cost argument here (one was written, priced
  // against a baseline that did not exist, and retracted). Sits before VIEW
  // STATE so the model reads "what this surface is" before "what is on it".
  const viewScopeBlock = buildViewScopeBlock(snapshot.currentView, offeredTools);
  // Activity changes on EVERY turn, so this block MUST stay in the uncached
  // suffix — in the cached prefix it would invalidate the prompt cache on every
  // message, which costs far more than the ~20 tokens it saves.
  // ★ The zone comes off the SNAPSHOT: this file is i18n- and clock-free, and
  // the recap's day must agree with the `Today is …` line built beside it.
  const activityBlock = buildActivityRecapBlock(
    snapshot.activitySummary ?? null,
    snapshot.timezone,
    offeredTools,
  );
  // Thread state changes every turn, so this block MUST stay in the uncached
  // suffix — in the cached prefix it would invalidate the prompt cache on every
  // message, which costs far more than the ~40 tokens it saves.
  const chatBlock = buildChatPointerBlock(snapshot.chatPointer ?? null, offeredTools);
  const volatileText = [
    `Today is ${snapshot.today}. UI language is ${snapshot.language}. Respond in the user's language. Storage backend: ${snapshot.storageKind}. Current task count: ${snapshot.taskCount}.`,
    `Known groups: ${groups}. Known labels: ${labels}. When the user mentions a category, prefer reusing an existing group or label rather than creating near-duplicates.`,
    appContext,
    viewScopeBlock,
    viewStateBlock,
    insightsBlock,
    activityBlock,
    chatBlock,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { type: "text", text: stableText, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatileText },
  ];
}

export function systemBlocksText(blocks: SystemBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

/** Content for a synthetic tool_result standing in for a call that never ran
 *  (turn truncated at max_tokens, or the user stopped mid-turn). */
export const INTERRUPTED_TOOL_RESULT =
  "Tool call was interrupted before it produced a result. Ignore it.";

/**
 * Repair a conversation so every assistant `tool_use` block is immediately
 * followed by a user message carrying a `tool_result` for each id — the
 * invariant the Anthropic API enforces (400 invalid_request_error otherwise).
 *
 * A dangling `tool_use` arises when the tool loop pushes the assistant message
 * but exits before running the tools + appending results: the turn stopped at
 * `max_tokens` with tool_use in its content, or the user hit Stop/Escape. Left
 * in history, the NEXT send appends a user turn right after the dangling
 * tool_use and the whole request is rejected — wedging the chat.
 *
 * The tool loop builds a turn's results all-or-nothing (one user message with
 * every result, or none), so a dangling turn never has a partial carrier —
 * detection is simply "is the next message a user tool_result carrier for these
 * ids?". If not, inject one with `is_error` results for all the ids. A
 * well-formed history is returned unchanged (identity).
 */
export function closeDanglingToolUses(messages: ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  const consumed = new Set<number>(); // indices folded into a merged carrier
  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) continue;
    const msg = messages[i];
    out.push(msg);
    if (msg.role !== "assistant") continue;
    const toolUseIds = msg.content
      .filter((b): b is ToolUseBlock => b.type === "tool_use")
      .map((b) => b.id);
    if (toolUseIds.length === 0) continue;
    const next = messages[i + 1];
    const nextResults =
      next?.role === "user" && Array.isArray(next.content)
        ? next.content.filter((b): b is ToolResultBlock => b.type === "tool_result")
        : null;
    const satisfied = new Set((nextResults ?? []).map((b) => b.tool_use_id));
    const missing = toolUseIds.filter((id) => !satisfied.has(id));
    if (missing.length === 0) continue;
    const synthetic: ToolResultBlock[] = missing.map((id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: INTERRUPTED_TOOL_RESULT,
      is_error: true,
    }));
    if (nextResults && nextResults.length > 0) {
      // Partial carrier: fold the missing results INTO it (keep one user message
      // immediately after the assistant) rather than inserting a second user
      // turn that would split the results and stay invalid.
      out.push({ role: "user", content: [...synthetic, ...(next.content as ContentBlock[])] });
      consumed.add(i + 1);
    } else {
      // No carrier at all: insert one covering every dangling id.
      out.push({ role: "user", content: synthetic });
    }
  }
  return out;
}

/** ★★★ TOOLS CARRY THEIR OWN CACHE BREAKPOINT, and this is the one that matters.
 *  Without it, `tools` shares the single prefix that ends at the system block's
 *  breakpoint — so ANY view-dependent byte in `stableText` rewrites all ~6.5k
 *  tokens of tool schemas along with it.
 *  ★★★ AND `stableText` IS VIEW-DEPENDENT BY DEFAULT — this was mis-analysed
 *  once and the wrong conclusion nearly shipped. `settings.ai.groundInGuides`
 *  defaults to TRUE (`settings-types.ts`, and a missing key reads as true), and
 *  20 of the 21 `BUILTIN_FEATURE_GUIDES` are view-scoped (mean ~1 KB, Open
 *  Points ~2.9 KB), so `selectActiveGuides` swaps a multi-KB guide in and out of
 *  `guideBlock` on EVERY view switch, for every user, out of the box. Moving the
 *  ~100-token view-scope block into the volatile suffix therefore never bought a
 *  cache read on its own; only this breakpoint does, by closing a segment at the
 *  end of `tools` so the guide swap re-caches only the smaller system slice.
 *  ★ Marking the LAST tool is how a tools-block breakpoint is expressed — the
 *  segment covers everything up to and including the marked element. */
function withCacheBreakpoint(defs: typeof TOOL_DEFS) {
  return defs.map((def, i) =>
    i === defs.length - 1
      ? { ...def, cache_control: { type: "ephemeral" as const } }
      : def,
  );
}

export const CACHED_TOOLS = withCacheBreakpoint(TOOL_DEFS);

/** The flags that select a tool-list variant.
 *
 *  ★★★ ONE OBJECT, NOT TWO ADJACENT BOOLEANS. Both flags are
 *  `boolean | undefined`, so a positional pair typechecks when transposed —
 *  the §159 shape, where two adjacent same-typed arguments silently swapped
 *  and passed 337 tests plus tsc. Reading them by NAME off the config removes
 *  the hazard rather than guarding it. */
export type ToolFlags = Pick<AiConfig, "historySearch" | "chatSearch">;

/** Tool names removed by each bit of the variant key. */
const DISABLED_BY_BIT: ReadonlyArray<readonly [number, string]> = [
  [1, "search_history"],
  [2, "search_chats"],
];

/** ★★ ADVERTISEMENT AND ENFORCEMENT READ THE SAME PREDICATE. Never spell an
 *  inline `=== false` here. `search_history` is gated in TWO places — this list
 *  (what the model is OFFERED) and `runTool`'s `search_history` case (what the
 *  executor will SERVE, via `use-chat-dispatcher`'s `isHistorySearchEnabled`) —
 *  and both call the exported `historySearchEnabled`. Two hand-spelled `=== false`
 *  copies are one config slip from a switch that advertises OFF and serves ON.
 *  ★ `search_chats` is gated identically: this list plus `runTool`'s
 *    `search_chats` case, via `use-chat-dispatcher`'s `isChatSearchEnabled`. */
function variantKey(flags: ToolFlags): number {
  return (
    (historySearchEnabled(flags.historySearch) ? 0 : 1) |
    (chatSearchEnabled(flags.chatSearch) ? 0 : 2)
  );
}

// ★★ A MEMO, not four frozen constants. The rule the old pair encoded was ONE
//   ARRAY IDENTITY PER SETTINGS COMBINATION — stable for a whole conversation,
//   because the list ships on every request. Two toggles make four combinations
//   and a third would make eight, so the invariant outlives its old spelling.
const TOOL_VARIANTS = new Map<number, ReturnType<typeof withCacheBreakpoint>>([[0, CACHED_TOOLS]]);
const NAME_VARIANTS = new Map<number, ReadonlySet<string>>();

function variantFor(key: number) {
  const cached = TOOL_VARIANTS.get(key);
  if (cached) return cached;
  const removed = new Set(
    DISABLED_BY_BIT.filter(([bit]) => (key & bit) !== 0).map(([, name]) => name),
  );
  // ★ The breakpoint is RECOMPUTED per variant, never assumed to sit where it
  //   sits in the full list — removing a tool that happens to precede it does
  //   not move it TODAY, but a tool appended after it later would make that
  //   assumption silently wrong, and a lost breakpoint is invisible except as a
  //   bill.
  const built = withCacheBreakpoint(TOOL_DEFS.filter((d) => !removed.has(d.name)));
  TOOL_VARIANTS.set(key, built);
  return built;
}

/**
 * The tool list for this user's settings.
 *
 * ★★ ONE ARRAY PER COMBINATION, never a filter at the call site. The list is
 *    passed to every request, so rebuilding it per call would destroy
 *    referential stability for no benefit — the settings are constant for the
 *    whole conversation.
 *
 * ★ Only an explicit `false` disables, matching `sanitizeAiConfig`, so an
 *   absent/garbage setting keeps the shipped behaviour. It is also what makes
 *   the two live settings (`undefined` and `true`) share ONE array identity.
 */
export function toolsFor(flags: ToolFlags) {
  return variantFor(variantKey(flags));
}

/** The names of the tools this request will actually carry.
 *
 *  ★★ DERIVED FROM THE ARRAYS `toolsFor` RETURNS, never listed by hand. These
 *  feed the prompt surfaces that ADVERTISE tools (`buildViewScopeBlock`,
 *  `buildActivityRecapBlock`), so "what the model is told it has" and "what the
 *  request carries" come from ONE place and cannot disagree. */
export function toolNamesFor(flags: ToolFlags): ReadonlySet<string> {
  const key = variantKey(flags);
  const cached = NAME_VARIANTS.get(key);
  if (cached) return cached;
  const built: ReadonlySet<string> = new Set(variantFor(key).map((d) => d.name));
  NAME_VARIANTS.set(key, built);
  return built;
}

export async function callClaude(
  apiKey: string,
  model: string,
  system: SystemBlock[],
  messages: ApiMessage[],
  /** `settings.ai`'s tool flags — only an explicit false drops a tool. */
  toolFlags: ToolFlags,
  signal?: AbortSignal,
): Promise<{
  content: ContentBlock[];
  stop_reason: string;
  usage: ApiUsage;
}> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokensFor(model),
      system: system,
      messages,
      tools: toolsFor(toolFlags),
    }),
    signal,
  });
  if (!res.ok) {
    // Parse the RESPONSE body ONCE for two safe reads: the `error.type` token
    // (classification) and the sanitized `error.message` (surfaced to the user).
    // The response body carries NO secret — the api key lives only in the request
    // header, which is never read here. safeMessage must be surfaced, not logged.
    let errorType: string | undefined;
    let safeMessage: string | undefined;
    try {
      const body: unknown = await res.json();
      errorType = safeAiErrorType(body);
      safeMessage = safeAiErrorMessage(body);
    } catch {
      // Non-JSON / unreadable body — status alone is enough to classify.
    }
    throw new AiHttpError(res.status, errorType, safeMessage);
  }
  const json = await res.json() as { content: ContentBlock[]; stop_reason: string; usage?: ApiUsage };
  return {
    content: json.content,
    stop_reason: json.stop_reason,
    usage: json.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}

export function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
