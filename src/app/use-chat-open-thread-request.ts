"use client";

// §799 — the chat panel's consumer of an "open this thread" request, sent by an Activity entry's link.
//
// ★★ `panel-chat` is mounted UNCONDITIONALLY (workspace-section only `hidden`s it), so there is no remount
//   to swallow a request — and none to clear one either. The parent CONSUMES it (`onConsumed`, which sets the
//   request back to null), and this hook remembers the request object it already applied, so a re-render
//   before that clear lands cannot apply it twice (StrictMode runs a mount effect twice).
// ★★★ BLOCKED MEANS DO NOT SWITCH. `selectThread` changes the active thread, and `use-chat-threads.ts` aborts
//   the running send when it does. So while an answer (or an Apply) runs, the request is consumed WITHOUT
//   switching and the hook reports a notice instead; the running send is never aborted from here.
// ★ The notice is render-time state (no setState in an effect): it is set when the refused request arrives
//   and dropped as soon as the panel is no longer blocked, so a later send cannot bring it back.
import { useEffect, useRef, useState } from "react";

export interface OpenThreadRequest {
  readonly threadId: string;
  /** Bumped per click, so a second click on the same link is a new request. */
  readonly nonce: number;
}

export interface UseChatOpenThreadRequestDeps {
  request: OpenThreadRequest | null;
  /** A send or an Apply is running. */
  blocked: boolean;
  /** The ids in the panel's thread list. A request for any other id is consumed and ignored. */
  threadIds: readonly string[];
  activeThreadId: string | null;
  selectThread: (id: string) => void;
  onConsumed?: () => void;
}

/** Applies `request` once and returns whether the "finish the current answer first" notice shows. */
export function useChatOpenThreadRequest(deps: UseChatOpenThreadRequestDeps): boolean {
  const { request, blocked, threadIds, activeThreadId, selectThread, onConsumed } = deps;
  const [seen, setSeen] = useState<OpenThreadRequest | null>(null);
  const [refused, setRefused] = useState(false);
  if (request !== null && request !== seen) {
    setSeen(request);
    setRefused(blocked && request.threadId !== activeThreadId);
  } else if (refused && !blocked) {
    setRefused(false);
  }

  const applied = useRef<OpenThreadRequest | null>(null);
  useEffect(() => {
    if (request === null || applied.current === request) return;
    applied.current = request;
    if (!blocked && threadIds.includes(request.threadId)) selectThread(request.threadId);
    onConsumed?.();
  }, [request, blocked, threadIds, selectThread, onConsumed]);

  return refused;
}
