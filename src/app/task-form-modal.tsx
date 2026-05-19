"use client";

import { type RefObject } from "react";
import type { listContacts } from "./contacts";
import { type Lang } from "./i18n";
import { useTaskForm } from "./task-form-context";
import { type Absence, type Task } from "./types";

export interface TaskFormModalProps {
  lang: Lang;
  today: string;
  nextId: number;
  contactsList: ReturnType<typeof listContacts>;
  absences: Absence[];
  tasksForDeps: Task[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  modalRef: RefObject<HTMLDivElement>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onRemoveContact: (name: string) => void;
  onShowToast: (kind: "info" | "error", text: string) => void;
}

export function TaskFormModal(_props: TaskFormModalProps) {
  const { taskModalOpen } = useTaskForm();
  if (!taskModalOpen) return null;
  // Real JSX arrives in Task 2.
  return null;
}
