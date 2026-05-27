"use client";
import { useCallback, useState } from "react";
import type React from "react";
import { emptyForm, type TaskFormDraft } from "./task-form-context";
import { upsertContact, type ContactsMap } from "./contacts";
import { type ActivityKind } from "./activity-log";
import { t, type Lang } from "./i18n";
import { type Settings } from "./settings-menu";
import { type Task } from "./types";
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeDependencies,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNotes,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";

export interface UseTaskSubmitArgs {
  form: TaskFormDraft;
  setForm: React.Dispatch<React.SetStateAction<TaskFormDraft>>;
  editingId: number | null;
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tasks: Task[];
  today: string;
  lang: Lang;
  settings: Settings;
  tasksRef: React.MutableRefObject<Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setContacts: React.Dispatch<React.SetStateAction<ContactsMap>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  onPushToJiraRef: React.MutableRefObject<(taskId: number) => Promise<boolean>>;
}

export function useTaskSubmit(args: UseTaskSubmitArgs): {
  error: string | null;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  handleCancelEdit: () => void;
  openEditModal: (task: Task) => void;
} {
  const {
    form,
    setForm,
    editingId,
    setEditingId,
    setTaskModalOpen,
    tasks,
    today,
    lang,
    settings,
    tasksRef,
    setTasks,
    setContacts,
    logActivity,
    onPushToJiraRef,
  } = args;

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);

      const taskName = sanitizeTaskName(form.taskName);
      const assignee = sanitizeAssignee(form.assignee);
      const dueDate = sanitizeIsoDate(form.dueDate);

      if (!taskName || !assignee || !dueDate) {
        setError(t(lang, "errorRequired"));
        return;
      }
      if (dueDate < today) {
        setError(t(lang, "errorPastDate"));
        return;
      }

      if (editingId !== null) {
        const existing = tasks.find((row) => row.id === editingId);
        if (
          existing?.jiraKey &&
          sanitizeAssignee(existing.assignee) !== assignee
        ) {
          window.alert(t(lang, "jiraAssigneeForbidden", existing.jiraKey));
          return;
        }
      }

      const email = sanitizeEmail(form.assigneeEmail);
      if (email && !isValidEmail(email)) {
        setError(t(lang, "errorInvalidEmail"));
        return;
      }

      const knownIds = new Set(tasks.map((row) => row.id));
      const cleanDependencies = sanitizeDependencies(
        form.dependencies,
        knownIds,
        editingId,
      );

      const rawStart = sanitizeIsoDate(form.startDate);
      const startDate =
        rawStart && rawStart > dueDate ? dueDate : rawStart || undefined;

      const payload = {
        taskName,
        assignee,
        assigneeEmail: email,
        startDate,
        dueDate,
        lastUpdateDate: sanitizeIsoDate(form.lastUpdateDate) || today,
        priority: sanitizePriority(form.priority),
        blockers: sanitizeBlockers(form.blockers),
        notes: sanitizeNotes(form.notes),
        group: sanitizeGroup(form.group),
        labels: sanitizeLabels(form.labels),
        dependencies: cleanDependencies,
        healthOverride: form.healthOverride || undefined,
        originalEstimateMinutes: form.originalEstimateMinutes,
        timeSpentMinutes: form.timeSpentMinutes,
      };

      setContacts((prev) => upsertContact(prev, assignee, email));

      if (editingId !== null) {
        const stamp = new Date().toISOString();
        const updatedId = editingId;
        setTasks((prev) =>
          prev.map((row) =>
            row.id === editingId
              ? { ...row, ...payload, localModifiedAt: stamp }
              : row,
          ),
        );
        setEditingId(null);
        logActivity("task.updated", updatedId, taskName);
      } else {
        const nextId =
          tasks.length > 0 ? Math.max(...tasks.map((row) => row.id)) + 1 : 1;
        const newTask: Task = { id: nextId, ...payload, inquiriesSent: 0 };
        const newId = newTask.id;
        const shouldPush =
          form.pushToJira &&
          settings.jira.enabled &&
          !!settings.jira.projectKey;
        const nextList = [...tasksRef.current, newTask];
        tasksRef.current = nextList;
        setTasks(nextList);
        logActivity("task.created", newId, taskName);
        if (shouldPush) {
          void onPushToJiraRef.current(newId);
        }
      }
      setForm(emptyForm());
      setTaskModalOpen(false);
    },
    [
      form,
      editingId,
      tasks,
      today,
      lang,
      settings,
      tasksRef,
      setTasks,
      setEditingId,
      setForm,
      setTaskModalOpen,
      setContacts,
      logActivity,
      onPushToJiraRef,
    ],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setError(null);
    setForm(emptyForm());
    setTaskModalOpen(false);
  }, [setEditingId, setForm, setTaskModalOpen]);

  const openEditModal = useCallback(
    (task: Task) => {
      setEditingId(task.id);
      setError(null);
      setTaskModalOpen(true);
      setForm({
        taskName: task.taskName,
        assignee: task.assignee,
        assigneeEmail: task.assigneeEmail ?? "",
        startDate: task.startDate ?? "",
        dueDate: task.dueDate,
        lastUpdateDate: task.lastUpdateDate,
        priority: task.priority,
        blockers: task.blockers,
        notes: task.notes,
        group: task.group ?? "",
        labels: task.labels ?? [],
        dependencies: task.dependencies ?? [],
        originalEstimateMinutes: task.originalEstimateMinutes,
        timeSpentMinutes: task.timeSpentMinutes,
        pushToJira: false,
        healthOverride: task.healthOverride ?? "",
      });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setEditingId, setTaskModalOpen, setForm],
  );

  return { error, handleSubmit, handleCancelEdit, openEditModal };
}
