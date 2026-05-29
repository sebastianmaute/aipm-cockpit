"use client";
import React, { createContext, useContext, useState } from "react";
import { type PopoutTab, readPopoutTabFromUrl } from "./broadcast-sync";
import { type AppView } from "./nav-config";

export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity" | "resource-report" | "raid-report" | "address-book" | "budget";

interface WorkspaceTabContextValue {
  activeTab: AppView;
  setActiveTab: React.Dispatch<React.SetStateAction<AppView>>;
  isPopout: boolean;
}

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null);

export function WorkspaceTabProvider({ children }: { children: React.ReactNode }) {
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  const [activeTab, setActiveTab] = useState<AppView>(popoutTab ?? "chat");
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
