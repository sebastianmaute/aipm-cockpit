// src/app/use-workspace-collapsed.ts
"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

const WORKSPACE_COLLAPSED_KEY = "lop-app:workspace-collapsed";

export function useWorkspaceCollapsed(): {
  workspaceCollapsed: boolean;
  setWorkspaceCollapsed: Dispatch<SetStateAction<boolean>>;
} {
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(WORKSPACE_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Persist on every change.
  useEffect(() => {
    try {
      if (workspaceCollapsed) {
        window.localStorage.setItem(WORKSPACE_COLLAPSED_KEY, "1");
      } else {
        window.localStorage.removeItem(WORKSPACE_COLLAPSED_KEY);
      }
    } catch { /* non-fatal */ }
  }, [workspaceCollapsed]);

  return { workspaceCollapsed, setWorkspaceCollapsed };
}
