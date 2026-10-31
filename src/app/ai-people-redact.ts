// src/app/ai-people-redact.ts
//
// AI people protection, layer 2: the redaction session. `redact` swaps every
// known person name and every email, phone number and IBAN for a placeholder
// (`[Person N]`, `[email N]`, `[phone N]`, `[IBAN N]`); `restore` maps issued
// placeholders back. Pure and i18n-free. The mapping lives ONLY in the
// module-level `sessions` map below: never persisted, never exported.
//
// Matching rules (each pinned in ai-people-redact.test.ts):
// - Names are matched whole-word, case-insensitively and diacritic-folded
//   (ä/ö/ü fold to ae/oe/ue and ß to ss, so "Müller" = "MÜLLER" = "Mueller";
//   other marks are stripped). Folding works per character CLUSTER composed to
//   NFC, so NFD text ("u" + U+0308) folds like "ü"; the apostrophes ’ ‘ ʼ ′
//   fold to "'". A German genitive "s" may follow a name; it is not part of
//   the match and stays in the text ("Müllers" -> "[Person 1]s"). Whitespace
//   inside a name may be any run of whitespace. The longest alternative wins
//   at each position.
// - Dictionary names go through cleanPersonName first: "(CFO)" suffixes and
//   "nobody" values such as TBD or "offen" never become names.
// - A FULL known name is always redacted; a one-word dictionary entry is a full
//   name too (no stop list, no length floor). A single TOKEN of a multi-word
//   name is redacted alone only when it is at least MIN_TOKEN_LENGTH long and
//   is not in NAME_STOP_WORDS — whether one known person or several have it.
// - Placeholders: a full name and its variants (case, ü/ue, ß/ss, possessive)
//   share one placeholder that restores the full name. A LONE token of a
//   multi-word person ("Brandvik" of "Anna Brandvik"), and a one-word entry that
//   aliases one, gets its own placeholder per (person, token) restoring that
//   token's dictionary spelling — never the full name, which would turn
//   "Brandvik GmbH" into "Anna Brandvik GmbH" in a restored write (review 3, R2).
//   A token several known people share ("Müller" of two Müllers) gets ONE
//   placeholder keyed by the token alone, restoring the token as the first of
//   them spells it (review 5, S1; it used to be left in clear).
// - Case gate: a LONE word (a one-word entry or a token) is redacted only when
//   the text spells it capitalised or all upper case, so "price list" stays
//   while "Price" goes. Multi-word names match in any case. A one-word entry the
//   dictionary itself spells NOT capitalised ("anna", a user id like "jdoe") is
//   exempt and matches in any case: it has no capitalised form to tell a common
//   word apart by, so a spelling exactly as stored is always redacted (review 3,
//   R1). A capitalised entry ("Bob") stays gated: "bob" is left, like "max".
// - Emails, IBANs (mod-97 checked) and phone numbers are redacted even when not
//   in the dictionary. An UNKNOWN phone needs a leading "+" or "0" (optionally
//   inside "("), at least MIN_PHONE_DIGITS digits, and only space - . / ( ) as
//   separators; date-shaped matches are rejected. A KNOWN phone is matched by
//   its digit sequence with any of those separators.
// - Priority on overlap: email, IBAN, known phone, unknown phone, name.

import { cleanPersonName, type PeopleDictionary } from "./ai-people-dictionary";

export type RedactionCounts = { person: number; email: number; phone: number; iban: number };

export interface RedactionSession {
  redact(text: string): string;
  restore(text: string): string;
  /** Replacements made by this session so far, per kind (cumulative). */
  counts(): RedactionCounts;
}

type Kind = keyof RedactionCounts;

const LABEL: Record<Kind, string> = { person: "Person", email: "email", phone: "phone", iban: "IBAN" };
const KIND_BY_LABEL: Record<string, Kind> = { person: "person", email: "email", phone: "phone", iban: "iban" };
/** Case-insensitive: a model may write "[person 1]". */
const PLACEHOLDER = /\[(person|email|phone|iban) (\d+)\]/gi;

const MIN_TOKEN_LENGTH = 3;
const MIN_PHONE_DIGITS = 7;
const MIN_KNOWN_PHONE_DIGITS = 5;
const IBAN_MIN = 15;
const IBAN_MAX = 34;

/** Common English/German words (and name particles) that are also first or
 *  last names. A token on this list is never redacted ALONE; a full name that
 *  contains it still is. Keep it small: every entry is a name that leaks. */
const NAME_STOP_WORDS: ReadonlySet<string> = new Set([
  "mark", "may", "will", "ann", "april", "june", "august", "rose", "max", "frank", "bill", "art", "grant",
  "hope", "grace", "joy", "long", "young", "page", "wolf", "klein", "lange", "mai",
  "van", "von", "der", "den", "del", "die", "das", "the", "and", "und",
  // Review 4, M1: app vocabulary. RAG colours (EN, DE), month names and their
  // abbreviations (EN, DE), and "Rich" (rich text). Entries are FOLDED (grün -> gruen).
  "red", "amber", "green", "rot", "gelb", "gruen", "rich",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "january", "february", "march", "july", "september", "october", "november", "december",
  "januar", "februar", "maerz", "maer", "juni", "juli", "oktober", "okt", "dezember", "dez",
]);

// --- folding -----------------------------------------------------------------

/** Folded per CLUSTER (a base char and its combining marks, composed to NFC), so
 *  "u" + U+0308 folds like "ü" (review 4, I1). Apostrophe variants fold to "'". */
const GERMAN_FOLD: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", ß: "ss", "’": "'", "‘": "'", "ʼ": "'", "′": "'",
};
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

function foldCluster(c: string): string {
  const lower = c.normalize("NFC").toLowerCase();
  return GERMAN_FOLD[lower] ?? lower.normalize("NFD").replace(/\p{M}+/gu, "");
}

/** Fold `text`; `map[i]` is the index in `text` of the CLUSTER folded char `i`
 *  came from, so a match always starts and ends on a cluster boundary of the
 *  original text and slicing it keeps the input byte-exact (NFD included). */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  for (const m of text.matchAll(CLUSTER)) {
    const f = foldCluster(m[0]);
    folded += f;
    for (let k = 0; k < f.length; k++) map.push(m.index);
  }
  map.push(text.length);
  return { folded, map };
}

const fold = (s: string) => foldWithMap(s).folded;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normSpace = (s: string) => s.trim().replace(/\s+/g, " ");

// --- the person matcher -----------------------------------------------------

/** `ungated`: folded one-word entries some dictionary spelling of which fails the case gate (R1). */
type NameMatcher = { readonly re: RegExp | null; readonly owner: ReadonlyMap<string, string>; readonly ungated: ReadonlySet<string> };

/** The placeholder key of a lone token of a multi-word person (R2). */
const tokenKey = (person: string, token: string): string => `${person}\u0000${token}`;
/** The `person` of a lone token several people share (S1). Never a person key: a cleaned name has a letter in every token. */
const SHARED_TOKEN_OWNER = "*";

/** Person key = folded full name; a lone token's key is `tokenKey`. `canonical` maps each key to the first
 *  spelling seen (for a token: that token as the full name's first spelling writes it). */
function buildNameMatcher(names: readonly string[], canonical: Map<string, string>): NameMatcher {
  const multi = new Map<string, string[]>(); // person key -> folded tokens
  const singles: string[] = [];
  const ungated = new Set<string>();
  for (const raw of names) {
    const name = cleanPersonName(raw);
    if (name === null) continue;
    const key = normSpace(fold(name));
    if (!key) continue;
    if (!canonical.has(key)) canonical.set(key, name);
    if (key.includes(" ")) multi.set(key, key.split(" "));
    else {
      singles.push(key);
      if (!looksLikeAName(name)) ungated.add(key);
    }
  }
  const tokenOwners = new Map<string, Set<string>>();
  for (const [key, tokens] of multi) {
    const spelled = (canonical.get(key) ?? key).split(" ");
    tokens.forEach((t, i) => {
      tokenOwners.set(t, (tokenOwners.get(t) ?? new Set()).add(key));
      const k = tokenKey(key, t);
      if (!canonical.has(k)) canonical.set(k, spelled.length === tokens.length ? spelled[i]! : t);
    });
  }
  const owner = new Map<string, string>(); // folded alternative -> person key
  for (const key of multi.keys()) owner.set(key, key);
  // A one-word entry is a full known name: that token of the one multi-word person
  // it is a token of (its own placeholder, R2), else a person of its own. Never
  // stop-listed (F1).
  for (const single of new Set(singles)) {
    const owners = tokenOwners.get(single);
    owner.set(single, owners && owners.size === 1 ? tokenKey([...owners][0]!, single) : single);
  }
  for (const [token, owners] of tokenOwners) {
    if ([...token].length < MIN_TOKEN_LENGTH || NAME_STOP_WORDS.has(token)) continue;
    if (!/\p{L}/u.test(token) || owner.has(token)) continue;
    const [first] = owners;
    if (owners.size === 1) {
      owner.set(token, tokenKey(first!, token));
      continue;
    }
    // Review 5, S1: shared by several people. One placeholder for the token alone, restoring the first owner's spelling.
    const shared = tokenKey(SHARED_TOKEN_OWNER, token);
    if (!canonical.has(shared)) canonical.set(shared, canonical.get(tokenKey(first!, token)) ?? token);
    owner.set(token, shared);
  }
  if (owner.size === 0) return { re: null, owner, ungated };
  const alternatives = [...owner.keys()]
    .sort((a, b) => b.length - a.length)
    .map((alt) => alt.split(" ").map(escapeRe).join("\\s+"));
  // An optional German genitive "s" may follow, OUTSIDE the match, so it stays in the text (review 4, I1).
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?=s?(?![\\p{L}\\p{N}]))`, "gu");
  return { re, owner, ungated };
}

// --- pattern kinds ------------------------------------------------------------

const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g;
const IBAN_RE = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g;
const PHONE_RE = /(?<![\w+\-./(])\(?(?:\+[1-9]|00[1-9]|0[1-9])[\d \-./()]*\d(?!\d)/g;
const DATE_START = /^\(?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?!\d)/;
const PHONE_SEP = "[\\s\\-./()]*";

const digitsOf = (s: string) => s.replace(/\D/g, "");
const phoneKey = (s: string) => (s.trim().replace(/^\(/, "").startsWith("+") ? "+" : "") + digitsOf(s);

function ibanValid(raw: string): boolean {
  const s = raw.replace(/ /g, "");
  if (s.length < IBAN_MIN || s.length > IBAN_MAX) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const c of moved) {
    const v = c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** The longest valid IBAN prefix of a match, dropping trailing space groups. */
function validIbanPrefix(match: string): string | null {
  let cur = match;
  for (;;) {
    if (ibanValid(cur)) return cur;
    const cut = cur.lastIndexOf(" ");
    if (cut < 0) return null;
    cur = cur.slice(0, cut);
  }
}

/** The case gate for a lone word: capitalised, or all upper case. */
function looksLikeAName(word: string): boolean {
  const first = word.match(/\p{L}/u)?.[0] ?? "";
  if (first !== first.toLowerCase()) return true;
  return word === word.toUpperCase() && word !== word.toLowerCase();
}

function phoneAccepted(match: string): boolean {
  return digitsOf(match).length >= MIN_PHONE_DIGITS && !DATE_START.test(match);
}

// --- the session --------------------------------------------------------------

/** `kind: null` reserves a range unchanged (an IBAN-shaped run that fails the
 *  checksum), so no phone pattern can match inside it. */
type Span = { start: number; end: number; kind: Kind | null; key: string; spelling: string };

const KINDS: readonly Kind[] = ["person", "email", "phone", "iban"];
/** The per-session redaction cache's bounds (S4): entries, and characters held (original plus redaction). */
const CACHE_MAX_ENTRIES = 4096;
const CACHE_MAX_CHARS = 8_000_000;

/** `accepted` (sorted, disjoint) plus every span of `batch` that overlaps none of it; earlier batches win.
 *  `batch` must be sorted by start and disjoint, as one pattern's matches are. One pass per batch (review 5,
 *  S4): checking each candidate against every accepted span made one long string quadratic. */
function mergeBatch(accepted: readonly Span[], batch: readonly Span[]): readonly Span[] {
  if (batch.length === 0) return accepted;
  const out: Span[] = [];
  let i = 0;
  for (const c of batch) {
    if (c.end <= c.start) continue;
    while (i < accepted.length && accepted[i]!.end <= c.start) out.push(accepted[i++]!);
    if (i < accepted.length && accepted[i]!.start < c.end) continue;
    out.push(c);
  }
  while (i < accepted.length) out.push(accepted[i++]!);
  return out;
}

class Session implements RedactionSession {
  private signature = "";
  private names: NameMatcher = { re: null, owner: new Map(), ungated: new Set() };
  private knownPhones: { re: RegExp; key: string }[] = [];
  /** dictionary key -> dictionary spelling, per kind (emails/phones/persons). */
  private readonly canonical: Record<Kind, Map<string, string>> = {
    person: new Map(), email: new Map(), phone: new Map(), iban: new Map(),
  };
  private readonly numberOf: Record<Kind, Map<string, number>> = {
    person: new Map(), email: new Map(), phone: new Map(), iban: new Map(),
  };
  private readonly restoreTo: Record<Kind, Map<number, string>> = {
    person: new Map(), email: new Map(), phone: new Map(), iban: new Map(),
  };
  private readonly tally: RedactionCounts = { person: 0, email: 0, phone: 0, iban: 0 };
  /** Review 5, S4: original string -> its redaction and the replacements it made. Memory only, like the mapping;
   *  cleared whenever the dictionary changes, since that changes what a string redacts to. */
  private readonly cache = new Map<string, { out: string; counts: RedactionCounts }>();
  private cachedChars = 0;

  /** Absorb the dictionaries (union). Numbering already issued never changes. */
  setDictionaries(dicts: readonly PeopleDictionary[]): void {
    const names = dicts.flatMap((d) => d.names);
    const emails = dicts.flatMap((d) => d.emails);
    const phones = dicts.flatMap((d) => d.phones);
    const signature = JSON.stringify([names, emails, phones]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.cache.clear();
    this.cachedChars = 0;
    this.names = buildNameMatcher(names, this.canonical.person);
    for (const e of emails) {
      const key = e.trim().toLowerCase();
      if (!this.canonical.email.has(key)) this.canonical.email.set(key, e.trim());
    }
    this.knownPhones = [];
    for (const p of phones) {
      const digits = digitsOf(p);
      if (digits.length < MIN_KNOWN_PHONE_DIGITS) continue;
      const key = phoneKey(p);
      if (!this.canonical.phone.has(key)) this.canonical.phone.set(key, p.trim());
      const plus = key.startsWith("+") ? "(?:\\+\\s*)?" : "";
      const body = [...digits].join(PHONE_SEP);
      this.knownPhones.push({ re: new RegExp(`(?<![\\d+])${plus}${body}(?!\\d)`, "g"), key });
    }
  }

  /** Review 5, S4: a cached string is not matched again, but its replacements are COUNTED again, so `counts()`
   *  (and the per-send `ai.peopleRedacted` diag, a before/after difference of it) reads the same with or
   *  without the cache: the replacements in the body sent, not the work done. */
  redact(text: string): string {
    const hit = this.cache.get(text);
    if (hit) {
      this.cache.delete(text);
      this.cache.set(text, hit); // least recently used is evicted first
      for (const kind of KINDS) this.tally[kind] += hit.counts[kind];
      return hit.out;
    }
    const before = this.counts();
    const out = this.render(text, this.spansOf(text));
    const after = this.counts();
    this.remember(text, out, { person: after.person - before.person, email: after.email - before.email, phone: after.phone - before.phone, iban: after.iban - before.iban });
    return out;
  }

  /** Bounded by entries and by characters held; a string over the character bound is not cached. */
  private remember(text: string, out: string, counts: RedactionCounts): void {
    const size = text.length + out.length;
    if (size > CACHE_MAX_CHARS) return;
    while (this.cache.size >= CACHE_MAX_ENTRIES || this.cachedChars + size > CACHE_MAX_CHARS) {
      const [oldest, entry] = this.cache.entries().next().value!;
      this.cache.delete(oldest);
      this.cachedChars -= oldest.length + entry.out.length;
    }
    this.cache.set(text, { out, counts });
    this.cachedChars += size;
  }

  /** Every span to replace, sorted and disjoint. Kinds are taken in priority order; one batch per pattern. */
  private spansOf(text: string): readonly Span[] {
    const at = (m: RegExpExecArray) => ({ start: m.index, end: m.index + m[0].length, spelling: m[0] });
    let spans = mergeBatch([], [...text.matchAll(EMAIL_RE)].map((m) => ({ ...at(m), kind: "email" as const, key: m[0].toLowerCase() })));
    spans = mergeBatch(spans, [...text.matchAll(IBAN_RE)].map((m) => {
      const iban = validIbanPrefix(m[0]);
      return iban
        ? { start: m.index, end: m.index + iban.length, kind: "iban" as const, key: iban.replace(/ /g, ""), spelling: iban }
        : { ...at(m), kind: null, key: "" };
    }));
    for (const { re, key } of this.knownPhones) {
      spans = mergeBatch(spans, [...text.matchAll(re)].map((m) => ({ ...at(m), kind: "phone" as const, key })));
    }
    spans = mergeBatch(spans, [...text.matchAll(PHONE_RE)].filter((m) => phoneAccepted(m[0]))
      .map((m) => ({ ...at(m), kind: "phone" as const, key: phoneKey(m[0]) })));
    return mergeBatch(spans, this.nameSpans(text));
  }

  private nameSpans(text: string): Span[] {
    if (!this.names.re) return [];
    const spans: Span[] = [];
    const { folded, map } = foldWithMap(text);
    for (const m of folded.matchAll(this.names.re)) {
      const alt = normSpace(m[0]);
      const person = this.names.owner.get(alt);
      if (person === undefined) continue;
      const start = map[m.index];
      // The match must end on a cluster boundary: the genitive look-ahead lets an
      // "s" follow, which could be the second half of one folded ß ("hanss").
      const after = m.index + m[0].length;
      if (map[after] === map[after - 1]) continue;
      const end = map[after];
      const spelling = text.slice(start, end);
      if (!alt.includes(" ") && !this.names.ungated.has(alt) && !looksLikeAName(spelling)) continue;
      spans.push({ start, end, kind: "person", key: person, spelling });
    }
    return spans;
  }

  private render(text: string, spans: readonly Span[]): string {
    let out = "";
    let at = 0;
    for (const s of spans) {
      out += text.slice(at, s.start) + (s.kind === null ? s.spelling : this.placeholder(s, s.kind));
      at = s.end;
    }
    return out + text.slice(at);
  }

  private placeholder(s: Span, kind: Kind): string {
    let n = this.numberOf[kind].get(s.key);
    if (n === undefined) {
      n = this.numberOf[kind].size + 1;
      this.numberOf[kind].set(s.key, n);
      this.restoreTo[kind].set(n, this.canonical[kind].get(s.key) ?? s.spelling);
    }
    this.tally[kind] += 1;
    return `[${LABEL[kind]} ${n}]`;
  }

  restore(text: string): string {
    return text.replace(PLACEHOLDER, (whole, label: string, num: string) =>
      this.restoreTo[KIND_BY_LABEL[label.toLowerCase()]].get(Number(num)) ?? whole);
  }

  counts(): RedactionCounts {
    return { ...this.tally };
  }
}

/** Browser-session memo: one session per sorted project-key list. Never persisted. */
const sessions = new Map<string, Session>();

/** The session for these projects, its dictionary the union of `dicts`.
 *  Placeholders already issued stay stable as the dictionaries grow. */
export function redactionSessionFor(projectKeys: readonly string[], dicts: readonly PeopleDictionary[]): RedactionSession {
  const id = JSON.stringify([...projectKeys].sort());
  let s = sessions.get(id);
  if (!s) {
    s = new Session();
    sessions.set(id, s);
  }
  s.setDictionaries(dicts);
  return s;
}

// --- JSON request/response bodies -------------------------------------------

/** String values that are protocol or opaque blobs, never content. */
const PROTOCOL_KEYS: ReadonlySet<string> = new Set([
  "model", "role", "type", "id", "tool_use_id", "media_type", "signature", "stop_reason",
]);

function isProtocolString(key: string, owner: Record<string, unknown>): boolean {
  if (PROTOCOL_KEYS.has(key)) return true;
  // A tool's own name (tool_use / server_tool_use block, tool_choice) — NOT a
  // `name` inside a tool INPUT, which is data the model wrote.
  // A base64 source's `data` is opaque bytes (an image or a PDF): a refusing
  // protection never walks one (`hasUnredactableContent`), and the unforced
  // create-project wizard sends them through a pattern-only session, where an
  // IBAN- or phone-shaped run inside the base64 would corrupt the file (review 3,
  // R3). A plain-text document's `data` IS readable text and is redacted;
  // `redacted_thinking` is passed whole by `redactValue`.
  if (key === "data" && owner.type === "base64") return true;
  return key === "name" && (owner.type === "tool_use" || owner.type === "server_tool_use" || owner.type === "tool");
}

/** Every string redacted, KEYS included, whatever its key: a tool `input` is data
 *  the model wrote, and the transport restores real names into it, so a
 *  protocol-named key there (`role`, `type`, `id`, `data`…) is content too.
 *  Review 3, R7: `restoreJsonText` restores the raw reply text, so a placeholder
 *  the model used as an object key comes back as a real name and rides in the
 *  history; redacting keys here keeps it from leaving on the next send. No tool
 *  schema keys an object by person today (keys are ids, months, milestone ids). */
function redactAll(v: unknown, s: RedactionSession): unknown {
  if (typeof v === "string") return s.redact(v);
  if (Array.isArray(v)) return v.map((x) => redactAll(x, s));
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[s.redact(k)] = redactAll(x, s);
  return out;
}

/** `top`: the request body itself, whose `tools` definitions pass untouched. */
function redactValue(v: unknown, s: RedactionSession, top = false): unknown {
  if (typeof v === "string") return s.redact(v);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, s));
  if (v === null || typeof v !== "object") return v;
  const owner = v as Record<string, unknown>;
  if (owner.type === "redacted_thinking") return owner; // opaque, and the API verifies it
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(owner)) {
    const keep = (top && k === "tools") || (typeof x === "string" && isProtocolString(k, owner));
    out[k] = keep ? x : k === "input" ? redactAll(x, s) : redactValue(x, s);
  }
  return out;
}

/** Redact every string VALUE of a JSON request body, and the keys inside a tool
 *  `input` (R7); other keys (protocol or app-authored), protocol strings, opaque
 *  blobs and the top-level `tools` definitions (app-authored, no project data) stay. A body that is not JSON is redacted as plain text, never sent raw. */
export function redactJsonBody(body: string, s: RedactionSession): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return s.redact(body);
  }
  return JSON.stringify(redactValue(parsed, s, true));
}

/** Restore placeholders inside JSON (or SSE) text; each restored value is
 *  JSON-escaped so the text stays valid. Unknown placeholders are untouched. */
export function restoreJsonText(text: string, s: RedactionSession): string {
  return text.replace(PLACEHOLDER, (whole) => {
    const restored = s.restore(whole);
    return restored === whole ? whole : JSON.stringify(restored).slice(1, -1);
  });
}
