"use client";
import { useCallback, useMemo, useState } from "react";
import type React from "react";
import { emptyForm, type TaskFormDraft } from "./task-form-context";
import { upsertContact, type ContactsMap } from "./contacts";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { useAdjustmentTracker } from "./field-feedback";
import { t, type Lang } from "./i18n";
import { mintId } from "./id-mint-session";
import { type Settings } from "./settings-types";
import { type Task, type RaidItem } from "./types";
import { applyStatusChange } from "./task-status";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { TASK_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeDependencies,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";
import { sanitizeNoteHtml } from "./sanitize-html";
import { describeTextCap } from "./sanitize-report";
import { resolveSuccessorLinks, type SuccessorEdit } from "./successor-links";
import { hasTaskErrors, validateTaskForm, type TaskFieldErrors } from "./task-validation";

export interface UseTaskSubmitArgs {
  form: TaskFormDraft;
  setForm: React.Dispatch<React.SetStateAction<TaskFormDraft>>;
  editingId: number | null;
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tasks: readonly Task[];
  today: string;
  lang: Lang;
  settings: Settings;
  tasksRef: React.RefObject<readonly Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<readonly Task[]>>;
  setContacts: React.Dispatch<React.SetStateAction<ContactsMap>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  onPushToJiraRef: React.MutableRefObject<(taskId: number) => Promise<boolean>>;
  raid: readonly RaidItem[];
  setRaid: React.Dispatch<React.SetStateAction<readonly RaidItem[]>>;
  pendingLinkRaidIdRef: React.MutableRefObject<number | null>;
  /** Called with the new task id after a create-mode save resolves it, so the
   *  editor buffer can flush staged RAID/links against the real parent id. */
  onTaskCreated?: (newId: number) => void;
  /** Called when the editor closes without creating (cancel/nav-away) so the
   *  editor buffer discards any staged create-mode items. */
  onEditorDiscard?: () => void;
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
}

export function useTaskSubmit(args: UseTaskSubmitArgs): {
  fieldErrors: TaskFieldErrors;
  submitted: boolean;
  saveDisabled: boolean;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  handleCancelEdit: () => void;
  openEditModal: (task: Task) => void;
} {
  const {
    form,
    setForm,
    editingId,
    setEditingId,
    setTaskModalOpen,
    tasks,
    today,
    lang,
    settings,
    tasksRef,
    setTasks,
    setContacts,
    logActivity,
    logActivityChanges,
    showToast,
    onPushToJiraRef,
    setRaid,
    pendingLinkRaidIdRef,
    onTaskCreated,
    onEditorDiscard,
    captureFieldEdit,
  } = args;

  // `submitted` flips true on the first submit attempt so per-field errors can
  // reveal even for fields the user never blurred. Live `fieldErrors` also gate
  // the Save button (saveDisabled) — see task-validation.ts for the rules.
  const [submitted, setSubmitted] = useState(false);
  const isNewTask = editingId === null;
  const fieldErrors = useMemo(
    () => validateTaskForm(form, today, isNewTask),
    [form, today, isNewTask],
  );
  const saveDisabled = hasTaskErrors(fieldErrors);
  const adj = useAdjustmentTracker();

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitted(true);
      adj.reset();

      // Per-field validation gates the submit (same rules surfaced inline).
      // Normally the Save button is already disabled when invalid; this is the
      // belt-and-suspenders guard for any path that still fires onSubmit.
      if (hasTaskErrors(validateTaskForm(form, today, isNewTask))) return;

      // Safety net: fields are normally already trimmed on blur, but we re-cap here at submit time in case blur was skipped.
      const taskName = sanitizeTaskName(adj.track(describeTextCap(form.taskName, TASK_NAME_MAX)));
      const assignee = sanitizeAssignee(adj.track(describeTextCap(form.assignee, ASSIGNEE_MAX)));
      const dueDate = sanitizeIsoDate(form.dueDate);

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

      const email = sanitizeEmail(adj.track(describeTextCap(form.assigneeEmail, EMAIL_MAX)));

      const knownIds = new Set(tasks.map((row) => row.id));
      const cleanDependencies = sanitizeDependencies(
        form.dependencies,
        knownIds,
        editingId,
      );

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
        blockers: sanitizeBlockers(adj.track(describeTextCap(form.blockers, TEXTAREA_MAX))),
        description: sanitizeNoteHtml(form.description ?? ""),
        group: sanitizeGroup(adj.track(describeTextCap(form.group, GROUP_MAX))),
        labels: sanitizeLabels(form.labels),
        dependencies: cleanDependencies,
        healthOverride: form.healthOverride || undefined,
        originalEstimateMinutes: form.originalEstimateMinutes,
        timeSpentMinutes: form.timeSpentMinutes,
        resourceId: form.resourceId ?? undefined,
        knowledgeLinks: form.knowledgeLinks,
        // ★★ `noteLog` is DELIBERATELY absent — from this payload AND from the
        // form draft itself (`emptyForm` carries no such field). The note log is
        // WRITE-THROUGH — NoteLogPanel (inline in the editor) and the floating
        // notes window both commit straight to the workspace row, and never
        // touch this draft. A draft copy would go stale the instant a note is
        // added/edited/deleted, and since `payload` is spread OVER `row` it
        // would overwrite the live log with that stale copy — silent data
        // loss. The write-through path is the sole owner.
      };

      if (adj.count() > 0) {
        showToast("info", t(lang, "fieldsAdjusted", adj.count()));
      }

      setContacts((prev) => upsertContact(prev, assignee, email));

      // A successor target is a row the user never opened, so their intent was
      // purely ADDITIVE — unlike the own task, whose whole field list they
      // authored and may legitimately overwrite. Apply only the entries the
      // resolution ADDS, onto the LIVE row, and re-sanitize: a concurrent
      // writer's edit to the same target survives instead of being clobbered by
      // a whole array computed outside the updater. Idempotent (the sanitizer
      // de-dupes), so a StrictMode double-invoke is safe. Mirrors how `onDelete`
      // in use-task-row-handlers.ts rebuilds each dependent from `prev`.
      //
      // ★★ "Additive" hides two things. (1) THE CAP WINDOW: sanitizeDependencies
      // iterates and BREAKS at the 20-link cap, and the live entries come FIRST
      // here — so if a concurrent writer filled the target to 20 between resolve
      // and commit, `added` is never reached and NOTHING is toasted, because the
      // skipped count was computed from the snapshot where the row still had
      // room. Do NOT "fix" that by putting `added` first: that drops a STORED
      // entry instead of the new one, which is strictly worse. The ordering is
      // right; the silence is the known cost. (2) It re-sanitizes the WHOLE live
      // array, so a stored DANGLING reference on the target is stripped in the
      // same pass. That is a repair rather than a bug, and it is self-consistent
      // with the engine keeping `before` raw so undo restores what was stored.
      const addSuccessorLinks = (
        row: Task,
        edit: SuccessorEdit,
        liveIds: ReadonlySet<number>,
        stamp: string,
      ): Task => {
        const added = edit.after.filter(
          (a) => !edit.before.some((b) => b.taskId === a.taskId && b.type === a.type),
        );
        return {
          ...row,
          dependencies: sanitizeDependencies(
            [...(row.dependencies ?? []), ...added],
            liveIds,
            row.id,
          ),
          localModifiedAt: stamp,
        };
      };

      // ★ Called AFTER each branch's own-task captures, so the target entries
      // land on top of the stack and a bare undo() peels the successor links
      // first (the most recently-intended act). ★★ There is NOT always an
      // own-task entry to unwind from: `captureFieldChanges` pushes nothing when
      // no own field changed, so a successors-only save leaves ONLY these
      // entries, and a create pushes none at all (creates are not undoable
      // here) — the target entries then stand alone.
      //
      // ★★ captureFieldEdit MERGES before/after onto the live row by id rather
      // than replacing it, so these entries cannot revert a field this save
      // never touched. A whole-row capture() would give one tidier entry and
      // inherit open-followups §50, where undo restores a stale row.
      //
      // ★★ The undo IMAGES stay snapshot-based even though the WRITE above is
      // live: `before`/`after` are the arrays resolved from `tasksRef.current`,
      // so undoing after a concurrent writer touched the same target reverts to
      // the snapshot rather than to that writer's value. Accepted residue —
      // the write itself is what data loss turns on. Two known consequences,
      // both recorded as follow-ups rather than fixed here: (a) redo can write a
      // dangling reference (create task 5 with successor 2 → undo → delete 5 →
      // redo merges `{taskId:5}` back; it self-heals on the next load), and
      // (b) a staged successor list is unbounded while UNDO_CAP is 25, so a
      // large fan-out can evict the own-task entries of its own save.
      const recordSuccessorEdits = (
        resolution: ReturnType<typeof resolveSuccessorLinks>,
        nameSource: readonly Task[],
      ) => {
        for (const [targetId, edit] of resolution.edits) {
          const name = nameSource.find((r) => r.id === targetId)?.taskName;
          captureFieldEdit?.({
            setter: setTasks,
            kind: "task.updated",
            id: targetId,
            before: { dependencies: edit.before },
            after: { dependencies: edit.after },
            stampField: "localModifiedAt",
            name,
          });
          // A silent write to a row the user never opened is exactly what an
          // audit trail is for. `diffFields` skips array-valued fields, so this
          // names the row with no field detail — the same entry the own task's
          // dependency edit already produces.
          logActivity("task.updated", targetId, name ?? "");
        }
      };

      if (editingId !== null) {
        const stamp = new Date().toISOString();
        const updatedId = editingId;
        const prevTask = tasksRef.current.find((r) => r.id === editingId);
        // ★★★ Resolve against the edited task carrying THIS SAVE's predecessors,
        // not its stored ones — the same reason the create path resolves against
        // a list containing the new task. The cycle walk starts at the owning
        // task and follows its predecessors, so an unpatched row hides an edge
        // the user is adding right now: with B already depending on C, editing A
        // to add predecessor B and successor C in one save closes B→A→C→B, and
        // the stale walk finds nothing to object to. The picker cannot catch it
        // either — its `allowedIds` reads the same stored map.
        const successors = resolveSuccessorLinks({
          ownId: editingId,
          links: form.successorLinks,
          tasks: tasksRef.current.map((r) =>
            r.id === editingId ? { ...r, dependencies: cleanDependencies } : r,
          ),
        });
        if (successors.skipped > 0) {
          showToast("info", t(lang, "depSuccessorsSkipped", successors.skipped));
        }
        // ONE functional setter for the edited task AND every successor target:
        // they all live in the same array, so a second setTasks would be a
        // second pass over it for no benefit.
        setTasks((prev) => {
          // Live ids, so the re-sanitize inside addSuccessorLinks judges
          // dangling references against current state rather than the snapshot.
          const liveIds = new Set(prev.map((r) => r.id));
          return prev.map((row) => {
            if (row.id === editingId) {
              return applyStatusChange(
                { ...row, ...payload, localModifiedAt: stamp },
                form.status,
                today,
              );
            }
            const edit = successors.edits.get(row.id);
            return edit ? addSuccessorLinks(row, edit, liveIds, stamp) : row;
          });
        });
        setEditingId(null);
        if (prevTask) {
          // Single-item edit, so tasksRef's row equals the mapped row — recompute
          // the same next value to diff prev→next for the undo capture + audit detail.
          const nextTask = applyStatusChange(
            { ...prevTask, ...payload, localModifiedAt: stamp },
            form.status,
            today,
          );
          captureFieldChanges(captureFieldEdit, {
            setter: setTasks,
            kind: "task.updated",
            id: updatedId,
            prev: prevTask,
            next: nextTask,
            groups: TASK_UNDO_GROUPS,
            stampField: "localModifiedAt",
            name: taskName,
          });
          if (logActivityChanges) {
            logActivityChanges("task.updated", diffFields(prevTask, nextTask), updatedId, taskName);
          } else {
            logActivity("task.updated", updatedId, taskName);
          }
        } else {
          logActivity("task.updated", updatedId, taskName);
        }
        recordSuccessorEdits(successors, tasksRef.current);
      } else {
        const newTask: Task = applyStatusChange(
          {
            id: mintId("task", tasks),
            ...payload,
            status: form.status,
            inquiriesSent: 0,
            createdDate: today,
          },
          form.status,
          today,
        );
        const newId = newTask.id;
        const shouldPush =
          form.pushToJira &&
          settings.jira.enabled &&
          !!settings.jira.projectKey;
        const stamp = new Date().toISOString();
        const withNew = [...tasksRef.current, newTask];
        // ★★★ Resolve AFTER the mint, against a list that CONTAINS the new
        // task. Resolving against tasksRef.current makes newId a dangling
        // reference that sanitizeDependencies strips, so every staged link is
        // silently dropped — green tests, no error, no links. It also lets the
        // cycle walk see the new task's own predecessors, which is how a task
        // staged as both predecessor and successor gets caught here.
        const successors = resolveSuccessorLinks({
          ownId: newId,
          links: form.successorLinks,
          tasks: withNew,
        });
        if (successors.skipped > 0) {
          showToast("info", t(lang, "depSuccessorsSkipped", successors.skipped));
        }
        const newIds = new Set(withNew.map((r) => r.id));
        const nextList =
          successors.edits.size === 0
            ? withNew
            : withNew.map((row) => {
                const edit = successors.edits.get(row.id);
                return edit ? addSuccessorLinks(row, edit, newIds, stamp) : row;
              });
        // ★ Assign the PATCHED list, not `withNew` — the ref is what the next
        // save reads, so seeding it with the unpatched array would make every
        // following save resolve against targets that look unlinked.
        // ★ This branch replaces the whole array rather than mapping `prev`
        // (pre-existing: the create was always a snapshot write), so the
        // additive merge above buys less here than on the update path. Kept
        // identical anyway so the two paths cannot drift.
        tasksRef.current = nextList;
        setTasks(nextList);
        recordSuccessorEdits(successors, nextList);
        logActivity("task.created", newId, taskName);
        // Flush any editor-buffered RAID/links now that the parent id exists.
        onTaskCreated?.(newId);
        const linkRaidId = pendingLinkRaidIdRef.current;
        pendingLinkRaidIdRef.current = null;
        if (linkRaidId != null) {
          setRaid((prev) =>
            prev.some((r) => r.id === linkRaidId)
              ? prev.map((r) =>
                  r.id === linkRaidId
                    ? {
                        ...r,
                        linkedTaskIds: r.linkedTaskIds.includes(newId)
                          ? r.linkedTaskIds
                          : [...r.linkedTaskIds, newId],
                      }
                    : r,
                )
              : prev,
          );
        }
        if (shouldPush) {
          void onPushToJiraRef.current(newId);
        }
      }
      setForm(emptyForm());
      // Reset only on this clean-close path. The jira-assignee early-return
      // above intentionally leaves `submitted` true so its field errors persist
      // while the form stays open.
      setSubmitted(false);
      setTaskModalOpen(false);
    },
    [
      form,
      editingId,
      isNewTask,
      tasks,
      today,
      lang,
      settings,
      tasksRef,
      setTasks,
      setEditingId,
      setForm,
      setTaskModalOpen,
      setContacts,
      logActivity,
      logActivityChanges,
      showToast,
      adj,
      onPushToJiraRef,
      setRaid,
      pendingLinkRaidIdRef,
      onTaskCreated,
      captureFieldEdit,
    ],
  );

  const handleCancelEdit = useCallback(() => {
    pendingLinkRaidIdRef.current = null;
    onEditorDiscard?.();
    setEditingId(null);
    setSubmitted(false);
    setForm(emptyForm());
    setTaskModalOpen(false);
  }, [setEditingId, setForm, setTaskModalOpen, pendingLinkRaidIdRef, onEditorDiscard]);

  const openEditModal = useCallback(
    (task: Task) => {
      // Switching the editor to an EXISTING task (e.g. a deep-link fired mid-create)
      // must drop any create-mode staged RAID/links — otherwise saving this existing
      // task takes the edit branch (no flush) and the stale items later flush onto the
      // wrong parent id.
      onEditorDiscard?.();
      pendingLinkRaidIdRef.current = null;
      setEditingId(task.id);
      setSubmitted(false);
      setTaskModalOpen(true);
      setForm({
        taskName: task.taskName,
        assignee: task.assignee,
        assigneeEmail: task.assigneeEmail ?? "",
        startDate: task.startDate ?? "",
        dueDate: task.dueDate,
        lastUpdateDate: task.lastUpdateDate,
        priority: task.priority,
        status: task.status,
        blockers: task.blockers,
        description: task.description,
        group: task.group ?? "",
        labels: task.labels ?? [],
        dependencies: task.dependencies ?? [],
        // Never hydrated from the live graph — see emptyForm()'s comment.
        successorLinks: [],
        originalEstimateMinutes: task.originalEstimateMinutes,
        timeSpentMinutes: task.timeSpentMinutes,
        resourceId: task.resourceId,
        pushToJira: false,
        healthOverride: task.healthOverride ?? "",
        knowledgeLinks: task.knowledgeLinks ?? [],
      });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setEditingId, setTaskModalOpen, setForm, pendingLinkRaidIdRef, onEditorDiscard],
  );

  return { fieldErrors, submitted, saveDisabled, handleSubmit, handleCancelEdit, openEditModal };
}
