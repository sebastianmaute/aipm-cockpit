"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import type { Stakeholder } from "./types";

export interface UseStakeholdersArgs {
  today: string;
  logActivity?: (summary: string) => void;
}

export function useStakeholders(args: UseStakeholdersArgs) {
  const { stakeholders, setStakeholders } = useWorkspace();

  const handleSaveStakeholder = useCallback((item: Stakeholder) => {
    const withStamp: Stakeholder = { ...item, localModifiedAt: new Date().toISOString() };
    setStakeholders((prev) => {
      const idx = prev.findIndex((s) => s.id === item.id);
      return idx < 0 ? [...prev, withStamp] : prev.map((s) => (s.id === item.id ? withStamp : s));
    });
    args.logActivity?.(`Stakeholder #${item.id} "${item.title ?? item.name}" saved`);
  }, [setStakeholders, args]);

  const handleDeleteStakeholder = useCallback((id: number) => {
    setStakeholders((prev) => prev.filter((s) => s.id !== id));
    args.logActivity?.(`Stakeholder #${id} deleted`);
  }, [setStakeholders, args]);

  return { stakeholders, handleSaveStakeholder, handleDeleteStakeholder };
}
