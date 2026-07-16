"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { type Health } from "./health";
import type { DocumentLink } from "./document-link";
import { type NoteLogEntry, type Priority, type TaskDependency, type TaskStatus } from "./types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyForm() {
  return {
    taskName: "",
    assignee: "",
    assigneeEmail: "",
    startDate: "",
    dueDate: "",
    lastUpdateDate: todayISO(),
    priority: "Medium" as Priority,
    status: "To Do" as TaskStatus,
    blockers: "",
    notes: "",
    group: "",
    labels: [] as string[],
    dependencies: [] as TaskDependency[],
    // Optional Jira-style effort, canonical MINUTES. undefined = unset.
    originalEstimateMinutes: undefined as number | undefined,
    timeSpentMinutes: undefined as number | undefined,
    // FK -> Resource.id; null/undefined = unlinked. Set by the assignee picker.
    resourceId: undefined as number | null | undefined,
    pushToJira: false,
    // Empty string = "Auto" (no override). Mapped to undefined on save.
    healthOverride: "" as "" | Health,
    documentLinks: [] as DocumentLink[],
    // Running note log — appended in-form, persisted on save. Separate from the
    // freeform `notes` field. Timestamps are stamped in the add handler.
    noteLog: [] as NoteLogEntry[],
  };
}

export type TaskFormDraft = ReturnType<typeof emptyForm>;

export type BulkEditField =
  | "priority"
  | "status"
  | "dueDate"
  | "lastUpdateDate"
  | "assignee"
  | "assigneeEmail"
  | "blockers"
  | "notes"
  | "group"
  | "labels";

export function emptyBulkEdit() {
  return {
    enabled: {
      priority: false,
      status: false,
      dueDate: false,
      lastUpdateDate: false,
      assignee: false,
      assigneeEmail: false,
      blockers: false,
      notes: false,
      group: false,
      labels: false,
    } as Record<BulkEditField, boolean>,
    priority: "Medium" as Priority,
    status: "To Do" as TaskStatus,
    dueDate: "",
    lastUpdateDate: todayISO(),
    assignee: "",
    assigneeEmail: "",
    blockers: "",
    notes: "",
    group: "",
    labels: [] as string[],
  };
}

export type BulkEditDraft = ReturnType<typeof emptyBulkEdit>;

interface TaskFormValue {
  form: TaskFormDraft;
  setForm: Dispatch<SetStateAction<TaskFormDraft>>;
  editingId: number | null;
  setEditingId: Dispatch<SetStateAction<number | null>>;
  taskModalOpen: boolean;
  setTaskModalOpen: Dispatch<SetStateAction<boolean>>;

  bulkEdit: BulkEditDraft;
  setBulkEdit: Dispatch<SetStateAction<BulkEditDraft>>;
  bulkEditOpen: boolean;
  setBulkEditOpen: Dispatch<SetStateAction<boolean>>;
}

const TaskFormContext = createContext<TaskFormValue | undefined>(undefined);

export function TaskFormProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<TaskFormDraft>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [bulkEdit, setBulkEdit] = useState<BulkEditDraft>(emptyBulkEdit);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // Memoized container: useState setters are identity-stable and excluded
  // from deps; the value identity only changes when a state slice changes.
  const value: TaskFormValue = useMemo(
    () => ({
      form,
      setForm,
      editingId,
      setEditingId,
      taskModalOpen,
      setTaskModalOpen,
      bulkEdit,
      setBulkEdit,
      bulkEditOpen,
      setBulkEditOpen,
    }),
    [form, editingId, taskModalOpen, bulkEdit, bulkEditOpen],
  );

  return (
    <TaskFormContext.Provider value={value}>
      {children}
    </TaskFormContext.Provider>
  );
}

export function useTaskForm(): TaskFormValue {
  const ctx = useContext(TaskFormContext);
  if (!ctx) throw new Error("useTaskForm must be used within TaskFormProvider");
  return ctx;
}
