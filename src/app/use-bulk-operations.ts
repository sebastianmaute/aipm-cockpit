"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lang } from "./i18n";
import type { Settings } from "./settings-menu";
import type { Task } from "./types";
import type { ActivityKind } from "./activity-log";
import type { Command } from "./voice";
import { useWorkspace } from "./workspace-context";
import { useTaskForm, emptyBulkEdit } from "./task-form-context";

export interface BulkRowHandlers {
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onSendInquiry: (task: Task) => void;
}

export interface UseBulkOperationsArgs {
  lang: Lang;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  handlers: BulkRowHandlers;
  onCancelEdit: () => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useBulkOperations(args: UseBulkOperationsArgs) {
  const { tasks, setTasks, filteredSortedTasks } = useWorkspace();
  const {
    bulkEdit,
    setBulkEdit,
    setBulkEditOpen,
    setForm,
    setEditingId,
    setTaskModalOpen,
  } = useTaskForm();

  const langRef = useRef(args.lang);
  const showToastRef = useRef(args.showToast);
  const logActivityRef = useRef(args.logActivity);
  const handlersRef = useRef(args.handlers);
  const onCancelEditRef = useRef(args.onCancelEdit);
  const setSettingsRef = useRef(args.setSettings);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { handlersRef.current = args.handlers; }, [args.handlers]);
  useEffect(() => { onCancelEditRef.current = args.onCancelEdit; }, [args.onCancelEdit]);
  useEffect(() => { setSettingsRef.current = args.setSettings; }, [args.setSettings]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const visibleIds = useMemo(
    () => filteredSortedTasks.map((r) => r.id),
    [filteredSortedTasks],
  );

  const allVisibleSelected = useMemo(
    () =>
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)),
    [visibleIds, selectedIds],
  );

  const selectedJiraCount = useMemo(
    () =>
      tasks.reduce(
        (n, r) => (selectedIds.has(r.id) && r.jiraKey ? n + 1 : n),
        0,
      ),
    [tasks, selectedIds],
  );

  // Stub implementations — filled in Task 8
  const onToggleSelect = useCallback((_id: number) => {}, []);
  const toggleSelectAllVisible = useCallback(() => {}, []);
  const clearSelection = useCallback(() => {}, []);
  const cancelBulkEdit = useCallback(() => {}, []);
  const applyBulkEdit = useCallback(() => {}, []);
  const handleBulkSendInquiry = useCallback(() => {}, []);
  const handleClearAll = useCallback(() => {}, []);
  const handleCommand = useCallback(
    (_cmd: Command, _originalText: string) => {},
    [],
  );

  return {
    selectedIds,
    allVisibleSelected,
    selectedJiraCount,
    onToggleSelect,
    toggleSelectAllVisible,
    clearSelection,
    cancelBulkEdit,
    applyBulkEdit,
    handleBulkSendInquiry,
    handleClearAll,
    handleCommand,
  };
}
