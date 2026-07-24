"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  type Filters,
  type ToolDispatcher,
  type ResourceInput,
  type SettingsUpdateInput,
  toRaidSummary,
  toChangeSummary,
  toMilestoneSummary,
  toStakeholderSummary,
  toResourceSummary,
} from "./chat-tools";
import { deriveMode, sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";
import { greetingName } from "./contacts";
import { mintId } from "./id-mint-session";
import { effectivePersonEmail } from "./resource-foundation";
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
  sanitizeRaidItem,
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeStakeholder,
  sanitizeResource,
} from "./sanitize";
import { plainToHtml } from "./sanitize-html";
import {
  NEXT_ACTIONS_FIELD_COERCE,
  resolveNextActionsConfig,
  type NextActionsConfig,
  type Settings,
} from "./settings-types";
import { emptyForm, useTaskForm } from "./task-form-context";
import { applyStatusChange } from "./task-status";
import { DEFAULT_TASK_STATUS, TASK_STATUSES, type Task, type TaskStatus } from "./types";
import { useWorkspace } from "./workspace-context";

const STATUS_SET = new Set<string>(TASK_STATUSES);

/** True when `v` is one of the known task statuses. */
function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && STATUS_SET.has(v);
}

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
  const {
    tasks,
    setTasks,
    raid,
    setRaid,
    changes,
    setChanges,
    milestones,
    setMilestones,
    stakeholders,
    setStakeholders,
    resources,
    setResources,
    insights,
  } = useWorkspace();
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
  const stakeholdersRef = useRef(stakeholders);
  const resourcesRef = useRef(resources);
  const insightsRef = useRef(insights);
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
  useEffect(() => {
    stakeholdersRef.current = stakeholders;
  }, [stakeholders]);
  useEffect(() => {
    resourcesRef.current = resources;
  }, [resources]);
  useEffect(() => {
    insightsRef.current = insights;
  }, [insights]);

  // Helpers live inside the hook — they're not consumed anywhere else.
  // Stubbed for now; filled in by later tasks.
  // (Hoisted as useCallback for Tasks 3/5 ergonomics; other stubs stay inline.)
  const sendInquiry = useCallback(
    (id: number): { sent: boolean; reason?: string } => {
      if (args.isReadOnly) return { sent: false, reason: "read-only" };
      const task = tasksRef.current.find((row) => row.id === id);
      if (!task) return { sent: false, reason: "task-not-found" };
      // Prefer the linked resource's CURRENT email; cached assigneeEmail can be
      // stale after a rename/re-link.
      const resById = new Map(resourcesRef.current.map((r) => [r.id, r]));
      let email = effectivePersonEmail(task.assigneeEmail ?? "", task.resourceId, resById).trim();
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

  // Shared read-only refusal for the write tools (popout/mirror windows).
  const readOnlyError = () =>
    new Error(t(settingsRef.current.language, "popoutReadOnly"));

  const dispatcher = useMemo<ToolDispatcher>(
    () => ({
      listTasks: () => tasksRef.current,
      getTask: (id) => tasksRef.current.find((row) => row.id === id) ?? null,
      createTask: (input) => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const list = tasksRef.current;
        const id = mintId("task", list);
        const taskName = sanitizeTaskName(input.taskName);
        const assignee = sanitizeAssignee(input.assignee);
        const dueDate = sanitizeIsoDate(input.dueDate);
        if (!taskName) throw new Error("taskName is required");
        if (!assignee) throw new Error("assignee is required");
        if (!dueDate) throw new Error("dueDate must be YYYY-MM-DD");
        const email = sanitizeEmail(input.assigneeEmail);
        if (email && !isValidEmail(email))
          throw new Error("assigneeEmail is invalid");
        const baseTask: Task = {
          id,
          taskName,
          assignee,
          assigneeEmail: email,
          dueDate,
          lastUpdateDate:
            sanitizeIsoDate(input.lastUpdateDate) || todayRef.current,
          priority: sanitizePriority(input.priority),
          status: DEFAULT_TASK_STATUS,
          blockers: sanitizeBlockers(input.blockers),
          // Model supplies plain text → wrap to sanitized HTML for `description`.
          description: plainToHtml(sanitizeNotes(input.description ?? input.notes)),
          inquiriesSent: 0,
          group: sanitizeGroup(input.group),
          labels: sanitizeLabels(input.labels),
        };
        // A model-supplied status routes through applyStatusChange (the sole
        // writer of status + completedDate) so e.g. Done stamps completedDate.
        // An invalid value falls back to the default.
        const newTask = isTaskStatus(input.status)
          ? applyStatusChange(baseTask, input.status, todayRef.current)
          : baseTask;
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
          if (
            patch.status !== undefined &&
            patch.status !== existing.status
          ) {
            throw new Error(
              `Status for ${existing.jiraKey} is managed in Jira; change it via the Jira workflow and re-sync.`,
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
        // buildPatch carries the model's plain text through as `description`;
        // wrap it to sanitized HTML here (the single write boundary).
        if (patch.description !== undefined)
          cleanPatch.description = plainToHtml(sanitizeNotes(patch.description));
        if (patch.inquiriesSent !== undefined)
          cleanPatch.inquiriesSent = sanitizeNonNegInt(patch.inquiriesSent);
        if (patch.group !== undefined)
          cleanPatch.group = sanitizeGroup(patch.group);
        if (patch.labels !== undefined)
          cleanPatch.labels = sanitizeLabels(patch.labels);
        const mergedBase: Task = {
          ...existing,
          ...cleanPatch,
          id: existing.id,
          localModifiedAt: new Date().toISOString(),
        };
        // A valid status change routes through applyStatusChange — the sole
        // writer of status + completedDate (keeps the Done⟺completedDate
        // invariant). Invalid values are ignored (status left unchanged).
        const merged = isTaskStatus(patch.status)
          ? applyStatusChange(mergedBase, patch.status, todayRef.current)
          : mergedBase;
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

      updateSettings: (patch: SettingsUpdateInput) => {
        if (args.isReadOnly) throw readOnlyError();
        const cur = settingsRef.current;
        // Accumulate ONLY the changed top-level fields, so the functional setter
        // below merges them onto the LIVE `prev` — a concurrent non-AI settings
        // edit in the same tick keeps its own fields instead of being clobbered.
        const changes: Partial<Settings> = {};
        const applied: Record<string, unknown> = {};

        if (patch.dashboardDensity === "comfortable" || patch.dashboardDensity === "compact") {
          changes.dashboardDensity = patch.dashboardDensity;
          applied.dashboardDensity = patch.dashboardDensity;
        }
        if (typeof patch.showViewHints === "boolean") {
          changes.showViewHints = patch.showViewHints;
          applied.showViewHints = patch.showViewHints;
        }
        if (patch.tasksViewMode === "table" || patch.tasksViewMode === "board") {
          changes.tasksViewMode = patch.tasksViewMode;
          applied.tasksViewMode = patch.tasksViewMode;
        }
        if (typeof patch.hideExternalTasks === "boolean") {
          changes.hideExternalTasks = patch.hideExternalTasks;
          applied.hideExternalTasks = patch.hideExternalTasks;
        }
        if (patch.enabledModules !== undefined) {
          // sanitizeFeatures drops any unknown/invalid module id — a hallucinated
          // id can never enable a non-existent module.
          const feats = sanitizeFeatures(patch.enabledModules);
          changes.features = feats;
          applied.enabledModules = feats;
        }
        if (patch.nextActionsWeights && typeof patch.nextActionsWeights === "object") {
          const curCfg = resolveNextActionsConfig(cur.nextActions);
          const cfg: NextActionsConfig = { ...curCfg };
          const appliedWeights: Record<string, number> = {};
          for (const [k, v] of Object.entries(
            patch.nextActionsWeights as Record<string, unknown>,
          )) {
            // Only known tuning fields, each clamped by its own coercer — the
            // SAME validators the settings UI uses. Unknown keys are ignored.
            if (Object.prototype.hasOwnProperty.call(NEXT_ACTIONS_FIELD_COERCE, k)) {
              const key = k as keyof NextActionsConfig;
              const coerced = NEXT_ACTIONS_FIELD_COERCE[key](v, curCfg[key]);
              cfg[key] = coerced;
              appliedWeights[k] = coerced;
            }
          }
          if (Object.keys(appliedWeights).length > 0) {
            changes.nextActions = cfg;
            applied.nextActionsWeights = appliedWeights;
          }
        }

        if (Object.keys(applied).length > 0) {
          // Ref kept in sync (like the entity setters) so a back-to-back tool
          // call reads the just-applied settings; persistence + writeSettings
          // run in the settings-save effect, exactly as for setLanguage.
          settingsRef.current = { ...cur, ...changes };
          args.setSettings((prev) => ({ ...prev, ...changes }));
        }
        return applied;
      },
      listRaid: () => raidRef.current.map(toRaidSummary),
      listChanges: () => changesRef.current.map(toChangeSummary),
      listMilestones: () => milestonesRef.current.map(toMilestoneSummary),
      listStakeholders: () => stakeholdersRef.current.map(toStakeholderSummary),

      createRaid: (input) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("raid", raidRef.current);
        const sanitized = sanitizeRaidItem({
          ...input,
          id,
          raisedDate: input.raisedDate || todayRef.current,
          linkedTaskIds: input.linkedTaskIds ?? [],
          causedByRaidIds: input.causedByRaidIds ?? [],
          stakeholderIds: input.stakeholderIds ?? [],
        });
        if (!sanitized) throw new Error("invalid RAID item: title is required");
        // A malformed date the model supplied is dropped to "" by the sanitizer;
        // fall back to today so a created item always carries a raised date.
        const item = sanitized.raisedDate
          ? sanitized
          : { ...sanitized, raisedDate: todayRef.current };
        const next = [...raidRef.current, item];
        raidRef.current = next;
        setRaid(next);
        return toRaidSummary(item);
      },
      updateRaid: (id, patch) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = raidRef.current.find((r) => r.id === id);
        if (!existing) return null;
        const merged = sanitizeRaidItem({
          ...existing,
          ...patch,
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid RAID item update");
        const next = raidRef.current.map((r) => (r.id === id ? merged : r));
        raidRef.current = next;
        setRaid(next);
        return toRaidSummary(merged);
      },
      deleteRaid: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        if (!raidRef.current.some((r) => r.id === id)) return false;
        const next = raidRef.current.filter((r) => r.id !== id);
        raidRef.current = next;
        setRaid(next);
        return true;
      },

      createChange: (input) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("change", changesRef.current);
        const sanitized = sanitizeChangeItem({
          ...input,
          id,
          raisedDate: input.raisedDate || todayRef.current,
          linkedTaskIds: input.linkedTaskIds ?? [],
          linkedRaidIds: input.linkedRaidIds ?? [],
          stakeholderIds: input.stakeholderIds ?? [],
        });
        if (!sanitized) throw new Error("invalid change: title is required");
        const item = sanitized.raisedDate
          ? sanitized
          : { ...sanitized, raisedDate: todayRef.current };
        const next = [...changesRef.current, item];
        changesRef.current = next;
        setChanges(next);
        return toChangeSummary(item);
      },
      updateChange: (id, patch) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = changesRef.current.find((c) => c.id === id);
        if (!existing) return null;
        const merged = sanitizeChangeItem({
          ...existing,
          ...patch,
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid change update");
        const next = changesRef.current.map((c) => (c.id === id ? merged : c));
        changesRef.current = next;
        setChanges(next);
        return toChangeSummary(merged);
      },
      deleteChange: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        if (!changesRef.current.some((c) => c.id === id)) return false;
        const next = changesRef.current.filter((c) => c.id !== id);
        changesRef.current = next;
        setChanges(next);
        return true;
      },

      createMilestone: (input) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("milestone", milestonesRef.current);
        const item = sanitizeMilestone({
          ...input,
          id,
          linkedTaskIds: input.linkedTaskIds ?? [],
        });
        if (!item) throw new Error("invalid milestone: name and date (YYYY-MM-DD) are required");
        const next = [...milestonesRef.current, item];
        milestonesRef.current = next;
        setMilestones(next);
        return toMilestoneSummary(item);
      },
      updateMilestone: (id, patch) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = milestonesRef.current.find((m) => m.id === id);
        if (!existing) return null;
        const merged = sanitizeMilestone({
          ...existing,
          ...patch,
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid milestone update");
        const next = milestonesRef.current.map((m) => (m.id === id ? merged : m));
        milestonesRef.current = next;
        setMilestones(next);
        return toMilestoneSummary(merged);
      },
      deleteMilestone: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        if (!milestonesRef.current.some((m) => m.id === id)) return false;
        const next = milestonesRef.current.filter((m) => m.id !== id);
        milestonesRef.current = next;
        setMilestones(next);
        return true;
      },

      createStakeholder: (input) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("stakeholder", stakeholdersRef.current);
        const item = sanitizeStakeholder({ ...input, id, raci: {} });
        if (!item) throw new Error("invalid stakeholder: name is required");
        const next = [...stakeholdersRef.current, item];
        stakeholdersRef.current = next;
        setStakeholders(next);
        return toStakeholderSummary(item);
      },
      updateStakeholder: (id, patch) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = stakeholdersRef.current.find((s) => s.id === id);
        if (!existing) return null;
        const merged = sanitizeStakeholder({
          ...existing,
          ...patch,
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid stakeholder update");
        const next = stakeholdersRef.current.map((s) => (s.id === id ? merged : s));
        stakeholdersRef.current = next;
        setStakeholders(next);
        return toStakeholderSummary(merged);
      },
      deleteStakeholder: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        if (!stakeholdersRef.current.some((s) => s.id === id)) return false;
        const next = stakeholdersRef.current.filter((s) => s.id !== id);
        stakeholdersRef.current = next;
        setStakeholders(next);
        return true;
      },

      listResources: () => resourcesRef.current.map(toResourceSummary),
      createResource: (input: ResourceInput) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("resource", resourcesRef.current);
        // sanitizeResource fills roleId/utilization defaults; returns null with
        // no first/last name (or splittable full name).
        const item = sanitizeResource({ ...input, id });
        if (!item) throw new Error("invalid resource: first or last name is required");
        const next = [...resourcesRef.current, item];
        resourcesRef.current = next;
        setResources(next);
        return toResourceSummary(item);
      },
      getResource: (id: number) => {
        const found = resourcesRef.current.find((r) => r.id === id);
        return found ? toResourceSummary(found) : null;
      },
      updateResource: (id: number, patch: Partial<ResourceInput>) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = resourcesRef.current.find((r) => r.id === id);
        if (!existing) return null;
        const merged = sanitizeResource({
          ...existing,
          ...patch,
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid resource update");
        const next = resourcesRef.current.map((r) => (r.id === id ? merged : r));
        resourcesRef.current = next;
        setResources(next);
        return toResourceSummary(merged);
      },
      deleteResource: (id: number) => {
        if (args.isReadOnly) throw readOnlyError();
        if (!resourcesRef.current.some((r) => r.id === id)) return false;
        const next = resourcesRef.current.filter((r) => r.id !== id);
        resourcesRef.current = next;
        setResources(next);
        return true;
      },

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
          insights: insightsRef.current ?? [],
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
