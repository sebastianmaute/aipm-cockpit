"use client";
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { type PopoutTab, readPopoutTabFromUrl } from "./broadcast-sync";
import { type AppView, buildHash, slugToView } from "./nav-config";
import type { ApiMessage, DisplayItem } from "./chat-api";

/** A chat conversation held in memory so it survives view-navigation remounts
 *  (the modern shell mounts one view at a time). `history` is the Anthropic wire
 *  transcript; `display` is its rendered projection — always kept together. */
export interface ChatConversation {
  history: ApiMessage[];
  display: DisplayItem[];
}

interface WorkspaceTabContextValue {
  activeTab: AppView;
  setActiveTab: React.Dispatch<React.SetStateAction<AppView>>;
  isPopout: boolean;
  pendingOpen: { view: AppView; id: number } | null;
  requestOpen: (view: AppView, id: number) => void;
  clearPendingOpen: () => void;
  pendingChatSeed: { prompt: string; autoSend: boolean } | null;
  requestChat: (prompt: string, autoSend: boolean) => void;
  clearChatSeed: () => void;
  // Deep-link a Help concept: switch to the Help view and scroll to the
  // concept section (no hash write — mirrors requestChat). Used by the
  // per-view callouts' "Learn more" link.
  pendingHelpConcept: string | null;
  requestHelpConcept: (conceptId: string) => void;
  clearHelpConcept: () => void;
  // In-memory per-project chat store: read at (re)mount + on project switch,
  // written on change. A ref (not state) so the whole shell doesn't re-render on
  // every chat message; ChatPanel owns the reactive copy.
  getChatConversation: (projectId: string) => ChatConversation | undefined;
  saveChatConversation: (projectId: string, conv: ChatConversation) => void;
}

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null);

/** Cap on distinct projects' conversations held in the in-memory chat store. */
const CHAT_STORE_MAX_PROJECTS = 20;

export function WorkspaceTabProvider({ children }: { children: React.ReactNode }) {
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  // `popoutTab` may still carry legacy popout slugs (`resource-report`,
  // `address-book`) that map onto the resources/directory views; route them
  // through slugToView so the initial AppView is always a valid view.
  const [activeTab, setActiveTab] = useState<AppView>(popoutTab ? slugToView(popoutTab) : "dashboard");
  const [pendingOpen, setPendingOpen] = useState<{ view: AppView; id: number } | null>(null);
  const requestOpen = useCallback((view: AppView, id: number) => {
    setActiveTab(view);
    setPendingOpen({ view, id });
    if (!isPopout && typeof window !== "undefined") {
      // replaceState, NOT `location.hash = …`: assigning location.hash fires a
      // hashchange, which useHashView handles by re-invoking requestOpen — that
      // re-entrant setActiveTab navigates AWAY from a just-armed full-page task
      // editor (cancelling it, then leaving taskModalOpen stuck true so the row
      // click no-ops and the editor only surfaces on the NEXT nav). replaceState
      // updates the URL without the self-triggered hashchange (same reason
      // useHashView's view->hash write uses replaceState). Genuine back/forward
      // still fires popstate, which useHashView handles.
      window.history.replaceState(null, "", buildHash(view, id));
    }
  }, [isPopout]);
  const clearPendingOpen = useCallback(() => setPendingOpen(null), []);
  const [pendingChatSeed, setPendingChatSeed] = useState<{ prompt: string; autoSend: boolean } | null>(null);
  const requestChat = useCallback((prompt: string, autoSend: boolean) => {
    setActiveTab("chat");
    setPendingChatSeed({ prompt, autoSend });
    // No hash write: chat carries no item id (unlike requestOpen).
  }, []);
  const clearChatSeed = useCallback(() => setPendingChatSeed(null), []);
  const [pendingHelpConcept, setPendingHelpConcept] = useState<string | null>(null);
  const requestHelpConcept = useCallback((conceptId: string) => {
    setActiveTab("help");
    setPendingHelpConcept(conceptId);
    // No hash write: the Help view scrolls to the concept section internally.
  }, []);
  const clearHelpConcept = useCallback(() => setPendingHelpConcept(null), []);
  const chatConvRef = useRef<Map<string, ChatConversation>>(new Map());
  const getChatConversation = useCallback(
    (projectId: string): ChatConversation | undefined => chatConvRef.current.get(projectId),
    [],
  );
  const saveChatConversation = useCallback((projectId: string, conv: ChatConversation): void => {
    const m = chatConvRef.current;
    // Bound growth across a long session of many projects (transcripts can carry
    // base64 attachments). Evict the oldest-inserted when a NEW project overflows
    // the cap — mirrors landing-state's per-project cap.
    if (!m.has(projectId) && m.size >= CHAT_STORE_MAX_PROJECTS) {
      const oldest = m.keys().next().value;
      if (oldest !== undefined) m.delete(oldest);
    }
    m.set(projectId, conv);
  }, []);
  return (
    <WorkspaceTabContext.Provider value={{ activeTab, setActiveTab, isPopout, pendingOpen, requestOpen, clearPendingOpen, pendingChatSeed, requestChat, clearChatSeed, pendingHelpConcept, requestHelpConcept, clearHelpConcept, getChatConversation, saveChatConversation }}>
      {children}
    </WorkspaceTabContext.Provider>
  );
}

export function useWorkspaceTab(): WorkspaceTabContextValue {
  const ctx = useContext(WorkspaceTabContext);
  if (!ctx) throw new Error("useWorkspaceTab must be used inside WorkspaceTabProvider");
  return ctx;
}
