"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { type Health } from "./health";
import type { DocumentLink } from "./document-link";
import { type Priority, type TaskDependency } from "./types";

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
    blockers: "",
    notes: "",
    group: "",
    labels: [] as string[],
    dependencies: [] as TaskDependency[],
    // Optional Jira-style effort, canonical MINUTES. undefined = unset.
    originalEstimateMinutes: undefined as number | undefined,
    timeSpentMinutes: undefined as number | undefined,
    pushToJira: false,
    // Empty string = "Auto" (no override). Mapped to undefined on save.
    healthOverride: "" as "" | Health,
    documentLinks: [] as DocumentLink[],
  };
}

export type TaskFormDraft = ReturnType<typeof emptyForm>;

export type BulkEditField =
  | "priority"
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

  const value: TaskFormValue = {
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
  };

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
