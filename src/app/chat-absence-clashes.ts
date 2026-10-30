// src/app/chat-absence-clashes.ts — §773: the absence clashes ONE chat tool call would cause.
//
// Pure and i18n-free. Three readers ask it the same question: the staging gate (`chat-panel.tsx`, through
// `shouldStage`'s predicate), the review card (which shows the same plan's `clashes`) and the four date tools'
// results (`runTool`, through the dispatcher's `absenceClashesFor`).
// ★★ It reads the plan `describeProposal` builds for the card, never a rule of its own: the triggers (ruling
//  R2) live in `inline-ai-edit/plan-clashes.ts`, so the gate, the card and the tool result judge one thing.
// ★ Ask it BEFORE the write. A trigger is a CHANGE against the stored row; after the write the row already
//  holds the new date, so the same call reads as no change and judges nothing.
import type { AbsenceClash, AbsenceCtx } from "./absence-clash";
import { describeProposal } from "./chat-proposal-describe";
import type { ProposedCall } from "./chat-proposal";
import type { Workspace } from "./workspace";

/** The chat tools that set a task's or a milestone's date — the only calls judged. */
export const DATE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "create_task", "update_task", "create_milestone", "update_milestone",
]);

/** The clashes `call` would cause against `ws` as it stands now; none for any other tool. */
export function callAbsenceClashes(call: ProposedCall, ws: Workspace, absence: AbsenceCtx): AbsenceClash[] {
  if (!DATE_WRITE_TOOLS.has(call.name)) return [];
  const [row] = describeProposal([call], ws, undefined, undefined, absence);
  return row ? row.plan.clashes.map((note) => note.clash) : [];
}
