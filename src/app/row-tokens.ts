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

/**
 * ★★ COLLISIONS ARE KEYED ON THE COLLAPSED NAME, NOT THE RAW ONE. Accessible-name
 * computation collapses internal whitespace runs, so a row called "Risk  A" (two
 * spaces) and one called "Risk A" are TWO strings here and ONE name to a screen
 * reader. Keying on the raw string emits both BARE and reproduces exactly the
 * 2.4.6 failure this module exists to close — invisibly, because the two names
 * differ on screen only by a space nobody can see.
 *
 * ★ The TOKEN still carries the row's own name verbatim; only the comparison is
 * collapsed. The user reads what they typed and hears a disambiguated name.
 *
 * ★ Leading/trailing whitespace is already trimmed upstream by the entity
 * sanitizers, so internal runs are the live vector — but this collapses ends
 * too, since `\s+` does not care where the run sits.
 */
const collapse = (name: string): string => name.replace(/\s+/g, " ");

/** Maps each row's id to the display TOKEN used in every one of that row's labels. */
export function buildRowTokens<Id>(rows: readonly TokenRow<Id>[]): Map<Id, string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = collapse(row.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  // ★ Holds COLLAPSED tokens — the escalation loop has to compare what a screen
  // reader would hear, or it steps over a collision it was added to catch.
  const used = new Set<string>();
  const tokens = new Map<Id, string>();
  for (const row of rows) {
    const key = collapse(row.name);
    let token = row.name;
    if ((counts.get(key) ?? 0) > 1) {
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      token = `${row.name} (${occurrence})`;
    }
    if (used.has(collapse(token))) {
      let bump = 2;
      while (used.has(collapse(`${row.name} (${bump})`))) bump += 1;
      token = `${row.name} (${bump})`;
    }
    used.add(collapse(token));
    tokens.set(row.id, token);
  }
  return tokens;
}

/**
 * One control's accessible name: the action verb, then the row token.
 *
 * ★★★ FRONT POSITION IS A BEST PRACTICE, NOT THE RULE, and an earlier revision
 * of this docstring hung a "so" between them that does not follow. WCAG 2.5.3
 * (label-in-name) asks that the accessible name CONTAIN the control's visible
 * text, case-insensitively — so "Alpha (2) – Delete" conforms exactly as well
 * as "Delete – Alpha (2)", and front position is irrelevant to conformance.
 * Understanding SC 2.5.3 carries it only as a NOTE ("A best practice is to have
 * the text of the label at the start of the name"). The verb leads here for
 * that note and for one consistent shape across every adopting surface. Do NOT
 * enforce prefixing as if it were the SC — this repo's own dependency-type
 * select conforms while failing a prefix test ("Type for next link" sits INSIDE
 * "Predecessor type for next link").
 *
 * ★★ WHAT IS PINNED, AND WHAT IS NOT. axe's `label-content-name-mismatch` does
 * carry `wcag21a`, but it is also tagged `experimental` and axe's default
 * tagExclude drops it, so a tag-only run never executes it — verify with
 *   node -e "const a=require('axe-core');const r=a.getRules().find(x=>x.ruleId==='label-content-name-mismatch');console.log(a._audit.tagExclude.join(','),'::',r.tags.join(','))"
 * A unit test is therefore the only detector that can exist. The one beside
 * this function pins what a pure function CAN guarantee: the returned name
 * contains `verb`. It renders no control, so it does NOT pin that any call
 * site's VISIBLE text is in fact `verb` — that is a per-call-site property and
 * nothing in this file covers it.
 */
export function rowLabel(verb: string, token: string): string {
  return `${verb} – ${token}`;
}
