// Carries the chat panel's live thread list up to the AI dispatcher.
//
// ★★★ WHY A MODULE STORE AND NOT PROPS. `useChatThreads` is called in
//   `chat-panel.tsx`; `useChatDispatcher` is called in `task-manager.tsx`, which
//   RENDERS the chain that reaches the panel. Threads therefore sit BELOW the
//   point where the AI snapshot is assembled, and every file in that chain
//   (`task-manager.tsx`, `workspace-section.tsx`, `chat-panel.tsx`) sits at
//   EXACTLY its size baseline, so threading a ref down costs lines on three
//   files that have none. Precedent: `project-appearance-prefs.ts`, which the
//   dispatcher already reads through `useViewDigest`.
//
// ★★ NO `useSyncExternalStore`, no listener set, no snapshot cache, no equality
//   function — the precedent needs all four because components RENDER from it.
//   Nothing renders from chat search: `getSnapshot()` reads at send time. Adding
//   reactivity here would be machinery with no consumer.
//
// ★★★ ONE SLOT, and what that does and does NOT buy. Publishing for a new
//   project replaces the slot outright, so there is nothing to evict and a read
//   for project B can never be answered with a value STORED UNDER project A —
//   the key check does that. It does NOT make the stored value trustworthy: the
//   store cannot tell whose threads a payload actually holds, so a publisher
//   handing it project A's threads under project B's key is a leak this file is
//   structurally unable to see. That is a real bug that shipped — the publish
//   effect in `use-chat-threads.ts` fired with the NEW project id while
//   `threads` still held the OLD project's rows, because the reset lives in the
//   async settle of the load effect. **The PUBLISHER owns payload/key
//   agreement**; see that effect's `threadsMatchProject` gate.
import type { ChatThread } from "./chat-threads";

export interface PublishedThreads {
  threads: readonly ChatThread[];
  activeThreadId: string | null;
  /**
   * ★★★ Turso reachability, NOT `threads.length > 0`. The two are different
   * questions and the engine's `coverage` field depends on the distinction.
   */
  available: boolean;
}

// ★★ FROZEN, and both levels of it. This one object is handed to EVERY miss for
//   the process lifetime, and `readonly` on `threads` is a TYPE-only guarantee
//   that `available`/`activeThreadId` never had at all — so one consumer
//   assigning to a read result would corrupt what every later miss returns.
const EMPTY: PublishedThreads = Object.freeze({
  threads: Object.freeze([]) as readonly ChatThread[],
  activeThreadId: null,
  available: false,
});

let slot: { projectId: string; value: PublishedThreads } | null = null;

export function publishChatThreads(projectId: string, value: PublishedThreads): void {
  slot = { projectId, value };
}

/** The live threads for `projectId`, or an unavailable empty value. */
export function readChatThreads(projectId: string): PublishedThreads {
  return slot !== null && slot.projectId === projectId ? slot.value : EMPTY;
}

/**
 * Drop the slot.
 *
 * ★ Module state survives `vi.clearAllMocks()` and RTL cleanup, so every test
 *   touching this must call it in an `afterEach` or it leaks into whatever file
 *   the shuffled run schedules next.
 */
export function clearChatThreads(): void {
  slot = null;
}

/**
 * Drop the slot only if it is still the one `projectId` published.
 *
 * ★★ This is the UNMOUNT path, and it must be scoped. Withdrawing AI consent
 *   unmounts the chat panel (it renders a consent screen instead) while nothing
 *   else clears the store, so the last payload would otherwise stay readable
 *   with `available: true` forever. Scoping it means a publisher that has since
 *   moved to another project cannot have its fresh value wiped by a late
 *   cleanup for the old one.
 */
export function clearChatThreadsFor(projectId: string): void {
  if (slot !== null && slot.projectId === projectId) slot = null;
}
