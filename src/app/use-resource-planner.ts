"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang } from "./i18n";
import { mintId } from "./id-mint-session";
import { useCalendarEvents } from "./use-calendar-events";
import { useRaidItems } from "./use-raid-items";
import { useReferenceData } from "./use-reference-data";
import { plainSeed, useResourceDirectory } from "./use-resource-directory";
import { generatePeriods, convertUtilization } from "./resource-capacity";
import { DEFAULT_WEEK_HOURS, type Absence, type AbsenceType, type Shift, type Task } from "./types";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { useWorkspace } from "./workspace-context";
import { descriptionHtml } from "./rich-text-plain";
import { RICH_SINK } from "./html-start";
import { eventsToAbsences, type AbsenceImportTarget, type OutlookEvent } from "./outlook-calendar";
import { type UndoStackApi } from "./undo/use-undo-stack";

function emptyAbsenceDraft(id: number, today: string): Absence {
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

export interface UseResourcePlannerArgs {
  lang: Lang;
  /** Today (YYYY-MM-DD) in the resolved effective timezone, from the caller. */
  today: string;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  /** Capture a pre-op snapshot for undo (RAID/absence/shift delete, resource bulk-edit). */
  capture?: UndoStackApi["capture"];
  /** Capture a MULTI-array pre-op snapshot for undo. Forwarded to both sub-hooks:
   *  reference-data deletes (role/discipline/grade) that cascade an edit into a
   *  second array, and resource deletes (resources + absences + shifts) and
   *  email-correcting resource saves in `use-resource-directory.ts`. */
  captureComposite?: UndoStackApi["captureComposite"];
  /** Capture per-field edits for undo (RAID/resource modal save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
  /** Capture a bulk field-patch edit for undo (RAID bulk apply).
   *  ★★ REQUIRED while its three siblings above stay OPTIONAL, and that split is
   *  deliberate: it is driven by TEST-HARNESS SHAPE, not by importance. Both
   *  test files for this hook build their args through a `makeArgs` factory —
   *  one per file, not one shared:
   *    grep -n "function makeArgs" src/app/use-resource-planner.test.tsx src/app/use-resource-planner.undo.test.tsx
   *  so requiring it costs one stub per FILE rather than one per call site, while
   *  making a dropped wire — which silently un-does the RAID bulk edit — a
   *  typecheck failure. The equivalent change on `use-change-log` /
   *  `use-stakeholders` was deliberately REJECTED: their call sites are inline
   *  object literals, and a required prop that every site satisfies with a no-op
   *  stub LOOKS wired and is not — worse than an honest optional. Do NOT
   *  "harmonise" the two directions in either sense. Enumerate those call sites
   *  with the following — no count is quoted because the output also carries
   *  comment lines naming either hook, so read it rather than counting it:
   *    grep -rn "useChangeLog(\|useStakeholders(" src/app --include=*.ts --include=*.tsx | grep -v "export function"
   */
  captureFieldRows: UndoStackApi["captureFieldRows"];
  /** Arms the one-shot destructive-save bypass. Optional — popouts and tests
   *  supply none. */
  allowDestructiveSave?: () => void;
}

export function useResourcePlanner(args: UseResourcePlannerArgs) {
  const {
    tasks,
    setTasks,
    raid,
    setRaid,
    absences,
    setAbsences,
    shifts,
    setShifts,
    resources,
    setResources,
    plan,
    setPlan,
  } = useWorkspace();

  const { workdayHours, holidaySet, today } = args;

  // ★★ Callbacks read `argsRef.current.x`, never `args.x` — they do not list
  //    `args` in their deps arrays, and `react-hooks/exhaustive-deps` is FATAL
  //    here. ONE mirror of the whole bag, refreshed after every commit, instead
  //    of a ref per arg (§61 (c)); the `useRef` must stay visible in this file,
  //    because exhaustive-deps only treats a value as stable when it can see it.
  const argsRef = useRef(args);
  useEffect(() => { argsRef.current = args; });
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // Log an UPDATE with a per-field diff (#22) when a diff logger + previous
  // snapshot are available; else fall back to the plain (changes-less) log so
  // callers wiring only logActivity still record the event. Reads refs so it's
  // stable (useCallback []) and safe inside the memoised handlers.
  const logUpdate = useCallback(
    (
      kind: ActivityKind,
      previous: object | undefined,
      next: object,
      ...args: (string | number)[]
    ): void => {
      if (previous && argsRef.current.logActivityChanges) {
        argsRef.current.logActivityChanges(kind, diffFields(previous, next), ...args);
      } else {
        argsRef.current.logActivity(kind, ...args);
      }
    },
    [],
  );

  const [editingAbsence, setEditingAbsence] = useState<{
    absence: Absence;
    isNew: boolean;
  } | null>(null);

  const [editingShift, setEditingShift] = useState<{
    shift: Shift;
    isNew: boolean;
  } | null>(null);

  // RAID CRUD (save/delete/inquiry/bulk-undo) extracted to use-raid-items.ts (§61).
  const raidItemsApi = useRaidItems({ lang: args.lang, today, logActivity: args.logActivity, showToast: args.showToast, capture: args.capture, captureFieldEdit: args.captureFieldEdit, captureFieldRows: args.captureFieldRows, logUpdate, allowDestructiveSave: args.allowDestructiveSave });

  const handleOpenAddAbsence = useCallback(
    (seed?: Partial<Absence>) => {
      const nextId = mintId("absence", absences);
      const draft: Absence = {
        ...emptyAbsenceDraft(nextId, today),
        ...plainSeed(seed),
        id: nextId,
      };
      setEditingAbsence({ absence: draft, isNew: true });
    },
    [absences, today],
  );

  const handleImportAbsences = useCallback(
    (
      rows: readonly { event: OutlookEvent; type: AbsenceType }[],
      target: AbsenceImportTarget,
    ): void => {
      if (rows.length === 0) return;
      const stamp = new Date().toISOString();
      setAbsences((prev) => eventsToAbsences(rows, prev, target, stamp));
    },
    [setAbsences],
  );

  const handleEditAbsence = useCallback((absence: Absence) => {
    setEditingAbsence({ absence, isNew: false });
  }, []);

  const handleCloseAbsenceModal = useCallback(() => {
    setEditingAbsence(null);
  }, []);

  const handleSaveAbsence = useCallback(
    (next: Absence) => {
      const stamp = new Date().toISOString();
      const withStamp: Absence = { ...next, localModifiedAt: stamp };
      const existing = absences.find((a) => a.id === next.id);
      if (existing) {
        setAbsences((prev) =>
          prev.map((a) => (a.id === next.id ? withStamp : a)),
        );
        logUpdate(
          "absence.updated",
          existing,
          withStamp,
          next.id,
          next.assignee,
          next.startDate,
          next.endDate,
        );
      } else {
        setAbsences((prev) => [...prev, withStamp]);
        argsRef.current.logActivity(
          "absence.created",
          next.id,
          next.assignee,
          next.startDate,
          next.endDate,
        );
      }
      setEditingAbsence(null);
    },
    [absences, setAbsences, logUpdate],
  );

  const handleDeleteAbsence = useCallback(
    (id: number) => {
      const removed = absences.find((a) => a.id === id);
      if (removed) argsRef.current.capture?.({ setter: setAbsences, kind: "absence.deleted", removed: [removed], fromArray: absences, name: removed.assignee });
      setAbsences((prev) => prev.filter((a) => a.id !== id));
      if (removed) {
        argsRef.current.logActivity("absence.deleted", id, removed.assignee);
        argsRef.current.allowDestructiveSave?.();
      }
      setEditingAbsence(null);
    },
    [absences, setAbsences],
  );

  // CRUD extracted to use-calendar-events.ts (useChangeLog/useStakeholders convention).
  const calendarEventsApi = useCalendarEvents({ today, logActivity: args.logActivity, logActivityChanges: args.logActivityChanges, capture: args.capture, captureFieldEdit: args.captureFieldEdit, allowDestructiveSave: args.allowDestructiveSave });

  // Reference-data (roles/disciplines/grades) CRUD extracted to use-reference-data.ts.
  const referenceDataApi = useReferenceData({ logActivity: args.logActivity, captureComposite: args.captureComposite, logUpdate, allowDestructiveSave: args.allowDestructiveSave });

  // Resource-directory CRUD (create/edit/delete/bulk/import) extracted to use-resource-directory.ts.
  const resourceDirectoryApi = useResourceDirectory({ lang: args.lang, logActivity: args.logActivity, showToast: args.showToast, capture: args.capture, captureComposite: args.captureComposite, captureFieldEdit: args.captureFieldEdit, logUpdate, allowDestructiveSave: args.allowDestructiveSave });

  const handleOpenShiftEditor = useCallback(
    (existing: Shift | null, seed: { display: string; email: string }) => {
      if (existing) {
        setEditingShift({ shift: existing, isNew: false });
        return;
      }
      const nextId = mintId("shift", shifts);
      const draft: Shift = {
        ...emptyShiftDraft(nextId),
        assignee: seed.display,
        assigneeEmail: seed.email || undefined,
      };
      setEditingShift({ shift: draft, isNew: true });
    },
    [shifts],
  );

  const handleCloseShiftModal = useCallback(() => {
    setEditingShift(null);
  }, []);

  const handleSaveShift = useCallback(
    (next: Shift) => {
      const stamp = new Date().toISOString();
      const withStamp: Shift = { ...next, localModifiedAt: stamp };
      const existing = shifts.find((s) => s.id === next.id);
      if (existing) {
        setShifts((prev) =>
          prev.map((s) => (s.id === next.id ? withStamp : s)),
        );
        logUpdate("shift.updated", existing, withStamp, next.id, next.assignee);
      } else {
        setShifts((prev) => [...prev, withStamp]);
        argsRef.current.logActivity("shift.created", next.id, next.assignee);
      }
      setEditingShift(null);
    },
    [shifts, setShifts, logUpdate],
  );

  const handleDeleteShift = useCallback(
    (id: number) => {
      const removed = shifts.find((s) => s.id === id);
      if (removed) argsRef.current.capture?.({ setter: setShifts, kind: "shift.deleted", removed: [removed], fromArray: shifts, name: removed.assignee });
      setShifts((prev) => prev.filter((s) => s.id !== id));
      if (removed) {
        argsRef.current.logActivity("shift.deleted", id, removed.assignee);
        argsRef.current.allowDestructiveSave?.();
      }
      setEditingShift(null);
    },
    [shifts, setShifts],
  );

  const handleCreateMitigationTaskFromRaid = useCallback(
    (raidItemId: number): number | null => {
      const item = raid.find((r) => r.id === raidItemId);
      if (!item) return null;
      const list = tasksRef.current;
      const newId = mintId("task", list);
      const stamp = new Date().toISOString();
      const newTask: Task = {
        id: newId,
        taskName: item.title,
        assignee: item.owner ?? "",
        assigneeEmail: item.ownerEmail ?? "",
        dueDate: item.targetDate ?? today,
        lastUpdateDate: today,
        priority: "Medium",
        status: "To Do",
        blockers: "",
        // Both fields are rich HTML since slice B: UPGRADE (pass HTML through,
        // wrap legacy plain text) instead of escaping an already-HTML value a
        // second time, which would render markup as visible text.
        // ★★★ The sink is the DESTINATION field's, never the SOURCE field's —
        // still the rule, though source and destination now agree: both a RAID
        // `mitigation`/`description` and `Task.description` are "rich" fields
        // sanitized by `sanitizeRichHtml`, so there is no longer a narrower list
        // on either side to classify against.
        // ★★★ THIS COMMENT USED TO DESCRIBE A DEFECT THAT IS NOW CLOSED, and the
        // measurement is kept because the CLOSURE is the non-obvious part. The
        // destination's save ran `sanitizeNoteHtml` — 8 tags at KEEP_CONTENT:
        // false — so an AI-authored heading copied through as live markup was
        // silently deleted on the first human Save. Choosing the destination's
        // (narrower) sink stored it ESCAPED instead, which saved the words but
        // only when the disallowed tag LED the value: `descriptionHtml`
        // classifies on the FIRST tag, so a mid-value <h2> was invisible to it
        // and the save ate it either way. Measured 2026-08-10:
        //   A leading  "<h2>Plan</h2><p>steps</p>"
        //     "template" stored as-is        -> save "<p>steps</p>"        Plan GONE
        //     "note"     stored escaped      -> save unchanged             Plan KEPT
        //   B mid-value "<p>Intro</p><h2>Plan</h2><p>steps</p>"
        //     "template" stored as-is        -> save "<p>Intro</p><p>steps</p>"  Plan GONE
        //     "note"     stored as-is        -> save "<p>Intro</p><p>steps</p>"  Plan GONE
        // ★★ Case B needed the value SANITIZED to the destination's allow-list,
        // not merely classified against it — which is what one shared sanitizer
        // delivers. Re-measured 2026-08-11: BOTH A and B store as-is and save
        // BYTE-IDENTICAL, heading intact. §137 CLOSED, case B included.
        description: descriptionHtml(item.mitigation ?? item.description ?? "", RICH_SINK),
        inquiriesSent: 0,
        localModifiedAt: stamp,
      };
      const nextList = [...list, newTask];
      tasksRef.current = nextList;
      setTasks(nextList);
      setRaid((prev) =>
        prev.map((r) =>
          r.id === raidItemId
            ? {
                ...r,
                linkedTaskIds: [...r.linkedTaskIds, newId],
                localModifiedAt: stamp,
              }
            : r,
        ),
      );
      return newId;
    },
    [raid, setRaid, setTasks, today],
  );

  const handleSetUtilization = useCallback(
    (resourceId: number, periodKey: string, value: number) => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId
            ? { ...r, utilization: { ...r.utilization, [periodKey]: value }, localModifiedAt: stamp }
            : r,
        ),
      );
    },
    [setResources],
  );

  const handleSetAllUtilizationMode = useCallback(
    (mode: "percent" | "hours") => {
      if (resources.every((r) => r.utilizationMode === mode)) return;
      const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.utilizationMode === mode
            ? r
            : {
                ...r,
                utilizationMode: mode,
                utilization: convertUtilization(r.utilization, r.utilizationMode, mode, periods, workdayHours, holidaySet),
                localModifiedAt: stamp,
              },
        ),
      );
    },
    [resources, plan, workdayHours, holidaySet, setResources],
  );

  const handleSetAbsenceOverride = useCallback(
    (resourceId: number, periodKey: string, hours: number | null) => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) => {
          if (r.id !== resourceId) return r;
          const next = { ...(r.absenceOverride ?? {}) };
          if (hours == null) delete next[periodKey];
          else next[periodKey] = hours;
          const out = { ...r, localModifiedAt: stamp } as typeof r;
          if (Object.keys(next).length > 0) out.absenceOverride = next;
          else delete out.absenceOverride;
          return out;
        }),
      );
    },
    [setResources],
  );

  const handleSetPlanWindow = useCallback(
    (startDate: string, endDate: string) => {
      setPlan((prev) => ({ ...prev, startDate, endDate }));
    },
    [setPlan],
  );

  const handleSetPlanGranularity = useCallback(
    (granularity: "week" | "month") => {
      setPlan((prev) => ({ ...prev, granularity }));
    },
    [setPlan],
  );

  const handleSetBudgetFollowsPlan = useCallback(
    (v: boolean) => {
      setPlan((prev) => ({ ...prev, budgetFollowsPlan: v }));
    },
    [setPlan],
  );

  return {
    editingAbsence,
    editingShift,
    ...resourceDirectoryApi,
    ...raidItemsApi,
    handleOpenAddAbsence,
    handleImportAbsences,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    ...calendarEventsApi,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
    ...referenceDataApi,
    handleSetUtilization,
    handleSetAllUtilizationMode,
    handleSetAbsenceOverride,
    handleSetPlanWindow,
    handleSetPlanGranularity,
    handleSetBudgetFollowsPlan,
  };
}
