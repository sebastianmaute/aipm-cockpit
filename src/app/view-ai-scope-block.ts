// src/app/view-ai-scope-block.ts
// Pure formatting of a ViewScope (and optional digest) into system-prompt text.
// Split from the registry so the registry stays data and the wording stays
// independently testable. English-only, same reason as view-ai-scope.ts.
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import type { AppView } from "./nav-config";

/**
 * What this surface IS. Emitted into the VOLATILE suffix — see `chat-api.ts`
 * for why (the cache saving comes from `CACHED_TOOLS`, not from this
 * placement). Keep it SHORT: it is paid on every message.
 *
 * ★★★ `offeredTools` IS THE SET THE WIRE WILL ACTUALLY SEND, derived from the
 *     same `toolsFor` that builds the request's `tools` array — NOT a re-read of
 *     `settings.ai`. That is the whole point: a hint and the tool list cannot
 *     drift, because one filters against the other. `historySearch === false`
 *     dropped `search_history` from the request while three prompt surfaces went
 *     on instructing the model to call it; passing the SETTING down instead
 *     would have fixed those three and left the next gated tool to repeat it.
 *
 * ★★ REQUIRED, never an "all tools" default. An optional parameter makes a new
 *    call site advertise tools it may not be sending, silently — which is the
 *    defect this argument exists to close. Make tsc ask the question.
 */
export function buildViewScopeBlock(
  view: AppView,
  offeredTools: ReadonlySet<string>,
): string {
  const scope = VIEW_AI_SCOPE[view];
  const lines = [
    `VIEW SCOPE — the user is looking at the "${view}" view.`,
    scope.purpose,
  ];
  // ★ A `reading` that is ABOUT a tool goes when the tool does — the registry
  //   declares the dependency, this decides it against the live tool set.
  const readingApplies =
    !scope.readingRequiresTool || offeredTools.has(scope.readingRequiresTool);
  if (scope.reading && readingApplies) lines.push(scope.reading);
  const hints = (scope.toolHints ?? []).filter((h) => offeredTools.has(h));
  if (hints.length > 0) {
    lines.push(`Relevant tools here: ${hints.join(", ")}.`);
  }
  // Precedence, stated so the model can act on it. This is the INVERSE of the
  // guide-vs-guide rule in assembleGuideBlock ("earlier wins"), so it has to be
  // said out loud — a reader will otherwise assume that rule extends here.
  lines.push(
    "This describes the surface. An operating guide describes how the user wants you to work; where the two conflict, the operating guide wins.",
  );
  return lines.join("\n");
}

/** The VOLATILE-suffix block: what is currently ON that surface. */
export function buildViewStateBlock(digest: string | undefined): string {
  if (!digest) return "";
  return [
    // ★★ DO NOT re-add a blanket "after their filters and sorting" claim here.
    // This wrapper is shared by all four digest views and only ONE of them
    // (open-points) is fed the pane's true visible rows; the other three report
    // project totals. A wrapper that promises filtered data turns three honest
    // count lines into three false ones, and it is the wrapper the model reads
    // first. Each digest states its own scope instead — see view-ai-digest.ts.
    "VIEW STATE — the user's current view. Each line states its own scope.",
    "Prefer this over a tool call only for what a line explicitly claims to cover.",
    digest,
  ].join("\n");
}
