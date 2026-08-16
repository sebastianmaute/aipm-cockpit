"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
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
  toKnowledgeSummary,
  toCalendarEventSummary,
  toBudgetBucketSummary,
} from "./chat-tools";
import { resourceLogName } from "./chat-tool-summaries";
import { assertJiraManagedUnchanged, buildTaskCleanPatch } from "./chat-task-patch";
import { deriveMode, type FeatureModuleId } from "./feature-modules";
import { computeSettingsPatch } from "./chat-settings-patch";
import { useViewDigest } from "./use-view-digest";
import { buildDashboardSnapshot } from "./ai-dashboard-snapshot";
import { greetingName } from "./contacts";
import { mintId } from "./id-mint-session";
import { effectivePersonEmail } from "./resource-foundation";
import { resolveDependencyWrite } from "./task-dependency-write";
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
  sanitizePriority,
  sanitizeTaskName,
  sanitizeRaidItem,
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeStakeholder,
  sanitizeResource,
} from "./sanitize";
import { AI_RICH_FIELDS, sanitizeAiRichText, withAiRichFields } from "./ai-rich-text";
import { emptyForm, useTaskForm } from "./task-form-context";
import { applyStatusChange } from "./task-status";
import { DEFAULT_TASK_STATUS, TASK_STATUSES, type Task, type TaskStatus } from "./types";
import { useWorkspace } from "./workspace-context";
import { useDocumentTools } from "./use-document-tools";
import type { ChatDispatcherArgs } from "./chat-dispatcher-types";
export type { ChatDispatcherArgs };

const STATUS_SET = new Set<string>(TASK_STATUSES);

/** True when `v` is one of the known task statuses. */
function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && STATUS_SET.has(v);
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
    knowledgeItems,
    calendarEvents,
    budgets,
    activityLog,
    effectiveFilters,
    filteredSortedTasks,
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
  const timezoneRef = useRef(args.timezone);
  const viewRef = useRef(args.currentView);
  const editingIdRef = useRef(editingId);
  const raidRef = useRef(raid);
  const changesRef = useRef(changes);
  const milestonesRef = useRef(milestones);
  const stakeholdersRef = useRef(stakeholders);
  const resourcesRef = useRef(resources);
  const insightsRef = useRef(insights);
  const knowledgeItemsRef = useRef(knowledgeItems);
  const calendarEventsRef = useRef(calendarEvents);
  const budgetsRef = useRef(budgets);
  const activityLogRef = useRef(activityLog);
  const viewDigest = useViewDigest({
    view: args.currentView, tasks, filteredSortedTasks, effectiveFilters,
    resources, budgets, milestones, today: args.today, settings: args.settings,
    settingsProjectId: args.settingsProjectId, holidaySet: args.holidaySet,
  });
  const viewDigestRef = useRef(viewDigest);
  const getDashboardModelRef = useRef(args.getDashboardModel);
  const getBudgetRollupRef = useRef(args.getBudgetRollup);
  const getAllocationsSnapshotRef = useRef(args.getAllocationsSnapshot);
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
    timezoneRef.current = args.timezone;
  }, [args.timezone]);
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
  useEffect(() => {
    knowledgeItemsRef.current = knowledgeItems;
  }, [knowledgeItems]);
  useEffect(() => {
    calendarEventsRef.current = calendarEvents;
  }, [calendarEvents]);
  useEffect(() => {
    budgetsRef.current = budgets;
  }, [budgets]);
  useEffect(() => {
    activityLogRef.current = activityLog;
  }, [activityLog]);
  useEffect(() => {
    viewDigestRef.current = viewDigest;
  }, [viewDigest]);
  useEffect(() => {
    getDashboardModelRef.current = args.getDashboardModel;
  }, [args.getDashboardModel]);
  useEffect(() => {
    getBudgetRollupRef.current = args.getBudgetRollup;
  }, [args.getBudgetRollup]);
  useEffect(() => {
    getAllocationsSnapshotRef.current = args.getAllocationsSnapshot;
  }, [args.getAllocationsSnapshot]);

  // Helpers live inside the hook — they're not consumed anywhere else.
  // Stubbed for now; filled in by later tasks.
  // (Hoisted as useCallback for Tasks 3/5 ergonomics; other stubs stay inline.)
  // ★ Hoisted to a local const: exhaustive-deps demands the whole `args` object
  // once a callback reads TWO of its members, so depend on the member itself.
  const logActivityAs = args.logActivityAs;
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
      // ★ Same kind the USER-side path emits for this operation
      // (`use-bulk-operations.ts` handleSendInquiries), so the AI row and the
      // user row describe the same event identically. The EN string's plural
      // wording reads oddly at a count of 1 — that quirk is inherited from the
      // shared kind deliberately; a singular-only kind is not worth minting.
      logActivityAs?.("ai", "bulk.inquiries", 1);
      return { sent: true };
    },
    [args.isReadOnly, logActivityAs, setTasks],
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

  const documentTools = useDocumentTools(args.isReadOnly, args.logActivityAs);

  // ★★★ Every writer below ends its SUCCESS path with one `logActivityAs?.`
  // call, AFTER the setter and AFTER every reject guard. Arity is UNCHECKED by
  // the type system and is NOT uniform across kinds — read `logActivityAs` on
  // `ChatDispatcherArgs` before adding or editing one.

  const dispatcher = useMemo<ToolDispatcher>(
    () => ({
      ...documentTools,
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
          // ★★★ Upgrade-aware, NOT plainToHtml — see the update boundary.
          description: sanitizeAiRichText(input.description ?? input.notes),
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
        args.logActivityAs?.("ai", "task.created", newTask.id, newTask.taskName);
        return newTask;
      },
      updateTask: (id, patch) => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const existing = tasksRef.current.find((row) => row.id === id);
        if (!existing) return null;
        assertJiraManagedUnchanged(existing, patch);
        const cleanPatch = buildTaskCleanPatch(patch, existing);
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
        args.logActivityAs?.("ai", "task.updated", merged.id, merged.taskName);
        return merged;
      },
      setTaskDependencies: (id, raw) => {
        if (args.isReadOnly) throw readOnlyError();
        const list = tasksRef.current;
        const target = list.find((row) => row.id === id);
        if (!target) return null;
        const prior = target.dependencies ?? [];
        const { applied, rejected } = resolveDependencyWrite(id, raw, list);

        // Refuse a WHOLLY-DESTRUCTIVE write: nothing was applied, something
        // was rejected (a genuine "clear all" call sends an empty array with
        // nothing rejected, and that must keep working), and the task
        // currently HAS links. Writing `applied` (= []) unconditionally here
        // would delete every existing link on every refused proposal — e.g. a
        // model asked to add ONE new link that happens to close a cycle would
        // silently wipe the other links it never touched. Leave the task
        // untouched and hand back its current links so the caller can still
        // report `rejected` accurately without deleting anything.
        if (applied.length === 0 && rejected.length > 0 && prior.length > 0) {
          return { id, dependencies: prior, rejected, removed: [] };
        }

        // Every link REPLACE semantics dropped relative to what was stored
        // before this call — the set-difference the tool result surfaces so
        // a model that simply OMITTED some existing links (a routine LLM
        // slip, not a refused write) still reports the deletion instead of
        // it disappearing with no trace in the transcript.
        const removed = prior.filter(
          (d) => !applied.some((a) => a.taskId === d.taskId && a.type === d.type),
        );
        const added = applied.filter(
          (a) => !prior.some((d) => d.taskId === a.taskId && d.type === a.type),
        );

        // True no-op (same link set, nothing removed and nothing added) —
        // skip the write so an unchanged dependency list doesn't stamp a
        // fresh localModifiedAt / arm an unnecessary Jira push. Nothing
        // changed, so `removed` must stay empty too — this is not FIX A2's
        // case, there is nothing to report.
        if (removed.length === 0 && added.length === 0) {
          return { id, dependencies: prior, rejected, removed: [] };
        }

        const next = list.map((row) =>
          row.id === id
            ? { ...row, dependencies: applied, localModifiedAt: new Date().toISOString() }
            : row,
        );
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        setTasks(next);
        // ★★ THE 21st WRITER — the one a `^(create|update|delete)[A-Z]` grep
        // over this file structurally cannot find. Past BOTH early returns
        // above: each leaves the task untouched, so a row would claim an edit
        // that never landed.
        args.logActivityAs?.("ai", "task.updated", id, target.taskName);
        return { id, dependencies: applied, rejected, removed };
      },
      deleteTask: (id) => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        // `find`, not `some`: the activity row names the task, and after the
        // filter below there is nothing left to read the name off.
        const doomed = tasksRef.current.find((row) => row.id === id);
        if (!doomed) return false;
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
        args.logActivityAs?.("ai", "task.deleted", doomed.id, doomed.taskName);
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
        // ★★ ONE summarising row, never one per task: the log is a 500-entry
        // ring buffer, so N rows from one chat turn age out a week of the
        // user's own history (`jira.sync` models this shape). ★ Deleting
        // nothing is not a delete — a "0 task(s)" row is pure noise there.
        // ★★ `bulk.delete`, NOT `bulk.edit`: chat tool writes take no undo
        // capture, so this row is the only account of an irreversible mass
        // deletion and must not read as an edit.
        if (count > 0) args.logActivityAs?.("ai", "bulk.delete", count);
        return count;
      },
      sendInquiry,
      setFilters: applyFilters,
      setLanguage: (l) => {
        args.setSettings((s) => ({ ...s, language: l }));
        // A persisted `settings.language` write, so it logs the same kind
        // `updateSettings` does. NO ARGS — "Settings updated" has no
        // placeholder.
        args.logActivityAs?.("ai", "settings.updated");
      },

      updateSettings: (patch: SettingsUpdateInput) => {
        if (args.isReadOnly) throw readOnlyError();
        const cur = settingsRef.current;
        const { changes, applied } = computeSettingsPatch(patch, cur);
        if (Object.keys(applied).length > 0) {
          // Ref kept in sync (like the entity setters) so a back-to-back tool
          // call reads the just-applied settings; persistence + writeSettings
          // run in the settings-save effect, exactly as for setLanguage.
          settingsRef.current = { ...cur, ...changes };
          args.setSettings((prev) => ({ ...prev, ...changes }));
          // ★ NO ARGS — "Settings updated" has no placeholder, and the
          // user-side row omits field values too (secrets). Inside the
          // `applied` guard: a patch that changed nothing is not a change.
          args.logActivityAs?.("ai", "settings.updated");
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
          ...withAiRichFields(input, AI_RICH_FIELDS.raid),
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
        // THREE args — "RAID #{0} created ({1}): {2}".
        args.logActivityAs?.("ai", "raid.created", item.id, item.category, item.title);
        return toRaidSummary(item);
      },
      updateRaid: (id, patch) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = raidRef.current.find((r) => r.id === id);
        if (!existing) return null;
        const merged = sanitizeRaidItem({
          ...existing,
          ...withAiRichFields(patch, AI_RICH_FIELDS.raid),
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid RAID item update");
        // ★★★ Re-apply the STORED log — `sanitizeRaidItem` drops `noteLog` and cannot keep it (DOM-free). §49.
        const next = raidRef.current.map((r) => (r.id === id ? { ...merged, noteLog: existing.noteLog } : r));
        raidRef.current = next;
        setRaid(next);
        args.logActivityAs?.("ai", "raid.updated", merged.id, merged.category, merged.title);
        return toRaidSummary(merged);
      },
      deleteRaid: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        // `find`, not `some` — the row names the item, and the filter below
        // destroys the only copy of its category and title.
        const doomed = raidRef.current.find((r) => r.id === id);
        if (!doomed) return false;
        const next = raidRef.current.filter((r) => r.id !== id);
        raidRef.current = next;
        setRaid(next);
        args.logActivityAs?.("ai", "raid.deleted", doomed.id, doomed.category, doomed.title);
        return true;
      },

      createChange: (input) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("change", changesRef.current);
        const sanitized = sanitizeChangeItem({
          ...withAiRichFields(input, AI_RICH_FIELDS.change),
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
        args.logActivityAs?.("ai", "change.created", item.id, item.title);
        return toChangeSummary(item);
      },
      updateChange: (id, patch) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = changesRef.current.find((c) => c.id === id);
        if (!existing) return null;
        const merged = sanitizeChangeItem({
          ...existing,
          ...withAiRichFields(patch, AI_RICH_FIELDS.change),
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid change update");
        const next = changesRef.current.map((c) => (c.id === id ? merged : c));
        changesRef.current = next;
        setChanges(next);
        args.logActivityAs?.("ai", "change.updated", merged.id, merged.title);
        return toChangeSummary(merged);
      },
      deleteChange: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        const doomed = changesRef.current.find((c) => c.id === id);
        if (!doomed) return false;
        const next = changesRef.current.filter((c) => c.id !== id);
        changesRef.current = next;
        setChanges(next);
        args.logActivityAs?.("ai", "change.deleted", doomed.id, doomed.title);
        return true;
      },

      createMilestone: (input) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("milestone", milestonesRef.current);
        const item = sanitizeMilestone({
          ...withAiRichFields(input, AI_RICH_FIELDS.milestone),
          id,
          linkedTaskIds: input.linkedTaskIds ?? [],
        });
        if (!item) throw new Error("invalid milestone: name and date (YYYY-MM-DD) are required");
        const next = [...milestonesRef.current, item];
        milestonesRef.current = next;
        setMilestones(next);
        // ★ CREATE is the two-arg outlier ("Created milestone #{0} – {1}");
        // update and delete take the id ALONE — see below.
        args.logActivityAs?.("ai", "milestone.created", item.id, item.name);
        return toMilestoneSummary(item);
      },
      updateMilestone: (id, patch) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = milestonesRef.current.find((m) => m.id === id);
        if (!existing) return null;
        const merged = sanitizeMilestone({
          ...existing,
          ...withAiRichFields(patch, AI_RICH_FIELDS.milestone),
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid milestone update");
        const next = milestonesRef.current.map((m) => (m.id === id ? merged : m));
        milestonesRef.current = next;
        setMilestones(next);
        // ★★ ONE arg. "Updated milestone #{0}" has no {1}, and
        // milestones-panel.tsx passes the id alone — a name would be dropped
        // silently and make the AI row and the user row disagree.
        args.logActivityAs?.("ai", "milestone.updated", merged.id);
        return toMilestoneSummary(merged);
      },
      deleteMilestone: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        if (!milestonesRef.current.some((m) => m.id === id)) return false;
        const next = milestonesRef.current.filter((m) => m.id !== id);
        milestonesRef.current = next;
        setMilestones(next);
        // ★★ ONE arg — "Deleted milestone #{0}", same as the panel's own row.
        args.logActivityAs?.("ai", "milestone.deleted", id);
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
        args.logActivityAs?.("ai", "stakeholder.created", item.id, item.name);
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
        args.logActivityAs?.("ai", "stakeholder.updated", merged.id, merged.name);
        return toStakeholderSummary(merged);
      },
      deleteStakeholder: (id) => {
        if (args.isReadOnly) throw readOnlyError();
        const doomed = stakeholdersRef.current.find((s) => s.id === id);
        if (!doomed) return false;
        const next = stakeholdersRef.current.filter((s) => s.id !== id);
        stakeholdersRef.current = next;
        setStakeholders(next);
        args.logActivityAs?.("ai", "stakeholder.deleted", doomed.id, doomed.name);
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
        args.logActivityAs?.("ai", "resource.created", item.id, resourceLogName(item));
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
        args.logActivityAs?.("ai", "resource.updated", merged.id, resourceLogName(merged));
        return toResourceSummary(merged);
      },
      deleteResource: (id: number) => {
        if (args.isReadOnly) throw readOnlyError();
        const doomed = resourcesRef.current.find((r) => r.id === id);
        if (!doomed) return false;
        const next = resourcesRef.current.filter((r) => r.id !== id);
        resourcesRef.current = next;
        setResources(next);
        args.logActivityAs?.("ai", "resource.deleted", doomed.id, resourceLogName(doomed));
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
          // Assembled by useViewDigest — it needs pane state this hook does not
          // hold (health filter, debounced search, effective view mode) to name
          // the rows the pane is ACTUALLY rendering. See use-view-digest.ts.
          // ★ Unlike the entity refs above — which tool handlers update
          // SYNCHRONOUSLY so back-to-back calls see fresh data — this one is
          // written by an effect, so it can lag one render. Harmless for the
          // system prompt (built once per send, well after effects flush); a
          // `get_app_state` called mid-turn right after a create can return a
          // digest that predates that write. Not worth a synchronous mirror:
          // the digest describes the SCREEN, which has not repainted yet either.
          viewDigest: viewDigestRef.current,
        };
      },

      getActivityLog: () => activityLogRef.current,

      getTimezone: () => timezoneRef.current,

      getDashboardSnapshot: () =>
        buildDashboardSnapshot(
          getDashboardModelRef.current(),
          getBudgetRollupRef.current(),
          todayRef.current,
        ),

      listAllocations: () => getAllocationsSnapshotRef.current(),

      listKnowledgeItems: () => (knowledgeItemsRef.current ?? []).map(toKnowledgeSummary),
      listCalendarEvents: () => (calendarEventsRef.current ?? []).map(toCalendarEventSummary),
      listBudgetBuckets: () => (budgetsRef.current ?? []).map(toBudgetBucketSummary),
    }),
    // Empty deps otherwise: every reactive value is read via a ref. Identity is
    // stable. `documentTools` is a REAL dep, not a ref-routed value — it is
    // itself a useMemo'd object (use-document-tools.ts) that changes identity
    // when isReadOnly/mutateDocuments change, and the spread above captures it
    // by closure; omitting it here would freeze the FIRST render's document
    // tools into every later dispatcher even after a popout toggled read-only.
    // Note: when Task 6 lands, audit whether any captured value still needs
    // ref-routing; the eslint-disable stays as long as the empty-deps approach
    // is intentional for everything else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.isReadOnly, documentTools],
  );

  return dispatcher;
}
