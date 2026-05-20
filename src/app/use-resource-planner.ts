"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { DEFAULT_WEEK_HOURS, type Absence, type RaidItem, type Shift, type Task } from "./types";
import type { ActivityKind } from "./activity-log";
import { useWorkspace } from "./workspace-context";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}

function emptyShiftDraft(id: number): Shift {
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    hoursPerWeekday: DEFAULT_WEEK_HOURS,
    note: undefined,
  };
}

export interface UseResourcePlannerArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useResourcePlanner(args: UseResourcePlannerArgs) {
  const {
    tasks,
    setTasks,
    raid,
    setRaid,
    absences,
    setAbsences,
    shifts,
    setShifts,
  } = useWorkspace();

  const langRef = useRef(args.lang);
  const logActivityRef = useRef(args.logActivity);
  const showToastRef = useRef(args.showToast);
  const tasksRef = useRef(tasks);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const [editingAbsence, setEditingAbsence] = useState<{
    absence: Absence;
    isNew: boolean;
  } | null>(null);

  const [editingShift, setEditingShift] = useState<{
    shift: Shift;
    isNew: boolean;
  } | null>(null);

  const handleSaveRaidItem = useCallback((_item: RaidItem) => {}, []);
  const handleDeleteRaidItem = useCallback((_id: number) => {}, []);
  const handleOpenAddAbsence = useCallback((_seed?: Partial<Absence>) => {}, []);
  const handleEditAbsence = useCallback((_absence: Absence) => {}, []);
  const handleCloseAbsenceModal = useCallback(() => {}, []);
  const handleSaveAbsence = useCallback((_next: Absence) => {}, []);
  const handleDeleteAbsence = useCallback((_id: number) => {}, []);
  const handleOpenShiftEditor = useCallback(
    (_existing: Shift | null, _seed: { display: string; email: string }) => {},
    [],
  );
  const handleCloseShiftModal = useCallback(() => {}, []);
  const handleSaveShift = useCallback((_next: Shift) => {}, []);
  const handleDeleteShift = useCallback((_id: number) => {}, []);
  const handleCreateMitigationTaskFromRaid = useCallback(
    (_raidItemId: number): number | null => null,
    [],
  );

  return {
    editingAbsence,
    editingShift,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
  };
}
