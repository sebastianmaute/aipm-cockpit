"use client";

// Per-entity CRUD hook for RAID items: save, delete, owner inquiry and the bulk-edit
// undo capture. Extracted from use-resource-planner.ts (open-followups §61 (d)) — RAID
// is not resource planning, and these four handlers were a self-contained block there.
// `handleCreateMitigationTaskFromRaid` stays in the planner: it writes TASKS too, so
// it belongs with the hook that already owns the tasks ref.
//
// MOVE ONLY: every body and dependency array is the one it had in the planner. The
// args are read through one `argsRef` derived here rather than threaded in, for the
// reason use-reference-data.ts's header gives — exhaustive-deps only treats a value as
// stable when it can see the useRef. `logUpdate` is threaded, as it is for both sibling hooks.

import { useCallback, useEffect, useRef } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import { buildRaidInquiryMailto, resolveRaidOwnerEmail } from "./raid-inquiry";
import { type RaidEscalation, type RaidItem } from "./types";
import { type ActivityKind } from "./activity-log";
import { useWorkspace } from "./workspace-context";
import { isWriteSafeEmail, sanitizeLoadedEmail } from "./sanitize";
import { typedEmailRefusalKey } from "./email-refusal-i18n";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { RAID_UNDO_GROUPS } from "./undo/field-groups";

export interface UseRaidItemsArgs {
  lang: Lang;
  /** Today (YYYY-MM-DD) in the resolved effective timezone — an auto-raised Issue's raisedDate. */
  today: string;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  /** Capture a pre-op snapshot for undo (RAID delete). */
  capture?: UndoStackApi["capture"];
  /** Capture per-field edits for undo (RAID modal save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
  /** Capture a bulk field-patch edit for undo (RAID bulk apply). Required on
   *  `UseResourcePlannerArgs` — read the reason there. */
  captureFieldRows: UndoStackApi["captureFieldRows"];
  /** useResourcePlanner's diff-aware update logger — stable (it reads refs). */
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

export function useRaidItems(args: UseRaidItemsArgs) {
  const { raid, setRaid, resources } = useWorkspace();
  const { today, logUpdate } = args;

  const argsRef = useRef(args);
  useEffect(() => { argsRef.current = args; });

  // isNew carries the modal's create/edit intent so a create can't be misread as
  // an update and clobber a row committed since the modal opened (id-mint race).
  // Non-modal callers (bulk edit) omit it → id-existence fallback (unchanged).
  const handleSaveRaidItem = useCallback(
    (item: RaidItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }): number | undefined => {
      const stamp = new Date().toISOString();
      const { create, id } = resolveEntitySave(raid, item.id, isNew, () => nextRaidId(raid));
      // Only a genuine UPDATE of an existing Risk can auto-raise an Issue; a create
      // (re-minted id) has no meaningful `previous`.
      const previous = create ? undefined : raid.find((r) => r.id === id);
      // ★★★ `noteLog` AND `escalations` from the STORED row, never the payload — both
      // are write-through (notes window; Escalate CTA, §515) while the always-mounted
      // RAID editor's snapshot goes stale. Read open-followups §48 before editing.
      // ★★ Severity too, but ONLY when the stale draft still holds the value an escalation
      //   raised FROM — a deliberate change to any other severity in the editor wins.
      //   The comparison is against the FIRST escalation the draft has not seen that carries
      //   a `fromSeverity` — i.e. the severity the draft snapshotted — never the LAST one: a
      //   second raise (from the already-raised value) or a later notify-only entry would
      //   otherwise let the stale draft undo the raise. Both reads tolerate a non-array
      //   (JSON and IndexedDB load RAID rows unvalidated).
      const storedEscRaw: unknown = previous?.escalations;
      const storedEsc: readonly Partial<RaidEscalation>[] = Array.isArray(storedEscRaw) ? storedEscRaw : [];
      const draftEscRaw: unknown = item.escalations;
      const draftEscCount = Array.isArray(draftEscRaw) ? draftEscRaw.length : 0;
      const firstUnseenFrom = storedEsc.slice(draftEscCount).find((e) => e?.fromSeverity !== undefined)?.fromSeverity;
      const keepEscalatedSeverity =
        !create && previous !== undefined && storedEsc.length > draftEscCount &&
        firstUnseenFrom !== undefined && item.severity === firstUnseenFrom;
      const withStamp: RaidItem = {
        ...item, id, localModifiedAt: stamp,
        ...(create ? {} : { noteLog: previous?.noteLog, escalations: previous?.escalations }),
        ...(keepEscalatedSeverity ? { severity: previous?.severity } : {}),
      };
      // Editing a row a concurrent writer already deleted: the map-replace below
      // would silently no-op. Surface it instead of dropping the edit in silence.
      if (!create && !previous) {
        reportSilentFailure(argsRef.current.showToast, argsRef.current.lang, "raid.editVanished", "concurrent delete during edit", "guardEditVanished");
        return undefined;
      }

      const triggersAutoIssue =
        previous !== undefined &&
        item.category === "R" &&
        previous.status !== "Realized" &&
        item.status === "Realized" &&
        !raid.some((r) => r.category === "I" && r.causedByRaidIds.includes(id));

      let autoIssueId: number | null = null;
      let autoIssue: RaidItem | null = null;
      if (triggersAutoIssue) {
        // Derive the auto-issue id off the closure WITH this update applied so it
        // can't collide with the item being saved.
        const baseList = raid.map((r) => (r.id === id ? withStamp : r));
        autoIssueId = nextRaidId(baseList);
        autoIssue = {
          id: autoIssueId,
          category: "I",
          title: item.title,
          description: item.description,
          severity: item.severity,
          status: "Open",
          owner: item.owner,
          ownerEmail: item.ownerEmail,
          mitigation: undefined,
          linkedTaskIds: [],
          causedByRaidIds: [id],
          stakeholderIds: [],
          raisedDate: today,
          targetDate: item.targetDate,
          localModifiedAt: stamp,
        };
      }

      // Functional updater so bulk (N saves in one tick) composes instead of each
      // call clobbering the last.
      setRaid((prev) => {
        const base = create ? [...prev, withStamp] : prev.map((r) => (r.id === id ? withStamp : r));
        return autoIssue ? [...base, autoIssue] : base;
      });
      if (autoIssue) {
        argsRef.current.showToast(
          "info",
          t(argsRef.current.lang, "raidAutoCreatedIssue", id, autoIssueId ?? 0),
        );
      }

      if (!create && previous && !opts?.suppressFieldUndo) {
        captureFieldChanges(argsRef.current.captureFieldEdit, {
          setter: setRaid, kind: "raid.updated", id,
          prev: previous, next: withStamp, groups: RAID_UNDO_GROUPS,
          stampField: "localModifiedAt", name: item.title,
        });
      }

      if (create) {
        argsRef.current.logActivity("raid.created", id, item.category, item.title);
      } else if (previous && previous.status !== item.status) {
        argsRef.current.logActivity("raid.statusChanged", id, previous.status, item.status);
      } else {
        logUpdate("raid.updated", previous, withStamp, id, item.category, item.title);
      }
      if (autoIssueId !== null) {
        argsRef.current.logActivity("raid.autoIssue", id, autoIssueId);
      }
      // The COMMITTED id — re-minted by `resolveEntitySave` when the open-time id
      // was taken. "Log as RAID" links the insight to THIS, never to draft.id (§515).
      return id;
    },
    [raid, setRaid, today, logUpdate],
  );

  const handleDeleteRaidItem = useCallback(
    (id: number) => {
      const removed = raid.find((r) => r.id === id);
      if (removed) argsRef.current.capture?.({ setter: setRaid, kind: "raid.deleted", removed: [removed], fromArray: raid, name: removed.title });
      setRaid((prev) => prev.filter((r) => r.id !== id));
      if (removed) {
        argsRef.current.logActivity("raid.deleted", id, removed.category, removed.title);
        argsRef.current.allowDestructiveSave?.();
      }
    },
    [raid, setRaid],
  );

  // Send a status-inquiry email to a RAID item's owner (mirrors the task
  // `onSendInquiry`): resolve the owner's LIVE email, open a mailto, and bump
  // `inquiriesSent` via a FUNCTIONAL setter (the bulk-edit landmine — a stale
  // closure value would drop concurrent bumps).
  const handleSendRaidInquiry = useCallback(
    (item: RaidItem) => {
      const lang = argsRef.current.lang;
      const byId = new Map(resources.map((r) => [r.id, r]));
      let email = resolveRaidOwnerEmail(item, byId);
      if (!email && isWriteSafeEmail(item.owner ?? "")) email = (item.owner ?? "").trim();
      if (!email) {
        const provided = window.prompt(t(lang, "promptEmail", item.owner || item.title), "");
        if (provided === null) return;
        const trimmed = sanitizeLoadedEmail(provided); // M-C4: the unwrapped address, as every AI write stores
        if (!isWriteSafeEmail(trimmed)) {
          window.alert(t(lang, typedEmailRefusalKey(trimmed)));
          return;
        }
        email = trimmed;
        setRaid((prev) => prev.map((r) => (r.id === item.id ? { ...r, ownerEmail: trimmed } : r)));
      }
      window.location.href = buildRaidInquiryMailto(item, email, lang);
      setRaid((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, inquiriesSent: (r.inquiriesSent ?? 0) + 1 } : r)),
      );
    },
    [resources, setRaid],
  );

  // Called by raid-panel BEFORE its save loop, with the field patches the bulk
  // form is about to write. Field patches rather than whole rows: a whole-row
  // capture reverts anything a concurrent writer changed on these rows meanwhile
  // — a note added through the notes window, an outlookEventId stamped by the
  // background calendar push (open-followups §50).
  const captureRaidBulkUndo = useCallback(
    (edits: readonly { id: number; before: Partial<RaidItem>; after: Partial<RaidItem> }[]) => {
      // `stampField` matches the tasks bulk edit. §181 asked which of the two
      // registers was right and deliberately declined to guess; the measurement
      // is that RAID has TWO behavioural readers of this field — `raidLastTouch`
      // (`insights/detect.ts`, the aging insight) and `lastTouch`
      // (`raid-review.ts`, feeding `daysSinceReview`). The bulk APPLY stamps every
      // written row (`handleSaveRaid`'s `withStamp`; `suppressFieldUndo` suppresses
      // only the undo capture, never the stamp), so an undo that does not re-stamp
      // leaves the apply's timestamp on a row whose content moved backwards and
      // both readers report a reverted item as freshly touched.
      // ★ All four registers stamp as of open-followups §289 — milestones was
      // the last holdout and now stamps on the apply, the single-row capture
      // and the bulk capture alike. This comment used to record the opposite
      // ("milestones deliberately still does NOT stamp"), which was true when
      // §181 closed and became false without anything flagging it.
      if (edits.length) argsRef.current.captureFieldRows({ setter: setRaid, kind: "bulk.edit", edits, entityKey: "raid", stampField: "localModifiedAt" });
    },
    [setRaid],
  );

  return { handleSaveRaidItem, handleDeleteRaidItem, handleSendRaidInquiry, captureRaidBulkUndo };
}
