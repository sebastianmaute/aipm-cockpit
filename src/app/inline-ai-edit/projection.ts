// src/app/inline-ai-edit/projection.ts
//
// D7 (AI-07): what the inline editor SENDS to the model. The scope block used to carry the whole
// stored row, so emails, notes and stakeholder influence/interest left the device on every inline
// edit. The withheld set lives on the descriptor (`withheldFields`), beside the `diffFields` it must
// stay disjoint from. ★ This is a SEND filter only: the concurrency token is still derived from the
// FULL stored row (`use-inline-entity-edit.ts`), never from this projection.
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";

/** A RAID item's `escalations` without each entry's `toEmail`: the model still learns the item was
 *  escalated, when and to whom by name, but not the address. `escalations` is not a `diffFields` member,
 *  so it is not writable through inline edit. Checked 2026-10: it is the only nested email-bearing value on
 *  any inline entity (`attendeeResourceIds` are ids, `raci` maps milestone ids to letters, and the
 *  resource `emails` list is withheld at the top level). */
function withoutEscalationEmails(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const { toEmail: _dropped, ...rest } = entry as Record<string, unknown>;
    void _dropped;
    return rest;
  });
}

/** `item` without the entity's withheld fields (`noteLog` included) and without nested escalation
 *  emails. Pure; returns a new object. */
export function projectForInlineEdit(
  entity: InlineEntity,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const withheld = INLINE_DESCRIPTORS[entity].withheldFields;
  const kept = Object.fromEntries(Object.entries(item).filter(([key]) => !withheld.has(key)));
  return "escalations" in kept ? { ...kept, escalations: withoutEscalationEmails(kept.escalations) } : kept;
}
