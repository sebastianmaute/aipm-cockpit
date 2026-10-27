// AI-05 / AI-07 — the personal-data fields the model is never sent, per entity. A leaf module (type-only
// import, no runtime dependency) so the chat-thread minimiser and the activity-history renderer can read the
// same list as the inline editor without loading the inline descriptors.
//
// ★ ONE SOURCE: `INLINE_DESCRIPTORS[entity].withheldFields` (entity-descriptor.ts) is built from this table
//   plus `noteLog`, and `withheldActivityField` below reads the same table for logged edits.
import type { InlineEntity } from "./inline-ai-edit/entity-descriptor";

/** The named personal-data fields of each entity: e-mail addresses, notes, a stakeholder's influence and
 *  interest, a person's phone, location, birthday and absence override, and an absence's type and note. */
export const AI_WITHHELD_FIELDS: Readonly<Record<InlineEntity, readonly string[]>> = {
  task: ["assigneeEmail"],
  raid: ["ownerEmail"],
  change: [],
  milestone: [],
  stakeholder: ["email", "notes", "influence", "interest"],
  resource: ["email", "emails", "businessPhone", "location", "birthday", "notes", "absenceOverride"],
  absence: ["assigneeEmail", "type", "note"],
  calendarEvent: [],
};

/** Withheld on every entity: the dated note log. */
export const WITHHELD_ON_EVERY_ENTITY = "noteLog";

/** Every field named in `AI_WITHHELD_FIELDS`, plus `noteLog` — what a logged edit of an unknown entity drops. */
export const ALL_WITHHELD_FIELDS: ReadonlySet<string> = new Set([
  ...Object.values(AI_WITHHELD_FIELDS).flat(),
  WITHHELD_ON_EVERY_ENTITY,
]);

/** A field that holds e-mail addresses, by its name (`email`, `emails`, `assigneeEmail`, `ownerEmail`, `toEmail`…). */
export function isEmailField(field: string): boolean {
  return /email/i.test(field);
}

/**
 * Whether a logged change to `field` under the activity `kind` must stay out of what the model reads.
 * The entity is the kind's prefix (`absence.updated` → `absence`); a prefix that is an entity of
 * `AI_WITHHELD_FIELDS` withholds that entity's fields, and any other prefix (`bulk`, `shift`, `calendar`,
 * a kind from a newer release…) withholds every field in `ALL_WITHHELD_FIELDS`. An e-mail field and the
 * note log are withheld under every kind.
 */
export function withheldActivityField(kind: unknown, field: string): boolean {
  if (isEmailField(field) || field === WITHHELD_ON_EVERY_ENTITY) return true;
  const prefix = typeof kind === "string" ? kind.slice(0, Math.max(0, kind.indexOf("."))) : "";
  // ★ own-property check: a `kind` of "toString.x" must not resolve a prototype member.
  if (Object.prototype.hasOwnProperty.call(AI_WITHHELD_FIELDS, prefix)) {
    return AI_WITHHELD_FIELDS[prefix as InlineEntity].includes(field);
  }
  return ALL_WITHHELD_FIELDS.has(field);
}
