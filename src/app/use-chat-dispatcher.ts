"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { type Filters, type ToolDispatcher, toRaidSummary, toChangeSummary, toMilestoneSummary } from "./chat-tools";
import { deriveMode, type FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";
import { greetingName } from "./contacts";
import { useFilters } from "./filters-context";
import { t } from "./i18n";
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNonNegInt,
  sanitizeNotes,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";
import { type Settings } from "./settings-types";
import { emptyForm, useTaskForm } from "./task-form-context";
import { type Task } from "./types";
import { useWorkspace } from "./workspace-context";

export interface ChatDispatcherArgs {
  settings: Settings;
  today: string;
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
  /** True in a popout/mirror window — mutating tools are refused so chat edits
   *  can't be silently lost (popouts neither persist nor broadcast). */
  isReadOnly: boolean;
  currentView: AppView;
}

export function useChatDispatcher(args: ChatDispatcherArgs): ToolDispatcher {
  const { tasks, setTasks, raid, changes, milestones } = useWorkspace();
  const { editingId, setEditingId, setForm } = useTaskForm();
  const {
    setSearch,
    setPriorityFilter,
    setAssigneeFilter,
    setGroupFilter,
    setLabelFilter,
  } = useFilters();

  // Refs absorb every reactive value the dispatcher reads. Without these the
  // dispatcher would rebuild on every task/settings/today/editingId change,
  // which is the whole reason ChatPanel currently re-renders on form input.
  // Refs seeded synchronously on first render; refreshed by the effects below.
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(args.settings);
  const todayRef = useRef(args.today);
  const viewRef = useRef(args.currentView);
  const editingIdRef = useRef(editingId);
  const raidRef = useRef(raid);
  const changesRef = useRef(changes);
  const milestonesRef = useRef(milestones);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    settingsRef.current = args.settings;
  }, [args.settings]);
  useEffect(() => {
    todayRef.current = args.today;
  }, [args.today]);
  useEffect(() => {
    viewRef.current = args.currentView;
  }, [args.currentView]);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);
  useEffect(() => {
    raidRef.current = raid;
  }, [raid]);
  useEffect(() => {
    changesRef.current = changes;
  }, [changes]);
  useEffect(() => {
    milestonesRef.current = milestones;
  }, [milestones]);

  // Helpers live inside the hook — they're not consumed anywhere else.
  // Stubbed for now; filled in by later tasks.
  // (Hoisted as useCallback for Tasks 3/5 ergonomics; other stubs stay inline.)
  const sendInquiry = useCallback(
    (id: number): { sent: boolean; reason?: string } => {
      if (args.isReadOnly) return { sent: false, reason: "read-only" };
      const task = tasksRef.current.find((row) => row.id === id);
      if (!task) return { sent: false, reason: "task-not-found" };
      let email = task.assigneeEmail?.trim();
      if (!email && isValidEmail(task.assignee)) email = task.assignee.trim();
      if (!email) return { sent: false, reason: "no-email-on-file" };

      const greeting = greetingName(task.assignee) || task.assignee;
      const currentLang = settingsRef.current.language;
      const subject = t(currentLang, "emailSubject", task.id, task.taskName);
      const body = t(
        currentLang,
        "emailBodyTemplate",
        greeting,
        task.id,
        task.taskName,
        task.dueDate,
        task.lastUpdateDate,
      );
      const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(url);
      const next = tasksRef.current.map((row) =>
        row.id === task.id
          ? { ...row, inquiriesSent: (row.inquiriesSent ?? 0) + 1 }
          : row,
      );
      tasksRef.current = next;
      setTasks(next);
      return { sent: true };
    },
    [args.isReadOnly, setTasks],
  );
  const applyFilters = useCallback(
    (f: Filters): void => {
      if (f.search !== undefined) setSearch(f.search);
      if (f.priority !== undefined) setPriorityFilter(f.priority);
      if (f.assignee !== undefined)
        setAssigneeFilter(f.assignee.trim() === "" ? "All" : f.assignee);
      if (f.group !== undefined)
        setGroupFilter(f.group.trim() === "" ? "All" : f.group);
      if (f.label !== undefined)
        setLabelFilter(f.label.trim() === "" ? "All" : f.label);
    },
    [
      setSearch,
      setPriorityFilter,
      setAssigneeFilter,
      setGroupFilter,
      setLabelFilter,
    ],
  );

  const dispatcher = useMemo<ToolDispatcher>(
    () => ({
      listTasks: () => tasksRef.current,
      getTask: (id) => tasksRef.current.find((row) => row.id === id) ?? null,
      createTask: (input) => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const list = tasksRef.current;
        const id =
          list.length > 0 ? Math.max(...list.map((row) => row.id)) + 1 : 1;
        const taskName = sanitizeTaskName(input.taskName);
        const assignee = sanitizeAssignee(input.assignee);
        const dueDate = sanitizeIsoDate(input.dueDate);
        if (!taskName) throw new Error("taskName is required");
        if (!assignee) throw new Error("assignee is required");
        if (!dueDate) throw new Error("dueDate must be YYYY-MM-DD");
        const email = sanitizeEmail(input.assigneeEmail);
        if (email && !isValidEmail(email))
          throw new Error("assigneeEmail is invalid");
        const newTask: Task = {
          id,
          taskName,
          assignee,
          assigneeEmail: email,
          dueDate,
          lastUpdateDate:
            sanitizeIsoDate(input.lastUpdateDate) || todayRef.current,
          priority: sanitizePriority(input.priority),
          blockers: sanitizeBlockers(input.blockers),
          notes: sanitizeNotes(input.notes),
          inquiriesSent: 0,
          group: sanitizeGroup(input.group),
          labels: sanitizeLabels(input.labels),
        };
        const next = [...list, newTask];
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        setTasks(next);
        return newTask;
      },
      updateTask: (id, patch) => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const existing = tasksRef.current.find((row) => row.id === id);
        if (!existing) return null;
        // Jira-managed fields can't be changed locally on linked tasks.
        if (existing.jiraKey) {
          if (
            patch.assignee !== undefined &&
            sanitizeAssignee(patch.assignee) !==
              sanitizeAssignee(existing.assignee)
          ) {
            throw new Error(
              `Assignee for ${existing.jiraKey} is managed in Jira. Change it in Jira and re-sync.`,
            );
          }
          if (
            patch.completedDate === undefined &&
            "completedDate" in patch &&
            existing.completedDate
          ) {
            throw new Error(
              `Reopening ${existing.jiraKey} must be done in Jira (workflow transition required).`,
            );
          }
        }
        const cleanPatch: Partial<Task> = {};
        if (patch.taskName !== undefined)
          cleanPatch.taskName = sanitizeTaskName(patch.taskName);
        if (patch.assignee !== undefined)
          cleanPatch.assignee = sanitizeAssignee(patch.assignee);
        if (patch.assigneeEmail !== undefined) {
          const e = sanitizeEmail(patch.assigneeEmail);
          if (e && !isValidEmail(e))
            throw new Error("assigneeEmail is invalid");
          cleanPatch.assigneeEmail = e;
        }
        if (patch.dueDate !== undefined) {
          const d = sanitizeIsoDate(patch.dueDate);
          if (!d) throw new Error("dueDate must be YYYY-MM-DD");
          cleanPatch.dueDate = d;
        }
        if (patch.lastUpdateDate !== undefined) {
          const d = sanitizeIsoDate(patch.lastUpdateDate);
          if (d) cleanPatch.lastUpdateDate = d;
        }
        if (patch.priority !== undefined)
          cleanPatch.priority = sanitizePriority(
            patch.priority,
            existing.priority,
          );
        if (patch.blockers !== undefined)
          cleanPatch.blockers = sanitizeBlockers(patch.blockers);
        if (patch.notes !== undefined)
          cleanPatch.notes = sanitizeNotes(patch.notes);
        if (patch.inquiriesSent !== undefined)
          cleanPatch.inquiriesSent = sanitizeNonNegInt(patch.inquiriesSent);
        if (patch.group !== undefined)
          cleanPatch.group = sanitizeGroup(patch.group);
        if (patch.labels !== undefined)
          cleanPatch.labels = sanitizeLabels(patch.labels);
        const merged: Task = {
          ...existing,
          ...cleanPatch,
          id: existing.id,
          localModifiedAt: new Date().toISOString(),
        };
        const next = tasksRef.current.map((row) =>
          row.id === id ? merged : row,
        );
        tasksRef.current = next;
        setTasks(next);
        return merged;
      },
      deleteTask: (id) => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const exists = tasksRef.current.some((row) => row.id === id);
        if (!exists) return false;
        // Mirror handleDelete's cascade: strip references to the deleted id
        // from every other task's dependency list.
        const next = tasksRef.current
          .filter((row) => row.id !== id)
          .map((row) =>
            row.dependencies &&
            row.dependencies.some((d) => d.taskId === id)
              ? {
                  ...row,
                  dependencies: row.dependencies.filter(
                    (d) => d.taskId !== id,
                  ),
                }
              : row,
          );
        tasksRef.current = next;
        setTasks(next);
        args.setSelectedIds((prev) => {
          if (!prev.has(id)) return prev;
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        if (editingIdRef.current === id) {
          setEditingId(null);
          setForm(emptyForm());
        }
        return true;
      },
      deleteAllTasks: () => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const count = tasksRef.current.length;
        tasksRef.current = [];
        setTasks([]);
        args.setSelectedIds(new Set());
        setEditingId(null);
        setForm(emptyForm());
        return count;
      },
      sendInquiry,
      setFilters: applyFilters,
      setLanguage: (l) =>
        args.setSettings((s) => ({ ...s, language: l })),
      listRaid: () => raidRef.current.map(toRaidSummary),
      listChanges: () => changesRef.current.map(toChangeSummary),
      listMilestones: () => milestonesRef.current.map(toMilestoneSummary),
      getSnapshot: () => {
        const tasks = tasksRef.current;
        const groups = new Set<string>();
        const labels = new Set<string>();
        for (const tk of tasks) {
          if (tk.group?.trim()) groups.add(tk.group);
          for (const l of tk.labels ?? []) {
            const clean = l.trim();
            if (clean) labels.add(clean);
          }
        }
        return {
          today: todayRef.current,
          language: settingsRef.current.language,
          holidayCountries: settingsRef.current.holidayCountries,
          storageKind: settingsRef.current.storageConfig.kind,
          taskCount: tasks.length,
          knownGroups: Array.from(groups).sort(),
          knownLabels: Array.from(labels).sort(),
          mode: deriveMode(settingsRef.current.features),
          enabledModules: settingsRef.current.features as FeatureModuleId[],
          currentView: viewRef.current,
        };
      },
    }),
    // Empty deps: every reactive value is read via a ref. Identity is stable.
    // Note: when Task 6 lands, audit whether any captured value still needs
    // ref-routing; the eslint-disable stays as long as the empty-deps approach
    // is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.isReadOnly],
  );

  return dispatcher;
}
