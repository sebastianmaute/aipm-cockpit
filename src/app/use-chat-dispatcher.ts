"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { type Filters, type ToolDispatcher } from "./chat-tools";
import { useFilters } from "./filters-context";
import { useTaskForm } from "./task-form-context";
import { useWorkspace } from "./workspace-context";
import { type Settings } from "./settings-menu";

export interface ChatDispatcherArgs {
  settings: Settings;
  today: string;
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
}

export function useChatDispatcher(args: ChatDispatcherArgs): ToolDispatcher {
  const { tasks, setTasks } = useWorkspace();
  const { editingId, setEditingId, setForm } = useTaskForm();
  const {
    setSearch,
    setPriorityFilter,
    setAssigneeFilter,
    setGroupFilter,
    setLabelFilter,
  } = useFilters();

  // Refs absorb every reactive value the dispatcher reads. Without these the
  // dispatcher would rebuild on every task/settings/today/editingId change,
  // which is the whole reason ChatPanel currently re-renders on form input.
  // Refs seeded synchronously on first render; refreshed by the effects below.
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(args.settings);
  const todayRef = useRef(args.today);
  const editingIdRef = useRef(editingId);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    settingsRef.current = args.settings;
  }, [args.settings]);
  useEffect(() => {
    todayRef.current = args.today;
  }, [args.today]);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  // Helpers live inside the hook — they're not consumed anywhere else.
  // Stubbed for now; filled in by later tasks.
  // (Hoisted as useCallback for Tasks 3/5 ergonomics; other stubs stay inline.)
  const sendInquiry = useCallback(
    (_id: number): { sent: boolean; reason?: string } => {
      throw new Error("not implemented yet");
    },
    [],
  );
  const applyFilters = useCallback((_f: Filters): void => {
    throw new Error("not implemented yet");
  }, []);

  const dispatcher = useMemo<ToolDispatcher>(
    () => ({
      listTasks: () => tasksRef.current,
      getTask: (id) => tasksRef.current.find((row) => row.id === id) ?? null,
      createTask: () => {
        throw new Error("not implemented yet");
      },
      updateTask: () => {
        throw new Error("not implemented yet");
      },
      deleteTask: () => {
        throw new Error("not implemented yet");
      },
      deleteAllTasks: () => {
        throw new Error("not implemented yet");
      },
      sendInquiry,
      setFilters: applyFilters,
      setLanguage: (_l) => {
        throw new Error("not implemented yet");
      },
      getSnapshot: () => {
        throw new Error("not implemented yet");
      },
    }),
    // Empty deps: every reactive value is read via a ref. Identity is stable.
    // Note: when Task 6 lands, audit whether any captured value still needs
    // ref-routing; the eslint-disable stays as long as the empty-deps approach
    // is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Suppress unused-variable warnings for state we don't yet read; later
  // tasks consume them. Removing this when those methods land is part of
  // Task 6.
  void setTasks;
  void setEditingId;
  void setForm;
  void setSearch;
  void setPriorityFilter;
  void setAssigneeFilter;
  void setGroupFilter;
  void setLabelFilter;

  return dispatcher;
}
