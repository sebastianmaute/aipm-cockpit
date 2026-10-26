// src/app/inline-ai-edit/projection.ts
//
// D7 (AI-07): what the inline editor SENDS to the model. The scope block used to carry the whole
// stored row, so emails, notes and stakeholder influence/interest left the device on every inline
// edit. The withheld set lives on the descriptor (`withheldFields`), beside the `diffFields` it must
// stay disjoint from. ★ This is a SEND filter only: the concurrency token is still derived from the
// FULL stored row (`use-inline-entity-edit.ts`), never from this projection.
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";

/** `item` without the entity's withheld fields (`noteLog` included). Pure; returns a new object. */
export function projectForInlineEdit(
  entity: InlineEntity,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const withheld = INLINE_DESCRIPTORS[entity].withheldFields;
  return Object.fromEntries(Object.entries(item).filter(([key]) => !withheld.has(key)));
}
