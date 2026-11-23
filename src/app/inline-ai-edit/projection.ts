// src/app/inline-ai-edit/projection.ts
//
// D7 (AI-07): what the inline editor SENDS to the model. The scope block used to carry the whole
// stored row, so emails, notes and stakeholder influence/interest left the device on every inline
// edit. The withheld set lives on the descriptor (`withheldFields`), beside the `diffFields` it must
// stay disjoint from. ★ This is a SEND filter only: the concurrency token is still derived from the
// FULL stored row (`use-inline-entity-edit.ts`), never from this projection.
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import { isEmailField } from "../ai-withheld-fields";

/** `value` with every e-mail field (`isEmailField`) dropped from each object nested in it, at any depth. A RAID
 *  item's `escalations` keep when and to whom by name, without `toEmail`. Nested values are not `diffFields`
 *  members, so none of them is writable through inline edit. Top-level e-mail fields are already withheld. */
function withoutNestedEmails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNestedEmails);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isEmailField(key))
      .map(([key, v]) => [key, withoutNestedEmails(v)]),
  );
}

/** `item` without the entity's withheld fields (`noteLog` included) and without any e-mail field nested in what
 *  is left. Pure; returns a new object. */
export function projectForInlineEdit(
  entity: InlineEntity,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const withheld = INLINE_DESCRIPTORS[entity].withheldFields;
  return Object.fromEntries(
    Object.entries(item)
      .filter(([key]) => !withheld.has(key))
      .map(([key, v]) => [key, withoutNestedEmails(v)]),
  );
}
