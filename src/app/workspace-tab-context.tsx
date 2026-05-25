"use client";
import React, { createContext, useContext, useState } from "react";
import { type PopoutTab, readPopoutTabFromUrl } from "./broadcast-sync";

export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity" | "resource-report" | "address-book";

interface WorkspaceTabContextValue {
  activeTab: TopTab;
  setActiveTab: React.Dispatch<React.SetStateAction<TopTab>>;
  isPopout: boolean;
}

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null);

export function WorkspaceTabProvider({ children }: { children: React.ReactNode }) {
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  const [activeTab, setActiveTab] = useState<TopTab>(popoutTab ?? "chat");
  return (
    <WorkspaceTabContext.Provider value={{ activeTab, setActiveTab, isPopout }}>
      {children}
    </WorkspaceTabContext.Provider>
  );
}

export function useWorkspaceTab(): WorkspaceTabContextValue {
  const ctx = useContext(WorkspaceTabContext);
  if (!ctx) throw new Error("useWorkspaceTab must be used inside WorkspaceTabProvider");
  return ctx;
}
