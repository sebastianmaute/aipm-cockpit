"use client";
import React, { createContext, useContext, useState } from "react";
import { type PopoutTab, readPopoutTabFromUrl } from "./broadcast-sync";
import { type AppView, slugToView } from "./nav-config";

export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "directory" | "workload" | "calendar" | "planning" | "manage-roles" | "activity" | "raid-report" | "changes" | "change-report" | "budget" | "budget-report" | "trends";

interface WorkspaceTabContextValue {
  activeTab: AppView;
  setActiveTab: React.Dispatch<React.SetStateAction<AppView>>;
  isPopout: boolean;
}

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null);

export function WorkspaceTabProvider({ children }: { children: React.ReactNode }) {
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  // `popoutTab` may still carry legacy popout slugs (`resource-report`,
  // `address-book`) that map onto the resources/directory views; route them
  // through slugToView so the initial AppView is always a valid view.
  const [activeTab, setActiveTab] = useState<AppView>(popoutTab ? slugToView(popoutTab) : "chat");
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
