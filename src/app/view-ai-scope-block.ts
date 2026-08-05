// src/app/view-ai-scope-block.ts
// Pure formatting of a ViewScope (and optional digest) into system-prompt text.
// Split from the registry so the registry stays data and the wording stays
// independently testable. English-only, same reason as view-ai-scope.ts.
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import type { AppView } from "./nav-config";

/** The CACHED-prefix block: what this surface is. Call-invariant for a view. */
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
    "VIEW STATE — what is currently on the user's screen, after their filters and sorting.",
    "Prefer this over a tool call when the question is about what they can see.",
    digest,
  ].join("\n");
}
