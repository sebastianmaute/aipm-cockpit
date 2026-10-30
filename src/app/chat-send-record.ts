// src/app/chat-send-record.ts — what the staging gate knows about the whole user send (AI-02).
//
// Pure and i18n-free. `shouldStage` (`chat-proposal.ts`) judges one model turn; a single send can run
// several turns, so the gate also needs what earlier turns of the SAME send did and what the
// conversation holds. `chat-panel.tsx` opens one record per send and carries it through its tool loop.
import type { ApiMessage } from "./chat-api";
import { ALWAYS_STAGED_TOOLS, isDestructiveCall, sendsInvitations, type ProposedCall } from "./chat-proposal";
import { TOKEN_REQUIRED_TOOLS } from "./chat-proposal-apply";
import { PERSON_FIELDS } from "./person-reassign";
import { RESOURCE_MATCH_FIELDS } from "./resource-foundation";

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

/** The input keys that change where a person is reached, across every update tool's schema
 *  (`chat-tool-defs.ts`). An attachment must not repoint a stored address unseen, even with a valid token.
 *  - the address fields themselves;
 *  - each person-name key and its paired address key in `PERSON_FIELDS`: a new name makes the writer
 *    derive the stored address (`withReassignFields`), so a name-only reassignment repoints it too;
 *  - `resourceId`, the person link, which decides the address an absence resolves to.
 *  `attendeeResourceIds` is absent on purpose: it names attendees, not an address on file.
 *  `chat-send-record.test.ts` walks the tokened tools' schemas and goes red for a key missing here. */
export const UNTRUSTED_CONTACT_KEYS: ReadonlySet<string> = new Set([
  "email", "emails", "toEmail", "businessPhone",
  ...Object.values(PERSON_FIELDS).flatMap((f) => [f.name, f.email]),
  "resourceId",
]);

/** True when the call's input carries a contact key. The key decides, not the value: clearing an
 *  address, or naming the same person again, still goes to the card. */
function touchesContactField(call: ProposedCall): boolean {
  return Object.keys(call.input).some((key) => UNTRUSTED_CONTACT_KEYS.has(key));
}

/** The `update_resource` keys that change who a stored name or address resolves to: every field the person
 *  linker matches on (`RESOURCE_MATCH_FIELDS`), plus `name`, the write alias the dispatcher splits into
 *  `firstName`/`lastName`. A rename can relink an unlinked same-name assignee on the next load and redirect
 *  its inquiries. Scoped to that tool: a stakeholder's or a scenario's `name` resolves nobody. */
const RESOURCE_MATCH_KEYS: ReadonlySet<string> = new Set([...RESOURCE_MATCH_FIELDS, "name"]);

function changesDirectoryMatch(call: ProposedCall): boolean {
  return call.name === "update_resource" && Object.keys(call.input).some((key) => RESOURCE_MATCH_KEYS.has(key));
}

/** True when this call goes to the review card in an untrusted send. FAIL CLOSED: everything stages
 *  except a pure read (`isPureReadTool`), `optimize_wbs` (it proposes, it does not write) and a tokened
 *  update (`TOKEN_REQUIRED_TOOLS`) — the token pins the write to the row the model read, and a lone one
 *  applies as it does in a trusted send. A tool this module does not know stages.
 *  A tokened update still stages when it is destructive, would send invitations, edits the project
 *  record (`ALWAYS_STAGED_TOOLS`), is `escalate_raid_item` (it records a recipient address), or carries
 *  a contact, person-name or person-link key (`UNTRUSTED_CONTACT_KEYS`), or renames a directory person
 *  (`RESOURCE_MATCH_KEYS`). */
export function stagesWhenUntrusted(call: ProposedCall): boolean {
  if (isPureReadTool(call.name) || call.name === "optimize_wbs") return false;
  if (!TOKEN_REQUIRED_TOOLS.has(call.name)) return true;
  if (isDestructiveCall(call) || sendsInvitations(call) || ALWAYS_STAGED_TOOLS.has(call.name)) return true;
  if (call.name === "escalate_raid_item") return true;
  return touchesContactField(call) || changesDirectoryMatch(call);
}
