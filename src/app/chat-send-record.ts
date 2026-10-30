// src/app/chat-send-record.ts — what the staging gate knows about the whole user send (AI-02).
//
// Pure and i18n-free. `shouldStage` (`chat-proposal.ts`) judges one model turn; a single send can run
// several turns, so the gate also needs what earlier turns of the SAME send did and what the
// conversation holds. `chat-panel.tsx` opens one record per send and carries it through its tool loop.
import type { ApiMessage } from "./chat-api";
import {
  ALWAYS_STAGED_TOOLS,
  isCreateTool,
  isDestructiveCall,
  isEntityWriteCall,
  sendsInvitations,
  type ProposedCall,
} from "./chat-proposal";
import { TOKEN_REQUIRED_TOOLS } from "./chat-proposal-apply";

/** One user send, as the staging gate sees it.
 *  - `appliedWrites`: entity writes that already ran directly in an earlier turn of this send, so
 *    "more than one write stages" counts across the send, not per turn.
 *  - `untrusted`: an attachment (an `image` or `document` block) is somewhere in the history. Its
 *    text reaches the model as input it may follow, so risky writes go to the review card
 *    (`stagesWhenUntrusted`) — the prompt-injection gate.
 *  - `staged`: a turn of this send already staged a card. A later turn's tool calls then run
 *    nothing and get `PROPOSAL_PENDING_RESULT` (`chat-proposal-stage.ts`), so that card is never
 *    replaced before the user saw it. */
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

/** Tools that change device or view state rather than an entity, and still stage in an untrusted send:
 *  an attachment must not be able to switch the language, hide rows behind a filter or turn settings
 *  off unseen. */
const UNTRUSTED_STAGED_NON_ENTITY: ReadonlySet<string> = new Set(["update_settings", "set_filters", "set_language"]);

/** True when this call goes to the review card in an untrusted send: a create, a destructive call, an
 *  invitation or inquiry, a project, settings, filter or language write, and every entity write whose
 *  schema takes no `expectedToken` (`TOKEN_REQUIRED_TOOLS`). False for reads, `optimize_wbs` (it
 *  proposes, it does not write) and a tokened update — the token pins the write to the row the model
 *  read, and a lone one applies as it does in a trusted send. */
export function stagesWhenUntrusted(call: ProposedCall): boolean {
  if (isCreateTool(call.name)) return true;
  if (isDestructiveCall(call)) return true;
  if (sendsInvitations(call)) return true;
  if (ALWAYS_STAGED_TOOLS.has(call.name)) return true;
  if (UNTRUSTED_STAGED_NON_ENTITY.has(call.name)) return true;
  return isEntityWriteCall(call) && !TOKEN_REQUIRED_TOOLS.has(call.name);
}
