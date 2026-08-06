// Shared helper for driving an edit modal's field-visibility tier through the
// UI, the way a user does.
//
// The control now lives in `ModalHeader`'s `headerExtra` slot: a trigger button
// labelled with the ACTIVE tier that opens a `PopoverPanel` holding a
// `SegmentedControl`. So the tier switches are no longer top-level `<button>`s —
// they are `role="radio"` children of a radiogroup that does not exist in the
// DOM until the popover is open. Nine sibling modal tests drove them the old
// way; they all go through here instead, so the subtleties below live once.
import { fireEvent, screen, within } from "@testing-library/react";
import { t, type Lang } from "../app/i18n";

/** The three selectable tiers. "Custom" is a DERIVED state (a hand-picked field
 *  set), never an option in the group — so it cannot be selected here. */
export type FieldTierKey = "fieldViewSimple" | "fieldViewAdvanced" | "fieldViewFull";

/** Escape regex metacharacters in a string destined for `new RegExp`. The i18n
 *  values are prose and none carries a metacharacter today, so this is latent
 *  rather than live — but an EN/DE string is free to grow a `(` or `?`, and a
 *  query built from one would then throw or silently match the wrong control. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The field-visibility trigger in the modal header.
 *
 * ★ Its accessible name is `"<active tier> – Configure fields"` — the visible
 * tier LEADS it (WCAG 2.5.3 label-in-name), so the name CHANGES as the tier
 * changes. A testing-library string `name` is an EXACT match, so it must be
 * queried by regex against the stable tail, not by the whole string. Exported
 * because four other sites (`modal-field-controls.test.tsx` and the three
 * placement tests) each hand-rolled that regex, so the trap above was explained
 * at one of the five places that depend on it.
 */
export function fieldTierTrigger(lang: Lang = "en-US"): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(escapeRegExp(t(lang, "configureFields"))) });
}

/**
 * Selects a field-visibility tier through the modal header's control: opens the
 * popover, clicks the tier radio, then CLOSES the popover again.
 *
 * ★★ Closing is NOT optional. The popover's per-field checkbox list is built
 * from `MODAL_FIELDS`, which labels each field with the SAME i18n key the modal
 * body uses for it (`absenceAssigneeEmail`, `resourceBirthday`, …). While the
 * popover is open both labels are in the document, so the very next body query —
 * the `getByText`/`getByLabelText` these tests exist to make — matches two nodes
 * and throws "found multiple elements". Measured, not assumed: with the closing
 * click removed, five of the nine callers fail that way (absence, budget,
 * raid-edit, resource, task-form-fields — "Found multiple elements with the
 * text: Email" / "Birthday" / "/Title/"). The other four survive today only
 * because their particular labels happen not to collide, which is not a property
 * worth depending on; two of them already carry a comment asserting the popover
 * is closed ("so body labels are safe"), and this keeps that true.
 *
 * ★ Closing by clicking the trigger again is safe despite `PopoverPanel` also
 * having outside-click dismissal: that listener early-returns when the event
 * target is inside `anchorRef` (the trigger), so there is no close-then-reopen
 * double toggle. `fireEvent.click` does not dispatch a `mousedown` at all, so it
 * never reaches that listener in the first place. Escape would also work (the
 * popover is the topmost dismissal-stack layer), but it is a weaker choice here:
 * a stray Escape that the popover did not claim would take the whole modal down
 * and turn a real regression into a confusing cascade. The assertion below is
 * what proves the close actually happened, either way.
 */
export function selectFieldTier(tier: FieldTierKey, lang: Lang = "en-US"): void {
  fireEvent.click(fieldTierTrigger(lang));
  // Scoped to the popover: several modal bodies render their own
  // `SegmentedControl`s (budget type, raid category/status/severity), so an
  // unscoped radio query could resolve against the wrong group.
  const panel = screen.getByRole("dialog", { name: t(lang, "configureFields") });
  fireEvent.click(within(panel).getByRole("radio", { name: t(lang, tier) }));

  // Re-read the trigger — picking a tier rewrites its accessible name.
  const trigger = fieldTierTrigger(lang);
  fireEvent.click(trigger);

  const stillOpen =
    trigger.getAttribute("aria-expanded") !== "false" ||
    screen.queryByRole("radiogroup", { name: t(lang, "fieldViewLabel") }) !== null;
  if (stillOpen) {
    throw new Error(
      "selectFieldTier: the field-visibility popover is still open after the closing click — " +
        "any body query that follows will be ambiguous (see this helper's comment)",
    );
  }
}
