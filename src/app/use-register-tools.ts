// src/app/use-register-tools.ts — the sixteen register-CRUD tools the AI chat
// calls through ToolDispatcher: RAID, changes, milestones and stakeholders
// (list/create/update/delete each). Extracted from use-chat-dispatcher.ts,
// which sat one line under the 800-line ratchet, verbatim apart from the
// dropped `args.` prefix (24 lines); the bodies, their comments and their
// order are unchanged.
//
// ★★ NOT coverage-excluded, for the same reason use-document-tools.ts is not
// (see its header): these are real decisions — what each model input is
// sanitized to, and which activity kind and ARITY each write logs — not
// render-scope UI glue. They stay covered through use-chat-dispatcher.test.tsx's
// existing renderDispatcher/runTool harness, because they are still reached
// through the same dispatcher object.
//
// ★★★ THE CLOCK AND SETTINGS REFS ARE PASSED IN, NOT RE-MINTED HERE. A second
// `useRef(args.clock)` in this file would be a second copy of the §159 clock
// bag refreshed by a second effect, and the entire value of that bag is that
// there is exactly ONE place to read the project's day from. The four register
// refs below have no reader outside this file, so those DO move.
//
// ★★ Every write refuses in a read-only popout, exactly as before. ★ The reason
// that used to be given here — "chat tool writes take no undo capture, so a
// mirror window must never reach a setter" — was true when written and is now
// false: every update and delete below captures. The RULE is unchanged; a
// popout owns no undo stack of its own, so a write reaching a setter there
// would still be unrecoverable in that window.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import { AI_RICH_FIELDS, withAiRichFields } from "./ai-rich-text";
import { applyChangeStatus, applyModelChangeStatus, withStoredNoteLog } from "./change-log";
import {
  type ToolDispatcher,
  toRaidSummary,
  toChangeSummary,
  toMilestoneSummary,
  toStakeholderSummary,
} from "./chat-tools";
import { t } from "./i18n";
import { mintId } from "./id-mint-session";
import {
  dropUnacceptedChangeFields,
  dropUnacceptedMilestoneFields,
  dropUnacceptedRaidFields,
  dropUnacceptedStakeholderFields,
  sanitizeIsoDate,
  sanitizeRaidItem,
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeStakeholder,
} from "./sanitize";
import type { Settings } from "./settings-types";
import type { ProjectClock } from "./timezone";
import { capturePart, type UndoStackApi } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";

/** The register slice of `ToolDispatcher` — derived from it with `Pick` rather
 *  than re-declared, so a signature change on the tool contract lands here as a
 *  type error instead of as a silently divergent second declaration. */
export type RegisterToolDispatcher = Pick<
  ToolDispatcher,
  | "listRaid"
  | "getRaidRow"
  | "getChangeRow"
  | "getMilestoneRow"
  | "getStakeholderRow"
  | "createRaid"
  | "updateRaid"
  | "deleteRaid"
  | "listChanges"
  | "createChange"
  | "updateChange"
  | "deleteChange"
  | "listMilestones"
  | "createMilestone"
  | "updateMilestone"
  | "deleteMilestone"
  | "listStakeholders"
  | "createStakeholder"
  | "updateStakeholder"
  | "deleteStakeholder"
>;

export interface RegisterToolsDeps {
  /** True in a popout/mirror window — every write below refuses. */
  isReadOnly: boolean;
  logActivityAs?: LogActivityAsFn;
  /** Arms the one-shot destructive-save bypass. Optional: the dispatcher
   *  renders in contexts (tests, popouts) that supply none. */
  allowDestructiveSave?: () => void;
  /** Owned by use-chat-dispatcher; see the ★★★ note at the top of this file. */
  clockRef: RefObject<ProjectClock>;
  /** Owned by use-chat-dispatcher — read only for the read-only refusal's language. */
  settingsRef: RefObject<Settings>;
  /** Undo capture for the eight update/delete writers below, as a REF owned by
   *  use-chat-dispatcher (which syncs it from `ChatDispatcherArgs.undo`).
   *  ★★ A REF, not the value: the memo below is exhaustive on purpose and lists
   *  no ref objects, so passing the live API would either be read stale from
   *  inside the memo or force a new dep that moves every register writer's
   *  identity whenever the undo stack re-renders. A ref object is stable, and
   *  `.current` is read at CALL time, which is what the memo needs.
   *  ★★ `.current` being typed `| undefined` is SLACK IN THIS TYPE, NOT a design
   *  choice shared with `ChatDispatcherArgs.undo`. That prop is REQUIRED, and its
   *  docblock records the measurement that made it so: while it was `undo?:`,
   *  deleting `undo: undoApi` from `task-manager.tsx` — its ONLY production call
   *  site — was green on eslint, on `npx tsc --noEmit` AND on the whole unit
   *  suite while all fourteen capture sites silently stopped capturing. So do NOT
   *  read the `?.` below as precedent for restoring that `?`.
   *  ★ The sole producer is `useRef(args.undo)` in `use-chat-dispatcher.ts`,
   *  seeded from that required prop, so `.current` is never actually undefined at
   *  any site below; the `?.` is defence this widened type still makes
   *  mandatory. */
  undoRef: RefObject<Pick<UndoStackApi, "captureComposite"> | undefined>;
}

export function useRegisterTools(deps: RegisterToolsDeps): RegisterToolDispatcher {
  const { isReadOnly, logActivityAs, clockRef, settingsRef, allowDestructiveSave, undoRef } = deps;
  const {
    raid,
    setRaid,
    changes,
    setChanges,
    milestones,
    setMilestones,
    stakeholders,
    setStakeholders,
  } = useWorkspace();

  // Refs, so this object's identity stays stable across register edits and so
  // back-to-back tool calls in one turn read each other's writes — the same
  // pattern use-chat-dispatcher keeps for every other slice.
  const raidRef = useRef(raid);
  const changesRef = useRef(changes);
  const milestonesRef = useRef(milestones);
  const stakeholdersRef = useRef(stakeholders);
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

  // Shared read-only refusal for the write tools (popout/mirror windows).
  // ★ useCallback, unlike the plain arrow this was in use-chat-dispatcher: a
  // fresh arrow each render is a dep the memo below cannot honestly carry, and
  // the whole point of that dep array is that it needs no exhaustive-deps
  // escape hatch. `settingsRef` is stable, so this identity never changes.
  const readOnlyError = useCallback(
    () => new Error(t(settingsRef.current.language, "popoutReadOnly")),
    [settingsRef],
  );

  // ★★★ Every writer below ends its SUCCESS path with one `logActivityAs?.`
  // call, AFTER the setter and AFTER every reject guard. Arity is UNCHECKED by
  // the type system and is NOT uniform across kinds — read `logActivityAs` on
  // `ChatDispatcherArgs` before adding or editing one.

  return useMemo<RegisterToolDispatcher>(
    () => ({
      listRaid: () => raidRef.current.map(toRaidSummary),
      listChanges: () => changesRef.current.map(toChangeSummary),
      listMilestones: () => milestonesRef.current.map(toMilestoneSummary),
      listStakeholders: () => stakeholdersRef.current.map(toStakeholderSummary),

      // FULL rows, for the concurrency token only — never a model-facing read.
      // The four `list*` summaries above drop the rich fields (`description`,
      // `mitigation`, …), so a token hashed from one of them would be identical
      // before and after an edit to any dropped field: a false PERMIT.
      getRaidRow: (id: number) => raidRef.current.find((r) => r.id === id) ?? null,
      getChangeRow: (id: number) => changesRef.current.find((c) => c.id === id) ?? null,
      getMilestoneRow: (id: number) => milestonesRef.current.find((m) => m.id === id) ?? null,
      getStakeholderRow: (id: number) => stakeholdersRef.current.find((s) => s.id === id) ?? null,

      // ★★★ THE FOUR `create*` WRITERS BELOW CAPTURE NO UNDO, DELIBERATELY, and
      // that is true of all four — do not "complete the pattern" at any of them.
      // `UndoOp` is "delete" | "edit" and the undo direction never removes, so a
      // create captured as a `removed` image finds its row still live at undo
      // time, takes `applyUndoRestoreWithRemap`'s id-reuse branch and splices in
      // a SECOND copy. The full reasoning, measured, is at `createTask` in
      // use-chat-dispatcher.ts. Every update and delete here DOES capture.
      createRaid: (input) => {
        if (isReadOnly) throw readOnlyError();
        const id = mintId("raid", raidRef.current);
        const sanitized = sanitizeRaidItem({
          ...withAiRichFields(input, AI_RICH_FIELDS.raid),
          id,
          raisedDate: input.raisedDate || clockRef.current.today,
          linkedTaskIds: input.linkedTaskIds ?? [],
          causedByRaidIds: input.causedByRaidIds ?? [],
          stakeholderIds: input.stakeholderIds ?? [],
        });
        if (!sanitized) throw new Error("invalid RAID item: title is required");
        // A malformed date the model supplied is dropped to "" by the sanitizer;
        // fall back to today so a created item always carries a raised date.
        const item = sanitized.raisedDate
          ? sanitized
          : { ...sanitized, raisedDate: clockRef.current.today };
        const next = [...raidRef.current, item];
        raidRef.current = next;
        setRaid(next);
        // THREE args — "RAID #{0} created ({1}): {2}".
        logActivityAs?.("ai", "raid.created", item.id, item.category, item.title);
        return toRaidSummary(item);
      },
      updateRaid: (id, patch) => {
        if (isReadOnly) throw readOnlyError();
        const existing = raidRef.current.find((r) => r.id === id);
        if (!existing) return null;
        // ★★★ `dropUnacceptedRaidFields` FIRST — `sanitizeRaidItem` rebuilds a
        // whole record, so a value it refuses CLEARS the merged field rather
        // than leaving the stored one alone (or resets it to a hardcoded
        // default, for `category`/`status`). The AI edit preview refuses those
        // same values and shows the field as unchanged, so without this the
        // card says "unchanged" while the write wipes a populated field. Guard
        // here and never in the sanitizer: that runs on JSON load, CSV decode,
        // template apply and AI proposal too, where there IS no prior value.
        // Mirrors `applyModelChangeStatus`, applied one field over.
        const merged = sanitizeRaidItem({
          ...existing,
          // ★ Guard OUTSIDE, matching milestone — see the note at that call
          // site for why the order is load-bearing. It is behaviour-NEUTRAL
          // here today: `RAID_FIELD_GUARDS`' keys (category, status, severity,
          // probability, impact, and the three dates) are disjoint from
          // `AI_RICH_FIELDS.raid` (description, mitigation), so neither pass
          // can see what the other writes. Nested this way the trap is disarmed
          // for whoever adds a rich field to the guard table.
          ...withAiRichFields(dropUnacceptedRaidFields(patch, existing), AI_RICH_FIELDS.raid),
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid RAID item update");
        // ★★★ Re-apply the STORED log — `sanitizeRaidItem` drops `noteLog` and cannot keep it (DOM-free). §49.
        const next = raidRef.current.map((r) => (r.id === id ? { ...merged, noteLog: existing.noteLog } : r));
        // `existing` is the STORED row and `raidRef.current` the PRE-op array —
        // both read ABOVE the reassignment on the next line. Capturing `merged`
        // would store the NEW values as the "before" image, making undo a
        // silent no-op that still reports success.
        undoRef.current?.captureComposite({
          kind: "raid.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setRaid,
            edited: [existing],
            fromArray: raidRef.current,
            isPrimary: true,
          })],
          name: existing.title,
          entityKey: "raid",
        });
        raidRef.current = next;
        setRaid(next);
        logActivityAs?.("ai", "raid.updated", merged.id, merged.category, merged.title);
        return toRaidSummary(merged);
      },
      // ★★ These four registers count toward the save-time data-loss guards,
      //    so a delete that empties one — or several deletes inside one save
      //    debounce window — is refused unless the bypass is armed. Armed
      //    AFTER the early return, so a miss never arms (open-followups §285).
      deleteRaid: (id) => {
        if (isReadOnly) throw readOnlyError();
        // `find`, not `some` — the row names the item, and the filter below
        // destroys the only copy of its category and title.
        const doomed = raidRef.current.find((r) => r.id === id);
        if (!doomed) return false;
        const next = raidRef.current.filter((r) => r.id !== id);
        // Pre-op array, so `doomed` keeps its OWN index and returns where it
        // was rather than at the head of the list.
        undoRef.current?.captureComposite({
          kind: "raid.deleted",
          primaryCount: 1,
          parts: [capturePart({
            setter: setRaid,
            removed: [doomed],
            fromArray: raidRef.current,
            isPrimary: true,
          })],
          name: doomed.title,
          entityKey: "raid",
        });
        raidRef.current = next;
        setRaid(next);
        logActivityAs?.("ai", "raid.deleted", doomed.id, doomed.category, doomed.title);
        allowDestructiveSave?.();
        return true;
      },

      createChange: (input) => {
        if (isReadOnly) throw readOnlyError();
        const sanitized = sanitizeChangeItem({
          ...withAiRichFields(input, AI_RICH_FIELDS.change),
          id: mintId("change", changesRef.current),
          // Defaulted BEFORE the sanitizer, so an unparseable date lands on today rather than on the empty string the sanitizer stores for one.
          raisedDate: sanitizeIsoDate(input.raisedDate) || clockRef.current.today,
          linkedTaskIds: input.linkedTaskIds ?? [],
          linkedRaidIds: input.linkedRaidIds ?? [],
          stakeholderIds: input.stakeholderIds ?? [],
        });
        if (!sanitized) throw new Error("invalid change: title is required");
        // The status routes through applyChangeStatus, where every status transition stamps or clears decisionDate — so a model-created "Approved" carries a decision date instead of shipping without one.
        const item = applyChangeStatus(sanitized, sanitized.status, clockRef.current.today);
        const next = [...changesRef.current, item];
        changesRef.current = next;
        setChanges(next);
        logActivityAs?.("ai", "change.created", item.id, item.title);
        return toChangeSummary(item);
      },
      updateChange: (id, patch) => {
        if (isReadOnly) throw readOnlyError();
        const existing = changesRef.current.find((c) => c.id === id);
        if (!existing) return null;
        // ★★★ `dropUnacceptedChangeFields` FIRST — `sanitizeChangeItem` rebuilds
        // a whole record, so a value it refuses CLEARS the merged field rather
        // than leaving the stored one alone (`impact`, `decisionDate`,
        // `scheduleImpactDays` and `costImpact` lose their key, `raisedDate` is
        // written as "", and `type` resets to the hardcoded "Other"). The AI
        // edit preview refuses those same values and shows the field as
        // unchanged, so without this the card says "unchanged" while the write
        // wipes a populated field. Guard here and never in the sanitizer: that
        // runs on JSON load, CSV decode, template apply and AI proposal too,
        // where there IS no prior value.
        // ★★ `status` is NOT in that table — `applyModelChangeStatus` below
        // already keeps the stored one and owns the coupled `decisionDate`
        // transition, and it gates on the model's RAW value, which dropping the
        // key would take away.
        const merged = sanitizeChangeItem({
          ...existing,
          // ★ Guard OUTSIDE, matching milestone. Behaviour-NEUTRAL here today:
          // `CHANGE_FIELD_GUARDS`' keys (type, impact, the two dates,
          // scheduleImpactDays, costImpact) are disjoint from
          // `AI_RICH_FIELDS.change` (description, impactDescription,
          // resolutionNotes). ★★ `impact` and `impactDescription` are DIFFERENT
          // keys — the near-collision is the reason to state the disjointness
          // rather than eyeball it.
          ...withAiRichFields(dropUnacceptedChangeFields(patch), AI_RICH_FIELDS.change),
          id, localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid change update");
        // Same transition, gated on the model's RAW status: absent leaves the stored pair alone, unrecognised is IGNORED rather than sanitized to "Proposed" (which would demote a decided change and clear its date). Why, in full: applyModelChangeStatus in change-log.ts.
        const stamped = applyModelChangeStatus(merged, patch.status, existing.status, clockRef.current.today);
        // ★★★ Re-apply the STORED log — §49's defect class, one register over. WHY, and which of the sanitizer's six call sites must do this: `withStoredNoteLog`'s docblock in `change-log.ts`. ★ The local justification used to be "an AI write takes NO undo capture, so a log lost on this path is unrecoverable"; that is now false — the capture is immediately below. The re-apply is still REQUIRED and the argument only got narrower: undo is session-scoped and holds one before-image, so it recovers a log dropped by THIS write and nothing after a reload.
        const next = changesRef.current.map((c) => (c.id === id ? withStoredNoteLog(stamped, existing.noteLog) : c));
        // `existing` (STORED, log intact) against the PRE-op array — read
        // before the reassignment below.
        undoRef.current?.captureComposite({
          kind: "change.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setChanges,
            edited: [existing],
            fromArray: changesRef.current,
            isPrimary: true,
          })],
          name: existing.title,
          entityKey: "change",
        });
        changesRef.current = next;
        setChanges(next);
        logActivityAs?.("ai", "change.updated", stamped.id, stamped.title);
        return toChangeSummary(stamped);
      },
      deleteChange: (id) => {
        if (isReadOnly) throw readOnlyError();
        const doomed = changesRef.current.find((c) => c.id === id);
        if (!doomed) return false;
        const next = changesRef.current.filter((c) => c.id !== id);
        undoRef.current?.captureComposite({
          kind: "change.deleted",
          primaryCount: 1,
          parts: [capturePart({
            setter: setChanges,
            removed: [doomed],
            fromArray: changesRef.current, // pre-op — keeps `doomed`'s own index
            isPrimary: true,
          })],
          name: doomed.title,
          entityKey: "change",
        });
        changesRef.current = next;
        setChanges(next);
        logActivityAs?.("ai", "change.deleted", doomed.id, doomed.title);
        allowDestructiveSave?.();
        return true;
      },

      createMilestone: (input) => {
        if (isReadOnly) throw readOnlyError();
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
        logActivityAs?.("ai", "milestone.created", item.id, item.name);
        return toMilestoneSummary(item);
      },
      updateMilestone: (id, patch) => {
        if (isReadOnly) throw readOnlyError();
        const existing = milestonesRef.current.find((m) => m.id === id);
        if (!existing) return null;
        // ★★ `dropUnacceptedMilestoneFields` before the spread, for the reason
        // its docstring gives: `sanitizeMilestone` rebuilds the whole record and
        // assigns `achievedDate` conditionally, so a refused value CLEARS the
        // stored date instead of failing. The guard turns "refused" back into
        // "unchanged", which is what the preview already promises.
        const merged = sanitizeMilestone({
          ...existing,
          // ★★★ THE GUARD NESTS OUTSIDE, AND THE ORDER IS THE WHOLE GUARD.
          // `withAiRichFields` runs `sanitizeAiRichText`, which returns "" for
          // any non-string — so run INSIDE, it hands the guard an already-
          // stringified value and `MILESTONE_FIELD_GUARDS.description`'s
          // `typeof v === "string"` is unconditionally true. That shipped once:
          // the guard was dead code, the preview refused the value, and the
          // write cleared the stored rich text anyway. The guard must see the
          // RAW model value. Pinned by a source assertion in
          // `sanitize-milestone-patch.test.ts` — no behavioural test can see a
          // re-nesting here, because any such test composes its own copy.
          ...withAiRichFields(dropUnacceptedMilestoneFields(patch), AI_RICH_FIELDS.milestone),
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid milestone update");
        const next = milestonesRef.current.map((m) => (m.id === id ? merged : m));
        // ★ The undo label DOES carry the name even though the activity row
        // above deliberately does not — they answer different questions, and
        // `buildUndoLabel` has a `name` slot the "Updated milestone #{0}"
        // string has no placeholder for.
        undoRef.current?.captureComposite({
          kind: "milestone.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setMilestones,
            edited: [existing],
            fromArray: milestonesRef.current, // pre-op — reassignment is below
            isPrimary: true,
          })],
          name: existing.name,
          entityKey: "milestone",
        });
        milestonesRef.current = next;
        setMilestones(next);
        // ★★ ONE arg. "Updated milestone #{0}" has no {1}, and
        // milestones-panel.tsx passes the id alone — a name would be dropped
        // silently and make the AI row and the user row disagree.
        logActivityAs?.("ai", "milestone.updated", merged.id);
        return toMilestoneSummary(merged);
      },
      deleteMilestone: (id) => {
        if (isReadOnly) throw readOnlyError();
        // ★★ `find`, not the `some` this used to be: the capture below needs
        // the ROW, and after the filter there is no copy of it left to take.
        // The guard is otherwise identical — a miss still returns false before
        // anything is written or armed.
        const doomed = milestonesRef.current.find((m) => m.id === id);
        if (!doomed) return false;
        const next = milestonesRef.current.filter((m) => m.id !== id);
        undoRef.current?.captureComposite({
          kind: "milestone.deleted",
          primaryCount: 1,
          parts: [capturePart({
            setter: setMilestones,
            removed: [doomed],
            fromArray: milestonesRef.current, // pre-op — keeps its own index
            isPrimary: true,
          })],
          name: doomed.name,
          entityKey: "milestone",
        });
        milestonesRef.current = next;
        setMilestones(next);
        // ★★ ONE arg — "Deleted milestone #{0}", same as the panel's own row.
        logActivityAs?.("ai", "milestone.deleted", id);
        allowDestructiveSave?.();
        return true;
      },

      createStakeholder: (input) => {
        if (isReadOnly) throw readOnlyError();
        const id = mintId("stakeholder", stakeholdersRef.current);
        const item = sanitizeStakeholder({ ...input, id, raci: {} });
        if (!item) throw new Error("invalid stakeholder: name is required");
        const next = [...stakeholdersRef.current, item];
        stakeholdersRef.current = next;
        setStakeholders(next);
        logActivityAs?.("ai", "stakeholder.created", item.id, item.name);
        return toStakeholderSummary(item);
      },
      updateStakeholder: (id, patch) => {
        if (isReadOnly) throw readOnlyError();
        const existing = stakeholdersRef.current.find((s) => s.id === id);
        if (!existing) return null;
        // ★★ Guarded like the other three registers: `sanitizeStakeholder`
        // RESETS an unrecognised category/influence/interest to a hardcoded
        // fallback, so a refused value silently demotes a "Sponsor" to "Other"
        // on a card that shows nothing.
        const merged = sanitizeStakeholder({
          ...existing,
          ...dropUnacceptedStakeholderFields(patch),
          id,
          localModifiedAt: new Date().toISOString(),
        });
        if (!merged) throw new Error("invalid stakeholder update");
        const next = stakeholdersRef.current.map((s) => (s.id === id ? merged : s));
        undoRef.current?.captureComposite({
          kind: "stakeholder.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setStakeholders,
            edited: [existing], // STORED row, not `merged` — see updateRaid
            fromArray: stakeholdersRef.current, // pre-op — reassignment is below
            isPrimary: true,
          })],
          name: existing.name,
          entityKey: "stakeholder",
        });
        stakeholdersRef.current = next;
        setStakeholders(next);
        logActivityAs?.("ai", "stakeholder.updated", merged.id, merged.name);
        return toStakeholderSummary(merged);
      },
      deleteStakeholder: (id) => {
        if (isReadOnly) throw readOnlyError();
        const doomed = stakeholdersRef.current.find((s) => s.id === id);
        if (!doomed) return false;
        const next = stakeholdersRef.current.filter((s) => s.id !== id);
        undoRef.current?.captureComposite({
          kind: "stakeholder.deleted",
          primaryCount: 1,
          parts: [capturePart({
            setter: setStakeholders,
            removed: [doomed],
            fromArray: stakeholdersRef.current, // pre-op — keeps its own index
            isPrimary: true,
          })],
          name: doomed.name,
          entityKey: "stakeholder",
        });
        stakeholdersRef.current = next;
        setStakeholders(next);
        logActivityAs?.("ai", "stakeholder.deleted", doomed.id, doomed.name);
        allowDestructiveSave?.();
        return true;
      },
    }),
    // ★★ EXHAUSTIVE ON PURPOSE — no escape hatch, unlike use-chat-dispatcher's
    // own memo. The register data is read through the four refs above, so a
    // raid/change/milestone/stakeholder edit does NOT move this identity; what
    // is listed here is every non-ref value the bodies close over, and each is
    // stable in practice (the four are `useState` setters, `readOnlyError` is
    // the useCallback above, `clockRef` is a ref object, and
    // `allowDestructiveSave` is a `useCallback` with an EMPTY deps array over a
    // single ref write in use-storage-backend.ts, so its identity never moves
    // either). ★ That last one arrived with the destructive-save arming and was
    // a plain arrow at first — re-created every render, which made this memo
    // recompute every render and propagated the churn to use-chat-dispatcher,
    // whose own dispatcher memo lists `registerTools`. Verify before trusting
    // this line: `grep -n "const allowDestructiveSave" src/app/use-storage-backend.ts`
    // must show the useCallback wrapper.
    //
    // ★★ `logActivityAs` IS THE DEP THIS EXTRACTION COULD HAVE DROPPED. Before
    // the move these bodies read `args.logActivityAs` from use-chat-dispatcher's
    // own closure, which was refreshed whenever `documentTools` changed identity
    // — and `logActivityAs` is one of THAT hook's deps. So a changed logger
    // reached the register writers indirectly. Memoizing here on `[isReadOnly]`
    // alone would sever that path.
    //
    // ★★ READ THAT AS LATENT, NOT LIVE — an earlier draft of this comment said
    // the omission "would have left every register write logging through a stale
    // function", and that overclaims. `logActivityAs` is a `useCallback` over the
    // raw `setActivityLog` setter (use-activity-log.ts), so its identity never
    // moves for the life of the provider and the trigger cannot fire today. The
    // dep is carried because that is the difference between safe and safe BY
    // ACCIDENT, one rewiring away — not because a defect is observable now. The
    // same qualification applies to the indirect path described above: sound, but
    // never actually exercised.
    [
      isReadOnly,
      logActivityAs,
      allowDestructiveSave,
      readOnlyError,
      clockRef,
      // ★ Listed for the same reason `clockRef` is — exhaustive-deps cannot know
      // a value destructured from `deps` is a ref object. Its identity never
      // moves, so it recomputes nothing; it is here to keep the "no escape
      // hatch" property above true.
      undoRef,
      setRaid,
      setChanges,
      setMilestones,
      setStakeholders,
    ],
  );
}
