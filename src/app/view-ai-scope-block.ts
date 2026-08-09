// src/app/view-ai-scope-block.ts
// Pure formatting of a ViewScope (and optional digest) into system-prompt text.
// Split from the registry so the registry stays data and the wording stays
// independently testable. English-only, same reason as view-ai-scope.ts.
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import type { AppView } from "./nav-config";

/** What this surface IS. Emitted into the VOLATILE suffix — see `chat-api.ts`
 *  for why (the cache saving comes from `CACHED_TOOLS`, not from this
 *  placement). Keep it SHORT: it is paid on every message. */
export function buildViewScopeBlock(view: AppView): string {
  const scope = VIEW_AI_SCOPE[view];
  const lines = [
    `VIEW SCOPE — the user is looking at the "${view}" view.`,
    scope.purpose,
  ];
  if (scope.reading) lines.push(scope.reading);
  if (scope.toolHints && scope.toolHints.length > 0) {
    lines.push(`Relevant tools here: ${scope.toolHints.join(", ")}.`);
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
