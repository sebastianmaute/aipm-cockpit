// src/app/use-chat-threads-publish.ts — publishes useChatThreads' list to the module registry the AI
// dispatcher reads (see chat-threads-registry.ts for why this is not a prop). A deps-object hook
// (AGENTS.md "Extraction conventions", rule 1) with a single effect; it decides what the model may be
// told about past chats, so it is coverage-gated, not excluded.
import { useEffect } from "react";
import type { ChatThread } from "./chat-threads";
import { publishChatThreads, clearChatThreadsFor } from "./chat-threads-registry";

export interface UseChatThreadsPublishDeps {
  tursoMode: boolean;
  projectId: string;
  threads: ChatThread[];
  activeThreadId: string | null;
  /** Whether the current `threads` were loaded for the LIVE project. */
  threadsMatchProject: boolean;
  /** Whether the last load for this project failed. */
  loadFailed: boolean;
}

// ★★★ `tursoMode` GATES THE PAYLOAD, not just the flag. useChatThreads never
// unmounts on navigation — `panel-chat` is one of the two tabpanels
// workspace-section mounts unconditionally — so a Turso→File switch has no
// remount to clear stale threads, and publishing them beside
// `available: false` would leave real conversation text readable by a path
// that has just been told it cannot reach any. Same shape as the
// `threadIdRef` regression documented at ensureThreadForSend.
//
// ★★★ AND `projectId` GATES IT A SECOND TIME — the store's single slot stops
// a stale KEY being read back, and nothing there can stop a stale PAYLOAD
// being written under a FRESH key. `threads` is not reset synchronously when
// `projectId` changes (the reset lives in the async settle of the load effect),
// so in the very render where the id flips p1→p2 this effect fired
// with p2's id and p1's still-populated rows, and `readChatThreads("p2")`
// handed the dispatcher another project's conversation text — searchable, and
// marked available. Publishing an EMPTY list until the load for the LIVE
// project has settled is the fix. ★★ A "have we loaded at all" boolean
// would NOT do — it is true from p1's load onward, which is exactly the
// leaking state.
//
// ★★★ `available` IS A THREE-WAY SPLIT, NOT A RESTATEMENT OF `tursoMode`.
// chat-search.ts turns it into `coverage`, and chat-tool-defs.ts tells the
// model that `turso` means past conversations WERE searched — so under that
// flag an empty result reads as "this was never discussed". The three states
// do not make the same claim:
//   in flight       → NOT available (§174). This row used to read
//                     "available — we CAN look, there is simply nothing to
//                     show YET", and the empty list did keep the RENDER
//                     honest — but `available` reaches the model as
//                     `coverage: "turso"`, which chat-tool-defs.ts defines as
//                     "past conversations WERE searched". Over a list the
//                     fetch has not filled, that is an assertion that a topic
//                     was never discussed. "Not looked yet" is closer to
//                     "cannot look" than to "looked, nothing there", so the
//                     flag waits for the load for the LIVE project to settle
//                     (`threadsMatchProject`), success or failure.
//   load FAILED     → NOT available. The load's .catch() settles
//                     `loadedProjectId` too, so `threadsMatchProject` is true
//                     and a mode-only flag makes a failed fetch
//                     indistinguishable from a project that really has no
//                     threads — the model then asserts a topic was never
//                     raised while the user is looking at the failure banner.
//                     That is precisely the "an empty result is NOT evidence"
//                     reading chat-search-tool.ts and chat-tool-defs.ts exist
//                     to prevent, defeated one layer upstream of both.
//   settled, empty  → available. "We looked and there is nothing" is true.
// ★★★ IT READS `loadFailed`, NOT `threadsError`, AND THE DIFFERENCE IS AN
// ADVERTISE-THEN-DENY CONTRADICTION. `threadsError` is ALSO raised by
// runPersist when a SAVE or DELETE fails, and on a failed WRITE the list is
// still populated and perfectly readable — while `use-chat-search-bindings.ts`
// built the ambient chat pointer from `published.threads` and, until §173,
// never consulted `available`. So the system prompt said "There are N earlier conversations in this
// project … Use search_chats to read them", the model obeyed, and
// `search_chats` answered `coverage: "unavailable"` — over threads sitting in
// memory. Erring toward "I could not look" is the safe direction only for a
// failure that actually stopped us looking. `threadsError` is unchanged and
// still drives the sidebar banner and its Retry affordance.
// ★★ The pointer DOES consult `available` now (§173), so a payload whose
// flag is false never advertises its rows to the model either way.
export function useChatThreadsPublish(deps: UseChatThreadsPublishDeps): void {
  const { tursoMode, projectId, threads, activeThreadId, threadsMatchProject, loadFailed } = deps;
  useEffect(() => {
    publishChatThreads(projectId, {
      threads: tursoMode && threadsMatchProject ? threads : [],
      activeThreadId: tursoMode && threadsMatchProject ? activeThreadId : null,
      available: tursoMode && threadsMatchProject && !loadFailed,
    });
    // ★★ Clearing on unmount is not optional: nothing else in the app ever
    // clears the slot, so the last payload would stay readable with
    // `available: true` after the panel unmounts (a project swap or any other
    // load hold). ★ Withdrawing AI consent does NOT unmount the panel (it stays
    // mounted with a review banner) and does not clear the slot; what keeps its
    // rows from the model then is that they are read only inside a chat send,
    // and every request asks `assertInteractiveConsentLive` first. Scoped to the id THIS run published, so an ordinary
    // re-publish (cleanup runs, then the body re-publishes, in one commit) and
    // a project switch both end with the live value in the slot.
    return () => clearChatThreadsFor(projectId);
  }, [projectId, threads, activeThreadId, tursoMode, threadsMatchProject, loadFailed]);
}
