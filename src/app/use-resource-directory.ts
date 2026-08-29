"use client";

// Per-entity CRUD hook for the resource directory (create · edit · delete ·
// bulk · import), including its own editing state. Second of the two
// extractions that took use-resource-planner.ts back under the 800-line limit
// (open-followups §2); mirrors use-calendar-events.ts, which owns its editing
// state the same way.
//
// MOVE ONLY, no behaviour change: every handler keeps the body and the
// memoization form it had in use-resource-planner.ts.
//
// ★ Unlike the reference-data cluster, these handlers DO reach the memo()'d
// components open-followups §1 is about — ResourceDirectory
// (resource-directory.tsx:442) and ResourcesPanel (resources-panel.tsx:682),
// via workspace-section.tsx:487-490 and :539-540. That still does NOT make
// their identities load-bearing: all four that get there arrive wrapped in
// guardEdit(...) (task-manager.tsx:2258-2261), and guardEdit is
// makeEditGuard(...) called unmemoized during render (task-manager.tsx:2041),
// so it mints a fresh identity every render regardless of what this file does.
// The rest (editingResource, handleSaveResource via
// handleSaveResourceFromAnywhere, handleDeleteResource, handleCloseResourceModal)
// reach AppModals (task-manager.tsx:2680), which is a plain function component,
// not memo()'d (app-modals.tsx:113). So preserving the memoization form needs no
// justification beyond this being a move-only commit — don't invent one.
//
// The SIX refs the moved bodies read are re-derived here rather than threaded
// in: exhaustive-deps only knows a value is render-stable when it can see the
// useRef, so threading the ref objects as args would make the rule demand them
// in every dependency array — a change to the memoization form this move is
// forbidden to make. Deriving them locally keeps every dependency array
// byte-identical. `logUpdate` is threaded instead of re-derived because it was
// ALREADY a named dependency of handleSaveResource (so nothing changes) and
// re-deriving it would duplicate a helper the owner still needs.
//
// `plainSeed` moves here but is EXPORTED and imported back by
// use-resource-planner.ts, whose handleOpenAddAbsence still uses it. This
// direction is the acyclic one — the planner already imports this file, so the
// reverse (leaving it there and importing it here) would be a circular value
// import.

import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang } from "./i18n";
import { reportSilentFailure } from "./guard-feedback";
import { resourceDisplayName } from "./resource-foundation";
import { mintId } from "./id-mint-session";
import { type Absence, type Resource, type Shift } from "./types";
import { type ActivityKind } from "./activity-log";
import { useWorkspace } from "./workspace-context";
import { sanitizeResource } from "./sanitize";
import { mergeImportedResources, type OutlookContact } from "./outlook-contacts";
import { capturePart, type UndoStackApi } from "./undo/use-undo-stack";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { RESOURCE_UNDO_GROUPS } from "./undo/field-groups";

// Envelope-level defense against a caller accidentally forwarding a DOM/synthetic
// event as `seed` (e.g. `onClick={onAddResource}`). Spreading an event injects a
// non-cloneable PointerEvent into persisted state, which then crashes
// BroadcastChannel's structured clone. Accept only a plain `{}`-literal envelope
// (this deliberately rejects the rare `Object.create(null)` too); it does NOT
// deep-check property values, so a plain object holding a DOM node still slips
// through — the real guard is not forwarding events in the first place. On
// rejection we warn in dev so a future recurrence surfaces loudly instead of
// degrading to a silently-blank Add draft.
export function plainSeed<T>(seed: T | undefined): T | undefined {
  if (seed == null) return undefined;
  if (Object.getPrototypeOf(seed) === Object.prototype) return seed;
  if (process.env.NODE_ENV !== "production") {
    console.warn("[useResourcePlanner] non-plain seed dropped (event forwarded as seed?)", seed);
  }
  return undefined;
}

/** True when an absence/shift belongs to one of the removed resources — by
 *  stable resourceId first, else case-folded assignee name or email (the same
 *  join the calendar/workload rows use). Lets a resource delete cascade to its
 *  calendar entries so no ghost row (fed by the orphan absence) survives.
 *  The name/email fallback is SKIPPED when a SURVIVING resource shares that key
 *  (e.g. two people named "John Smith") so a delete never sweeps a twin's
 *  entries — only the precise resourceId match deletes in that ambiguous case. */
function recordMatchesRemoved(
  rec: { assignee?: string; assigneeEmail?: string; resourceId?: number | null },
  ids: ReadonlySet<number>,
  names: ReadonlySet<string>,
  emails: ReadonlySet<string>,
  survivingNames: ReadonlySet<string>,
  survivingEmails: ReadonlySet<string>,
): boolean {
  if (rec.resourceId != null && ids.has(rec.resourceId)) return true;
  const n = (rec.assignee ?? "").trim().toLowerCase();
  if (n && names.has(n) && !survivingNames.has(n)) return true;
  const e = (rec.assigneeEmail ?? "").trim().toLowerCase();
  return !!e && emails.has(e) && !survivingEmails.has(e);
}

export interface UseResourceDirectoryArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  /** Capture a pre-op snapshot for undo (resource bulk-edit). */
  capture?: UndoStackApi["capture"];
  /** Capture a MULTI-array pre-op snapshot for undo — a resource delete cascade-
   *  purges the person's absences and shifts, so undo spans three arrays. */
  captureComposite?: UndoStackApi["captureComposite"];
  /** Capture per-field edits for undo (resource modal save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
  /** useResourcePlanner's diff-aware update logger — stable (it reads refs),
   *  and already a declared dependency of handleSaveResource before the move. */
  logUpdate: (
    kind: ActivityKind,
    previous: object | undefined,
    next: object,
    ...args: (string | number)[]
  ) => void;
  /** Arms the one-shot destructive-save bypass. Optional — popouts and tests
   *  supply none. */
  allowDestructiveSave?: () => void;
}

export function useResourceDirectory(args: UseResourceDirectoryArgs) {
  const { resources, setResources, absences, setAbsences, shifts, setShifts } =
    useWorkspace();
  const { logUpdate } = args;

  const langRef = useRef(args.lang);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  const logActivityRef = useRef(args.logActivity);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  const showToastRef = useRef(args.showToast);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  const captureRef = useRef(args.capture);
  useEffect(() => { captureRef.current = args.capture; }, [args.capture]);
  const captureCompositeRef = useRef(args.captureComposite);
  useEffect(() => { captureCompositeRef.current = args.captureComposite; }, [args.captureComposite]);
  const captureFieldEditRef = useRef(args.captureFieldEdit);
  useEffect(() => { captureFieldEditRef.current = args.captureFieldEdit; }, [args.captureFieldEdit]);
  const allowDestructiveRef = useRef(args.allowDestructiveSave);
  useEffect(() => { allowDestructiveRef.current = args.allowDestructiveSave; }, [args.allowDestructiveSave]);

  // ── moved verbatim from use-resource-planner.ts ──

  const [editingResource, setEditingResource] = useState<{
    resource: Resource;
    isNew: boolean;
  } | null>(null);

  const handleOpenAddResource = useCallback(
    (seed?: Partial<Resource>) => {
      const id = mintId("resource", resources);
      const draft: Resource = {
        firstName: "",
        lastName: "",
        roleId: null,
        utilizationMode: "percent",
        utilization: {},
        ...plainSeed(seed),
        id, // authoritative regardless of seed
      };
      setEditingResource({ resource: draft, isNew: true });
    },
    [resources],
  );

  const handleEditResource = useCallback((resource: Resource) => {
    setEditingResource({ resource, isNew: false });
  }, []);

  const handleCloseResourceModal = useCallback(() => setEditingResource(null), []);

  const handleSaveResource = useCallback(
    (next: Resource) => {
      const stamp = new Date().toISOString();
      const name = `${next.firstName} ${next.lastName}`.trim();
      // Decide create-vs-update by the KNOWN modal intent, not by id-existence:
      // the id is minted at modal-OPEN, so a concurrent writer (AI create_resource,
      // another tab, a bulk op) may have committed that id since. Deciding by
      // find(id) would misclassify this create as an update and clobber that row.
      // Non-modal callers (edit-from-anywhere) leave editingResource null → fall
      // back to id-existence, preserving their behavior.
      const isNew = editingResource?.isNew ?? (resources.find((r) => r.id === next.id) === undefined);
      if (isNew) {
        // Re-mint at SAVE time if the open-time id was taken since, so the append
        // can't collide with a row committed while the modal was open.
        const id = resources.some((r) => r.id === next.id) ? mintId("resource", resources) : next.id;
        const created: Resource = { ...next, id, localModifiedAt: stamp };
        setResources((prev) => [...prev, created]);
        setEditingResource(null);
        logActivityRef.current("resource.created", id, name);
      } else {
        const previous = resources.find((r) => r.id === next.id);
        // Editing a row a concurrent writer already deleted: the map-replace below
        // would silently no-op. Surface it instead of dropping the edit in silence.
        if (!previous) {
          reportSilentFailure(showToastRef.current, langRef.current, "resource.editVanished", "concurrent delete during edit", "guardEditVanished");
          setEditingResource(null);
          return;
        }
        const withStamp: Resource = { ...next, localModifiedAt: stamp };
        setResources((prev) => prev.map((r) => (r.id === next.id ? withStamp : r)));
        setEditingResource(null);
        captureFieldChanges(captureFieldEditRef.current, {
          setter: setResources, kind: "resource.updated", id: next.id,
          prev: previous, next: withStamp, groups: RESOURCE_UNDO_GROUPS,
          stampField: "localModifiedAt", name,
        });
        logUpdate("resource.updated", previous, withStamp, next.id, name);
      }
    },
    [resources, setResources, logUpdate, editingResource],
  );

  // Cascade a resource removal to its calendar entries: drop every absence and
  // shift that belongs to a removed resource (else the orphan absence, joined by
  // name, keeps re-creating a ghost calendar row). Functional setters. Returns
  // the purged rows so the caller can fold them into a composite undo (else
  // undo would resurrect the resource but silently lose its calendar entries).
  const purgeCalendarFor = useCallback(
    (removed: readonly Resource[], surviving: readonly Resource[]) => {
      if (removed.length === 0) return { purgedAbsences: [] as Absence[], purgedShifts: [] as Shift[] };
      const ids = new Set(removed.map((r) => r.id));
      const names = new Set(
        removed.map((r) => resourceDisplayName(r).trim().toLowerCase()).filter(Boolean),
      );
      const emails = new Set(
        removed.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean),
      );
      // Keys still owned by a resource that ISN'T being deleted — never sweep a
      // surviving twin's entries on a name/email collision.
      const survivingNames = new Set(
        surviving.map((r) => resourceDisplayName(r).trim().toLowerCase()).filter(Boolean),
      );
      const survivingEmails = new Set(
        surviving.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean),
      );
      const matches = (rec: { assignee?: string; assigneeEmail?: string; resourceId?: number | null }) =>
        recordMatchesRemoved(rec, ids, names, emails, survivingNames, survivingEmails);
      // Snapshot the purged rows from the PRE-op arrays (closure) before the
      // setters run — these are the composite undo's delete-images.
      const purgedAbsences = absences.filter(matches);
      const purgedShifts = shifts.filter(matches);
      if (purgedAbsences.length > 0) setAbsences((prev) => prev.filter((a) => !matches(a)));
      if (purgedShifts.length > 0) setShifts((prev) => prev.filter((s) => !matches(s)));
      return { purgedAbsences, purgedShifts };
    },
    [absences, shifts, setAbsences, setShifts],
  );

  const handleDeleteResource = useCallback(
    (id: number) => {
      const removed = resources.find((r) => r.id === id);
      const surviving = resources.filter((r) => r.id !== id);
      setResources(surviving);
      setEditingResource(null);
      if (removed) {
        // Resource delete cascade-PURGES the person's absences/shifts (FK refs on
        // tasks/RAID are left dangling by design, but calendar rows are deleted).
        // So undo is COMPOSITE: re-insert the resource AND its purged calendar
        // rows — a single-array undo would resurrect the person but lose their
        // absences/shifts. Empty purge parts collapse to null (skipped).
        const { purgedAbsences, purgedShifts } = purgeCalendarFor([removed], surviving);
        const name = `${removed.firstName} ${removed.lastName}`.trim();
        captureCompositeRef.current?.({
          kind: "resource.deleted",
          primaryCount: 1,
          name,
          parts: [
            capturePart({ setter: setResources, removed: [removed], fromArray: resources, isPrimary: true }),
            capturePart({ setter: setAbsences, removed: purgedAbsences, fromArray: absences, fkRemapField: "resourceId" }),
            capturePart({ setter: setShifts, removed: purgedShifts, fromArray: shifts, fkRemapField: "resourceId" }),
          ],
        });
        logActivityRef.current("resource.deleted", id, name);
        allowDestructiveRef.current?.();
      }
    },
    [resources, absences, shifts, setResources, setAbsences, setShifts, purgeCalendarFor],
  );

  // Bulk edit: merge the same patch into every selected resource in ONE
  // functional set (the N-saves-per-tick landmine — a non-functional setter
  // would drop all but the last).
  const handleBulkEditResources = useCallback(
    (ids: readonly number[], patch: Partial<Resource>) => {
      const idSet = new Set(ids);
      const stamp = new Date().toISOString();
      const affected = resources.filter((r) => idSet.has(r.id));
      if (affected.length > 0) captureRef.current?.({ setter: setResources, kind: "bulk.edit", edited: affected, fromArray: resources, entityKey: "resource" });
      setResources((prev) =>
        prev.map((r) => {
          if (!idSet.has(r.id)) return r;
          const merged: Resource = { ...r, ...patch, localModifiedAt: stamp };
          // Route through the single validator so bulk-edited text fields get the
          // same caps the load path applies (never unbounded in JSON/IDB); the
          // merge keeps names intact so it can't return null, but fall back defensively.
          return sanitizeResource(merged) ?? merged;
        }),
      );
      for (const r of affected) {
        logActivityRef.current("resource.updated", r.id, `${r.firstName} ${r.lastName}`.trim());
      }
    },
    [resources, setResources],
  );

  const handleBulkDeleteResources = useCallback(
    (ids: readonly number[]) => {
      const idSet = new Set(ids);
      const removed = resources.filter((r) => idSet.has(r.id));
      const surviving = resources.filter((r) => !idSet.has(r.id));
      setResources((prev) => prev.filter((r) => !idSet.has(r.id)));
      setEditingResource(null);
      const { purgedAbsences, purgedShifts } = purgeCalendarFor(removed, surviving);
      if (removed.length > 0) {
        // Composite: re-insert the deleted resources AND their purged calendar rows.
        captureCompositeRef.current?.({
          kind: "resource.deleted",
          primaryCount: removed.length,
          parts: [
            capturePart({ setter: setResources, removed, fromArray: resources, isPrimary: true }),
            capturePart({ setter: setAbsences, removed: purgedAbsences, fromArray: absences, fkRemapField: "resourceId" }),
            capturePart({ setter: setShifts, removed: purgedShifts, fromArray: shifts, fkRemapField: "resourceId" }),
          ],
        });
        allowDestructiveRef.current?.();
      }
      for (const r of removed) {
        logActivityRef.current("resource.deleted", r.id, `${r.firstName} ${r.lastName}`.trim());
      }
    },
    [resources, absences, shifts, setResources, setAbsences, setShifts, purgeCalendarFor],
  );

  const handleImportResources = useCallback(
    (selected: readonly OutlookContact[]): void => {
      if (selected.length === 0) return;
      setResources((prev) => mergeImportedResources(prev, selected));
    },
    [setResources],
  );

  return {
    editingResource,
    handleOpenAddResource,
    handleEditResource,
    handleCloseResourceModal,
    handleSaveResource,
    handleDeleteResource,
    handleBulkEditResources,
    handleBulkDeleteResources,
    handleImportResources,
  };
}
