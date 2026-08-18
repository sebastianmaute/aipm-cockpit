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
// ★★ ONE SLOT, not a Map keyed by project. Publishing for a new project replaces
//   the slot outright, so a stale project's threads can never be read back and
//   there is nothing to evict. A Map would leak the previous project's entry on
//   every switch.
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

const EMPTY: PublishedThreads = { threads: [], activeThreadId: null, available: false };

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
