// src/app/chat-send-record.ts — what the staging gate knows about the whole user send (AI-02).
//
// Pure and i18n-free. `shouldStage` (`chat-proposal.ts`) judges one model turn; a single send can run
// several turns, so the gate also needs what earlier turns of the SAME send did and what the
// conversation holds. `chat-panel.tsx` opens one record per send and carries it through its tool loop.
import type { ApiMessage } from "./chat-api";
import { ALWAYS_STAGED_TOOLS, isDestructiveCall, sendsInvitations, type ProposedCall } from "./chat-proposal";
import { TOKEN_REQUIRED_TOOLS } from "./chat-proposal-apply";

/** One user send, as the staging gate sees it.
 *  - `appliedWrites`: entity writes that already ran directly in an earlier turn of this send, so
 *    "more than one write stages" counts across the send, not per turn.
 *  - `untrusted`: an attachment (an `image` or `document` block) is somewhere in the history. Its
 *    text reaches the model as input it may follow, so risky writes go to the review card
 *    (`stagesWhenUntrusted`) — the prompt-injection gate.
 *  - `staged`: a turn of this send already staged a card. A later turn's reads still run
 *    (`isPureReadTool`); every other call runs nothing and gets `PROPOSAL_PENDING_RESULT`
 *    (`chat-proposal-stage.ts`), so that card is never replaced before the user saw it. */
export type SendRecord = {
  readonly appliedWrites: number;
  readonly untrusted: boolean;
  readonly staged: boolean;
};

/** The record a send starts with. Read from the FULL history (`newHistory` in `chat-panel.tsx`), not
 *  the copy trimmed for the request budget: an attachment the trim replaced with its
 *  "[attachment: …]" placeholder is still in the conversation the model was shown earlier.
 *  ★ The placeholder alone does not make a send untrusted: a saved thread strips the blocks
 *  (`stripAttachmentsForPersistence`), and the model never sees their content again after that. */
export function openSendRecord(history: readonly ApiMessage[]): SendRecord {
  const untrusted = history.some(
    (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image" || b.type === "document"),
  );
  return { appliedWrites: 0, untrusted, staged: false };
}

/** The tools that only read: they write no entity, setting, filter or language and propose nothing. */
const READ_TOOLS: ReadonlySet<string> = new Set([
  "get_app_state", "get_contact_email", "get_dashboard_snapshot", "get_document", "get_forecast", "get_project",
  "get_resource", "get_task",
  "list_absences", "list_allocations", "list_budget_buckets", "list_calendar_events", "list_changes",
  "list_documents", "list_knowledge_items", "list_milestones", "list_raid", "list_resources", "list_stakeholders",
  "list_tasks",
  "search_chats", "search_history",
]);

/** True for a tool that only reads. Once a turn of the send has staged, these still run, so the model can
 *  look things up and write its reply; every other call (a write, `optimize_wbs`, a settings, filter or
 *  language change, or a tool this list does not name) is answered with `PROPOSAL_PENDING_RESULT`. */
export function isPureReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

/** The input fields that say where a person is reached, across every update tool's schema
 *  (`chat-tool-defs.ts`). An attachment must not repoint an address unseen, even with a valid token.
 *  `attendeeResourceIds` is absent on purpose: it names directory rows, not addresses. */
const CONTACT_FIELDS: readonly string[] = ["email", "emails", "assigneeEmail", "ownerEmail", "toEmail", "businessPhone"];

/** True when the call's input sets a contact field. The key decides, not the value: clearing an
 *  address is a contact change too. */
function touchesContactField(call: ProposedCall): boolean {
  return CONTACT_FIELDS.some((field) => Object.hasOwn(call.input, field));
}

/** True when this call goes to the review card in an untrusted send. FAIL CLOSED: everything stages
 *  except a pure read (`isPureReadTool`), `optimize_wbs` (it proposes, it does not write) and a tokened
 *  update (`TOKEN_REQUIRED_TOOLS`) — the token pins the write to the row the model read, and a lone one
 *  applies as it does in a trusted send. A tool this module does not know stages.
 *  A tokened update still stages when it is destructive, would send invitations, edits the project
 *  record (`ALWAYS_STAGED_TOOLS`), is `escalate_raid_item` (it records a recipient address), or sets a
 *  contact field (`CONTACT_FIELDS`). */
export function stagesWhenUntrusted(call: ProposedCall): boolean {
  if (isPureReadTool(call.name) || call.name === "optimize_wbs") return false;
  if (!TOKEN_REQUIRED_TOOLS.has(call.name)) return true;
  if (isDestructiveCall(call) || sendsInvitations(call) || ALWAYS_STAGED_TOOLS.has(call.name)) return true;
  if (call.name === "escalate_raid_item") return true;
  return touchesContactField(call);
}
