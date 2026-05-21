"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAlertableTasks } from "./due-dates";
import {
  computeTaskHealth,
  formatHealthTooltip,
  HEALTH_VALUES,
  healthColorName,
  healthDot,
  type Health,
  type TaskHealth,
} from "./health";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
// jira-api is lazy-loaded via loadJiraApi() — pulls ~400 LOC out of the
// initial bundle for users who don't have Jira configured.
import type { ConflictItem } from "./jira-api";
import { holidaysForCountries } from "./holidays";
import { type Lang, type TranslationKey, priorityLabel, t } from "./i18n";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useActivityLog } from "./use-activity-log";
import { useSettings } from "./use-settings";
import { loadJiraApi, useJiraSync } from "./use-jira-sync";
import { useStorageBackend } from "./use-storage-backend";
import { useResourcePlanner } from "./use-resource-planner";
import { useBulkOperations } from "./use-bulk-operations";
import { VersionMenu } from "./version-menu";
import {
  DueBanner,
  DueDatesModal,
  dueAlertsToastText,
} from "./notifications";
// Heavy tab panels are dynamic-imported so each panel's code (and its
// transitive deps like chat-tools / markdown / resource-calendar) only
// loads when the user first opens that tab. ssr:false because every
// panel uses browser-only APIs (window, IndexedDB handles, etc.) and
// can't be prerendered.
const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false },
);
const GanttPanel = dynamic(
  () => import("./gantt").then((m) => m.GanttPanel),
  { ssr: false },
);
const ReportsPanel = dynamic(
  () => import("./reports").then((m) => m.ReportsPanel),
  { ssr: false },
);
const RaidPanel = dynamic(
  () => import("./raid-panel").then((m) => m.RaidPanel),
  { ssr: false },
);
const ResourcesPanel = dynamic(
  () => import("./resources-panel").then((m) => m.ResourcesPanel),
  { ssr: false },
);
const ActivityLogPanel = dynamic(
  () => import("./activity-log-panel").then((m) => m.ActivityLogPanel),
  { ssr: false },
);
// Modals are dynamic-imported on the same principle — JiraConflictsModal
// only opens during a Jira-sync conflict; absence/shift editors only open
// when the user clicks an edit/add affordance. Helpers
// (emptyAbsenceDraft / emptyShiftDraft) are inlined below so opening
// these modals doesn't need to await the module load.
const JiraConflictsModal = dynamic(
  () => import("./jira-conflicts-modal").then((m) => m.JiraConflictsModal),
  { ssr: false },
);
const AbsenceEditModal = dynamic(
  () => import("./absence-edit-modal").then((m) => m.AbsenceEditModal),
  { ssr: false },
);
const ShiftEditModal = dynamic(
  () => import("./shift-edit-modal").then((m) => m.ShiftEditModal),
  { ssr: false },
);
import {
  type ContactsMap,
  greetingName,
  listContacts,
  loadContacts,
  removeContact as removeContactFromMap,
  saveContacts,
  seedContactsFromTasks,
  upsertContact,
} from "./contacts";
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeDependencies,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNonNegInt,
  sanitizeNotes,
  sanitizePriority,
  sanitizeTaskName,
  sanitizeVoiceTranscript,
} from "./sanitize";
import {
  type Settings,
  SettingsMenu,
} from "./settings-menu";
import {
  DEFAULT_WEEK_HOURS,
  PRIORITIES,
  PRIORITY_RANK,
  type Absence,
  type Priority,
  type RaidItem,
  type Shift,
  type Task,
  type TaskDependency,
} from "./types";
import { buildRaidByTaskIndex, countByCategory, nextRaidId } from "./raid";
import {
  openPopoutWindow,
  type PopoutTab,
  readPopoutTabFromUrl,
} from "./broadcast-sync";
import {
  FiltersProvider,
  type SortDir,
  type SortKey,
  useFilters,
} from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import {
  TaskFormProvider,
  emptyBulkEdit,
  emptyForm,
  useTaskForm,
} from "./task-form-context";
import { BulkEditModal } from "./bulk-edit-modal";
import { TaskFormModal } from "./task-form-modal";
import {
  RowContextProvider,
  TaskRow,
  type RowContextValue,
} from "./task-row";
import { useResizable } from "./use-resizable";
// voice-button is lazy-loaded — it transitively pulls the Web Speech API
// shims in voice.ts which we only need when the user clicks the mic.
const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);
import type { Command } from "./voice";

// --- inlined absence / shift draft helpers ------------------------------
//
// Originally re-exported from absence-edit-modal.tsx / shift-edit-modal.tsx
// alongside the components. Inlined here so opening a draft doesn't need
// to await the modal module — the parent computes the seed synchronously
// and the dynamic-imported modal hydrates around it.

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}

function emptyShiftDraft(id: number): Shift {
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    hoursPerWeekday: DEFAULT_WEEK_HOURS,
    note: undefined,
  };
}

type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity";

// i18n key for each tab's label — used by both the tab strip and the
// popout window's document.title. Adding a new tab requires a row here.
const TAB_LABEL_KEYS: Record<TopTab, TranslationKey> = {
  chat: "tabChat",
  reports: "tabReports",
  gantt: "tabGantt",
  raid: "tabRaid",
  resources: "tabResources",
  activity: "tabActivity",
};

const WORKSPACE_COLLAPSED_KEY = "lop-app:workspace-collapsed";
const COL_WIDTHS_KEY = "lop-app:col-widths";
const HIDDEN_COLS_KEY = "lop-app:hidden-cols";

// Columns the user can show/hide. sel, taskName, and actions are always visible.
const CONFIGURABLE_COLS: Array<{ key: string; labelKey: TranslationKey }> = [
  { key: "status",         labelKey: "colStatus" },
  { key: "id",             labelKey: "id" },
  { key: "assignee",       labelKey: "assignee" },
  { key: "startDate",      labelKey: "start" },
  { key: "dueDate",        labelKey: "due" },
  { key: "lastUpdateDate", labelKey: "lastUpdate" },
  { key: "priority",       labelKey: "priority" },
  { key: "blockers",       labelKey: "blockers" },
  { key: "notes",          labelKey: "notes" },
  { key: "depRelations",   labelKey: "depRelations" },
];

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sel: 36, status: 36, id: 80, taskName: 200, assignee: 140,
  startDate: 110, dueDate: 110, lastUpdateDate: 110, priority: 90,
  blockers: 140, notes: 140, depRelations: 120, actions: 60,
};


function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

// TaskManagerInner consumes the FiltersProvider context. The default
// export below wraps this in <FiltersProvider> so useFilters() works.
function TaskManagerInner() {
  const { settings, setSettings, hydrated, i18nReady, lang } = useSettings();
  const { activityLog, setActivityLog, logActivity, handleClearActivityLog } =
    useActivityLog({ lang });

  const [error, setError] = useState<string | null>(null);
  // Popout mode: when the URL carries `?popout=<tab>`, the window suppresses
  // the page header / banner / task table / footer and renders only the
  // requested workspace panel. The popout window is opened by the per-tab
  // popout icon (see TabButton). State stays in sync with the opening window
  // via BroadcastChannel — see useStorageBackend.
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  const [activeTab, setActiveTab] = useState<TopTab>(popoutTab ?? "chat");
  // Collapsed state for the workspace section. When true, only the tab
  // strip (with the expand chevron) is visible — panels are hidden and the
  // section drops to its intrinsic height with no resize handle. The
  // initial value is hydrated from localStorage in an effect below so the
  // SSR-rendered HTML still matches the client's first paint.
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);

  // Remembered (assignee → email) address book. Persisted at
  // `CONTACTS_KEY` independent of tasks. The store is hydrated in a
  // mount-time effect below (also seeded from existing tasks on first
  // load), upserted on every successful task save, and removed-from when
  // the user clicks × on a suggestion row.
  const [contacts, setContacts] = useState<ContactsMap>({});
  const contactsHydratedRef = useRef(false);

  // Filter / sort state owned by FiltersProvider (Slice 1 of the
  // task-manager decomposition; see docs/superpowers/specs/2026-05-17-
  // filters-context-slice1-design.md). The default export wraps this
  // component in <FiltersProvider> at the bottom of the file.
  // raidFilterTaskId is set when the user clicks a task's RAID badge;
  // the RaidPanel still receives it as a prop (kept that way until a
  // later slice hoists the provider above the dynamic() boundary).
  const {
    search,
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
    raidFilterTaskId,
    setSearch,
    setPriorityFilter,
    setAssigneeFilter,
    setGroupFilter,
    setLabelFilter,
    setSortKey,
    setSortDir,
    setRaidFilterTaskId,
  } = useFilters();

  // Tasks data + derivations owned by WorkspaceProvider (Slice 2 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md).
  // The default export wraps this component in <WorkspaceProvider> inside
  // <FiltersProvider>.
  const {
    tasks,
    setTasks,
    uniqueAssignees,
    uniqueGroups,
    uniqueLabels,
    tasksById,
    taskSearchIndex,
    filteredSortedTasks,
    raid,
    setRaid,
    absences,
    setAbsences,
    shifts,
    setShifts,
  } = useWorkspace();

  // Form / modal state owned by TaskFormProvider (Slice 3 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-18-task-form-context-slice3-design.md).
  // The default export wraps this component in <TaskFormProvider> inside
  // <WorkspaceProvider>.
  const {
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
  } = useTaskForm();

  const [toast, setToast] = useState<
    { kind: "info" | "error"; text: string; id: number } | null
  >(null);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dueModalOpen, setDueModalOpen] = useState(false);
  const notifiedThisSessionRef = useRef(false);
  // Populated after useBulkOperations is called below; onDelete calls through
  // this ref so it doesn't depend on deselectId being defined first.
  const deselectIdRef = useRef<(id: number) => void>(() => {});

  const [pushingIds, setPushingIds] = useState<Set<number>>(new Set());
  // Tracks which rows have their Notes cell expanded. Default is collapsed
  // (i.e. id not in the set) — collapsed notes are capped at NOTES_COLLAPSED_MAX
  // characters with an ellipsis and a "Show more" toggle.
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());

  // Resizable surfaces. See `use-resizable.ts` — each has its own
  // localStorage key, only deliberate corner-drag gestures are persisted.
  const { ref: tableRef, reset: resetTableSize } = useResizable(
    "lop-app:task-table-size",
  );
  const { ref: workspaceRef, reset: resetWorkspaceSize } = useResizable(
    "lop-app:workspace-size",
  );
  const { ref: modalRef } = useResizable("lop-app:task-modal-size");

  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const colDragRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colConfigOpen, setColConfigOpen] = useState(false);
  const colConfigRef = useRef<HTMLDivElement | null>(null);

  const resetColWidths = useCallback(() => {
    setColWidths(DEFAULT_COL_WIDTHS);
    try { window.localStorage.removeItem(COL_WIDTHS_KEY); } catch { /* non-fatal */ }
  }, []);

  const startColResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    colDragRef.current = { col, startX: e.clientX, startW: colWidths[col] ?? 80 };
    function onMove(mv: MouseEvent) {
      if (!colDragRef.current) return;
      const { col: c, startX, startW } = colDragRef.current;
      setColWidths((prev) => ({ ...prev, [c]: Math.max(40, startW + mv.clientX - startX) }));
    }
    function onUp() {
      colDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidths]);

  const today = todayISO();

  // Row-related handlers converted to useCallback for TaskRow consumption.
  // Placed here, after lang/today are defined, before first usage.

  const onToggleNoteExpanded = useCallback((id: number) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onJumpToRaid = useCallback((id: number) => {
    setRaidFilterTaskId(id);
    setActiveTab("raid");
    setWorkspaceCollapsed((prev) => (prev ? false : prev));
  }, [setRaidFilterTaskId, setActiveTab, setWorkspaceCollapsed]);

  const onToggleComplete = useCallback((task: Task) => {
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
    if (editingId === task.id) handleCancelEdit();
    logActivity(
      wasComplete ? "task.reopened" : "task.completed",
      task.id,
      task.taskName,
    );
  }, [lang, today, editingId, logActivity]);

  const onSendInquiry = useCallback((task: Task) => {
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
    const body = t(
      lang,
      "emailBodyTemplate",
      greeting,
      task.id,
      task.taskName,
      task.dueDate,
      task.lastUpdateDate,
    );
    const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    setTasks((prev) =>
      prev.map((row) =>
        row.id === task.id
          ? { ...row, inquiriesSent: (row.inquiriesSent ?? 0) + 1 }
          : row,
      ),
    );
  }, [lang]);

  const onPushToJira = useCallback(async (taskId: number): Promise<boolean> => {
    const jiraCfg = settings.jira;
    if (!jiraCfg.enabled || !jiraCfg.projectKey) {
      showToast("error", t(lang, "jiraPushPrereq"));
      return false;
    }
    const task = tasksRef.current.find((row) => row.id === taskId);
    if (!task) return false;
    if (task.jiraKey) {
      return false;
    }
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
        showToast("error", t(lang, "jiraPushFailed", `#${taskId}`, "no key"));
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
      showToast(
        "info",
        t(lang, "jiraPushedToast", created.key, issueType),
      );
      return true;
    } catch (err) {
      showToast(
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
  }, [settings.jira, lang, showToast]);

  const onEdit = useCallback((task: Task) => {
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
      pushToJira: false,
      healthOverride: task.healthOverride ?? "",
    });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const onDelete = useCallback((id: number) => {
    if (!window.confirm(t(lang, "confirmDelete", id))) return;
    const deletedName = tasksRef.current.find((t) => t.id === id)?.taskName ?? "";
    setTasks((prev) =>
      prev
        .filter((t) => t.id !== id)
        .map((t) =>
          t.dependencies && t.dependencies.some((d) => d.taskId === id)
            ? { ...t, dependencies: t.dependencies.filter((d) => d.taskId !== id) }
            : t,
        ),
    );
    deselectIdRef.current(id);
    if (editingId === id) handleCancelEdit();
    logActivity("task.deleted", id, deletedName);
  }, [lang, editingId, logActivity]);

  // Set the browser tab title in popout mode. The main-window title is
  // managed by `next/metadata` via layout.tsx; this only fires when
  // `?popout=<tab>` is present, so it never overwrites the main title.
  useEffect(() => {
    if (!isPopout || !popoutTab) return;
    document.title = `${t(lang, TAB_LABEL_KEYS[popoutTab])} — ${t(lang, "appTitle")}`;
  }, [isPopout, popoutTab, lang]);

  // `holidaysForCountries` is now async because `date-holidays` (and its
  // transitive moment + moment-timezone, ~100 KB+ gzipped) is dynamically
  // imported only when the user has at least one country selected. We
  // mirror the result into local state; consumers continue to read a
  // plain `Set<string>` and just see an empty set briefly on first paint
  // (or until a non-empty selection is loaded).
  const [holidaySet, setHolidaySet] = useState<Set<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    let cancelled = false;
    void holidaysForCountries(settings.holidayCountries).then((set) => {
      if (!cancelled) setHolidaySet(set);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.holidayCountries]);

  // Hydrate the workspace collapsed flag from localStorage on mount; then
  // persist any change. Default (key absent) is expanded — matches the
  // initial useState value, so first paint is consistent.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_COLLAPSED_KEY);
      if (raw === "1") setWorkspaceCollapsed(true);
    } catch {
      // Ignore — localStorage may be disabled.
    }
  }, []);
  useEffect(() => {
    try {
      if (workspaceCollapsed) {
        window.localStorage.setItem(WORKSPACE_COLLAPSED_KEY, "1");
      } else {
        window.localStorage.removeItem(WORKSPACE_COLLAPSED_KEY);
      }
    } catch {
      // Same — non-fatal.
    }
  }, [workspaceCollapsed]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COL_WIDTHS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setColWidths((prev) => ({ ...prev, ...(parsed as Record<string, number>) }));
        }
      }
    } catch { /* non-fatal */ }
  }, []);
  // Debounced: column drag fires setColWidths on every mousemove. Without
  // the timeout we'd JSON.stringify and write to localStorage 60×/sec
  // during a drag. 250 ms after the user lets go is plenty.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
      } catch {
        /* non-fatal */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [colWidths]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_COLS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHiddenCols(new Set(parsed as string[]));
      }
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...hiddenCols])); } catch { /* non-fatal */ }
  }, [hiddenCols]);

  useEffect(() => {
    if (!colConfigOpen) return;
    function onDown(e: MouseEvent) {
      if (colConfigRef.current && !colConfigRef.current.contains(e.target as Node))
        setColConfigOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setColConfigOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [colConfigOpen]);

  // Hydrate the contacts map on mount. If the persisted store is empty,
  // seed it once from whatever tasks have already been hydrated — that way
  // users who created tasks before this feature existed still get
  // assignee/email autocomplete the first time they open the modal.
  useEffect(() => {
    if (contactsHydratedRef.current) return;
    if (!hydrated) return; // wait until tasks are loaded so seeding works
    contactsHydratedRef.current = true;
    const loaded = loadContacts();
    const seeded =
      Object.keys(loaded).length === 0
        ? seedContactsFromTasks(loaded, tasks)
        : loaded;
    setContacts(seeded);
    if (Object.keys(seeded).length > 0 && Object.keys(loaded).length === 0) {
      saveContacts(seeded);
    }
  }, [hydrated, tasks]);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!contactsHydratedRef.current) return;
    saveContacts(contacts);
  }, [contacts]);

  function handleRemoveContact(name: string) {
    setContacts((prev) => removeContactFromMap(prev, name));
  }

  // --- RAID CRUD handlers ---------------------------------------------
  //
  // The RAID panel owns its own form state and edit modal; these are pure
  // mutators that update the top-level `raid` array, which round-trips to
  // storage via the existing save effect.

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  function showToast(kind: "info" | "error", text: string) {
    setToast({ kind, text, id: Date.now() });
  }

  const { jiraSyncing, jiraConflicts, handleJiraSync, handleResolveConflicts, clearConflicts } = useJiraSync({
    settings,
    today,
    lang,
    showToast,
    logActivity,
  });

  const { storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess, onOpenStorageFile } =
    useStorageBackend({ settings, lang, hydrated, activityLog, setActivityLog, showToast });

  const nextId =
    tasks.length > 0 ? Math.max(...tasks.map((t) => t.id)) + 1 : 1;

  // Stable, sorted contacts array for the ContactInput suggestion list.
  const contactsList = useMemo(() => listContacts(contacts), [contacts]);

  // Reverse-lookup index for the "referenced by N RAID items" badge on
  // each task row. Map<taskId, RaidItem[]>. O(R) on every raid update,
  // then O(1) per row. Empty when `raid` is empty — the per-row check
  // bails out fast.
  const raidByTask = useMemo(() => buildRaidByTaskIndex(raid), [raid]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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

    // Block assignee changes on Jira-linked tasks (also enforced by the disabled
    // input, but a paste/devtools edit could still get here).
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

    // Sanitize dependencies against the current snapshot of task ids. The
    // editor already filters by id and prevents self-loops + cycles, but a
    // sanitize pass keeps the persistence layer honest if anything slipped
    // through (e.g. a referenced task was deleted while the modal was open).
    const knownIds = new Set(tasks.map((t) => t.id));
    const cleanDependencies = sanitizeDependencies(
      form.dependencies,
      knownIds,
      editingId,
    );

    // startDate is optional and must not exceed dueDate. Empty → undefined
    // (preserves the derived behavior in the Gantt). If the user picked a
    // start past the due date we clamp it to dueDate so the bar collapses
    // to a single-day milestone instead of running backwards.
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
      // Empty string in the form means "Auto" (no override) — store as
      // undefined so the field round-trips cleanly via JSON.
      healthOverride: form.healthOverride || undefined,
    };

    // Remember this (assignee, email) pair for autocomplete next time.
    setContacts((prev) => upsertContact(prev, assignee, email));

    if (editingId !== null) {
      const stamp = new Date().toISOString();
      const updatedId = editingId;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingId
            ? { ...t, ...payload, localModifiedAt: stamp }
            : t,
        ),
      );
      setEditingId(null);
      logActivity("task.updated", updatedId, taskName);
    } else {
      const newTask: Task = { id: nextId, ...payload, inquiriesSent: 0 };
      const newId = newTask.id;
      const shouldPush =
        form.pushToJira &&
        settings.jira.enabled &&
        !!settings.jira.projectKey;
      // Synchronously update tasksRef so onPushToJira can find the row by id.
      const nextList = [...tasksRef.current, newTask];
      tasksRef.current = nextList;
      setTasks(nextList);
      logActivity("task.created", newId, taskName);
      if (shouldPush) {
        // Fire-and-forget; onPushToJira shows its own toasts.
        void onPushToJira(newId);
      }
    }
    setForm(emptyForm());
    setTaskModalOpen(false);
  }

  const handleEdit = useCallback((task: Task) => {
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
      pushToJira: false,
      healthOverride: task.healthOverride ?? "",
    });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  // Stable refs for the props passed to memoized <RaidPanel>. Without these
  // every parent re-render (search keystroke, column drag, etc.) would
  // produce a new function identity and bust the memo.
  const handleClearRaidTaskFilter = useCallback(() => {
    setRaidFilterTaskId(null);
  }, []);

  const handleJumpToTaskFromRaid = useCallback(
    (taskId: number) => {
      const task = tasksRef.current.find((tk) => tk.id === taskId);
      if (task) handleEdit(task);
    },
    [handleEdit],
  );

  function handleCancelEdit() {
    setEditingId(null);
    setError(null);
    setForm(emptyForm());
    setTaskModalOpen(false);
  }

  const {
    editingAbsence,
    editingShift,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
  } = useResourcePlanner({ lang, logActivity, showToast });

  const {
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
  } = useBulkOperations({
    lang,
    settings,
    setSettings,
    handlers: { onEdit: handleEdit, onDelete, onSendInquiry },
    onCancelEdit: handleCancelEdit,
    logActivity,
    showToast,
  });
  // Sync deselectIdRef so onDelete (defined above) can call it without
  // depending on useBulkOperations being declared first.
  deselectIdRef.current = deselectId;

  /**
   * Commit a Gantt drag-edit. Writes `startDate` + `dueDate` to the task,
   * stamps `localModifiedAt` so the Jira-sync conflict detection picks up
   * the change, and clamps the dates so start never exceeds due.
   *
   * No-ops if either date is unparseable (defensive — the panel already
   * formats them as YYYY-MM-DD) or if the task disappeared between drag
   * start and drop.
   */
  function handleGanttBarUpdate(edit: {
    taskId: number;
    startDate: string;
    dueDate: string;
  }) {
    const start = sanitizeIsoDate(edit.startDate);
    const due = sanitizeIsoDate(edit.dueDate);
    if (!due) return;
    // Reorder if the drag accidentally produced start > due.
    const finalStart = start && start > due ? due : start;
    const stamp = new Date().toISOString();
    const todayIso = today;
    const next = tasksRef.current.map((row) =>
      row.id === edit.taskId
        ? {
            ...row,
            startDate: finalStart || undefined,
            dueDate: due,
            // A drag-edit IS a meaningful change to the task, so bump
            // lastUpdateDate too. This makes the "Last update" column in
            // the tasks list reflect the edit, and `localModifiedAt`
            // keeps Jira-sync's conflict detection accurate.
            lastUpdateDate: todayIso,
            localModifiedAt: stamp,
          }
        : row,
    );
    tasksRef.current = next;
    setTasks(next);
  }

  const bannerItems = useMemo(() => {
    const cfg = settings.notifications.banner;
    if (!cfg.enabled) return [];
    return getAlertableTasks(tasks, cfg.thresholdWorkDays, today, holidaySet);
  }, [tasks, settings.notifications.banner, today, holidaySet]);

  const dueModalItems = useMemo(() => {
    const cfg = settings.notifications.popup;
    return getAlertableTasks(tasks, cfg.thresholdWorkDays, today, holidaySet);
  }, [tasks, settings.notifications.popup, today, holidaySet]);

  // Fire toast + popup once per session after settings + tasks are ready.
  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (tasks.length === 0) return; // wait for backend load
    notifiedThisSessionRef.current = true;

    const { toast: toastCfg, popup: popupCfg } = settings.notifications;
    if (toastCfg.enabled) {
      const items = getAlertableTasks(
        tasks,
        toastCfg.thresholdWorkDays,
        today,
        holidaySet,
      );
      if (items.length > 0) {
        showToast("info", dueAlertsToastText(items, settings.language));
      }
    }
    if (popupCfg.enabled) {
      const items = getAlertableTasks(
        tasks,
        popupCfg.thresholdWorkDays,
        today,
        holidaySet,
      );
      if (items.length > 0) setDueModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tasks, holidaySet]);

  // Refs used by task-manager handlers (voice commands, sync helpers, etc.).
  // The chat dispatcher has its own internal refs inside useChatDispatcher.
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(settings);
  const todayRef = useRef(today);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  const dispatcher = useChatDispatcher({
    settings,
    today,
    setSelectedIds,
    setSettings,
  });

  const handleAcceptAiConsent = useCallback(() => {
    setSettings((s) => ({ ...s, ai: { ...s.ai, consentAccepted: true } }));
  }, []);

  const isEditing = editingId !== null;
  const editingTask =
    editingId !== null
      ? tasks.find((row) => row.id === editingId) ?? null
      : null;
  const editingIsJiraLinked = !!editingTask?.jiraKey;

  const rowContextValue = useMemo<RowContextValue>(
    () => ({
      lang,
      today,
      holidaySet,
      jiraSiteUrl: settings.jira.siteUrl,
      jiraEnabled: settings.jira.enabled,
      jiraProjectKey: settings.jira.projectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    }),
    [
      lang,
      today,
      holidaySet,
      settings.jira.siteUrl,
      settings.jira.enabled,
      settings.jira.projectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    ],
  );

  // Render gate: hold first paint until the active-language dictionary is
  // in memory. Lifts in the next microtask for en-US/en-GB (no fetch);
  // briefly delays initial paint for de while ./i18n.de loads. Must come
  // AFTER every hook so the rules-of-hooks invariant holds.
  if (!i18nReady) return null;

  return (
    <div
      className={
        isPopout
          ? "flex flex-1 flex-col p-4"
          : "mx-auto w-full max-w-6xl p-6 sm:p-10"
      }
    >
      {!isPopout && (
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "appTitle")}
          </h1>
          <p className="mt-1 text-sm text-AIPM-dark-grey dark:text-AIPM-medium-grey">
            {t(lang, "appSubtitle")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/AIPM-logo.svg"
            alt="Acme"
            className="h-7 w-auto"
          />
          <div className="flex items-center gap-1">
            <VoiceCommandButton
              lang={lang}
              onCommand={handleCommand}
              onError={(msg) => showToast("error", msg)}
            />
            <button
              type="button"
              onClick={() => {
                // Open a fresh new-task modal. If the user was in the middle
                // of editing, cancel that first so the form starts empty.
                handleCancelEdit();
                setTaskModalOpen(true);
              }}
              aria-label={t(lang, "addTaskButton")}
              title={t(lang, "addTaskButton")}
              className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setBannerDismissed(false);
                setDueModalOpen(true);
              }}
              aria-label={t(lang, "showDueAlerts")}
              title={t(lang, "showDueAlerts")}
              className="relative rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 15a2 2 0 104 0H8z" />
              </svg>
              {bannerItems.length > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white"
                >
                  {bannerItems.length}
                </span>
              )}
            </button>
            <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} />
            <HelpMenu lang={lang} />
            <VersionMenu lang={lang} />
            <SettingsMenu
              settings={settings}
              onChange={setSettings}
              storageDescription={storageDescription}
              storageReady={storageReady}
              onPickStorageFile={onPickStorageFile}
              onOpenStorageFile={onOpenStorageFile}
              onGrantStorageWrite={onGrantWriteAccess}
            />
          </div>
        </div>
      </header>
      )}

      {!isPopout && !bannerDismissed && (
        <DueBanner
          items={bannerItems}
          lang={lang}
          onOpenList={() => setDueModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/*
        Resizable + collapsible workspace section. Only Chat and Reports
        live here — the New-task / Edit-task form moved out into a
        header-triggered modal.

        Resize state is persisted at "lop-app:workspace-size"; collapsed
        state at "lop-app:workspace-collapsed". When collapsed, the section
        drops resize/overflow and shrinks to just the tab strip — the
        chevron button on the right toggles back.

        `overflow-hidden` on the expanded section is required for CSS
        `resize` to take effect on a flex container; the individual panels
        still scroll internally via their own overflow rules. Min dimensions
        are sized so chat (input row + a few bubbles) and reports (4-tile
        row + first section header) render fully without internal
        scrollbars on first load.
      */}
      <section
        ref={workspaceRef}
        title={
          isPopout || workspaceCollapsed
            ? undefined
            : t(lang, "workspaceResizeHint")
        }
        className={
          isPopout
            ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            : workspaceCollapsed
            ? "mb-10 flex w-full flex-col rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            : "mb-10 flex h-[560px] min-h-[420px] w-full min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        }
      >
        {!isPopout && (
        <div
          role="tablist"
          aria-label="Workspace tabs"
          className={
            workspaceCollapsed
              ? "-mx-2 -mt-2 flex shrink-0 items-end gap-1 px-2"
              : "-mx-2 -mt-2 flex shrink-0 items-end gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800"
          }
        >
          <TabButton
            active={activeTab === "chat"}
            onClick={() => {
              setActiveTab("chat");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-chat"
            onPopout={() => openPopoutWindow("chat")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabChat")}
          </TabButton>
          <TabButton
            active={activeTab === "reports"}
            onClick={() => {
              setActiveTab("reports");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-reports"
            onPopout={() => openPopoutWindow("reports")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabReports")}
          </TabButton>
          <TabButton
            active={activeTab === "gantt"}
            onClick={() => {
              setActiveTab("gantt");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-gantt"
            onPopout={() => openPopoutWindow("gantt")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabGantt")}
          </TabButton>
          <TabButton
            active={activeTab === "raid"}
            onClick={() => {
              setActiveTab("raid");
              setRaidFilterTaskId(null);
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-raid"
            onPopout={() => openPopoutWindow("raid")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabRaid")}
          </TabButton>
          <TabButton
            active={activeTab === "resources"}
            onClick={() => {
              setActiveTab("resources");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-resources"
            onPopout={() => openPopoutWindow("resources")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabResources")}
          </TabButton>
          <TabButton
            active={activeTab === "activity"}
            onClick={() => {
              setActiveTab("activity");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-activity"
            onPopout={() => openPopoutWindow("activity")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabActivity")}
          </TabButton>
          {!workspaceCollapsed && (
            <button
              type="button"
              onClick={resetWorkspaceSize}
              aria-label={t(lang, "tableResetSizeHint")}
              title={t(lang, "tableResetSizeHint")}
              className="ml-auto mb-1 rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ResetSizeIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => setWorkspaceCollapsed((v) => !v)}
            aria-expanded={!workspaceCollapsed}
            aria-controls="workspace-panels"
            title={
              workspaceCollapsed
                ? t(lang, "workspaceExpand")
                : t(lang, "workspaceCollapse")
            }
            className={
              workspaceCollapsed
                ? "ml-auto mb-1 rounded-md p-1.5 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
                : "mb-1 rounded-md p-1.5 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
            }
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${workspaceCollapsed ? "rotate-180" : ""}`}
            >
              {/* Chevron up — flipped to chevron down via rotate-180 when collapsed. */}
              <path
                fillRule="evenodd"
                d="M14.78 12.78a.75.75 0 01-1.06 0L10 9.06l-3.72 3.72a.75.75 0 11-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        )}

        <div
          id="workspace-panels"
          hidden={!isPopout && workspaceCollapsed}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div
            id="panel-chat"
            role="tabpanel"
            hidden={activeTab !== "chat"}
            className="min-h-0 flex-1 pt-4"
          >
            <ChatPanel
              lang={lang}
              ai={settings.ai}
              dispatcher={dispatcher}
              onAcceptConsent={handleAcceptAiConsent}
            />
          </div>

          {activeTab === "reports" && (
            <div
              id="panel-reports"
              role="tabpanel"
              className="min-h-0 flex-1 overflow-y-auto pt-4"
            >
              <ReportsPanel
                tasks={tasks}
                today={today}
                holidaySet={holidaySet}
                lang={lang}
              />
            </div>
          )}

          {activeTab === "gantt" && (
            <div
              id="panel-gantt"
              role="tabpanel"
              className="min-h-0 flex-1 pt-4"
            >
              <GanttPanel
                lang={lang}
                tasks={tasks}
                absences={absences}
                onUpdateBar={handleGanttBarUpdate}
                onAddTask={() => {
                  handleCancelEdit();
                  setTaskModalOpen(true);
                }}
              />
            </div>
          )}

          <div
            id="panel-raid"
            role="tabpanel"
            hidden={activeTab !== "raid"}
            className="min-h-0 flex-1 pt-4"
          >
            <RaidPanel
              lang={lang}
              tasks={tasks}
              raid={raid}
              today={today}
              filterTaskId={raidFilterTaskId}
              onClearTaskFilter={handleClearRaidTaskFilter}
              onSave={handleSaveRaidItem}
              onDelete={handleDeleteRaidItem}
              onCreateMitigationTask={handleCreateMitigationTaskFromRaid}
              onJumpToTask={handleJumpToTaskFromRaid}
            />
          </div>

          {activeTab === "resources" && (
            <div
              id="panel-resources"
              role="tabpanel"
              className="min-h-0 flex-1 pt-4"
            >
              <ResourcesPanel
                lang={lang}
                tasks={tasks}
                absences={absences}
                shifts={shifts}
                today={today}
                holidaySet={holidaySet}
                onAddAbsence={handleOpenAddAbsence}
                onEditAbsence={handleEditAbsence}
                onEditShift={handleOpenShiftEditor}
              />
            </div>
          )}

          {activeTab === "activity" && (
            <div
              id="panel-activity"
              role="tabpanel"
              className="min-h-0 flex-1 pt-4"
            >
              <ActivityLogPanel
                lang={lang}
                entries={activityLog}
                onClear={handleClearActivityLog}
              />
            </div>
          )}
        </div>
      </section>

      {/*
        New-task / Edit-task modal. Opened by the header "+" button or by
        editing a row. Backdrop click + Esc cancel and close. Submit closes
        on success. Dialog role + a11y owned by <Modal>; the inner div is
        just the resizable panel surface (the `modalRef` carries the saved
        size via useResizable).
      */}
      <TaskFormModal
        lang={lang}
        today={today}
        nextId={nextId}
        contactsList={contactsList}
        absences={absences}
        tasksForDeps={tasks}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        editingIsJiraLinked={editingIsJiraLinked}
        jiraEnabled={settings.jira.enabled}
        error={error}
        holidaySet={holidaySet}
        jiraProjectKey={settings.jira.projectKey}
        jiraDefaultIssueType={settings.jira.issueTypes[0]}
        modalRef={modalRef}
        onSubmit={handleSubmit}
        onCancel={handleCancelEdit}
        onRemoveContact={handleRemoveContact}
        onShowToast={showToast}
      />

      {/*
        Tasks list section — wrapped in the same rounded-xl card surface as
        the workspace section so the two main areas of the page share visual
        weight. The internal layout (toolbar row, filter row, resizable
        table, bulk-edit panel) is unchanged. Hidden in popout mode so the
        popout window only shows the requested workspace panel.
      */}
      {!isPopout && (
      <section
        ref={tableRef}
        title={t(lang, "tableResizeHint")}
        className="mb-10 flex h-[560px] min-h-[300px] min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        {/* shrink-0 wrapper keeps header, filters and bulk-edit from growing into the table area */}
        <div className="shrink-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div ref={colConfigRef} className="relative">
              <button
                type="button"
                onClick={() => setColConfigOpen((o) => !o)}
                aria-label={t(lang, "colConfigTitle")}
                title={t(lang, "colConfigTitle")}
                aria-expanded={colConfigOpen}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                  <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.25 1.252a6.013 6.013 0 011.317.757l1.198-.42a1 1 0 011.15.376l1.18 2.044a1 1 0 01-.205 1.274l-.96.836a6.02 6.02 0 010 1.514l.96.836a1 1 0 01.205 1.274l-1.18 2.044a1 1 0 01-1.15.376l-1.198-.42a6.014 6.014 0 01-1.317.757l-.25 1.252a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.25-1.252a6.013 6.013 0 01-1.317-.757l-1.198.42a1 1 0 01-1.15-.376L2.745 13.3a1 1 0 01.205-1.274l.96-.836a6.023 6.023 0 010-1.514l-.96-.836a1 1 0 01-.205-1.274L3.925 5.52a1 1 0 011.15-.376l1.198.42a6.013 6.013 0 011.317-.757l.25-1.252zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </button>
              {colConfigOpen && (
                <div
                  role="dialog"
                  aria-label={t(lang, "colConfigTitle")}
                  className="absolute left-0 top-full z-40 mt-1 w-52 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {t(lang, "colConfigTitle")}
                  </p>
                  <ul className="space-y-1">
                    {CONFIGURABLE_COLS.map(({ key, labelKey }) => (
                      <li key={key}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800">
                          <input
                            type="checkbox"
                            checked={!hiddenCols.has(key)}
                            onChange={() =>
                              setHiddenCols((prev) => {
                                const next = new Set(prev);
                                next.has(key) ? next.delete(key) : next.add(key);
                                return next;
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
                          />
                          {t(lang, labelKey)}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {t(lang, "tasks")}{" "}
              {filteredSortedTasks.length !== tasks.length
                ? t(lang, "tasksCountFiltered", filteredSortedTasks.length, tasks.length)
                : t(lang, "tasksCount", filteredSortedTasks.length)}
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                handleCancelEdit();
                setTaskModalOpen(true);
              }}
              aria-label={t(lang, "addTaskButton")}
              title={t(lang, "addTaskButton")}
              className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
            >
              + {t(lang, "addTaskButton")}
            </button>
            {settings.jira.enabled && (
              <button
                type="button"
                onClick={handleJiraSync}
                disabled={jiraSyncing || !settings.jira.projectKey}
                title={
                  settings.jira.projectKey
                    ? t(lang, "jiraSync")
                    : t(lang, "jiraSyncNoScope")
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue shadow-sm hover:bg-AIPM-light-grey disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                  className={`h-4 w-4 ${jiraSyncing ? "animate-spin" : ""}`}
                >
                  <path
                    fillRule="evenodd"
                    d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
                    clipRule="evenodd"
                  />
                </svg>
                {jiraSyncing ? t(lang, "jiraSyncing") : t(lang, "jiraSync")}
              </button>
            )}
            <button
              type="button"
              onClick={resetTableSize}
              aria-label={t(lang, "tableResetSizeHint")}
              title={t(lang, "tableResetSizeHint")}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ResetSizeIcon />
            </button>
            <button
              type="button"
              onClick={resetColWidths}
              aria-label={t(lang, "colResetWidthsHint")}
              title={t(lang, "colResetWidthsHint")}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ResetColWidthsIcon />
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={tasks.length === 0}
              aria-label={t(lang, "clearAll")}
              title={t(lang, "clearAll")}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <EraserIcon />
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(lang, "searchPlaceholder")}
            className={inputClass}
          />
          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value as Priority | "All")
            }
            className={inputClass}
          >
            <option value="All">{t(lang, "allPriorities")}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(lang, p)}
              </option>
            ))}
          </select>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className={inputClass}
          >
            <option value="All">{t(lang, "allAssignees")}</option>
            {uniqueAssignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className={inputClass}
          >
            <option value="All">{t(lang, "allGroups")}</option>
            <option value="">{t(lang, "groupNone")}</option>
            {uniqueGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            className={inputClass}
          >
            <option value="All">{t(lang, "allLabels")}</option>
            {uniqueLabels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {selectedIds.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-AIPM-medium-grey/40 bg-AIPM-light-grey p-3 dark:border-zinc-700 dark:bg-zinc-900">
            <span className="text-sm font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "selectionCount", selectedIds.size)}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleBulkSendInquiry}
                className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
              >
                {t(lang, "bulkSendInquiries")}
              </button>
              <button
                type="button"
                onClick={() => setBulkEditOpen((o) => !o)}
                aria-pressed={bulkEditOpen}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t(lang, "bulkEdit")}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t(lang, "clearSelection")}
              </button>
            </div>
          </div>
        )}

        <BulkEditModal
          lang={lang}
          today={today}
          selectedIds={selectedIds}
          selectedJiraCount={selectedJiraCount}
          uniqueGroups={uniqueGroups}
          uniqueLabels={uniqueLabels}
          onApply={applyBulkEdit}
          onCancel={cancelBulkEdit}
        />

        </div>{/* end shrink-0 */}

        {tasks.length === 0 ? (
          <div className="flex-1 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            {t(lang, "noTasks")}
          </div>
        ) : filteredSortedTasks.length === 0 ? (
          <div className="flex-1 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            {t(lang, "noTasksFiltered")}
          </div>
        ) : (
          <div
            className="min-h-0 flex-1 w-full overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <RowContextProvider value={rowContextValue}>
              <table
                className="divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800"
                style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
              >
              <colgroup>
                {(["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","blockers","notes","depRelations","actions"] as const)
                  .filter((col) => !hiddenCols.has(col))
                  .map((col) => (
                    <col key={col} style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTHS[col] }} />
                  ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <Th onResize={(e) => startColResize("sel", e)}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label={t(lang, "selectAllVisible")}
                      className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
                    />
                  </Th>
                  {!hiddenCols.has("status") && <Th onResize={(e) => startColResize("status", e)}><span className="sr-only">Status</span></Th>}
                  {!hiddenCols.has("id") && <SortableTh label={t(lang, "id")} sortKey="id" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("id", e)} />}
                  <SortableTh label={t(lang, "task")} sortKey="taskName" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskName", e)} />
                  {!hiddenCols.has("assignee") && <SortableTh label={t(lang, "assignee")} sortKey="assignee" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("assignee", e)} />}
                  {!hiddenCols.has("startDate") && <SortableTh label={t(lang, "start")} sortKey="startDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("startDate", e)} />}
                  {!hiddenCols.has("dueDate") && <SortableTh label={t(lang, "due")} sortKey="dueDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("dueDate", e)} />}
                  {!hiddenCols.has("lastUpdateDate") && <SortableTh label={t(lang, "lastUpdate")} sortKey="lastUpdateDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("lastUpdateDate", e)} />}
                  {!hiddenCols.has("priority") && <SortableTh label={t(lang, "priority")} sortKey="priority" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("priority", e)} />}
                  {!hiddenCols.has("blockers") && <Th onResize={(e) => startColResize("blockers", e)}>{t(lang, "blockers")}</Th>}
                  {!hiddenCols.has("notes") && <Th onResize={(e) => startColResize("notes", e)}>{t(lang, "notes")}</Th>}
                  {!hiddenCols.has("depRelations") && <Th onResize={(e) => startColResize("depRelations", e)}>{t(lang, "depRelations")}</Th>}
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredSortedTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isSelected={selectedIds.has(task.id)}
                    isEditing={editingId === task.id}
                    isExpanded={expandedNotes.has(task.id)}
                    isPushing={pushingIds.has(task.id)}
                    raidRefs={raidByTask.get(task.id)}
                  />
                ))}
              </tbody>
              </table>
            </RowContextProvider>
          </div>
        )}
      </section>
      )}

      {dueModalOpen && (
        <DueDatesModal
          items={dueModalItems}
          lang={lang}
          onClose={() => setDueModalOpen(false)}
          onSelectTask={(taskId) => {
            const task = tasks.find((row) => row.id === taskId);
            if (task) {
              setDueModalOpen(false);
              handleEdit(task);
            }
          }}
        />
      )}

      {jiraConflicts.length > 0 && (
        <JiraConflictsModal
          lang={lang}
          conflicts={jiraConflicts}
          onResolve={handleResolveConflicts}
          onClose={clearConflicts}
        />
      )}

      {editingAbsence && (
        <AbsenceEditModal
          lang={lang}
          absence={editingAbsence.absence}
          isNew={editingAbsence.isNew}
          knownAssignees={[
            ...tasks.map((tk) => ({
              name: tk.assignee,
              email: tk.assigneeEmail,
            })),
            ...absences.map((a) => ({
              name: a.assignee,
              email: a.assigneeEmail,
            })),
          ]}
          onSave={handleSaveAbsence}
          onDelete={handleDeleteAbsence}
          onClose={handleCloseAbsenceModal}
        />
      )}

      {editingShift && (
        <ShiftEditModal
          lang={lang}
          shift={editingShift.shift}
          isNew={editingShift.isNew}
          existingAssigneeKeys={
            new Set(
              shifts
                .filter((s) => s.id !== editingShift.shift.id)
                .map((s) => s.assignee.trim().toLowerCase()),
            )
          }
          knownAssignees={[
            ...tasks.map((tk) => ({
              name: tk.assignee,
              email: tk.assigneeEmail,
            })),
            ...absences.map((a) => ({
              name: a.assignee,
              email: a.assigneeEmail,
            })),
            ...shifts.map((s) => ({
              name: s.assignee,
              email: s.assigneeEmail,
            })),
          ]}
          onSave={handleSaveShift}
          onDelete={handleDeleteShift}
          onClose={handleCloseShiftModal}
        />
      )}

      {!isPopout && (
      <footer className="mt-12 flex items-center justify-between gap-4 border-t border-AIPM-light-grey pt-6 text-xs text-AIPM-medium-grey dark:border-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/AIPM-logo.svg" alt="Acme" className="h-6 w-auto" />
        <span className="text-right italic">
          Identity Excellence Delivered. Globally.
        </span>
      </footer>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-30 max-w-md rounded-md px-4 py-2.5 text-sm shadow-lg ${
            toast.kind === "error"
              ? "bg-AIPM-pink text-white"
              : "bg-AIPM-dark-blue text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default function TaskManager() {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskFormProvider>
          <TaskManagerInner />
        </TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function TabButton({
  active,
  onClick,
  controls,
  children,
  onPopout,
  popoutLabel,
}: {
  active: boolean;
  onClick: () => void;
  controls: string;
  children: React.ReactNode;
  onPopout?: () => void;
  popoutLabel?: string;
}) {
  // Active/hover colors are applied to the wrapping flex row so the active
  // border-b-2 indicator spans both the label and the popout icon.
  const colorClass = active
    ? "border-AIPM-green text-AIPM-dark-blue dark:border-AIPM-green dark:text-AIPM-light-grey"
    : "border-transparent text-AIPM-medium-grey hover:text-AIPM-dark-blue dark:text-zinc-400 dark:hover:text-zinc-200";
  return (
    <div
      className={`-mb-px inline-flex items-stretch rounded-t-md border-b-2 transition-colors ${colorClass}`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={controls}
        onClick={onClick}
        className={`py-2 pl-4 text-sm font-medium ${onPopout ? "pr-1" : "pr-4"}`}
      >
        {children}
      </button>
      {onPopout && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPopout();
          }}
          aria-label={popoutLabel}
          title={popoutLabel}
          className="rounded-tr-md px-1.5 py-2 opacity-50 hover:opacity-100 focus-visible:opacity-100"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <path d="M9.5 2.5h4v4" />
            <path d="m13.5 2.5-5.5 5.5" />
            <path d="M11 9v2.5A1.5 1.5 0 0 1 9.5 13H4A1.5 1.5 0 0 1 2.5 11.5V6A1.5 1.5 0 0 1 4 4.5h2.5" />
          </svg>
        </button>
      )}
    </div>
  );
}

function ResetSizeIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      {/* center square */}
      <rect x="8.5" y="8.5" width="3" height="3" fill="currentColor" stroke="none" />
      {/* top arrow — shaft + head pointing down toward center */}
      <line x1="10" y1="2" x2="10" y2="6.5" />
      <polyline points="8,4.5 10,6.5 12,4.5" />
      {/* bottom arrow — shaft + head pointing up toward center */}
      <line x1="10" y1="18" x2="10" y2="13.5" />
      <polyline points="8,15.5 10,13.5 12,15.5" />
      {/* left arrow — shaft + head pointing right toward center */}
      <line x1="2" y1="10" x2="6.5" y2="10" />
      <polyline points="4.5,8 6.5,10 4.5,12" />
      {/* right arrow — shaft + head pointing left toward center */}
      <line x1="18" y1="10" x2="13.5" y2="10" />
      <polyline points="15.5,8 13.5,10 15.5,12" />
    </svg>
  );
}

function ResetColWidthsIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      {/* column fill between the two guide lines */}
      <rect x="7" y="3" width="6" height="14" fill="currentColor" fillOpacity="0.15" stroke="none" />
      {/* left vertical guide line */}
      <line x1="7" y1="3" x2="7" y2="17" />
      {/* right vertical guide line */}
      <line x1="13" y1="3" x2="13" y2="17" />
      {/* left arrow — shaft + head pointing right toward left guide line */}
      <line x1="1.5" y1="10" x2="5.5" y2="10" />
      <polyline points="5.5,8.5 7,10 5.5,11.5" />
      {/* right arrow — shaft + head pointing left toward right guide line */}
      <line x1="18.5" y1="10" x2="14.5" y2="10" />
      <polyline points="14.5,8.5 13,10 14.5,11.5" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <g transform="rotate(-30, 10, 10)">
        {/* tip — left portion with rounded left corners, filled */}
        <path
          d="M2 9.5 Q2 7 4 7 L7.5 7 L7.5 13 L4 13 Q2 13 2 10.5 Z"
          fill="currentColor"
          fillOpacity="0.35"
          stroke="none"
        />
        {/* eraser body outline */}
        <rect x="2" y="7" width="16" height="6" rx="2" />
        {/* dividing band between tip and body */}
        <line x1="7.5" y1="7" x2="7.5" y2="13" />
      </g>
    </svg>
  );
}

function Th({
  children,
  onResize,
}: {
  children: React.ReactNode;
  onResize?: (e: React.MouseEvent) => void;
}) {
  return (
    <th className="relative px-4 py-2 font-medium">
      {children}
      {onResize && (
        <div
          onMouseDown={onResize}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40"
        />
      )}
    </th>
  );
}

function SortableTh({
  label,
  sortKey,
  currentKey,
  dir,
  onClick,
  onResize,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  onResize?: (e: React.MouseEvent) => void;
}) {
  const isActive = currentKey === sortKey;
  const indicator = isActive ? (dir === "asc" ? "↑" : "↓") : "";
  return (
    <th className="relative px-4 py-2 font-medium">
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-zinc-900 dark:hover:text-zinc-100 ${isActive ? "text-zinc-900 dark:text-zinc-100" : ""}`}
      >
        {label}
        <span aria-hidden className="text-[0.65rem]">
          {indicator}
        </span>
      </button>
      {onResize && (
        <div
          onMouseDown={onResize}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40"
        />
      )}
    </th>
  );
}

