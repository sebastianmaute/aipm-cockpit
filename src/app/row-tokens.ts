// Shared row-name disambiguator.
//
// ★★ THE DISAMBIGUATOR IS DELIBERATELY NOT THE ID. Ids are `crypto.randomUUID()`
// on several entities, so "Delete – image.png (3f2a…-…)" reads 36 characters of
// character-salad aloud on every control — trading a 2.4.6 failure for a
// usability regression hitting exactly the users 2.4.6 protects. It is also NOT
// a whole-list positional ordinal, which shifts under sorting. An occurrence
// index ranges only over the rows sharing one name and tells the user there are
// several and which one they are on.
//
// ★ ALL colliding rows are numbered, including the first — hearing a bare
// "image.png" would otherwise leave a user unable to tell "the only one" from
// "the first of several".
//
// ★★ THE ESCALATION LOOP IS LOAD-BEARING, not defensive padding. A user can name
// a row literally "image.png (1)"; with two other rows called "image.png" the
// GENERATED token for the pair's first row would then collide with that row's
// BARE one.
//
// ★ Cross-MOUNT uniqueness is not required: a modal sets `aria-modal`, which
// hides the background copy from AT, and 2.4.6 is about distinguishability
// within one context.
//
// ★ Callers pass rows in the order the USER navigates (sorted/filtered as
// rendered), not the raw entity order — the occurrence index has to follow what
// is on screen.

/** A row reduced to what disambiguation needs: an identity and a display name. */
export interface TokenRow<Id> {
  readonly id: Id;
  readonly name: string;
}

/** Maps each row's id to the display TOKEN used in every one of that row's labels. */
export function buildRowTokens<Id>(rows: readonly TokenRow<Id>[]): Map<Id, string> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);

  const seen = new Map<string, number>();
  const used = new Set<string>();
  const tokens = new Map<Id, string>();
  for (const row of rows) {
    let token = row.name;
    if ((counts.get(row.name) ?? 0) > 1) {
      const occurrence = (seen.get(row.name) ?? 0) + 1;
      seen.set(row.name, occurrence);
      token = `${row.name} (${occurrence})`;
    }
    if (used.has(token)) {
      let bump = 2;
      while (used.has(`${row.name} (${bump})`)) bump += 1;
      token = `${row.name} (${bump})`;
    }
    used.add(token);
    tokens.set(row.id, token);
  }
  return tokens;
}

/** ★ `verb` stays at the FRONT so the accessible name still CONTAINS each
 *  control's visible text (WCAG 2.5.3 — containment, case-insensitive, NOT
 *  prefix). axe's `label-content-name-mismatch` is `experimental` and excluded
 *  by the gate's default tagExclude, so that is unit-tested too. */
export function rowLabel(verb: string, token: string): string {
  return `${verb} – ${token}`;
}
