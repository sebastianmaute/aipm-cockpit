// src/app/alloc-plan/alloc-apply.ts
//
// What one Plan with AI apply writes and what it skips, and why (§769). Pure and i18n-free: the hook
// (use-alloc-plan.tsx) hands the result to §774's `reassignTasks` and its own cell write, and words the toast.
//
// Every row was grounded at PROPOSE time; this judges it against the CONFIRM-time (live) state. A row whose inputs
// moved while the window was open is STALE and is not written: writing it anyway would silently overwrite a value the
// user never saw or approved (the same silent-overwrite class timelog-apply.ts had to close). A ticked hour edit the
// fresh moves, planned TOGETHER on the live state, already write is COVERED: its absolute value was planned without the
// moved hours and would overwrite them. A move or an hour edit that changes nothing is UNCHANGED.
import { type Resource } from "../types";
import { resourceDisplayName } from "../resource-foundation";
import { type OwnerEdit } from "../use-reassign-hours";
import { cellKey, type GroundedAllocCell } from "./alloc-plan";
import { isMoveStale, planTickedMoves, type GroundedAlternative, type GroundedMove, type MoveGroundContext } from "./alloc-ground-moves";

export type UtilPatch = { id: number; before: Pick<Resource, "utilization">; after: Pick<Resource, "utilization"> };

export interface ApplyPlan {
  /** Ticked rows, before any is judged. */
  chosen: number;
  /** Owner edits for §774, in the alternative's order: the fresh moves that change an owner. */
  ownerEdits: OwnerEdit[];
  /** Hour edits to write: fresh, not covered. */
  cells: GroundedAllocCell[];
  /** One per-key field patch per person for those cells (a cell already at its next value has none). */
  patches: UtilPatch[];
  /** Cell keys the patches write. */
  cellCount: number;
  stale: number;
  covered: number;
  /** Moves whose owner already is the receiver, and cells already at their next value. */
  unchanged: number;
}

/** One field patch per resource holding ONLY the cell keys the apply writes (a key that was absent stays absent in
 *  `before`, so undo removes it again). Undo merges `utilization` per key, so §774's resources part and this part
 *  share one entry without either reverting the other's keys. */
export function cellPatches(resources: readonly Resource[], cells: readonly GroundedAllocCell[]): UtilPatch[] {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const patches = new Map<number, UtilPatch>();
  for (const c of cells) {
    const r = byId.get(c.resourceId);
    if (!r || (r.utilization[c.periodKey] ?? 0) === c.nextValue) continue;
    const prev = patches.get(r.id) ?? { id: r.id, before: { utilization: {} }, after: { utilization: {} } };
    const had = Object.hasOwn(r.utilization, c.periodKey);
    patches.set(r.id, {
      id: r.id,
      before: { utilization: had ? { ...prev.before.utilization, [c.periodKey]: r.utilization[c.periodKey] } : prev.before.utilization },
      after: { utilization: { ...prev.after.utilization, [c.periodKey]: c.nextValue } },
    });
  }
  return [...patches.values()];
}

/** The owner a move writes: the receiver's display name, e-mail and link. */
function ownerEditFor(move: GroundedMove, receiver: Resource): OwnerEdit {
  return { taskId: move.taskId, assignee: resourceDisplayName(receiver), assigneeEmail: receiver.email ?? "", resourceId: receiver.id };
}

export function planApply(alt: GroundedAlternative, selected: ReadonlySet<string>, live: MoveGroundContext): ApplyPlan {
  const chosenMoves = alt.moves.filter((m) => selected.has(m.key));
  const chosenCells = alt.cells.filter((c) => selected.has(cellKey(c)));
  const resourceById = new Map(live.resources.map((r) => [r.id, r]));
  const taskById = new Map(live.tasks.map((t) => [t.id, t]));

  const freshMoves = chosenMoves.filter((m) => !isMoveStale(m, live));
  const freshCells = chosenCells.filter((c) => {
    const person = resourceById.get(c.resourceId);
    return person !== undefined && (person.utilization[c.periodKey] ?? 0) === c.currentValue;
  });
  const moveWrites = planTickedMoves(freshMoves, selected, live).changedCells;
  const cells = freshCells.filter((c) => !moveWrites.has(cellKey(c)));
  const patches = cellPatches(live.resources, cells);
  const cellCount = patches.reduce((n, p) => n + Object.keys(p.after.utilization).length, 0);

  // A fresh move's receiver and task exist: its snapshot watches both, so the stale check refused it otherwise.
  const ownerEdits = freshMoves
    .map((m) => ownerEditFor(m, resourceById.get(m.toResourceId) as Resource))
    .filter((e) => {
      const task = taskById.get(e.taskId);
      return !(task && task.assignee === e.assignee && task.assigneeEmail === e.assigneeEmail && task.resourceId === e.resourceId);
    });

  return {
    chosen: chosenMoves.length + chosenCells.length,
    ownerEdits,
    cells,
    patches,
    cellCount,
    stale: chosenMoves.length - freshMoves.length + chosenCells.length - freshCells.length,
    covered: freshCells.length - cells.length,
    unchanged: freshMoves.length - ownerEdits.length + cells.length - cellCount,
  };
}
