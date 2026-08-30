// Recurrence gate for open-followups 235: a file that WRITES a task's
// status/completedDate pair must also DECIDE whether that write was a
// completion or a reopening.
//
// ★★ WHAT THIS CANNOT DO, stated so a green run is not over-read:
//   - It is FILE-GRANULAR. A file holding two status writers where only one
//     calls statusActivityKind passes. It proves a file participates, never
//     that every site in it does. That is not hypothetical, and it is the
//     reason this gate is filed as a convenience: `use-jira-sync.ts` carries
//     the conflict-resolution path adopted in `3e182c78`, whose own commit
//     message says a file-granular gate "is satisfied by the two pull sites
//     that were already adopted, so the site could have stayed silent behind a
//     green run forever". Only `use-jira-sync.test.tsx`'s two conflict blocks
//     can catch a regression there.
//   - It matches on SPELLING, and a new spelling is invisible until added to
//     WRITER_ANCHORS. That failure is on record for the sibling census in
//     `use-load-truncation.test.ts`: closing open-followups §287 replaced an
//     `await backend.load()` with a facade helper, the load site vanished from
//     its scan, and it only went red because the ratio it counts happened to
//     go unbalanced. A rename here has no ratio to save it.
//   - ★★★ IT DOES NOT SEE THE WHOLE WRITER POPULATION, and this list used to
//     stop one bullet above, so a green run read as covering all of it.
//     `docs/AGENTS/task-status.md` documents FIVE writers of the
//     status/completedDate pair. WRITER_ANCHORS spells TWO of them, and
//     `writerFiles()` walks APP_DIR with a NON-RECURSIVE readdirSync, so a
//     whole subdirectory of writers is invisible — widening the anchors alone
//     would not reach it. The two outside are:
//       * Undo/redo restore (runUndo/runRedo in src/app/undo/use-undo-stack.ts).
//         TASK_UNDO_GROUPS pairs "status" with "completedDate" as its FIRST
//         group, so an undo of a mark-done restores both halves and genuinely
//         flips delivered-ness; it logs "undo"/"redo" and no transition. A real
//         gap, filed as open-followups 299 — NOT exempt, just unreached.
//       * Template import (templates.ts -> reconcileStatusFromDate). Creation,
//         with no before-row and therefore no transition to classify —
//         defensibly exempt on the same rationale the EXEMPT map records for
//         task-manager.tsx, which is why it is not filed.
//     Reproduce the non-recursive walk (prints `false`, while the file exists):
//       node -e "console.log(require('fs').readdirSync('src/app').includes('use-undo-stack.ts'))"
//       ls src/app/undo/use-undo-stack.ts
//     and the anchor gap with `grep -rn "statusActivityKind" src/app/undo/`
//     (no match, exit 1).
//   - It gates the AUDIT LOG only — but do NOT read that as "a miss here can
//     never move a metric", which is what this bullet used to say and is false.
//     The completion-trend NUMERATOR is safe: `deliveredBy` reduces over
//     `tasks`, never over these entries. The SERIES is not. Both kinds are
//     members of `COUNT_KINDS`, which also decides which days SEED a point, so
//     a missed writer drops a completion-only day and can take the chart under
//     the `days.length < 2` floor entirely. That leg is NOT why this gate is a
//     convenience — the two bullets above are, and they are each sufficient.
//
// ★ ANTI-VACUITY, observed 2026-08-30 — both mutants were run and reverted:
//   - Deleting both `const kind = statusActivityKind(...)` lines and both
//     `if (kind) logActivityRef.current(...)` lines from
//     `use-task-row-handlers.ts` ran 1 failed | 2 passed. The decision test
//     alone went red on `AssertionError: expected [ 'use-task-row-handlers.ts' ]
//     to deeply equal []`. The SET test stayed GREEN, which is correct — the
//     file still calls applyStatusChange, so it is still a writer. Note the
//     surviving `import { … statusActivityKind }` line does NOT rescue it:
//     DECISION requires the open paren.
//   - Adding a commented `applyStatusChange(` to `task-closed.ts` (not a
//     writer) ran 2 failed | 1 passed — the SET test named `task-closed.ts` as
//     an unpinned arrival AND the decision test demanded a decision from it.
//     So a new writer cannot join the population unnoticed. It also measures
//     the thing that makes `change-log.ts`'s exemption necessary: a COMMENT
//     matches an anchor exactly as a call does.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = join(process.cwd(), "src", "app");

/** A file that writes the status/completedDate pair matches one of these. */
const WRITER_ANCHORS = [/applyStatusChange\(/, /issueToTaskFields\(/];
const DECISION = /statusActivityKind\(/;

/**
 * Files carrying an anchor that deliberately record no transition. Every
 * reason below was read out of the file on 2026-08-30, not inferred from the
 * name — a wrong reason is worse than no reason, because it licenses the next
 * reader to exempt something real.
 */
const EXEMPT = new Map<string, string>([
  // Comment only: the single occurrence is a doc-comment line, never a call.
  ["change-log.ts", "names applyStatusChange in a comment, never calls it"],
  // DECLARES `issueToTaskFields`; its other occurrence is a comment.
  ["jira-api.ts", "declares issueToTaskFields — the writer, not a call site"],
  // DECLARES both `applyStatusChange` and `statusActivityKind`.
  ["task-status.ts", "declares applyStatusChange and statusActivityKind"],
  // handleCreateLinkedTask mints a child at DEFAULT_TASK_STATUS and routes it
  // through applyStatusChange for the pair. There is no before-state, so there
  // is no transition to classify; it logs `task.created` instead.
  ["task-manager.tsx", "mints a child at DEFAULT_TASK_STATUS — no before-state"],
]);

function writerFiles(): string[] {
  return readdirSync(APP_DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => {
      const src = readFileSync(join(APP_DIR, f), "utf8");
      return WRITER_ANCHORS.some((re) => re.test(src));
    })
    .sort();
}

describe("status-write census", () => {
  it("finds the known set of status-writing files", () => {
    // Pinned as a SET, not a count, so a new writer forces a deliberate choice
    // (adopt or exempt) instead of silently joining an unchecked population.
    expect(writerFiles()).toEqual([
      "change-log.ts",
      "jira-api.ts",
      "task-manager.tsx",
      "task-status.ts",
      "use-action-center-handlers.ts",
      "use-bulk-operations.ts",
      "use-chat-dispatcher.ts",
      "use-jira-sync.ts",
      "use-task-row-handlers.ts",
      "use-task-submit.ts",
    ]);
  });

  it("records a transition decision in every non-exempt status-writing file", () => {
    const missing = writerFiles()
      .filter((f) => !EXEMPT.has(f))
      .filter((f) => !DECISION.test(readFileSync(join(APP_DIR, f), "utf8")));
    expect(missing).toEqual([]);
  });

  it("keeps every exemption pointed at a file that still exists", () => {
    // Without this, a renamed or deleted file leaves a stale exemption that
    // would silently excuse some future file of the same name.
    const present = new Set(writerFiles());
    expect([...EXEMPT.keys()].filter((f) => !present.has(f))).toEqual([]);
  });
});
