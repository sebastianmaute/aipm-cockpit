// src/app/chat-thread-load.ts — the pure settle decisions for a chat-thread
// LOAD, extracted from use-chat-threads.ts. Given the thread ids, the project
// and whether something live must be preserved, each returns the `threads`
// updater plus the flags the caller acts on. No React, no I/O, no clock —
// every input is a value, so both are directly testable.
//
// Extracted to keep use-chat-threads.ts under the 800-line ratchet while the
// retryLoad guards grew. Behaviour is byte-identical to the in-hook version.
import type { ChatThread } from "./chat-threads";

/** Outcome of settling a SUCCESSFUL `loadThreads()` call, shared by the
 *  mount-fetch effect's `.then` and retryLoad's reload `.then` (§148) so the
 *  two settle paths cannot drift apart. `stale=true` means "do not adopt
 *  `loaded[0]`", and since `preserveLive` landed it has TWO causes, not one:
 *  either something (ensureThreadForSend) minted/adopted a different thread
 *  while this fetch was in flight, OR the caller held a live send via
 *  `preserveLive` and nothing moved at all. Under EITHER the caller must
 *  MERGE `loaded` rather than adopt `loaded[0]`, per the mount effect's own
 *  "MERGE, not bail" comment. */
export interface LoadSettleResult {
  updateThreads: (prev: ChatThread[]) => ChatThread[];
  stale: boolean;
  next: ChatThread | null;
}

/** `preserveLive` forces the merge branch even when the identity test reads
 *  clean. The identity test asks "did threadIdRef MOVE during this fetch",
 *  which is blind to a thread that moved BEFORE the fetch started and still
 *  has a send streaming into it — the state a failed mount fetch's own stale
 *  branch leaves behind. Only retryLoad passes true; see its comment for why
 *  the mount/project-switch effect must NOT.
 *
 *  ★★★ THE MERGE BRANCH IS SCOPED TO THIS PROJECT, and that filter is
 *  load-bearing rather than tidiness. `prev` is whatever the PREVIOUS project
 *  left behind — nothing resets it on a switch — so an unfiltered merge keeps
 *  another project's rows in the sidebar and, since the caller marks the list
 *  loaded on this path, republishes them under this project's id. Every row
 *  carries the `projectId` it was minted or fetched under (`loadThreads` is
 *  per-project; ensureThreadForSend and the busy-persist effect both stamp
 *  it), so the ownership test is exact rather than heuristic. */
export function mergeThreadsAfterLoad(
  startedOn: string | null,
  liveThreadId: string | null,
  projectId: string,
  loaded: ChatThread[],
  preserveLive: boolean,
): LoadSettleResult {
  if (preserveLive || liveThreadId !== startedOn) {
    return {
      updateThreads: (prev) => [
        ...prev.filter((th) => th.projectId === projectId && !loaded.some((l) => l.id === th.id)),
        ...loaded,
      ],
      stale: true,
      next: null,
    };
  }
  return { updateThreads: () => loaded, stale: false, next: loaded[0] ?? null };
}

/** Mirror of mergeThreadsAfterLoad for a FAILED `loadThreads()` call — shared
 *  by the mount effect's `.catch` and retryLoad's reload `.catch` (§148), so
 *  a mid-flight-minted thread's row survives a failed reload exactly as it
 *  already survived a failed initial fetch. */
export interface FailedLoadSettleResult {
  updateThreads: (prev: ChatThread[]) => ChatThread[];
  stale: boolean;
}

export function resetThreadsAfterFailedLoad(
  startedOn: string | null,
  liveThreadId: string | null,
  projectId: string,
  preserveLive: boolean,
): FailedLoadSettleResult {
  if (preserveLive || liveThreadId !== startedOn) {
    return { updateThreads: (prev) => prev.filter((th) => th.projectId === projectId), stale: true };
  }
  return { updateThreads: () => [], stale: false };
}
