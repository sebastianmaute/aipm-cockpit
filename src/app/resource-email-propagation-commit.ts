// Applies a computed propagation through FUNCTIONAL workspace setters and
// returns the undo fragments for it (spec Part 7). Shared by the human and AI
// resource writers so the two cannot drift. Each setter re-runs the pure
// retarget over `prev`, so a same-tick write to another row survives.
//
// ★ Before-images: `capturePart` stores the pre-op rows from `result.*.edited`,
//  computed over `input` — the same render-scope arrays the caller reads its
//  own resource before-image from. That is the precedent `purgeCalendarFor`
//  sets. It is safe for an EDIT capture: `capturePart`'s restore is an id-keyed
//  restore over the LIVE `prev` (`applyUndoRestoreWithRemap`), so a row a
//  concurrent writer added meanwhile is never dropped, and only rows this save
//  retargeted get their before-image back. (As for every `capturePart` edit, a
//  later edit to another field of THAT row is reverted with it.) Capturing from
//  inside the setter's `prev` is not possible — React runs the updater later,
//  after `captureComposite` has already pushed the entry.
import type { useWorkspace } from "./workspace-context";
import type { Resource } from "./types";
import { type Lang, t } from "./i18n";
import { capturePart, type CompositeFragment } from "./undo/use-undo-stack";
import {
  propagateResourceEmail, resourceEmailChange,
  retargetAbsenceEmails, retargetContactPersonEmails, retargetRaidEmails, retargetShiftEmails,
  retargetStakeholderEmails, retargetTaskEmails,
  type EmailPropagationInput, type EmailPropagationResult, type ResourceEmailChange,
} from "./resource-email-propagation";

export type PropagationSetters = Pick<ReturnType<typeof useWorkspace>, "setTasks" | "setRaid" | "setAbsences" | "setShifts" | "setStakeholders" | "setProject">;

/** ★ `ContactPerson` has no id, so `capturePart` cannot hold it. Instead the
 *  fragment re-runs the retarget over the LIVE `prev` in the opposite
 *  direction: undo moves the linked rows holding the propagated address back
 *  to the old one, redo moves the linked rows holding the old address forward
 *  again. A whole-array restore would drop every contact person added (or
 *  edited) after the correction — only the rows this correction retargeted
 *  are touched. Unarmed: a plain edit removes no rows. */
export function contactPersonsFragment(
  setProject: PropagationSetters["setProject"],
  change: ResourceEmailChange,
): CompositeFragment {
  const reverse: ResourceEmailChange = { resourceId: change.resourceId, from: change.to, to: change.from };
  const apply = (direction: ResourceEmailChange) =>
    setProject((prev) => (prev ? { ...prev, contactPersons: [...retargetContactPersonEmails(prev.contactPersons, direction).next] } : prev));
  return {
    isPrimary: false,
    restore: () => {
      apply(reverse);
      return () => apply(change);
    },
  };
}

export function commitEmailPropagation(args: {
  change: ResourceEmailChange;
  input: EmailPropagationInput;
  result: EmailPropagationResult;
  setters: PropagationSetters;
}): (CompositeFragment | null)[] {
  const { change, input, result, setters } = args;
  if (result.tasks.edited.length > 0) setters.setTasks((prev) => retargetTaskEmails(prev, change).next as typeof prev);
  if (result.raid.edited.length > 0) setters.setRaid((prev) => retargetRaidEmails(prev, change).next as typeof prev);
  if (result.absences.edited.length > 0) setters.setAbsences((prev) => retargetAbsenceEmails(prev, change).next as typeof prev);
  if (result.shifts.edited.length > 0) setters.setShifts((prev) => retargetShiftEmails(prev, change).next as typeof prev);
  if (result.stakeholders.edited.length > 0) setters.setStakeholders((prev) => retargetStakeholderEmails(prev, change).next as typeof prev);
  if (result.contactPersons.changed > 0) {
    setters.setProject((prev) => (prev ? { ...prev, contactPersons: [...retargetContactPersonEmails(prev.contactPersons, change).next] } : prev));
  }
  return [
    capturePart({ setter: setters.setTasks, edited: result.tasks.edited, fromArray: input.tasks }),
    capturePart({ setter: setters.setRaid, edited: result.raid.edited, fromArray: input.raid }),
    capturePart({ setter: setters.setAbsences, edited: result.absences.edited, fromArray: input.absences }),
    capturePart({ setter: setters.setShifts, edited: result.shifts.edited, fromArray: input.shifts }),
    capturePart({ setter: setters.setStakeholders, edited: result.stakeholders.edited, fromArray: input.stakeholders }),
    result.contactPersons.changed > 0 ? contactPersonsFragment(setters.setProject, change) : null,
  ];
}

export interface EmailCorrectionOutcome {
  /** The computed propagation — a caller holding its own refs advances them from `result.*.next`. */
  result: EmailPropagationResult;
  /** Undo fragments to spread after the resource's own primary part. */
  cascade: (CompositeFragment | null)[];
  /** The count-bearing Undo toast text for the composite (`CaptureCompositeOpts.toastText`). */
  toastText: string;
}

/** The ONE entry both resource writers call (`handleSaveResource` and AI
 *  `updateResource`): detect the primary-email change, propagate it over
 *  `input`, commit it through `setters`, and hand back the undo cascade and
 *  toast. Null when the email did not change or nothing linked matched — the
 *  caller then keeps its ordinary capture and toast. */
export function commitResourceEmailCorrection(args: {
  previous: Resource;
  next: Resource;
  input: EmailPropagationInput;
  setters: PropagationSetters;
  lang: Lang;
}): EmailCorrectionOutcome | null {
  const change = resourceEmailChange(args.previous, args.next);
  if (!change) return null;
  const result = propagateResourceEmail(change, args.input);
  if (result.count === 0) return null;
  const cascade = commitEmailPropagation({ change, input: args.input, result, setters: args.setters });
  return { result, cascade, toastText: t(args.lang, "undoToastResourceEmailPropagated", result.count) };
}
