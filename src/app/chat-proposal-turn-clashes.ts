// src/app/chat-proposal-turn-clashes.ts — §773: the absence clashes of a staged chat turn, judged against
// the turn as it will land, not only the workspace it was staged against.
//
// Pure and i18n-free. `describeProposal` asks it for every row's `plan.clashes`, so the card and the staged
// tool result (`stagedToolResult`) read one judgment.
// ★★ Why a turn and not the workspace: a call can change a task or milestone an EARLIER call of the same
//  turn creates (`create_task`, then `update_task` on its provisional id). That target is in no workspace,
//  so its row plan is empty — the write would land on someone's absence unannounced. Here the create's
//  input with every later change to it folded in is judged AS A CREATE: every date of a row created this
//  turn is new, so the whole item is judged (R2's "hands over the whole item").
// ★★ A second change to an EXISTING row is judged against the row as the turn's earlier changes leave it
//  (M-1): `update_task(5, {assignee})`, then `update_task(5, {dueDate})`, judges the move with the new
//  owner, and the whole item once an earlier call changed the owner (`carryClashes`). A milestone judges
//  its linked tasks as the turn leaves them too.
// ★★ Confined to clashes. The tasks folded in exist only in the workspace this module judges against;
//  the card's field lines, links and rejections are still described against the real workspace.
import type { AbsenceCtx } from "./absence-clash";
import type { ProposedCall } from "./chat-proposal";
import { describeEntityCalls, type ClashNote } from "./inline-ai-edit/plan";
import { carryClashes, type ClashCarry } from "./inline-ai-edit/plan-clashes";
import { INLINE_DESCRIPTORS, type EntityDescriptor } from "./inline-ai-edit/entity-descriptor";
import { linkPersonForWrite } from "./resource-foundation";
import { sanitizeAssignee, sanitizeIsoDate, sanitizeLoadedEmail, sanitizeTaskName } from "./sanitize";
import type { Task } from "./types";
import type { Workspace } from "./workspace";

type RowItem = Parameters<typeof describeEntityCalls>[1]["item"];
type Input = Readonly<Record<string, unknown>>;

/** The entities a clash can concern, by the tool that creates or updates them. */
const JUDGED: readonly EntityDescriptor[] = [INLINE_DESCRIPTORS.task, INLINE_DESCRIPTORS.milestone];

function descriptorOf(toolName: string): EntityDescriptor | undefined {
  return JUDGED.find((d) => d.createTool === toolName || d.updateTool === toolName);
}

/** A change's own fields: what it would set on its target, without the addressing. */
function changeFields(input: Input): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...input };
  delete rest.id;
  delete rest.expectedToken;
  return rest;
}

interface Created { descriptor: EntityDescriptor; mintedId: number; input: Record<string, unknown> }

export interface TurnClashes {
  /** The clashes `call` would cause, against the workspace plus what earlier calls of the turn create.
   *  `pendingOn` is the index of the call that creates this call's target (`PlanRow.dependsOn`). */
  judge(call: ProposedCall, pendingOn: number | undefined): ClashNote[];
  /** Take `call` (row `index`) into the turn, so later calls see the row it creates or the change it makes. */
  record(index: number, call: ProposedCall, mintedId: number | undefined, pendingOn: number | undefined): void;
}

export function turnClashes(ws: Workspace, absence: AbsenceCtx): TurnClashes {
  const created = new Map<number, Created>();
  /** Existing rows an earlier call of the turn changed, by `${entity}:${id}`. */
  const changed = new Map<string, ClashCarry>();

  /** A created task as `createTask` stores the fields the clash rule reads. */
  function createdTask(c: Created): Task {
    const assignee = sanitizeAssignee(c.input.assignee);
    const assigneeEmail = sanitizeLoadedEmail(c.input.assigneeEmail);
    return {
      id: c.mintedId,
      taskName: sanitizeTaskName(c.input.taskName),
      assignee,
      assigneeEmail,
      resourceId: linkPersonForWrite({ assignee, assigneeEmail }, absence.resources) ?? undefined,
      dueDate: sanitizeIsoDate(c.input.dueDate),
    } as Task;
  }

  /** The workspace the turn judges against: the real one, plus the tasks this turn creates so far (a
   *  milestone linking one judges its owner). Nothing else reads the folded rows. */
  function turnWorkspace(): Workspace {
    const tasks = [...created.values()].filter((c) => c.descriptor.entity === "task").map(createdTask);
    const stored = Array.isArray(ws.tasks) ? ws.tasks : [];
    const live = stored.map((t) => (changed.get(`task:${t.id}`)?.item as Task | undefined) ?? t);
    const touched = live.some((t, i) => t !== stored[i]);
    return tasks.length === 0 && !touched ? ws : { ...ws, tasks: [...live, ...tasks] };
  }

  function clashesOf(descriptor: EntityDescriptor, name: string, input: Input, item: RowItem, ownerChanged = false): ClashNote[] {
    const block = { type: "tool_use", name, input };
    return describeEntityCalls([block], { descriptor, item, ws: turnWorkspace(), absence, ownerChanged }).clashes;
  }

  /** The existing row an update addresses, as the turn's earlier changes leave it; undefined on a miss. */
  function existingRow(d: EntityDescriptor, input: Input): ClashCarry | undefined {
    const id = Number(input.id);
    const carried = changed.get(`${d.entity}:${id}`);
    if (carried) return carried;
    // As `describeProposal`'s own seed finds it.
    const rows = ws[d.wsKey] as unknown;
    const row = (Array.isArray(rows) ? (rows as readonly { id: number }[]) : []).find((r) => r.id === id);
    return row ? { item: row as unknown as RowItem, ownerChanged: false } : undefined;
  }

  return {
    judge(call, pendingOn) {
      const d = descriptorOf(call.name);
      if (!d) return [];
      if (pendingOn !== undefined) {
        const target = created.get(pendingOn);
        if (!target || target.descriptor !== d || call.name !== d.updateTool) return [];
        const merged = { ...target.input, ...changeFields(call.input) };
        return clashesOf(d, d.createTool, merged, { id: Number.NaN } as unknown as RowItem);
      }
      if (call.name === d.createTool) return clashesOf(d, call.name, call.input, { id: Number.NaN } as unknown as RowItem);
      // A miss is the NaN sentinel.
      const row = existingRow(d, call.input);
      if (!row) return clashesOf(d, call.name, call.input, { id: Number.NaN } as unknown as RowItem);
      return clashesOf(d, call.name, call.input, row.item as RowItem, row.ownerChanged);
    },
    record(index, call, mintedId, pendingOn) {
      const d = descriptorOf(call.name);
      if (!d) return;
      if (call.name === d.createTool && mintedId !== undefined) {
        created.set(index, { descriptor: d, mintedId, input: changeFields(call.input) });
        return;
      }
      if (pendingOn !== undefined) {
        const target = created.get(pendingOn);
        if (target && target.descriptor === d && call.name === d.updateTool) {
          created.set(pendingOn, { ...target, input: { ...target.input, ...changeFields(call.input) } });
        }
        return;
      }
      if (call.name !== d.updateTool) return;
      const row = existingRow(d, call.input);
      if (!row) return;
      // Read off the call's final plan, so a field the plan rejects carries nothing.
      const block = { type: "tool_use", name: call.name, input: call.input };
      const plan = describeEntityCalls([block], { descriptor: d, item: row.item as RowItem, ws: turnWorkspace() });
      changed.set(`${d.entity}:${row.item.id}`, carryClashes(block, plan, d, row, absence));
    },
  };
}
