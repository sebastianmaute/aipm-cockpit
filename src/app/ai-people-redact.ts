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
//   other marks are stripped). Whitespace inside a name may be any run of
//   whitespace. The longest alternative wins at each position.
// - Dictionary names go through cleanPersonName first: "(CFO)" suffixes and
//   "nobody" values such as TBD or "offen" never become names.
// - A FULL known name is always redacted; a one-word dictionary entry is a full
//   name too (no stop list, no length floor). A single TOKEN of a multi-word
//   name is redacted alone only when it is at least MIN_TOKEN_LENGTH long,
//   belongs to exactly ONE known person, and is not in NAME_STOP_WORDS.
// - Case gate: a LONE word (a one-word entry or a token) is redacted only when
//   the text spells it capitalised or all upper case, so "price list" stays
//   while "Price" goes. Multi-word names match in any case.
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
]);

// --- folding -----------------------------------------------------------------

const GERMAN_FOLD: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

function foldChar(c: string): string {
  const lower = c.toLowerCase();
  return GERMAN_FOLD[lower] ?? lower.normalize("NFD").replace(/\p{M}+/gu, "");
}

/** Fold `text`; `map[i]` is the index in `text` of the char folded char `i` came from. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const c of text) {
    const f = foldChar(c);
    folded += f;
    for (let k = 0; k < f.length; k++) map.push(i);
    i += c.length;
  }
  map.push(text.length);
  return { folded, map };
}

const fold = (s: string) => foldWithMap(s).folded;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normSpace = (s: string) => s.trim().replace(/\s+/g, " ");

// --- the person matcher -----------------------------------------------------

type NameMatcher = { readonly re: RegExp | null; readonly owner: ReadonlyMap<string, string> };

/** Person key = folded full name. `canonical` maps it to the first spelling seen. */
function buildNameMatcher(names: readonly string[], canonical: Map<string, string>): NameMatcher {
  const multi = new Map<string, string[]>(); // person key -> folded tokens
  const singles: string[] = [];
  for (const raw of names) {
    const name = cleanPersonName(raw);
    if (name === null) continue;
    const key = normSpace(fold(name));
    if (!key) continue;
    if (!canonical.has(key)) canonical.set(key, name);
    if (key.includes(" ")) multi.set(key, key.split(" "));
    else singles.push(key);
  }
  const tokenOwners = new Map<string, Set<string>>();
  for (const [key, tokens] of multi) {
    for (const t of tokens) tokenOwners.set(t, (tokenOwners.get(t) ?? new Set()).add(key));
  }
  const owner = new Map<string, string>(); // folded alternative -> person key
  for (const key of multi.keys()) owner.set(key, key);
  // A one-word entry is a full known name: an alias of the one multi-word person
  // it is a token of, else a person of its own. Never stop-listed (F1).
  for (const single of new Set(singles)) {
    const owners = tokenOwners.get(single);
    owner.set(single, owners && owners.size === 1 ? [...owners][0] : single);
  }
  for (const [token, owners] of tokenOwners) {
    if (owners.size !== 1 || [...token].length < MIN_TOKEN_LENGTH || NAME_STOP_WORDS.has(token)) continue;
    if (!/\p{L}/u.test(token)) continue;
    if (!owner.has(token)) owner.set(token, [...owners][0]);
  }
  if (owner.size === 0) return { re: null, owner };
  const alternatives = [...owner.keys()]
    .sort((a, b) => b.length - a.length)
    .map((alt) => alt.split(" ").map(escapeRe).join("\\s+"));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return { re, owner };
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

class Session implements RedactionSession {
  private signature = "";
  private names: NameMatcher = { re: null, owner: new Map() };
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

  /** Absorb the dictionaries (union). Numbering already issued never changes. */
  setDictionaries(dicts: readonly PeopleDictionary[]): void {
    const names = dicts.flatMap((d) => d.names);
    const emails = dicts.flatMap((d) => d.emails);
    const phones = dicts.flatMap((d) => d.phones);
    const signature = JSON.stringify([names, emails, phones]);
    if (signature === this.signature) return;
    this.signature = signature;
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

  redact(text: string): string {
    const spans: Span[] = [];
    const free = (start: number, end: number) => spans.every((s) => end <= s.start || start >= s.end);
    const add = (span: Span) => { if (span.end > span.start && free(span.start, span.end)) spans.push(span); };

    for (const m of text.matchAll(EMAIL_RE)) {
      add({ start: m.index, end: m.index + m[0].length, kind: "email", key: m[0].toLowerCase(), spelling: m[0] });
    }
    for (const m of text.matchAll(IBAN_RE)) {
      const iban = validIbanPrefix(m[0]);
      if (iban) add({ start: m.index, end: m.index + iban.length, kind: "iban", key: iban.replace(/ /g, ""), spelling: iban });
      else add({ start: m.index, end: m.index + m[0].length, kind: null, key: "", spelling: m[0] });
    }
    for (const { re, key } of this.knownPhones) {
      for (const m of text.matchAll(re)) add({ start: m.index, end: m.index + m[0].length, kind: "phone", key, spelling: m[0] });
    }
    for (const m of text.matchAll(PHONE_RE)) {
      if (phoneAccepted(m[0])) add({ start: m.index, end: m.index + m[0].length, kind: "phone", key: phoneKey(m[0]), spelling: m[0] });
    }
    if (this.names.re) {
      const { folded, map } = foldWithMap(text);
      for (const m of folded.matchAll(this.names.re)) {
        const alt = normSpace(m[0]);
        const person = this.names.owner.get(alt);
        if (person === undefined) continue;
        const start = map[m.index];
        // The look-ahead forbids a letter after the match, so it never ends inside
        // a folded expansion (ü -> ue); the next folded char's origin is the end.
        const end = map[m.index + m[0].length];
        const spelling = text.slice(start, end);
        if (!alt.includes(" ") && !looksLikeAName(spelling)) continue;
        add({ start, end, kind: "person", key: person, spelling });
      }
    }

    spans.sort((a, b) => a.start - b.start);
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
  if (key === "name" && (owner.type === "tool_use" || owner.type === "server_tool_use" || owner.type === "tool")) return true;
  // `data` is an opaque blob (base64, redacted thinking) — except a plain-text
  // document source, whose `data` IS the attachment's readable text.
  return key === "data" && owner.type !== "text";
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
    out[k] = keep ? x : redactValue(x, s);
  }
  return out;
}

/** Redact every string VALUE of a JSON request body; keys, protocol strings,
 *  opaque blobs and the top-level `tools` definitions (app-authored, no project
 *  data) stay. A body that is not JSON is redacted as plain text, never sent raw. */
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
