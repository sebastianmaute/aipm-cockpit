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
import type { ContactPerson } from "./types";
import { capturePart, type CompositeFragment } from "./undo/use-undo-stack";
import {
  retargetAbsenceEmails, retargetContactPersonEmails, retargetRaidEmails, retargetShiftEmails,
  retargetStakeholderEmails, retargetTaskEmails,
  type EmailPropagationInput, type EmailPropagationResult, type ResourceEmailChange,
} from "./resource-email-propagation";

export type PropagationSetters = Pick<ReturnType<typeof useWorkspace>, "setTasks" | "setRaid" | "setAbsences" | "setShifts" | "setStakeholders" | "setProject">;

/** ★ A WHOLE-ARRAY before/after fragment, because `ContactPerson` has no id
 *  and `capturePart` requires one (controller ruling). Unarmed: a plain edit
 *  removes no rows, exactly like `captureFieldPart`. */
export function contactPersonsFragment(
  setProject: PropagationSetters["setProject"],
  before: readonly ContactPerson[],
  after: readonly ContactPerson[],
): CompositeFragment {
  return {
    isPrimary: false,
    restore: () => {
      setProject((prev) => (prev ? { ...prev, contactPersons: [...before] } : prev));
      return () => setProject((prev) => (prev ? { ...prev, contactPersons: [...after] } : prev));
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
    result.contactPersons.changed > 0 ? contactPersonsFragment(setters.setProject, input.contactPersons, result.contactPersons.next) : null,
  ];
}
