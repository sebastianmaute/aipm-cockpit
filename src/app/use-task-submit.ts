"use client";
import { useCallback, useMemo, useState } from "react";
import type React from "react";
import { emptyForm, type TaskFormDraft } from "./task-form-context";
import { upsertContact, type ContactsMap } from "./contacts";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { useAdjustmentTracker } from "./field-feedback";
import { t, type Lang } from "./i18n";
import { mintId } from "./id-mint-session";
import { type Settings } from "./settings-types";
import { type Task, type RaidItem } from "./types";
import { applyStatusChange } from "./task-status";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { TASK_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";
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
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";
import { sanitizeNoteHtml } from "./sanitize-html";
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
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  onPushToJiraRef: React.MutableRefObject<(taskId: number) => Promise<boolean>>;
  raid: readonly RaidItem[];
  setRaid: React.Dispatch<React.SetStateAction<readonly RaidItem[]>>;
  pendingLinkRaidIdRef: React.MutableRefObject<number | null>;
  /** Called with the new task id after a create-mode save resolves it, so the
   *  editor buffer can flush staged RAID/links against the real parent id. */
  onTaskCreated?: (newId: number) => void;
  /** Called when the editor closes without creating (cancel/nav-away) so the
   *  editor buffer discards any staged create-mode items. */
  onEditorDiscard?: () => void;
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
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
    logActivityChanges,
    showToast,
    onPushToJiraRef,
    setRaid,
    pendingLinkRaidIdRef,
    onTaskCreated,
    onEditorDiscard,
    captureFieldEdit,
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
        description: sanitizeNoteHtml(form.description ?? ""),
        group: sanitizeGroup(adj.track(describeTextCap(form.group, GROUP_MAX))),
        labels: sanitizeLabels(form.labels),
        dependencies: cleanDependencies,
        healthOverride: form.healthOverride || undefined,
        originalEstimateMinutes: form.originalEstimateMinutes,
        timeSpentMinutes: form.timeSpentMinutes,
        resourceId: form.resourceId ?? undefined,
        knowledgeLinks: form.knowledgeLinks,
        // ★★ `noteLog` is DELIBERATELY absent. The note log is WRITE-THROUGH —
        // NoteLogPanel (inline in the editor) and the floating notes window both
        // commit straight to the workspace row, and never touch this draft. The
        // draft's copy (snapshotted by `openEditModal`) therefore goes stale the
        // instant a note is added/edited/deleted, and since `payload` is spread
        // OVER `row` it would overwrite the live log with that stale copy —
        // silent data loss. The write-through path is the sole owner.
      };

      if (adj.count() > 0) {
        showToast("info", t(lang, "fieldsAdjusted", adj.count()));
      }

      setContacts((prev) => upsertContact(prev, assignee, email));

      if (editingId !== null) {
        const stamp = new Date().toISOString();
        const updatedId = editingId;
        const prevTask = tasksRef.current.find((r) => r.id === editingId);
        setTasks((prev) =>
          prev.map((row) =>
            row.id === editingId
              ? applyStatusChange(
                  { ...row, ...payload, localModifiedAt: stamp },
                  form.status,
                  today,
                )
              : row,
          ),
        );
        setEditingId(null);
        if (prevTask) {
          // Single-item edit, so tasksRef's row equals the mapped row — recompute
          // the same next value to diff prev→next for the undo capture + audit detail.
          const nextTask = applyStatusChange(
            { ...prevTask, ...payload, localModifiedAt: stamp },
            form.status,
            today,
          );
          captureFieldChanges(captureFieldEdit, {
            setter: setTasks,
            kind: "task.updated",
            id: updatedId,
            prev: prevTask,
            next: nextTask,
            groups: TASK_UNDO_GROUPS,
            stampField: "localModifiedAt",
            name: taskName,
          });
          if (logActivityChanges) {
            logActivityChanges("task.updated", diffFields(prevTask, nextTask), updatedId, taskName);
          } else {
            logActivity("task.updated", updatedId, taskName);
          }
        } else {
          logActivity("task.updated", updatedId, taskName);
        }
      } else {
        const newTask: Task = applyStatusChange(
          {
            id: mintId("task", tasks),
            ...payload,
            status: form.status,
            inquiriesSent: 0,
            createdDate: today,
          },
          form.status,
          today,
        );
        const newId = newTask.id;
        const shouldPush =
          form.pushToJira &&
          settings.jira.enabled &&
          !!settings.jira.projectKey;
        const nextList = [...tasksRef.current, newTask];
        tasksRef.current = nextList;
        setTasks(nextList);
        logActivity("task.created", newId, taskName);
        // Flush any editor-buffered RAID/links now that the parent id exists.
        onTaskCreated?.(newId);
        const linkRaidId = pendingLinkRaidIdRef.current;
        pendingLinkRaidIdRef.current = null;
        if (linkRaidId != null) {
          setRaid((prev) =>
            prev.some((r) => r.id === linkRaidId)
              ? prev.map((r) =>
                  r.id === linkRaidId
                    ? {
                        ...r,
                        linkedTaskIds: r.linkedTaskIds.includes(newId)
                          ? r.linkedTaskIds
                          : [...r.linkedTaskIds, newId],
                      }
                    : r,
                )
              : prev,
          );
        }
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
      logActivityChanges,
      showToast,
      adj,
      onPushToJiraRef,
      setRaid,
      pendingLinkRaidIdRef,
      onTaskCreated,
      captureFieldEdit,
    ],
  );

  const handleCancelEdit = useCallback(() => {
    pendingLinkRaidIdRef.current = null;
    onEditorDiscard?.();
    setEditingId(null);
    setSubmitted(false);
    setForm(emptyForm());
    setTaskModalOpen(false);
  }, [setEditingId, setForm, setTaskModalOpen, pendingLinkRaidIdRef, onEditorDiscard]);

  const openEditModal = useCallback(
    (task: Task) => {
      // Switching the editor to an EXISTING task (e.g. a deep-link fired mid-create)
      // must drop any create-mode staged RAID/links — otherwise saving this existing
      // task takes the edit branch (no flush) and the stale items later flush onto the
      // wrong parent id.
      onEditorDiscard?.();
      pendingLinkRaidIdRef.current = null;
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
        status: task.status,
        blockers: task.blockers,
        description: task.description,
        group: task.group ?? "",
        labels: task.labels ?? [],
        dependencies: task.dependencies ?? [],
        originalEstimateMinutes: task.originalEstimateMinutes,
        timeSpentMinutes: task.timeSpentMinutes,
        resourceId: task.resourceId,
        pushToJira: false,
        healthOverride: task.healthOverride ?? "",
        knowledgeLinks: task.knowledgeLinks ?? [],
        noteLog: task.noteLog ?? [],
      });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setEditingId, setTaskModalOpen, setForm, pendingLinkRaidIdRef, onEditorDiscard],
  );

  return { fieldErrors, submitted, saveDisabled, handleSubmit, handleCancelEdit, openEditModal };
}
