"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import type { ActivityKind } from "./activity-log";
import type { Stakeholder } from "./types";

export interface UseStakeholdersArgs {
  today: string;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export function useStakeholders(args: UseStakeholdersArgs) {
  const { stakeholders, setStakeholders } = useWorkspace();

  const handleSaveStakeholder = useCallback((item: Stakeholder) => {
    const withStamp: Stakeholder = { ...item, localModifiedAt: new Date().toISOString() };
    const isNew = stakeholders.findIndex((s) => s.id === item.id) < 0;
    setStakeholders(isNew ? [...stakeholders, withStamp] : stakeholders.map((s) => (s.id === item.id ? withStamp : s)));
    args.logActivity?.(isNew ? "stakeholder.created" : "stakeholder.updated", item.id, item.name);
  }, [stakeholders, setStakeholders, args]);

  const handleDeleteStakeholder = useCallback((id: number, name: string) => {
    setStakeholders((prev) => prev.filter((s) => s.id !== id));
    args.logActivity?.("stakeholder.deleted", id, name);
  }, [setStakeholders, args]);

  return { stakeholders, handleSaveStakeholder, handleDeleteStakeholder };
}
