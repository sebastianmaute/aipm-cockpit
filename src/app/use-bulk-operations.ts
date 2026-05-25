"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-menu";
import type { Task } from "./types";
import type { ActivityKind } from "./activity-log";
import type { Command } from "./voice";
import { useWorkspace } from "./workspace-context";
import { useFilters } from "./filters-context";
import { useTaskForm, emptyBulkEdit, emptyForm } from "./task-form-context";
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNotes,
  sanitizePriority,
  sanitizeTaskName,
  sanitizeVoiceTranscript,
} from "./sanitize";
import { greetingName } from "./contacts";

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

  const applyBulkEdit = useCallback(() => {
    const lang = langRef.current;
    const today = new Date().toISOString().slice(0, 10);
    const fields = bulkEdit.enabled;
    const anyEnabled = Object.values(fields).some(Boolean);
    if (!anyEnabled) {
      showToastRef.current("error", t(lang, "bulkEditNoFields"));
      return;
    }
    if (fields.assignee) {
      const blockedCount = tasks.reduce(
        (n, row) => (selectedIds.has(row.id) && row.jiraKey ? n + 1 : n),
        0,
      );
      if (blockedCount > 0) {
        window.alert(t(lang, "jiraBulkAssigneeBlocked", blockedCount));
        return;
      }
    }
    const newDue = fields.dueDate ? sanitizeIsoDate(bulkEdit.dueDate) : "";
    if (fields.dueDate && (!newDue || newDue < today)) {
      showToastRef.current("error", t(lang, "errorPastDate"));
      return;
    }
    const newEmail = fields.assigneeEmail
      ? sanitizeEmail(bulkEdit.assigneeEmail)
      : "";
    if (fields.assigneeEmail && newEmail && !isValidEmail(newEmail)) {
      showToastRef.current("error", t(lang, "errorInvalidEmail"));
      return;
    }
    const updates: Partial<Task> = {};
    if (fields.priority) updates.priority = sanitizePriority(bulkEdit.priority);
    if (fields.dueDate) updates.dueDate = newDue;
    if (fields.lastUpdateDate)
      updates.lastUpdateDate =
        sanitizeIsoDate(bulkEdit.lastUpdateDate) || today;
    if (fields.assignee) updates.assignee = sanitizeAssignee(bulkEdit.assignee);
    if (fields.assigneeEmail) updates.assigneeEmail = newEmail;
    if (fields.blockers) updates.blockers = sanitizeBlockers(bulkEdit.blockers);
    if (fields.notes) updates.notes = sanitizeNotes(bulkEdit.notes);
    if (fields.group) updates.group = sanitizeGroup(bulkEdit.group);
    if (fields.labels) updates.labels = sanitizeLabels(bulkEdit.labels);
    const count = selectedIds.size;
    const stamp = new Date().toISOString();
    setTasks((prev) =>
      prev.map((row) =>
        selectedIds.has(row.id)
          ? { ...row, ...updates, localModifiedAt: stamp }
          : row,
      ),
    );
    showToastRef.current(
      "info",
      count === 1
        ? t(lang, "bulkEditDoneOne")
        : t(lang, "bulkEditDoneMany", count),
    );
    logActivityRef.current("bulk.edit", count);
    setBulkEditOpen(false);
    setBulkEdit(emptyBulkEdit());
    setSelectedIds(new Set());
  }, [bulkEdit, selectedIds, tasks, setTasks, setBulkEdit, setBulkEditOpen]);

  const handleClearAll = useCallback(() => {
    if (tasks.length === 0) return;
    if (!window.confirm(t(langRef.current, "confirmClearAll", tasks.length))) return;
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
      const greeting = greetingName(taskList[0].assignee) || taskList[0].assignee;
      const subject =
        taskList.length === 1
          ? t(lang, "emailSubject", taskList[0].id, taskList[0].taskName)
          : t(lang, "emailSubjectBulk", taskList.length);
      let body: string;
      if (taskList.length === 1) {
        const t0 = taskList[0];
        body = t(lang, "emailBodyTemplate", greeting, t0.id, t0.taskName, t0.dueDate, t0.lastUpdateDate);
      } else {
        const items = taskList
          .map((tk) => `- #${tk.id}: ${tk.taskName} (${tk.dueDate})`)
          .join("\n");
        body = t(lang, "emailBodyBulkTemplate", greeting, taskList.length, items);
      }
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
          handleClearAll();
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
    [tasks, handleClearAll, setTaskModalOpen, setForm, setSearchImmediate],
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
