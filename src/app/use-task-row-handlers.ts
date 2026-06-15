"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { t, type Lang } from "./i18n";
import { isValidEmail } from "./sanitize";
import { buildMailtoUrl } from "./mailto";
import { htmlToPlainText } from "./html-to-text";
import { renderTemplate, buildStatusInquiryVars } from "./comm-templates";
import { sanitizeTemplateHtml } from "./sanitize-html";
import type { CommSendRequest } from "./comm-send";
import { greetingName } from "./contacts";
import { loadJiraApi } from "./use-jira-sync";
import type { ActivityKind } from "./activity-log";
import type { Task } from "./types";
import type { Settings } from "./settings-types";
import { useWorkspaceTab } from "./workspace-tab-context";

export interface UseTaskRowHandlersArgs {
  tasksRef: React.RefObject<readonly Task[]>;
  settings: Settings;
  lang: Lang;
  today: string;
  editingId: number | null;
  showToast: (kind: "info" | "error", text: string) => void;
  openEditModal: (task: Task) => void;
  setTasks: React.Dispatch<React.SetStateAction<readonly Task[]>>;
  setRaidFilterTaskId: React.Dispatch<React.SetStateAction<number | null>>;
  setWorkspaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  deselectIdRef: React.MutableRefObject<(id: number) => void>;
  handleCancelEdit: () => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  resolveTemplateBody?: (category: "status-inquiry") => string | null;
  sendCommTemplate?: (req: CommSendRequest) => void;
}

export function useTaskRowHandlers(args: UseTaskRowHandlersArgs) {
  const {
    tasksRef,
    settings,
    lang,
    today,
    editingId,
    showToast,
    openEditModal,
    setTasks,
    setRaidFilterTaskId,
    setWorkspaceCollapsed,
    deselectIdRef,
    handleCancelEdit,
    logActivity,
    resolveTemplateBody,
    sendCommTemplate,
  } = args;

  const { setActiveTab } = useWorkspaceTab();

  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [pushingIds, setPushingIds] = useState<Set<number>>(new Set());

  // Stable ref wrappers for potentially-recreated callbacks — mirrors the
  // pattern used in use-bulk-operations.ts and use-resource-planner.ts.
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);
  const logActivityRef = useRef(logActivity);
  useEffect(() => {
    logActivityRef.current = logActivity;
  }, [logActivity]);
  const handleCancelEditRef = useRef(handleCancelEdit);
  useEffect(() => {
    handleCancelEditRef.current = handleCancelEdit;
  }, [handleCancelEdit]);

  const onToggleNoteExpanded = useCallback((id: number) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onJumpToRaid = useCallback(
    (id: number) => {
      setRaidFilterTaskId(id);
      setActiveTab("raid");
      setWorkspaceCollapsed((prev) => (prev ? false : prev));
    },
    [setRaidFilterTaskId, setActiveTab, setWorkspaceCollapsed],
  );

  const onToggleComplete = useCallback(
    (task: Task) => {
      if (task.completedDate && task.jiraKey) {
        window.alert(t(lang, "jiraReopenForbidden", task.jiraKey));
        return;
      }
      const wasComplete = !!task.completedDate;
      const stamp = new Date().toISOString();
      setTasks((prev) =>
        prev.map((row) => {
          if (row.id !== task.id) return row;
          if (row.completedDate) {
            return { ...row, completedDate: undefined, localModifiedAt: stamp };
          }
          return { ...row, completedDate: today, localModifiedAt: stamp };
        }),
      );
      if (editingId === task.id) handleCancelEditRef.current();
      logActivityRef.current(
        wasComplete ? "task.reopened" : "task.completed",
        task.id,
        task.taskName,
      );
    },
    [lang, today, editingId, setTasks],
  );

  const onSendInquiry = useCallback(
    (task: Task) => {
      let email = task.assigneeEmail?.trim();
      if (!email && isValidEmail(task.assignee)) {
        email = task.assignee.trim();
      }
      if (!email) {
        const provided = window.prompt(
          t(lang, "promptEmail", task.assignee),
          "",
        );
        if (provided === null) return;
        const trimmed = provided.trim();
        if (!isValidEmail(trimmed)) {
          window.alert(t(lang, "errorInvalidEmail"));
          return;
        }
        email = trimmed;
        setTasks((prev) =>
          prev.map((row) =>
            row.id === task.id ? { ...row, assigneeEmail: trimmed } : row,
          ),
        );
      }
      const greeting = greetingName(task.assignee) || task.assignee;
      const subject = t(lang, "emailSubject", task.id, task.taskName);
      const tplBody = resolveTemplateBody?.("status-inquiry") ?? null;
      const body = tplBody != null
        ? htmlToPlainText(renderTemplate(tplBody, "status-inquiry", buildStatusInquiryVars(task)))
        : t(lang, "emailBodyTemplate", greeting, task.id, task.taskName, task.dueDate, task.lastUpdateDate);
      const html = tplBody != null
        ? sanitizeTemplateHtml(renderTemplate(tplBody, "status-inquiry", buildStatusInquiryVars(task)))
        : `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`;
      if (sendCommTemplate) {
        sendCommTemplate({ to: email, subject, html, plain: body });
      } else {
        window.location.href = buildMailtoUrl(email, subject, body);
      }
      setTasks((prev) =>
        prev.map((row) =>
          row.id === task.id
            ? { ...row, inquiriesSent: (row.inquiriesSent ?? 0) + 1 }
            : row,
        ),
      );
    },
    [lang, setTasks, resolveTemplateBody, sendCommTemplate],
  );

  const onPushToJira = useCallback(
    async (taskId: number): Promise<boolean> => {
      const jiraCfg = settings.jira;
      if (!jiraCfg.enabled || !jiraCfg.projectKey) {
        showToastRef.current("error", t(lang, "jiraPushPrereq"));
        return false;
      }
      const task = tasksRef.current.find((row) => row.id === taskId);
      if (!task) return false;
      if (task.jiraKey) return false;
      if (pushingIds.has(taskId)) return false;

      setPushingIds((prev) => {
        const next = new Set(prev);
        next.add(taskId);
        return next;
      });

      const { createIssue, taskFieldsToJiraFields, formatJiraError } =
        await loadJiraApi();
      const issueType = jiraCfg.issueTypes[0] ?? "Task";
      try {
        const created = await createIssue(
          {
            siteUrl: jiraCfg.siteUrl,
            email: jiraCfg.email,
            apiToken: jiraCfg.apiToken,
          },
          jiraCfg.projectKey,
          issueType,
          taskFieldsToJiraFields(task),
        );
        if (!created?.key) {
          showToastRef.current(
            "error",
            t(lang, "jiraPushFailed", `#${taskId}`, "no key"),
          );
          return false;
        }
        const syncStamp = new Date().toISOString();
        const next = tasksRef.current.map((row) =>
          row.id === taskId
            ? {
                ...row,
                jiraKey: created.key,
                jiraIssueType: issueType,
                lastSyncedAt: syncStamp,
                localModifiedAt: undefined,
              }
            : row,
        );
        tasksRef.current = next;
        setTasks(next);
        showToastRef.current(
          "info",
          t(lang, "jiraPushedToast", created.key, issueType),
        );
        return true;
      } catch (err) {
        showToastRef.current(
          "error",
          t(lang, "jiraPushFailed", `#${taskId}`, formatJiraError(err)),
        );
        return false;
      } finally {
        setPushingIds((prev) => {
          if (!prev.has(taskId)) return prev;
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [settings.jira, lang, tasksRef, pushingIds, setTasks],
  );

  const onEdit = useCallback(
    (task: Task) => {
      openEditModal(task);
    },
    [openEditModal],
  );

  const onDelete = useCallback(
    (id: number) => {
      if (!window.confirm(t(lang, "confirmDelete", id))) return;
      const deletedName =
        tasksRef.current.find((tk) => tk.id === id)?.taskName ?? "";
      setTasks((prev) =>
        prev
          .filter((tk) => tk.id !== id)
          .map((tk) =>
            tk.dependencies?.some((d) => d.taskId === id)
              ? {
                  ...tk,
                  dependencies: tk.dependencies!.filter(
                    (d) => d.taskId !== id,
                  ),
                }
              : tk,
          ),
      );
      deselectIdRef.current(id);
      if (editingId === id) handleCancelEditRef.current();
      logActivityRef.current("task.deleted", id, deletedName);
    },
    [lang, tasksRef, setTasks, deselectIdRef, editingId],
  );

  const handleClearRaidTaskFilter = useCallback(() => {
    setRaidFilterTaskId(null);
  }, [setRaidFilterTaskId]);

  const handleJumpToTaskFromRaid = useCallback(
    (taskId: number) => {
      const task = tasksRef.current.find((tk) => tk.id === taskId);
      if (task) openEditModal(task);
    },
    [tasksRef, openEditModal],
  );

  return {
    expandedNotes,
    setExpandedNotes,
    pushingIds,
    setPushingIds,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
    handleClearRaidTaskFilter,
    handleJumpToTaskFromRaid,
  };
}
