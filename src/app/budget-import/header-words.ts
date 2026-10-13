// src/app/budget-import/header-words.ts — the header WORDS detection and the
// repeated-header rule read (§500): one place, so a person, hours or period word
// means the same to `detectLayout` and to `repeatedHeaderRows`. Pure: no i18n,
// no React, no DOM.

/** A period WORD (`Month`, `Monat`, `Zeitraum`, `KW` …), matched as a whole
 *  word of the header (`isPeriodWordHeader`): `Startmonat` or
 *  `Abrechnungsmonat` holds one only as part of a longer word. */
const PERIOD_WORD_RE = /^(months?|monate?|periods?|perioden?|zeitraum|weeks?|wochen?|kw)$/i;
/** An hours word: a long sheet's repeated header (`repeatedHeaderRows`). It
 *  neither settles nor, since round 8, preselects the hours column. */
export const HOURS_HEADER_RE = /hour|stunden|std|hrs|aufwand|effort/i;
/** A person column's header. */
export const PERSON_HEADER_RE = /^(name|mitarbeiter(in)?|person|ressource|resource|employee|member|mitglied)$/i;
const WORD_SPLIT_RE = /[^\p{L}]+/u;

/** A header with a period word as one of its words (`PERIOD_WORD_RE`):
 *  `Month`, `Start month`, `Monat/Jahr`, `KW 05`. */
export function isPeriodWordHeader(label: string): boolean {
  return label.split(WORD_SPLIT_RE).some((word) => PERIOD_WORD_RE.test(word));
}
