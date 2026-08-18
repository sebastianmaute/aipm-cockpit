"use client";

// Chat-search bindings for the AI dispatcher: the `getSnapshot().chatPointer`
// field, and the two `ToolDispatcher` members that back `search_chats`.
//
// ★★★ EXTRACTED FOR LIVENESS, not merely for lines. `useChatDispatcher` builds
//   its dispatcher inside a `useMemo` whose deps are `[args.isReadOnly,
//   documentTools]`, so anything read straight off `args` in that closure is
//   FROZEN at the render which last rebuilt it. The chat project id is exactly
//   such a value: a project switch changes it without changing either dep, so a
//   captured copy would go on asking the registry for the PREVIOUS project.
//   `readChatThreads` answers that key mismatch with its empty value, so the
//   read fails CLOSED — no cross-project leak — but `search_chats` would then
//   report "cannot look" for the rest of the session and the ambient pointer
//   would silently vanish. Ref-routing is the same answer that file gives every
//   other reactive value it reads — which is why the dispatcher's empty-deps
//   `useMemo` needs no entry for the object this hook returns, and why its
//   "every reactive value is read via a ref" note stays true. It lives HERE
//   because that file has two lines of headroom against the 800-line ratchet
//   and a ref plus its effect is four.
//
// ★★ The id wanted is the CHAT PANEL's registry key, and `settingsProjectId` is
//   that value by construction rather than by luck: `task-manager.tsx` derives
//   both from `portfolioCurrentId ?? "default"` — `landingProjectId` for the
//   dispatcher, the `currentProjectId` prop for `workspace-section`, which hands
//   `ChatPanel` `currentProjectId ?? "default"`. Should the two ever diverge,
//   `readChatThreads` returns EMPTY rather than another project's threads:
//   wrong, but wrong in the safe direction.
import { useEffect, useMemo, useRef } from "react";
import { summarizeChatThreads, type ChatPointer } from "./chat-search";
import { readChatThreads, type PublishedThreads } from "./chat-threads-registry";
import { chatSearchEnabled, type Settings } from "./settings-types";
import type { ProjectClock } from "./timezone";

export interface ChatSearchBindings {
  /** The bounded `getSnapshot().chatPointer` field — `undefined` when the
   *  toggle is off, or when there is no other thread to point at. */
  chatPointer: () => ChatPointer | undefined;
  /** The two `ToolDispatcher` members, shaped to spread straight into it. */
  tools: {
    getChatThreads: () => PublishedThreads;
    isChatSearchEnabled: () => boolean;
  };
}

export function useChatSearchBindings(
  projectId: string,
  settings: Settings,
  clock: ProjectClock,
): ChatSearchBindings {
  // Hoisted locals: react-hooks/exhaustive-deps rejects an `obj.member` dep.
  const chatSearch = settings.ai.chatSearch;
  const tz = clock.tz;
  const liveRef = useRef({ projectId, chatSearch, tz });
  useEffect(() => {
    liveRef.current = { projectId, chatSearch, tz };
  }, [projectId, chatSearch, tz]);
  // Stable identity on purpose: every reactive value is read through the ref at
  // CALL time, so the dispatcher may capture this object once and keep it.
  return useMemo(
    () => ({
      chatPointer: () => {
        const { projectId: pid, chatSearch: cs, tz: zone } = liveRef.current;
        // ★ The toggle gates the POINTER too, not just the tool: a user who
        //   switched chat search off should not have past conversation titles
        //   riding the volatile prompt suffix either.
        if (!chatSearchEnabled(cs)) return undefined;
        const published = readChatThreads(pid);
        // ★ `?? undefined` — the engine says "nothing to point at" with null,
        //   and the snapshot field is optional; a null would render as one.
        return (
          summarizeChatThreads(published.threads, published.activeThreadId, zone) ?? undefined
        );
      },
      tools: {
        getChatThreads: () => readChatThreads(liveRef.current.projectId),
        // ★ LIVE from the ref, never captured — a value read once at
        //   construction would keep serving for the whole session, which is the
        //   exact mid-conversation case enforcement exists for (§162).
        isChatSearchEnabled: () => chatSearchEnabled(liveRef.current.chatSearch),
      },
    }),
    [],
  );
}
