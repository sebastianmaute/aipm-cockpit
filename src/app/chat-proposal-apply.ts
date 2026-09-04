// src/app/chat-proposal-apply.ts — apply the rows the user kept from a staged
// chat plan, as ONE undoable commit.
//
// React-free. Takes the dispatcher, the described rows, the user's selection and
// an open `UndoBatch`; drives the real tool dispatch and reports what each row
// did.
//
// ★★★ THE CALLS ARE RE-INVOKED, NEVER REPLAYED AS A DATA DIFF, and this is the
// invariant with a live counter-example rather than a stylistic preference.
// `send_inquiry`'s handler calls `window.open` on a `mailto:` URL and only THEN
// increments `Task.inquiriesSent`. Rebuilding a plan's effect from the
// before/after rows `describeProposal` computed would bump that counter and open
// no mail client — a send that reports success, sends nothing, and raises no
// error at any layer. Any future tool with an in-handler side effect (a fetch, a
// download, a window) inherits its protection from this rule alone, so route
// every applied row through `runTool` and nothing else.
//
// ★★ `row.stamped` IS REPLAYED, NOT `row.call`. `describeProposal` PRESERVES a
// model-supplied `expectedToken` and stamps one only into an absence, so
// `stamped === call` in the common case — that identity is the normal state, not
// a symptom. Replaying `stamped` is correct in both branches; replaying `call`
// is correct only in one.
import { runTool, type ToolDispatcher } from "./chat-tools";
import { ConcurrencyTokenError } from "./chat-tools-updates";
import type { DescribedRow } from "./chat-proposal-describe";
import type { UndoBatch } from "./use-undo-batch";

/** What one selected row did. `index` is the row's position in the FULL
 *  described list — the same identity the review card's checkboxes and
 *  `cascadeDeselect` key on — so a caller can mark the right row without
 *  re-deriving anything from a filtered array. */
export interface AppliedRow {
  readonly index: number;
  readonly ok: boolean;
  /** The write was REFUSED because the row moved since it was staged, so it
   *  wrote nothing.
   *
   *  ★★ SEPARATE FROM A PLAIN FAILURE ON PURPOSE, matched on the ERROR TYPE and
   *  never its message (both `ConcurrencyTokenError` messages are model-facing
   *  recovery instructions and may be reworded). `requireToken` throws BEFORE
   *  the dispatcher is reached, so a stale row is safe to offer for retry; a
   *  hard failure may already have written something and is not. */
  readonly stale?: boolean;
  readonly error?: string;
}

export interface ApplyProposalResult {
  /** One entry per SELECTED row, in the described order. Unselected rows are
   *  absent rather than reported as skipped — the caller owns the selection and
   *  a "skipped" row would read as an outcome. */
  readonly rows: readonly AppliedRow[];
}

export interface ApplyProposalArgs {
  readonly dispatcher: ToolDispatcher;
  /** The FULL described list, so `AppliedRow.index` keeps the card's identity. */
  readonly rows: readonly DescribedRow[];
  /** Positions in `rows` the user kept. */
  readonly selected: ReadonlySet<number>;
  readonly batch: UndoBatch;
}

/**
 * Replay every selected row and push at most ONE undo entry for the whole
 * applied plan.
 *
 * ★★★ A ROW THAT FAILS FAILS ALONE. Each call is its own try/catch, so a stale
 * token or a sanitizer rejection stops that row and nothing else — the remaining
 * rows still apply and every outcome is reported. Silence about a partial apply
 * is the expensive failure here: the user approved a plan and would otherwise be
 * told it landed while some of it did not.
 *
 * ★ SEQUENTIAL, never `Promise.all`. The writers keep their own entity refs in
 * sync synchronously (`tasksRef.current = next`) so back-to-back calls compose,
 * and a concurrent fan-out would have several of them computing `next` from the
 * same pre-batch array and clobbering each other.
 */
export async function applyProposal(args: ApplyProposalArgs): Promise<ApplyProposalResult> {
  const { dispatcher, rows, selected, batch } = args;
  const applied: AppliedRow[] = [];

  await batch.runBatched(async () => {
    for (let index = 0; index < rows.length; index += 1) {
      if (!selected.has(index)) continue;
      const { stamped } = rows[index];
      try {
        await runTool(dispatcher, stamped.name, stamped.input);
        applied.push({ index, ok: true });
      } catch (e) {
        applied.push({
          index,
          ok: false,
          stale: e instanceof ConcurrencyTokenError,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });

  return { rows: applied };
}
