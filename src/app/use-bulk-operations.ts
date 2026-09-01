"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-types";
import type { BudgetBucket, Task, Resource } from "./types";
import { moveTasksToBucket } from "./budget-task-link";
import type { BucketCommitMeta } from "./use-budget-buckets";
import { effectivePersonEmail } from "./resource-foundation";
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
import { applyStatusChange, statusActivityKind } from "./task-status";
import { todayInZone, resolveTimezone } from "./timezone";
import { captureFieldPart, type UndoStackApi } from "./undo/use-undo-stack";
import { TASK_UNDO_GROUPS, buildBulkFieldEdits } from "./undo/field-groups";
import { visibleTaskRows } from "./visible-task-rows";

// Fields Jira owns on a synced task (mirrors issueToTaskFields). Bulk-editing
// them on a `jiraKey` row would be silently reverted by the next read-only pull
// (or unexpectedly pushed), so they are skipped on synced rows. Local-only
// fields (group/blockers/notes/labels/…) still apply. `status` is ALSO
// Jira-managed (Jira's statusCategory drives it) but is applied separately via
// applyStatusChange — see the `statusEnabled` handling in applyBulkEdit.
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
  /** Capture a pre-op snapshot for undo (clear-all deletes, bulk-edit changes). */
  capture: UndoStackApi["capture"];
  /** Capture a bulk field-patch edit for undo (the tasks bulk apply) — reverts
   *  only the fields the apply wrote, so a note added through the notes window
   *  or an outlookEventId stamped by a background Outlook push survives the
   *  undo (open-followups #50). */
  captureFieldRows: UndoStackApi["captureFieldRows"];
  /** The budget-bucket commit boundary. A bulk bucket change writes `budgets`,
   *  never `tasks` — the link lives on the bucket. */
  commitBuckets: (next: readonly BudgetBucket[], meta?: BucketCommitMeta) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  /** Arm the storage layer's one-shot destructive-save bypass before a clear-all
   *  — else the persistence data-loss guard refuses the mass deletion. */
  allowDestructiveSave?: () => void;
  /** Open the tasks view's type-to-confirm clear-all dialog. The voice `clearAll`
   *  command routes through this so it faces the SAME friction as the toolbar
   *  button (type the `tasksClearAllConfirmValue` phrase) instead of a one-click
   *  window.confirm. Undefined ⇒ voice clear-all is a safe no-op (popout / view
   *  not mounted). */
  requestClearAllConfirm?: () => void;
  /** Day-boundary context for the health filter. task-manager threads the SAME
   *  `today` and `holidaySet` VALUES into the Open Points pane, so two of the
   *  three inputs to `visibleTaskRows()` cannot drift at all.
   *  The third, `hideFinishedTasks`, is read off `settings` here (task-manager
   *  passes its EFFECTIVE settings) and off the pane's own `useEffectiveSettings`.
   *  Those are two objects, not one — equal for THIS flag because neither the
   *  policy nor the appearance override layer touches it (`settings-effective.ts`),
   *  so a future override for it would have to be added to both readers at once.
   *  Passing a pane-local re-derivation of any of the three brings back exactly
   *  the drift `visibleTaskRows()` exists to close. */
  today: string;
  holidaySet: ReadonlySet<string>;
}

export function useBulkOperations(args: UseBulkOperationsArgs) {
  const { tasks, setTasks, filteredSortedTasks, project, resources, budgets } = useWorkspace();
  const { commitBuckets } = args;
  // Directory for resolving a linked assignee's LIVE email on bulk inquiries
  // (the cached assigneeEmail can be stale after a rename/re-link).
  const resourcesById = useMemo<ReadonlyMap<number, Resource>>(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );
  const { setSearchImmediate, healthFilter } = useFilters();
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
  const captureRef = useRef(args.capture);
  const captureFieldRowsRef = useRef(args.captureFieldRows);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { handlersRef.current = args.handlers; }, [args.handlers]);
  useEffect(() => { onCancelEditRef.current = args.onCancelEdit; }, [args.onCancelEdit]);
  useEffect(() => { setSettingsRef.current = args.setSettings; }, [args.setSettings]);
  useEffect(() => { allowDestructiveSaveRef.current = args.allowDestructiveSave; }, [args.allowDestructiveSave]);
  useEffect(() => { requestClearAllConfirmRef.current = args.requestClearAllConfirm; }, [args.requestClearAllConfirm]);
  useEffect(() => { captureRef.current = args.capture; }, [args.capture]);
  useEffect(() => { captureFieldRowsRef.current = args.captureFieldRows; }, [args.captureFieldRows]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // The rows the Open Points table ACTUALLY renders — the same helper the pane
  // calls, so select-all can never reach a row the user cannot see. Deriving
  // this from `filteredSortedTasks` (upstream of the health + hide-finished
  // filters) is the reported bug.
  // `args.today`/`args.holidaySet` are hoisted: exhaustive-deps rejects an
  // `obj.member` dependency outright (fatal at --max-warnings=0).
  const today = args.today;
  const holidaySet = args.holidaySet;
  const hideFinished = args.settings.hideFinishedTasks ?? false;
  const visibleRows = useMemo(
    () => visibleTaskRows(filteredSortedTasks, healthFilter, hideFinished, { today, holidaySet }),
    [filteredSortedTasks, healthFilter, hideFinished, today, holidaySet],
  );

  const visibleIds = useMemo(
    () => visibleRows.map((r) => r.id),
    [visibleRows],
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
    // Named apart from the hook-scope `today` (args.today, the pane's day
    // boundary for the health filter): two day values that coincide today but
    // are not the same thing, and shadowing hid that.
    const editToday = todayInZone(new Date(), tz);
    const fields = bulkEdit.enabled;
    const anyEnabled = Object.values(fields).some(Boolean);
    if (!anyEnabled) {
      showToastRef.current("error", t(lang, "bulkEditNoFields"));
      return;
    }
    const built = buildBulkEditUpdates(bulkEdit, editToday);
    if (!built.ok) {
      showToastRef.current(
        "error",
        t(lang, built.error === "pastDate" ? "errorPastDate" : "errorInvalidEmail"),
      );
      return;
    }
    const updates = built.updates;
    // A row selected while visible and hidden by a LATER filter change must not
    // be edited from under the user. `visibleIds` is what they can see now, so
    // this is a second, independent guard: the first stops select-all REACHING a
    // hidden row, this one stops a STALE selection from being written.
    const visible = new Set(visibleIds);
    const targetIds = [...selectedIds].filter((id) => visible.has(id));
    const targetSet = new Set(targetIds);
    // Withholding a row is a decision the user has to be told about: the modal
    // closes and the selection clears whether or not anything was written, so
    // an unannounced skip is indistinguishable from an edit that worked. The
    // all-hidden case (targetIds empty) is the same failure, only total.
    const skippedHidden = selectedIds.size - targetIds.length;
    // `status` isn't in `updates` (it must route through applyStatusChange to keep
    // the Done ⟺ completedDate invariant), so track its enablement separately.
    const statusEnabled = fields.status;
    const newStatus = bulkEdit.status;
    // Jira-managed fields (incl. status) are skipped on synced rows (silently
    // reverted / pushed otherwise); local-only fields still apply. Non-synced rows
    // get everything.
    const managedEnabled = statusEnabled || JIRA_MANAGED_BULK_FIELDS.some((f) => f in updates);
    const jiraSafeUpdates: Partial<Task> = { ...updates };
    for (const f of JIRA_MANAGED_BULK_FIELDS) delete jiraSafeUpdates[f];
    // Local changes a synced row still receives (status never is — it's applied
    // via applyStatusChange only on non-synced rows below).
    const noLocalForSynced = Object.keys(jiraSafeUpdates).length === 0;
    const skippedSynced = managedEnabled
      ? tasks.reduce((n, row) => (targetSet.has(row.id) && row.jiraKey ? n + 1 : n), 0)
      : 0;
    // Synced rows are left fully untouched only when the edit was managed-fields-
    // only (nothing local to apply); subtract those so the count reflects rows
    // actually changed.
    const untouchedSynced = managedEnabled && noLocalForSynced ? skippedSynced : 0;
    const stamp = new Date().toISOString();
    const beforeRows = tasks.filter((r) => targetSet.has(r.id));
    // ONE definition of the row patch, used to derive the undo patches AND to
    // write the rows. Two copies would let the undo revert something other than
    // what was applied.
    const patchRow = (row: Task): Task => {
      if (row.jiraKey) {
        if (!managedEnabled) return { ...row, ...updates, localModifiedAt: stamp };
        // Only managed fields (incl. status) were enabled → nothing local to
        // change; leave the row untouched (no spurious localModifiedAt that a
        // pull would revert).
        if (noLocalForSynced) return row;
        return { ...row, ...jiraSafeUpdates, localModifiedAt: stamp };
      }
      // Non-synced: apply the flat field patch, then the status transition (via
      // applyStatusChange so status + completedDate stay in sync).
      const next = { ...row, ...updates };
      const withStatus = statusEnabled ? applyStatusChange(next, newStatus, editToday) : next;
      return { ...withStatus, localModifiedAt: stamp };
    };
    // Bucket links live on the BUCKET, so this writes `budgets`. A task-field
    // patch and a bucket change in the same apply must be ONE undo entry.
    const nextBuckets = fields.budgetBucket
      ? moveTasksToBucket(budgets, targetIds, bulkEdit.budgetBucket === "" ? null : Number(bulkEdit.budgetBucket), stamp)
      : budgets;
    const bucketsChanged = nextBuckets !== budgets;
    // A managed-fields-only edit already writes nothing to tasks; a BUCKET-only
    // edit must behave the same way, or every selected row gets a spurious
    // localModifiedAt that a Jira pull would revert.
    const taskFieldsEnabled = statusEnabled || Object.keys(updates).length > 0;
    // Field PATCHES, not whole rows — so undo reverts only what this apply
    // wrote, and a note added through the notes window (or an outlookEventId
    // stamped by a background Outlook push) survives the undo (§50).
    const taskEdits = taskFieldsEnabled
      ? buildBulkFieldEdits(beforeRows.map((row) => ({ before: row, after: patchRow(row) })), TASK_UNDO_GROUPS)
      : [];
    // ★★★ THE ROWS THE CAPTURE RECORDS AND THE ROWS THE WRITE TOUCHES ARE ONE
    // SET, derived from the one `patchRow` diff above. Gating the write on
    // `taskFieldsEnabled && targetIds.length > 0` while gating the capture on
    // `taskEdits.length > 0` let the two diverge: `buildBulkFieldEdits` puts
    // `localModifiedAt` in NEVER_CAPTURE, so a row whose ONLY difference is the
    // fresh stamp yields no edit — and the write stamped it regardless. Bulk-
    // editing a field to the value the rows already hold therefore dirtied every
    // selected row, autosaved, toasted "N tasks updated" and logged a bulk.edit
    // with NO undo entry behind it; the partial case (3 of 5 rows differ) left
    // two stamps unrevertable.
    // ★★ NARROWED THE WRITE rather than widening the capture with empty patches,
    // because writing nothing is what the rest of this apply already does for a
    // row it has no real change for: `patchRow`'s `noLocalForSynced` early return
    // and the bucket-only / no-op-bucket paths all decline to write precisely so
    // no spurious `localModifiedAt` reaches a row for a Jira pull to revert. An
    // empty-patch capture would instead have offered an undo for a change the
    // user cannot see.
    const editedIds = new Set(taskEdits.map((e) => e.id));
    // ★★ ONE count for the toast, the activity row AND the undo label.
    // `captureFieldRows` pushes `edits.length` as its own count, so the pure
    // task-field path must report exactly that or the toast and the undo entry
    // describe different sets of rows. A bucket move rewrites the link for every
    // visible target whether or not its task fields changed, so that path keeps
    // the target count (minus the synced rows left fully untouched).
    const count = bucketsChanged ? targetIds.length - untouchedSynced : taskEdits.length;
    const tasksPart = taskEdits.length > 0
      ? captureFieldPart<Task>({ setter: setTasks, edits: taskEdits, stampField: "localModifiedAt" })
      : null;
    if (tasksPart !== null && !bucketsChanged) {
      captureFieldRowsRef.current({ setter: setTasks, kind: "bulk.edit", edits: taskEdits, entityKey: "task", stampField: "localModifiedAt" });
    }
    // `editedIds` is a subset of the VISIBLE targets, so this also keeps a
    // fully-hidden selection from producing a fresh (identical) tasks array,
    // which would dirty the workspace for nothing — the guard the old
    // `targetIds.length > 0` test carried, now implied by construction.
    if (editedIds.size > 0) {
      setTasks((prev) => prev.map((row) => (editedIds.has(row.id) ? patchRow(row) : row)));
      // PER ROW, not once per batch: `activityTaskCompleted` is "Task #{0}
      // marked complete: {1}", which names ONE task and has no room for a
      // count. (An earlier revision added "and neither completion kind is in
      // `BULK_TOTAL_KINDS`, so neither carries a count the way `bulk.edit`
      // does" — false, and disproved by its own example: `bulk.edit` is NOT a
      // member of that set either, yet it renders "{0} task(s)". Membership
      // governs the completion-trend DENOMINATOR, not message arity.)
      // Driven off `editedIds` so the entries
      // describe exactly the rows the write above touched — a synced row (whose
      // `patchRow` never applies status) and a non-status edit both yield `null`
      // from the helper, so this is self-gating on top of that.
      // ★ Deliberately OUTSIDE the setter: `patchRow` is already called twice
      // per row (once to build the undo edits, once in the updater above), and
      // logging from in there would double every entry under StrictMode.
      for (const row of beforeRows) {
        if (!editedIds.has(row.id)) continue;
        const transition = statusActivityKind(row, patchRow(row));
        if (transition) logActivityRef.current(transition, row.id, row.taskName);
      }
    }
    if (bucketsChanged) {
      commitBuckets(nextBuckets, { kind: "bulk.edit", primaryCount: count, tasksPart, callerLogs: true });
    }
    if (skippedSynced > 0) {
      showToastRef.current("info", t(lang, "jiraBulkManagedFieldsSkipped", skippedSynced));
    }
    // Mirrors the Jira notice above — same shape, different reason for skipping.
    if (skippedHidden > 0) {
      showToastRef.current("info", t(lang, "bulkEditHiddenSkipped", skippedHidden));
    }
    // A bucket-only apply whose move is a no-op (every selected task is already
    // in the target) writes nothing — so it must not claim rows either. The
    // pre-existing managed-fields-only path drives `count` to 0 for the same
    // reason; this one cannot, because the rows ARE selectable targets.
    if (count > 0 && (taskFieldsEnabled || bucketsChanged)) {
      showToastRef.current(
        "info",
        count === 1
          ? t(lang, "bulkEditDoneOne")
          : t(lang, "bulkEditDoneMany", count),
      );
      logActivityRef.current("bulk.edit", count);
    } else if (targetIds.length > 0 && skippedHidden === 0 && skippedSynced === 0) {
      // The GENUINE no-change apply: rows were targeted, none was withheld, and
      // every one already held the values asked for — so the write half
      // correctly wrote nothing. Saying nothing is the same failure the
      // `skippedHidden` notice above exists to prevent (the modal closes and the
      // selection clears either way, so silence is indistinguishable from a
      // swallowed error).
      // Gated on BOTH skip counts being zero: when either notice fired the user
      // already has an explanation for the same outcome, and a second toast
      // would offer a different reason for it. Gated on `targetIds.length > 0`
      // so the message's claim ("those rows already hold those values") is true
      // by construction — with no target rows there is nothing to say that
      // about. The `!anyEnabled` and invalid-input paths returned earlier, so
      // neither can reach here.
      // NO activity row on purpose: nothing was written, so an audit line would
      // describe a change that did not happen — and `bulk.edit` renders as
      // "Bulk edit applied to {0} task(s)", i.e. a literal "0 task(s)" entry.
      // (It is in neither `COUNT_KINDS` nor `BULK_TOTAL_KINDS`, so the omission
      // costs the completion trend nothing either way.)
      showToastRef.current("info", t(lang, "bulkEditNoChanges"));
    }
    setBulkEditOpen(false);
    setBulkEdit(emptyBulkEdit());
    setSelectedIds(new Set());
  }, [bulkEdit, selectedIds, visibleIds, tasks, setTasks, setBulkEdit, setBulkEditOpen, tz, budgets, commitBuckets]);

  // Unconditional clear — callers own the confirmation, and BOTH paths gate it
  // with TypeToConfirmDialog: the tasks view's toolbar button directly, and the
  // voice command below by routing through `requestClearAllConfirmRef` so it
  // opens the same dialog rather than a one-click window.confirm.
  const handleClearAll = useCallback(() => {
    if (tasks.length === 0) return;
    captureRef.current({ setter: setTasks, kind: "task.deleted", removed: tasks, fromArray: tasks });
    allowDestructiveSaveRef.current?.(); // arm the storage destructive-save bypass (button + voice)
    // ★★ §163 — the USER half. `bulk.delete` had exactly ONE writer, the AI's
    // `delete_all_tasks`, so `BULK_TOTAL_KINDS` corrected the completion trend's
    // denominator for AI mass deletes and left the far commoner user path silent —
    // inverting the asymmetry rather than removing it. Count BEFORE the setter: the
    // row array is cleared under it.
    logActivityRef.current("bulk.delete", tasks.length);
    setTasks([]);
    setSelectedIds(new Set());
    onCancelEditRef.current();
  }, [tasks, setTasks]);

  // Delete only the selected rows (distinct from clear-all). Functional setter so
  // it reads the live array, captures an undo snapshot of the removed rows, and
  // arms the storage destructive-save bypass (a large multi-row delete can trip
  // the persistence mass-deletion guard, same as clear-all). Callers gate it
  // behind a type-to-confirm dialog.
  const handleBulkDelete = useCallback(
    (ids: Set<number>) => {
      if (ids.size === 0) return;
      const removed = tasks.filter((r) => ids.has(r.id));
      if (removed.length === 0) return;
      captureRef.current({ setter: setTasks, kind: "task.deleted", removed, fromArray: tasks });
      allowDestructiveSaveRef.current?.();
      // §163 — same reasoning as `handleClearAll`. `removed.length`, NOT `ids.size`:
      // a stale selection can name ids no longer in `tasks`, and the trend subtracts
      // whatever this entry carries.
      logActivityRef.current("bulk.delete", removed.length);
      setTasks((prev) => prev.filter((r) => !ids.has(r.id)));
      setSelectedIds(new Set());
    },
    [tasks, setTasks],
  );

  const handleBulkSendInquiry = useCallback(() => {
    const lang = langRef.current;
    const selected = tasks.filter((row) => selectedIds.has(row.id));
    if (selected.length === 0) return;

    const emailUpdates: Record<number, string> = {};
    const resolved: Array<{ task: Task; email: string }> = [];

    for (const task of selected) {
      let email = effectivePersonEmail(task.assigneeEmail ?? "", task.resourceId, resourcesById).trim();
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

    // Kept as a synchronous native confirm ON PURPOSE: the window.open() loop
    // below must run inside the original click's user-activation gesture, so an
    // awaited (async) branded dialog would get the mailto popups blocked. This
    // is a non-destructive send confirmation, not a destructive-tier action.
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
  }, [tasks, selectedIds, setTasks, resourcesById]);

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
          // Route through the tasks view's type-to-confirm dialog (type the
          // `tasksClearAllConfirmValue` phrase) — the SAME friction as the
          // toolbar button — rather than a one-click window.confirm before an
          // irreversible wipe. No dialog wired (popout / view not mounted) ⇒
          // safe no-op.
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
    handleBulkDelete,
    handleClearAll,
    handleCommand,
  };
}
