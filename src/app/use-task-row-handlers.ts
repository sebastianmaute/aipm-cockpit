"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { t, type Lang } from "./i18n";
import { isValidEmail } from "./sanitize";
import { buildMailtoUrl } from "./mailto";
import { htmlToPlainText } from "./html-to-text";
import { renderTemplate, buildStatusInquiryVars } from "./comm-templates";
import { sanitizeRichHtml } from "./sanitize-html";
import { plainTextToHtml, type CommSendRequest } from "./comm-send";
import { greetingName } from "./contacts";
import { loadJiraApi } from "./use-jira-sync";
import { applyStatusChange, statusActivityKind } from "./task-status";
import { laneKeyOf, type KanbanLane } from "./task-kanban";
import type { ActivityKind } from "./activity-log";
import type { Task, TaskStatus, Resource } from "./types";
import { effectivePersonEmail } from "./resource-foundation";
import type { Settings } from "./settings-types";
import { useWorkspaceTab } from "./workspace-tab-context";
import type { UndoStackApi } from "./undo/use-undo-stack";

const EMPTY_RESOURCE_MAP: ReadonlyMap<number, Resource> = new Map();

export interface UseTaskRowHandlersArgs {
  tasksRef: React.RefObject<readonly Task[]>;
  /** Directory for resolving a linked assignee's LIVE email on outbound
   *  inquiries (the cached `assigneeEmail` can be stale after a rename).
   *  Optional; an absent/empty map just falls back to the cached email. */
  resourcesById?: ReadonlyMap<number, Resource>;
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
  /** Capture a pre-op snapshot for undo (a delete removes rows). */
  capture: UndoStackApi["capture"];
  /** Capture a single field-level undo entry (the inline status dropdown). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
  resolveTemplateBody?: (category: "status-inquiry") => string | null;
  sendCommTemplate?: (req: CommSendRequest) => void;
}

export function useTaskRowHandlers(args: UseTaskRowHandlersArgs) {
  const {
    tasksRef,
    resourcesById = EMPTY_RESOURCE_MAP,
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
    capture,
    captureFieldEdit,
    resolveTemplateBody,
    sendCommTemplate,
  } = args;

  const { setActiveTab } = useWorkspaceTab();

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

  const onJumpToRaid = useCallback(
    (id: number) => {
      setRaidFilterTaskId(id);
      setActiveTab("raid");
      setWorkspaceCollapsed((prev) => (prev ? false : prev));
    },
    [setRaidFilterTaskId, setActiveTab, setWorkspaceCollapsed],
  );

  const onSendInquiry = useCallback(
    (task: Task) => {
      // Prefer the linked resource's CURRENT email; the cached assigneeEmail
      // can be stale after a rename/re-link. Unlinked → the cached email.
      let email = effectivePersonEmail(task.assigneeEmail ?? "", task.resourceId, resourcesById).trim();
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
        ? sanitizeRichHtml(renderTemplate(tplBody, "status-inquiry", buildStatusInquiryVars(task)))
        : plainTextToHtml(body);
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
    [lang, setTasks, resolveTemplateBody, sendCommTemplate, resourcesById],
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

  const onStatusChange = useCallback(
    (id: number, next: TaskStatus) => {
      const stamp = new Date().toISOString();
      const prevRow = tasksRef.current.find((row) => row.id === id);
      setTasks((prev) =>
        prev.map((row) =>
          row.id === id && !row.jiraKey
            ? { ...applyStatusChange(row, next, today), localModifiedAt: stamp }
            : row,
        ),
      );
      // Jira-synced tasks are read-only, so neither branch below fires for one.
      if (prevRow && !prevRow.jiraKey) {
        const after = applyStatusChange(prevRow, next, today);
        // No undo entry when the status didn't actually change (e.g.
        // re-selecting the same value): there is nothing for the user to revert
        // to that they did not already have.
        if (prevRow.status !== next) {
          captureFieldEdit?.({
            setter: setTasks,
            kind: "task.updated",
            id,
            before: { status: prevRow.status, completedDate: prevRow.completedDate },
            after: { status: after.status, completedDate: after.completedDate },
            stampField: "localModifiedAt",
            name: prevRow.taskName,
          });
        }
        // ★★ THE TRANSITION CHECK IS DELIBERATELY *NOT* GATED ON
        //   `prevRow.status !== next`, and it used to be. The setter above
        //   writes unconditionally for a non-synced row, so a row whose
        //   `status`/`completedDate` pair is already SPLIT — a state
        //   `migrateTask` deliberately does not repair, see
        //   docs/AGENTS/task-status.md — has its `completedDate` cleared by
        //   `applyStatusChange` even when the selected status equals the
        //   current one. Under the old gate that real write produced no audit
        //   entry at all. `statusActivityKind` compares DELIVERED-ness, not
        //   status, so it is already the right no-op test on its own: an
        //   unsplit row re-selected at its own status returns `null` here.
        //   Low reachability (a `<select>` onChange rarely fires for the value
        //   already displayed) but the write is real either way.
        const kind = statusActivityKind(prevRow, after);
        if (kind) logActivityRef.current(kind, id, prevRow.taskName);
      }
    },
    [today, setTasks, tasksRef, captureFieldEdit],
  );

  /** Swimlane cell write: the cell is (person, status), so ONE write covers both.
   *  Jira-synced tasks are read-only.
   *
   *  ★★★ `source` DECIDES THE NO-OP TEST, AND THE TWO ANSWERS DIFFER. Take it
   *  from the CALLER'S INTENT; never try to infer it by inspecting state — the
   *  same rule `resolveEntitySave` follows for the id-mint race, and for the
   *  same reason: the two situations are indistinguishable from the row alone.
   *
   *  - `"drag"` asks "does this card ALREADY DISPLAY in this cell?" A task whose
   *    free-string assignee uniquely names a directory person renders in
   *    `res:<id>` while storing no FK, so a stored-field test read a self-drop as
   *    a lane CHANGE: it wrote, stamped `localModifiedAt`, pushed an undo entry
   *    the user never made and armed the autosave for a drag that moved nothing.
   *  - `"assign"` asks "does this row ALREADY STORE this?" The per-card assignee
   *    `<select>` is controlled on `task.resourceId` (`task-kanban-card.tsx`), so
   *    for that very same row it reads "Unassigned" while the card sits in the
   *    person's lane. Picking that person is the repair — and the display test
   *    would call it a no-op, discard it, and let the controlled select snap
   *    straight back with no feedback. Inert forever, editor the only way out.
   *
   *  ★ Both paths fall through to ONE write below, so keyboard and mouse still
   *  cannot diverge in what they store (`tasks-section.tsx` onAssignFromCard). */
  const onSwimlaneDrop = useCallback(
    (id: number, lane: KanbanLane, next: TaskStatus, source: "drag" | "assign" = "drag") => {
      const prevRow = tasksRef.current.find((row) => row.id === id);
      if (!prevRow || prevRow.jiraKey) return;

      const nextAssignee = lane.resourceId != null || lane.key.startsWith("name:") ? lane.label : "";
      const nextResourceId = lane.resourceId ?? undefined;
      const alreadyThere =
        source === "drag"
          ? laneKeyOf(prevRow, resourcesById) === lane.key
          : (prevRow.resourceId ?? undefined) === nextResourceId
            && prevRow.assignee === nextAssignee;
      if (alreadyThere && prevRow.status === next) return;

      const stamp = new Date().toISOString();
      const after = applyStatusChange(
        { ...prevRow, assignee: nextAssignee, resourceId: nextResourceId },
        next,
        today,
      );
      setTasks((prev) =>
        prev.map((row) => (row.id === id ? { ...after, localModifiedAt: stamp } : row)),
      );
      captureFieldEdit?.({
        setter: setTasks,
        kind: "task.updated",
        id,
        before: {
          assignee: prevRow.assignee,
          resourceId: prevRow.resourceId,
          status: prevRow.status,
          completedDate: prevRow.completedDate,
        },
        after: {
          assignee: after.assignee,
          resourceId: after.resourceId,
          status: after.status,
          completedDate: after.completedDate,
        },
        stampField: "localModifiedAt",
        name: prevRow.taskName,
      });
      const kind = statusActivityKind(prevRow, after);
      if (kind) logActivityRef.current(kind, id, prevRow.taskName);
    },
    [today, setTasks, tasksRef, captureFieldEdit, resourcesById],
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
      const arr = tasksRef.current;
      const doomed = arr.find((tk) => tk.id === id);
      const deletedName = doomed?.taskName ?? "";
      // The delete also strips this id from other tasks' dependencies[], so undo
      // must restore the deleted task AND those edited dependents.
      const dependents = arr.filter((tk) =>
        tk.dependencies?.some((d) => d.taskId === id),
      );
      if (doomed) {
        capture({ setter: setTasks, kind: "task.deleted", removed: [doomed], edited: dependents, fromArray: arr, name: deletedName });
      }
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
    [lang, tasksRef, setTasks, deselectIdRef, editingId, capture],
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
    pushingIds,
    setPushingIds,
    onJumpToRaid,
    onSendInquiry,
    onPushToJira,
    onStatusChange,
    onSwimlaneDrop,
    onEdit,
    onDelete,
    handleClearRaidTaskFilter,
    handleJumpToTaskFromRaid,
  };
}
