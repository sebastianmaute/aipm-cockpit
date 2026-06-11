"use client";
import { useCallback, useMemo, useState } from "react";
import type React from "react";
import { emptyForm, type TaskFormDraft } from "./task-form-context";
import { upsertContact, type ContactsMap } from "./contacts";
import { type ActivityKind } from "./activity-log";
import { useAdjustmentTracker } from "./field-feedback";
import { t, type Lang } from "./i18n";
import { nextId } from "./resource-foundation";
import { type Settings } from "./settings-types";
import { type Task } from "./types";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
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
import { describeTextCap } from "./sanitize-report";
import { hasTaskErrors, validateTaskForm, type TaskFieldErrors } from "./task-validation";

export interface UseTaskSubmitArgs {
  form: TaskFormDraft;
  setForm: React.Dispatch<React.SetStateAction<TaskFormDraft>>;
  editingId: number | null;
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tasks: readonly Task[];
  today: string;
  lang: Lang;
  settings: Settings;
  tasksRef: React.RefObject<readonly Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<readonly Task[]>>;
  setContacts: React.Dispatch<React.SetStateAction<ContactsMap>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  onPushToJiraRef: React.MutableRefObject<(taskId: number) => Promise<boolean>>;
}

export function useTaskSubmit(args: UseTaskSubmitArgs): {
  fieldErrors: TaskFieldErrors;
  submitted: boolean;
  saveDisabled: boolean;
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
    showToast,
    onPushToJiraRef,
  } = args;

  // `submitted` flips true on the first submit attempt so per-field errors can
  // reveal even for fields the user never blurred. Live `fieldErrors` also gate
  // the Save button (saveDisabled) — see task-validation.ts for the rules.
  const [submitted, setSubmitted] = useState(false);
  const fieldErrors = useMemo(() => validateTaskForm(form, today), [form, today]);
  const saveDisabled = hasTaskErrors(fieldErrors);
  const adj = useAdjustmentTracker();

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitted(true);
      adj.reset();

      // Per-field validation gates the submit (same rules surfaced inline).
      // Normally the Save button is already disabled when invalid; this is the
      // belt-and-suspenders guard for any path that still fires onSubmit.
      if (hasTaskErrors(validateTaskForm(form, today))) return;

      // Safety net: fields are normally already trimmed on blur, but we re-cap here at submit time in case blur was skipped.
      const taskName = sanitizeTaskName(adj.track(describeTextCap(form.taskName, TASK_NAME_MAX)));
      const assignee = sanitizeAssignee(adj.track(describeTextCap(form.assignee, ASSIGNEE_MAX)));
      const dueDate = sanitizeIsoDate(form.dueDate);

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

      const email = sanitizeEmail(adj.track(describeTextCap(form.assigneeEmail, EMAIL_MAX)));

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
        blockers: sanitizeBlockers(adj.track(describeTextCap(form.blockers, TEXTAREA_MAX))),
        notes: sanitizeNotes(adj.track(describeTextCap(form.notes, TEXTAREA_MAX))),
        group: sanitizeGroup(adj.track(describeTextCap(form.group, GROUP_MAX))),
        labels: sanitizeLabels(form.labels),
        dependencies: cleanDependencies,
        healthOverride: form.healthOverride || undefined,
        originalEstimateMinutes: form.originalEstimateMinutes,
        timeSpentMinutes: form.timeSpentMinutes,
        documentLinks: form.documentLinks,
      };

      if (adj.count() > 0) {
        showToast("info", t(lang, "fieldsAdjusted", adj.count()));
      }

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
        const newTask: Task = { id: nextId(tasks), ...payload, inquiriesSent: 0 };
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
      // Reset only on this clean-close path. The jira-assignee early-return
      // above intentionally leaves `submitted` true so its field errors persist
      // while the form stays open.
      setSubmitted(false);
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
      showToast,
      adj,
      onPushToJiraRef,
    ],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setSubmitted(false);
    setForm(emptyForm());
    setTaskModalOpen(false);
  }, [setEditingId, setForm, setTaskModalOpen]);

  const openEditModal = useCallback(
    (task: Task) => {
      setEditingId(task.id);
      setSubmitted(false);
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
        documentLinks: task.documentLinks ?? [],
      });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setEditingId, setTaskModalOpen, setForm],
  );

  return { fieldErrors, submitted, saveDisabled, handleSubmit, handleCancelEdit, openEditModal };
}
