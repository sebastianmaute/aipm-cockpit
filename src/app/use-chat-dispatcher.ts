"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type Filters,
  type ToolDispatcher,
  type ResourceInput,
  type SettingsUpdateInput,
  toResourceSummary,
  toKnowledgeSummary,
  toCalendarEventSummary,
  toBudgetBucketSummary,
} from "./chat-tools";
import { resourceLogName } from "./chat-tool-summaries";
import { historySearchEnabled } from "./settings-types";
import { summarizeForRecap } from "./activity-recap";
import { assertJiraManagedUnchanged, buildTaskCleanPatch } from "./chat-task-patch";
import { deriveMode, type FeatureModuleId } from "./feature-modules";
import { computeSettingsPatch } from "./chat-settings-patch";
import { useViewDigest } from "./use-view-digest";
import { useChatSearchBindings } from "./use-chat-search-bindings";
import { buildDashboardSnapshot } from "./ai-dashboard-snapshot";
import { greetingName } from "./contacts";
import { mintId } from "./id-mint-session";
import { effectivePersonEmail, splitName } from "./resource-foundation";
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
  sanitizeResource,
} from "./sanitize";
import { sanitizeAiRichText } from "./ai-rich-text";
import { emptyForm, useTaskForm } from "./task-form-context";
import { applyStatusChange, statusActivityKind } from "./task-status";
import { capturePart } from "./undo/use-undo-stack";
import { DEFAULT_TASK_STATUS, TASK_STATUSES, type Task, type TaskStatus } from "./types";
import { useWorkspace } from "./workspace-context";
import { useDocumentTools } from "./use-document-tools";
import { useRegisterTools } from "./use-register-tools";
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
    milestones,
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
  // ★★★ ONE ref, not two (§159) — separate `today`/`timezone` refs are what let an inconsistent pair exist.
  const clockRef = useRef(args.clock);
  const viewRef = useRef(args.currentView);
  const editingIdRef = useRef(editingId);
  const resourcesRef = useRef(resources);
  const insightsRef = useRef(insights);
  const knowledgeItemsRef = useRef(knowledgeItems);
  const calendarEventsRef = useRef(calendarEvents);
  const budgetsRef = useRef(budgets);
  const activityLogRef = useRef(activityLog);
  const viewDigest = useViewDigest({
    view: args.currentView, tasks, filteredSortedTasks, effectiveFilters,
    resources, budgets, milestones, today: args.clock.today, settings: args.settings,
    settingsProjectId: args.settingsProjectId, holidaySet: args.holidaySet,
  });
  const viewDigestRef = useRef(viewDigest);
  const chatBindings = useChatSearchBindings(args.settingsProjectId, args.settings, args.clock);
  const getDashboardModelRef = useRef(args.getDashboardModel);
  const getBudgetRollupRef = useRef(args.getBudgetRollup);
  const getAllocationsSnapshotRef = useRef(args.getAllocationsSnapshot);
  const undoRef = useRef(args.undo);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    settingsRef.current = args.settings;
  }, [args.settings]);
  useEffect(() => {
    clockRef.current = args.clock;
  }, [args.clock]);
  useEffect(() => {
    viewRef.current = args.currentView;
  }, [args.currentView]);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);
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
  useEffect(() => {
    undoRef.current = args.undo;
  }, [args.undo]);

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

  const documentTools = useDocumentTools(args.isReadOnly, args.logActivityAs, args.allowDestructiveSave);
  // ★ The two refs are PASSED, not re-minted there — use-register-tools.ts's
  // header says why. Its own four register refs live in that file.
  const registerTools = useRegisterTools({
    isReadOnly: args.isReadOnly,
    logActivityAs: args.logActivityAs,
    allowDestructiveSave: args.allowDestructiveSave,
    clockRef,
    settingsRef,
    // ★★ The REF, never `args.undo` itself. That hook memoizes on an exhaustive
    // dep list that deliberately carries no ref objects; handing it the live
    // value would either go stale inside the memo or force `args.undo` into
    // that dep array, recomputing every register writer whenever the undo API
    // identity moves. A ref object's identity never moves, so this costs
    // nothing and reads the current value at call time.
    undoRef,
  });

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
            sanitizeIsoDate(input.lastUpdateDate) || clockRef.current.today,
          priority: sanitizePriority(input.priority),
          status: DEFAULT_TASK_STATUS,
          blockers: sanitizeBlockers(input.blockers),
          // ★★★ Upgrade-aware, NOT plainToHtml — see the update boundary.
          description: sanitizeAiRichText(input.description ?? input.notes),
          inquiriesSent: 0,
          group: sanitizeGroup(input.group),
          labels: sanitizeLabels(input.labels),
        };
        // A model-supplied status routes through applyStatusChange (it keeps
        // the Done/completedDate invariant) so e.g. Done stamps completedDate.
        // An invalid value falls back to the default.
        const newTask = isTaskStatus(input.status)
          ? applyStatusChange(baseTask, input.status, clockRef.current.today)
          : baseTask;
        const next = [...list, newTask];
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        // ★★★ NO UNDO CAPTURE HERE, AND THAT IS THE DESIGN. `UndoOp` is
        //   "delete" | "edit" ONLY (`undo/undo-stack.ts`) — the engine has no
        //   create op, and `use-undo-stack.ts` says so outright ("created rows
        //   are excluded entirely … no entity in the app captures a create").
        //   Capturing a create as a `removed` image is WORSE than capturing
        //   nothing: the row is still live at undo time, so
        //   `applyUndoRestoreWithRemap` takes its id-reuse branch, mints max+1
        //   and splices in a SECOND copy — undoing the create DUPLICATES the
        //   row. Measured against the real engine, not reasoned: seeding two
        //   rows, creating a third and undoing yields FOUR rows. Adding a
        //   capture here is a regression, not a completion of the pattern.
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
        // A valid status change routes through applyStatusChange, which keeps
        // the Done/completedDate invariant. Invalid values are ignored
        // (status left unchanged).
        const merged = isTaskStatus(patch.status)
          ? applyStatusChange(mergedBase, patch.status, clockRef.current.today)
          : mergedBase;
        const next = tasksRef.current.map((row) =>
          row.id === id ? merged : row,
        );
        // Captured from `existing` — the stored row BEFORE the merge — and
        // against `tasksRef.current`, which is still the PRE-op array because
        // this sits ABOVE the reassignment below. Both halves matter: capturing
        // `merged`/`mergedBase` would store the NEW values as the "before"
        // image, and undo would silently revert to what is already there.
        // ★ Unlike a create, an EDIT image is index-insensitive here — `.map`
        //   is position-preserving, so the row sits at the same index in the
        //   pre- and post-op arrays and `buildBeforeImages` resolves the same
        //   number either way. The pre-op array is used regardless, because
        //   that is the contract `buildBeforeImages` documents.
        undoRef.current?.captureComposite({
          kind: "task.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setTasks,
            edited: [existing],
            fromArray: tasksRef.current,
            isPrimary: true,
          })],
          name: existing.taskName,
          entityKey: "task",
        });
        tasksRef.current = next;
        setTasks(next);
        args.logActivityAs?.("ai", "task.updated", merged.id, merged.taskName);
        // ★ The `"ai"` actor is required: this file logs MODEL writes, and
        // threading the user actor here would misattribute them.
        const transition = statusActivityKind(existing, merged);
        if (transition) args.logActivityAs?.("ai", transition, merged.id, merged.taskName);
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
        // ★★ Captured HERE, not at the top of the body: all THREE early returns
        // above leave the task untouched, and an undo entry for a write that
        // never landed is worse than none — the user is offered a revert that
        // silently rewrites the row to a state it never left.
        // `list` is the PRE-op array (`tasksRef.current` read before the
        // reassignment below), and `target` is the STORED row, so the image
        // holds `prior` dependencies rather than `applied`.
        undoRef.current?.captureComposite({
          kind: "task.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setTasks,
            edited: [target],
            fromArray: list,
            isPrimary: true,
          })],
          name: target.taskName,
          entityKey: "task",
        });
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
        // ★★ COMPOSITE IN ONE PART, NOT TWO: the delete removes `doomed` AND
        // edits every dependent whose `dependencies[]` named it, both in the
        // SAME array — so one `capturePart` carries `removed` and `edited`
        // together. Capturing only `removed` resurrects the task with every
        // inbound link still stripped, which reads as a successful undo and is
        // not one. Mirrors the human path exactly (`use-task-row-handlers.ts`
        // `onDelete`, which derives `dependents` the same way).
        // `tasksRef.current` is still the PRE-op array here — the reassignment
        // is below — which is what makes `doomed`'s captured index its true one.
        const dependents = tasksRef.current.filter((row) =>
          row.dependencies?.some((d) => d.taskId === id),
        );
        undoRef.current?.captureComposite({
          kind: "task.deleted",
          primaryCount: 1,
          parts: [capturePart({
            setter: setTasks,
            removed: [doomed],
            edited: dependents,
            fromArray: tasksRef.current,
            isPrimary: true,
          })],
          name: doomed.taskName,
          entityKey: "task",
        });
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
        // ★★ Arm the one-shot destructive-save bypass ONLY on a real removal.
        //    Tasks count toward the save-time guards, and several delete_task
        //    calls in one assistant turn land in a single save debounce window
        //    — five removals leaving at most a tenth is a mass deletion by
        //    Layer B's arithmetic, and this IS the deliberate action the
        //    bypass exists for. Arming on a no-op would leak the one-shot
        //    until some later accidental wipe spent it (documents-panel.tsx
        //    carries the same reasoning at its own arming site).
        args.allowDestructiveSave?.();
        return true;
      },
      deleteAllTasks: () => {
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const count = tasksRef.current.length;
        // Captured ABOVE the reassignment, so `fromArray` is the pre-op array
        // and every row keeps its own index. Guarded on `count > 0` for the
        // same reason the activity row below is: clearing nothing is not a
        // clear, and an empty capture would push an undo entry that reverses
        // nothing. (`capturePart` returns null for an empty image and
        // `captureComposite` skips an all-null `parts`, so this guard is belt
        // and braces — but the `count` read below is the honest witness.)
        if (count > 0) {
          undoRef.current?.captureComposite({
            // ★★★ `task.deleted`, NOT the `bulk.delete` this once carried, and
            // the distinction is the ACTIVITY vocabulary versus the UNDO one.
            // The human mass delete keeps them apart deliberately
            // (`use-bulk-operations.ts`): it CAPTURES `task.deleted` with a
            // count and LOGS `bulk.delete` separately — see the `logActivityAs`
            // call below, which still uses the activity kind and is correct.
            // Reusing the activity kind here made this the first thing in the
            // codebase ever to hand `pushEntry` a `bulk.delete`, and both
            // renderers pick their verb with a `.deleted` suffix test that
            // `"bulk.delete"` fails — so a wipe-everything announced itself as
            // "Edited 3 item(s)", in the label AND the toast.
            // ★★ `entityKey` did not save it, and the way it failed is the part
            // worth keeping: it chooses the NOUN, never the VERB. With
            // `entityKey: "task"` the label took the ENTITY arm, resolved the
            // noun, then fell past every verb branch to that arm's own
            // `undoToastEdit` fallback — the SAME string the no-entityKey
            // generic arm produces. The noun was resolved and then discarded,
            // so supplying `entityKey` bought literally nothing.
            kind: "task.deleted",
            primaryCount: count,
            parts: [capturePart({
              setter: setTasks,
              removed: tasksRef.current,
              fromArray: tasksRef.current,
              isPrimary: true,
            })],
            entityKey: "task",
          });
        }
        tasksRef.current = [];
        setTasks([]);
        args.setSelectedIds(new Set());
        setEditingId(null);
        setForm(emptyForm());
        // ★★ ONE summarising row, never one per task: the log is a 500-entry
        // ring buffer, so N rows from one chat turn age out a week of the
        // user's own history (`jira.sync` models this shape). ★ Deleting
        // nothing is not a delete — a "0 task(s)" row is pure noise there.
        // ★★ `bulk.delete`, NOT `bulk.edit`: this is a mass deletion and must
        // not read as an edit. ★ The clause that used to justify this — "chat
        // tool writes take no undo capture, so this row is the only account of
        // an irreversible mass deletion" — was TRUE when written and is now
        // false: the capture sits a few lines above. The KIND is unchanged and
        // still right; only the reason was stale. An undo entry expires with
        // the session, so the activity row remains the durable account.
        if (count > 0) {
          args.logActivityAs?.("ai", "bulk.delete", count);
          // Clearing every task is the archetypal case the bypass exists for.
          // Gated on `count > 0` for the same reason the activity row is:
          // deleting nothing is not a delete, and arming for it leaks a
          // one-shot that no save will spend.
          args.allowDestructiveSave?.();
        }
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
        args.onSettingsLoggedByAi?.(); // §160 — suppress the debounced duplicate.
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
          // ★ §160 — inside the SAME `applied` guard, so a credit is only ever issued
          //   alongside a real settings-identity change (see its contract note).
          args.onSettingsLoggedByAi?.();
        }
        return applied;
      },
      ...registerTools,

      listResources: () => resourcesRef.current.map(toResourceSummary),
      createResource: (input: ResourceInput) => {
        if (args.isReadOnly) throw readOnlyError();
        const id = mintId("resource", resourcesRef.current);
        // sanitizeResource fills roleId/utilization defaults; returns null with
        // no first/last name (or splittable full name).
        const item = sanitizeResource({ ...input, id });
        if (!item) throw new Error("invalid resource: first or last name is required");
        const next = [...resourcesRef.current, item];
        // ★★★ NO undo capture, deliberately — same reasoning as `createTask`
        // above, in full there: `UndoOp` is "delete" | "edit", so a captured
        // create would DUPLICATE the row on undo rather than remove it.
        resourcesRef.current = next;
        setResources(next);
        args.logActivityAs?.("ai", "resource.created", item.id, resourceLogName(item));
        return toResourceSummary(item);
      },
      getResource: (id: number) => {
        const found = resourcesRef.current.find((r) => r.id === id);
        return found ? toResourceSummary(found) : null;
      },
      // The FULL row, for the concurrency token only. `getResource` above is
      // the model-facing read and returns a SUMMARY, which drops fields an
      // edit can touch — hashing that would be a false PERMIT for each one.
      getResourceRow: (id) => resourcesRef.current.find((r) => r.id === id) ?? null,
      updateResource: (id: number, patch: Partial<ResourceInput>) => {
        if (args.isReadOnly) throw readOnlyError();
        const existing = resourcesRef.current.find((r) => r.id === id);
        if (!existing) return null;
        // ★★★ `name` HAS TO BE SPLIT HERE OR IT IS A SILENT NO-OP ON UPDATE, and
        // it was one. `ResourceInput.name` is documented as "split into
        // first/last when the parts aren't given", and `sanitizeResource`
        // honours that — but only when firstName AND lastName are both empty,
        // because it is a FALLBACK. On an update the spread below merges over
        // `existing`, which always supplies at least one of them (the sanitizer
        // rejects a resource with neither), so the fallback could never fire and
        // `update_resource({name: "Grace Hopper"})` returned SUCCESS with the old
        // name intact — the model is told the rename worked and cannot see that
        // it did not. Create was unaffected: there is no `existing` to merge.
        // ★ Deliberately does NOT override explicit parts: a caller passing
        // firstName/lastName means those, and `name` stays the convenience form.
        // ★ A blank `name` is ignored rather than applied — splitting it yields
        // two empty parts, which the sanitizer rejects, turning a meaningless
        // request into a failed write of every other field in the same patch.
        // ★★ THE PART TESTS ARE `typeof … !== "string"`, NOT `=== undefined`,
        // because a JSON `null` is neither. With `=== undefined`, a payload of
        // `{name: "Grace Hopper", firstName: null}` skipped the split AND then
        // spread `firstName: null` over the stored row, which `sanitizeResource`
        // reduces to `""` — the rename silently dropped and the first name
        // WIPED, with the surviving last name keeping the record valid enough
        // to save. Measured before the fix: `{f: "", l: "Lovelace"}`. Any
        // non-string part now falls through to the split, which is the
        // behaviour the schema advertises.
        const renamed =
          typeof patch.name === "string"
          && patch.name.trim() !== ""
          && typeof patch.firstName !== "string"
          && typeof patch.lastName !== "string"
            ? splitName(patch.name)
            : null;
        const merged = sanitizeResource({
          ...existing,
          ...patch,
          ...(renamed ?? {}),
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid resource update");
        const next = resourcesRef.current.map((r) => (r.id === id ? merged : r));
        // `existing` is the STORED row (pre-merge) and `resourcesRef.current`
        // is still the PRE-op array — the reassignment is below. Capturing
        // `merged` would store the new values as the "before" image and undo
        // would be a silent no-op.
        undoRef.current?.captureComposite({
          kind: "resource.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setResources,
            edited: [existing],
            fromArray: resourcesRef.current,
            isPrimary: true,
          })],
          name: resourceLogName(existing),
          entityKey: "resource",
        });
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
        // ★★ ONE part, unlike the HUMAN resource delete
        // (`use-resource-directory.ts`), whose composite also re-inserts the
        // absences and shifts its own cascade purged. This path runs no such
        // purge — it filters the resources array and nothing else — so a
        // calendar part here would capture rows that were never removed.
        // ★ That asymmetry is PRE-EXISTING behaviour (the AI delete leaves the
        // person's calendar rows behind), not something this capture chose;
        // if the cascade is ever added here, this part list must grow with it.
        undoRef.current?.captureComposite({
          kind: "resource.deleted",
          primaryCount: 1,
          parts: [capturePart({
            setter: setResources,
            removed: [doomed],
            fromArray: resourcesRef.current,
            isPrimary: true,
          })],
          name: resourceLogName(doomed),
          entityKey: "resource",
        });
        resourcesRef.current = next;
        setResources(next);
        args.logActivityAs?.("ai", "resource.deleted", doomed.id, resourceLogName(doomed));
        args.allowDestructiveSave?.();
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
          today: clockRef.current.today,
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
          // Assembled by useViewDigest — needs pane state this hook lacks (health
          // filter, debounced search, view mode) to name the rows the pane ACTUALLY
          // renders. See use-view-digest.ts. ★ Unlike the entity refs above, which
          // tool handlers update SYNCHRONOUSLY, this is written by an effect and can
          // lag a render. Harmless for the system prompt (built once per send, after
          // effects flush); a mid-turn `get_app_state` right after a create can
          // return a digest predating that write. Not worth a synchronous mirror: the
          // digest describes the SCREEN, which has not repainted either.
          viewDigest: viewDigestRef.current,
          timezone: clockRef.current.tz,
          // ★ The toggle gate lives INSIDE summarizeForRecap (which also owns
          // the not-yet-existing settings field it reads), so a switched-off
          // recap SKIPS the scan rather than hiding its result.
          activitySummary: summarizeForRecap(
            settingsRef.current.ai, activityLogRef.current, clockRef.current,
          ),
          chatPointer: chatBindings.chatPointer(),
        };
      },

      getActivityLog: () => activityLogRef.current,

      // ★ LIVE from the ref, never captured — a value snapshotted at construction would
      //   keep serving for the whole session, the exact mid-conversation case §162 is about.
      isHistorySearchEnabled: () => historySearchEnabled(settingsRef.current.ai.historySearch),
      ...chatBindings.tools,

      getTimezone: () => clockRef.current.tz,

      getDashboardSnapshot: () =>
        buildDashboardSnapshot(
          getDashboardModelRef.current(),
          getBudgetRollupRef.current(),
          clockRef.current.today,
        ),

      listAllocations: () => getAllocationsSnapshotRef.current(),

      listKnowledgeItems: () => (knowledgeItemsRef.current ?? []).map(toKnowledgeSummary),
      listCalendarEvents: () => (calendarEventsRef.current ?? []).map(toCalendarEventSummary),
      listBudgetBuckets: () => (budgetsRef.current ?? []).map(toBudgetBucketSummary),
    }),
    // Empty deps otherwise: every reactive value is read via a ref. Identity is
    // stable. `documentTools` is a REAL dep, not a ref-routed value — it is
    // itself a useMemo'd object (use-document-tools.ts) that changes identity
    // when isReadOnly/mutateDocuments/logActivityAs change, and the spread above
    // captures it by closure; omitting it here would freeze the FIRST render's
    // document tools into every later dispatcher even after a popout toggled
    // read-only.
    // ★★ `registerTools` is the SAME SHAPE, and is listed for the same reason —
    // but do NOT read it as load-bearing TODAY, which is what a first draft of
    // this comment claimed. REASONED, not measured: use-register-tools.ts moves
    // identity on `isReadOnly` or `logActivityAs`, and BOTH already reach this
    // array — the first directly, the second through `documentTools`, which
    // carries the logger among its own deps. So every trigger that can move
    // `registerTools` already rebuilds this memo.
    // ★ MEASURED, and it is a weaker fact than it looks: deleting
    // `registerTools` from this array leaves use-chat-dispatcher.test.tsx fully
    // green (174/174). That says the SUITE cannot see the omission, not that the
    // omission is safe — no test flips either identity mid-render.
    // It is listed anyway because the redundancy is a property of the OTHER
    // hook's dep array, not of this one: the day that array gains a dep this one
    // lacks, the omission becomes the documentTools bug above, silently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.isReadOnly, documentTools, registerTools],
  );

  return dispatcher;
}
