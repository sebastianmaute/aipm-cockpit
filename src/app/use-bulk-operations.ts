"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-types";
import type { Task } from "./types";
import type { ActivityKind } from "./activity-log";
import type { Command } from "./voice";
import { useWorkspace } from "./workspace-context";
import { useFilters } from "./filters-context";
import { useTaskForm, emptyBulkEdit, emptyForm } from "./task-form-context";
import {
  isValidEmail,
  sanitizeTaskName,
  sanitizeVoiceTranscript,
} from "./sanitize";
import { buildBulkEditUpdates, buildInquiryMessage } from "./bulk-operations-helpers";
import { todayInZone, resolveTimezone } from "./timezone";

// Fields Jira owns on a synced task (mirrors issueToTaskFields). Bulk-editing
// them on a `jiraKey` row would be silently reverted by the next read-only pull
// (or unexpectedly pushed), so they are skipped on synced rows. Local-only
// fields (group/blockers/notes/labels/…) still apply. (Status is not a
// bulk-editable field.)
const JIRA_MANAGED_BULK_FIELDS = ["assignee", "priority", "dueDate"] as const;

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
  /** Arm the storage layer's one-shot destructive-save bypass before a clear-all
   *  — else the persistence data-loss guard refuses the mass deletion. */
  allowDestructiveSave?: () => void;
  /** Open the tasks view's type-to-confirm clear-all dialog. The voice `clearAll`
   *  command routes through this so it faces the SAME friction as the toolbar
   *  button (type "yes, clear all tasks") instead of a one-click window.confirm.
   *  Undefined ⇒ voice clear-all is a safe no-op (popout / view not mounted). */
  requestClearAllConfirm?: () => void;
}

export function useBulkOperations(args: UseBulkOperationsArgs) {
  const { tasks, setTasks, filteredSortedTasks, project } = useWorkspace();
  const { setSearchImmediate } = useFilters();
  const {
    bulkEdit,
    setBulkEdit,
    setBulkEditOpen,
    setForm,
    setTaskModalOpen,
  } = useTaskForm();

  const langRef = useRef(args.lang);
  const showToastRef = useRef(args.showToast);
  const logActivityRef = useRef(args.logActivity);
  const handlersRef = useRef(args.handlers);
  const onCancelEditRef = useRef(args.onCancelEdit);
  const setSettingsRef = useRef(args.setSettings);
  const allowDestructiveSaveRef = useRef(args.allowDestructiveSave);
  const requestClearAllConfirmRef = useRef(args.requestClearAllConfirm);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { handlersRef.current = args.handlers; }, [args.handlers]);
  useEffect(() => { onCancelEditRef.current = args.onCancelEdit; }, [args.onCancelEdit]);
  useEffect(() => { setSettingsRef.current = args.setSettings; }, [args.setSettings]);
  useEffect(() => { allowDestructiveSaveRef.current = args.allowDestructiveSave; }, [args.allowDestructiveSave]);
  useEffect(() => { requestClearAllConfirmRef.current = args.requestClearAllConfirm; }, [args.requestClearAllConfirm]);

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

  const onToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [visibleIds]);

  const cancelBulkEdit = useCallback(() => {
    setBulkEditOpen(false);
    setBulkEdit(emptyBulkEdit());
  }, [setBulkEdit, setBulkEditOpen]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBulkEditOpen(false);
  }, [setBulkEditOpen]);

  const deselectId = useCallback((id: number) => {
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const tz = resolveTimezone(args.settings.timezone, project?.operatingTimezone);
  const applyBulkEdit = useCallback(() => {
    const lang = langRef.current;
    const today = todayInZone(new Date(), tz);
    const fields = bulkEdit.enabled;
    const anyEnabled = Object.values(fields).some(Boolean);
    if (!anyEnabled) {
      showToastRef.current("error", t(lang, "bulkEditNoFields"));
      return;
    }
    const built = buildBulkEditUpdates(bulkEdit, today);
    if (!built.ok) {
      showToastRef.current(
        "error",
        t(lang, built.error === "pastDate" ? "errorPastDate" : "errorInvalidEmail"),
      );
      return;
    }
    const updates = built.updates;
    // Jira-managed fields are skipped on synced rows (silently reverted / pushed
    // otherwise); local-only fields still apply. Non-synced rows get everything.
    const managedEnabled = JIRA_MANAGED_BULK_FIELDS.some((f) => f in updates);
    const jiraSafeUpdates: Partial<Task> = { ...updates };
    for (const f of JIRA_MANAGED_BULK_FIELDS) delete jiraSafeUpdates[f];
    const skippedSynced = managedEnabled
      ? tasks.reduce((n, row) => (selectedIds.has(row.id) && row.jiraKey ? n + 1 : n), 0)
      : 0;
    // Synced rows are left fully untouched only when the edit was managed-fields-
    // only (nothing local to apply); subtract those so the count reflects rows
    // actually changed.
    const untouchedSynced = managedEnabled && Object.keys(jiraSafeUpdates).length === 0 ? skippedSynced : 0;
    const count = selectedIds.size - untouchedSynced;
    const stamp = new Date().toISOString();
    setTasks((prev) =>
      prev.map((row) => {
        if (!selectedIds.has(row.id)) return row;
        if (row.jiraKey) {
          if (!managedEnabled) return { ...row, ...updates, localModifiedAt: stamp };
          // Only managed fields were enabled → nothing local to change; leave the
          // row untouched (no spurious localModifiedAt that a pull would revert).
          if (Object.keys(jiraSafeUpdates).length === 0) return row;
          return { ...row, ...jiraSafeUpdates, localModifiedAt: stamp };
        }
        return { ...row, ...updates, localModifiedAt: stamp };
      }),
    );
    if (skippedSynced > 0) {
      window.alert(t(lang, "jiraBulkManagedFieldsSkipped", skippedSynced));
    }
    if (count > 0) {
      showToastRef.current(
        "info",
        count === 1
          ? t(lang, "bulkEditDoneOne")
          : t(lang, "bulkEditDoneMany", count),
      );
      logActivityRef.current("bulk.edit", count);
    }
    setBulkEditOpen(false);
    setBulkEdit(emptyBulkEdit());
    setSelectedIds(new Set());
  }, [bulkEdit, selectedIds, tasks, setTasks, setBulkEdit, setBulkEditOpen, tz]);

  // Unconditional clear — callers own the confirmation (the tasks view gates it
  // with TypeToConfirmDialog; the voice command below gates it with window.confirm).
  const handleClearAll = useCallback(() => {
    if (tasks.length === 0) return;
    allowDestructiveSaveRef.current?.(); // arm the storage destructive-save bypass (button + voice)
    setTasks([]);
    setSelectedIds(new Set());
    onCancelEditRef.current();
  }, [tasks, setTasks]);

  const handleBulkSendInquiry = useCallback(() => {
    const lang = langRef.current;
    const selected = tasks.filter((row) => selectedIds.has(row.id));
    if (selected.length === 0) return;

    const emailUpdates: Record<number, string> = {};
    const resolved: Array<{ task: Task; email: string }> = [];

    for (const task of selected) {
      let email = task.assigneeEmail?.trim() || "";
      if (!email && isValidEmail(task.assignee)) email = task.assignee.trim();
      if (!email) {
        const provided = window.prompt(t(lang, "promptEmail", task.assignee), "");
        if (provided === null) continue;
        const trimmed = provided.trim();
        if (!isValidEmail(trimmed)) {
          showToastRef.current("error", t(lang, "errorInvalidEmail"));
          continue;
        }
        email = trimmed;
        emailUpdates[task.id] = trimmed;
      }
      resolved.push({ task, email });
    }

    if (Object.keys(emailUpdates).length > 0) {
      setTasks((prev) =>
        prev.map((row) =>
          emailUpdates[row.id]
            ? { ...row, assigneeEmail: emailUpdates[row.id] }
            : row,
        ),
      );
    }

    if (resolved.length === 0) {
      showToastRef.current("error", t(lang, "bulkSendNoTasks"));
      return;
    }

    const groups = new Map<string, Task[]>();
    for (const { task, email } of resolved) {
      const list = groups.get(email) || [];
      list.push(task);
      groups.set(email, list);
    }

    if (!window.confirm(t(lang, "confirmBulkSend", groups.size, resolved.length))) {
      return;
    }

    for (const [email, taskList] of groups) {
      const { subject, body } = buildInquiryMessage(taskList, lang);
      const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(url);
    }

    const sentIds = new Set(resolved.map(({ task }) => task.id));
    setTasks((prev) =>
      prev.map((row) =>
        sentIds.has(row.id)
          ? { ...row, inquiriesSent: (row.inquiriesSent ?? 0) + 1 }
          : row,
      ),
    );
    showToastRef.current("info", t(lang, "bulkSendDone", groups.size, resolved.length));
    logActivityRef.current("bulk.inquiries", resolved.length);
    setSelectedIds(new Set());
  }, [tasks, selectedIds, setTasks]);

  const handleCommand = useCallback(
    (cmd: Command, originalText: string) => {
      const lang = langRef.current;
      switch (cmd.kind) {
        case "edit": {
          const task = tasks.find((row) => row.id === cmd.id);
          if (!task) {
            showToastRef.current("error", t(lang, "voiceTaskNotFound", cmd.id));
            return;
          }
          handlersRef.current.onEdit(task);
          return;
        }
        case "delete": {
          const task = tasks.find((row) => row.id === cmd.id);
          if (!task) {
            showToastRef.current("error", t(lang, "voiceTaskNotFound", cmd.id));
            return;
          }
          handlersRef.current.onDelete(cmd.id);
          return;
        }
        case "sendInquiry": {
          const task = tasks.find((row) => row.id === cmd.id);
          if (!task) {
            showToastRef.current("error", t(lang, "voiceTaskNotFound", cmd.id));
            return;
          }
          handlersRef.current.onSendInquiry(task);
          return;
        }
        case "clearAll":
          // Route through the tasks view's type-to-confirm dialog (type
          // "yes, clear all tasks") — the SAME friction as the toolbar button —
          // rather than a one-click window.confirm before an irreversible wipe.
          // No dialog wired (popout / view not mounted) ⇒ safe no-op.
          if (tasks.length > 0) requestClearAllConfirmRef.current?.();
          return;
        case "openForm":
          onCancelEditRef.current();
          setTaskModalOpen(true);
          return;
        case "openFormWith":
          onCancelEditRef.current();
          setForm({ ...emptyForm(), taskName: sanitizeTaskName(cmd.taskName) });
          setTaskModalOpen(true);
          return;
        case "search":
          setSearchImmediate(sanitizeVoiceTranscript(cmd.query));
          return;
        case "clearSearch":
          setSearchImmediate("");
          return;
        case "language":
          setSettingsRef.current((s) => ({ ...s, language: cmd.lang }));
          return;
        case "unknown":
          showToastRef.current("error", t(lang, "voiceUnknownCommand", originalText));
          return;
      }
    },
    [tasks, setTaskModalOpen, setForm, setSearchImmediate],
  );

  return {
    selectedIds,
    setSelectedIds,
    allVisibleSelected,
    selectedJiraCount,
    onToggleSelect,
    toggleSelectAllVisible,
    clearSelection,
    deselectId,
    cancelBulkEdit,
    applyBulkEdit,
    handleBulkSendInquiry,
    handleClearAll,
    handleCommand,
  };
}
