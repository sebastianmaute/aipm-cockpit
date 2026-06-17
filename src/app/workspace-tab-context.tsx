"use client";
import React, { createContext, useCallback, useContext, useState } from "react";
import { type PopoutTab, readPopoutTabFromUrl } from "./broadcast-sync";
import { type AppView, buildHash, slugToView } from "./nav-config";

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
}

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null);

export function WorkspaceTabProvider({ children }: { children: React.ReactNode }) {
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  // `popoutTab` may still carry legacy popout slugs (`resource-report`,
  // `address-book`) that map onto the resources/directory views; route them
  // through slugToView so the initial AppView is always a valid view.
  const [activeTab, setActiveTab] = useState<AppView>(popoutTab ? slugToView(popoutTab) : "chat");
  const [pendingOpen, setPendingOpen] = useState<{ view: AppView; id: number } | null>(null);
  const requestOpen = useCallback((view: AppView, id: number) => {
    setActiveTab(view);
    setPendingOpen({ view, id });
    if (!isPopout && typeof window !== "undefined") {
      window.location.hash = buildHash(view, id);
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
  return (
    <WorkspaceTabContext.Provider value={{ activeTab, setActiveTab, isPopout, pendingOpen, requestOpen, clearPendingOpen, pendingChatSeed, requestChat, clearChatSeed }}>
      {children}
    </WorkspaceTabContext.Provider>
  );
}

export function useWorkspaceTab(): WorkspaceTabContextValue {
  const ctx = useContext(WorkspaceTabContext);
  if (!ctx) throw new Error("useWorkspaceTab must be used inside WorkspaceTabProvider");
  return ctx;
}
