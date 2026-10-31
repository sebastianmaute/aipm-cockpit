// src/app/ai-people-redact-cache.ts
//
// AI people protection: a redaction session's cache, and the echo memory built on it (follow-up m5). Pure,
// i18n-free, memory only (never persisted), and private to `ai-people-redact.ts`.
//
// The cache maps an original string to its redaction (review 5, S4). The echo memory answers one question on
// restore: when a reply carries a placeholder at a spot where the session put it into text it SENT, which spelling
// did that text have there? Owner ruling (2026-10-31): one placeholder per person, so the model's view is unchanged;
// a spot the reply echoes gets its original spelling back; new text the AI writes gets the stored spelling.
// - A whole string equal to a redaction the session produced restores that original exactly (`original`). The
//   redaction must carry at least ECHO_MIN_CONTEXT characters besides its placeholders: a bare "[Person 1]" is
//   not specific, so it is new text and gets the stored spelling.
// - Otherwise, per placeholder (`spellingAt`): the ECHO_WINDOW characters either side of each placeholder the
//   session issued were recorded, in redacted form, with the spelling it replaced. A side with fewer than
//   ECHO_MIN_CONTEXT characters besides placeholders (the start or end of a short string) is not recorded. When
//   the reply has a recorded window of the SAME placeholder beside it, that spelling is used, but only when every
//   matching record agrees on one spelling; otherwise the caller uses the stored spelling.
// - Never a different person: records are keyed by the placeholder, and a placeholder's number is never reissued,
//   so a recorded spelling is always one the session matched for that very placeholder. Two originals with the
//   same redaction carry the same placeholders at the same spots; when the cache holds more than one, `original`
//   answers nothing and the per-placeholder rule decides.
// Bounds: the records are part of the cache entry they came from and count toward its character bound; they go
// with it on eviction, on `clear` (a dictionary change) and when the session goes cold (follow-up m3). A lost
// record only means the stored spelling, which is what restore gave before m5.

/** Characters recorded on each side of a placeholder. */
export const ECHO_WINDOW = 16;
/** The least context, besides placeholders, that counts as the same spot. */
export const ECHO_MIN_CONTEXT = 12;

/** An issued placeholder in a redaction: `[at, end)` in it, its token ("person 1"), the spelling it replaced. */
export type Occurrence = { readonly at: number; readonly end: number; readonly token: string; readonly spelling: string };
export type CacheLimits = { readonly entries: number; readonly chars: number };

const ANY_PLACEHOLDER = /\[(?:person|email|phone|iban) \d+\]/gi;
const specific = (s: string): boolean => s.replace(ANY_PLACEHOLDER, "").length >= ECHO_MIN_CONTEXT;
const windowKey = (side: "L" | "R", token: string, window: string): string => `${side}\u0000${token}\u0000${window}`;

type Entry<T> = { readonly out: string; readonly data: T; readonly echo: readonly (readonly [string, string])[]; readonly size: number };

export class RedactionCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  /** redaction -> the originals (in the cache) that redact to it. */
  private readonly byOut = new Map<string, Set<string>>();
  /** window key -> spelling -> how many cached records carry it. */
  private readonly spellings = new Map<string, Map<string, number>>();
  private chars = 0;

  constructor(private readonly limits: CacheLimits) {}

  /** The cached redaction of `text`, now the most recently used. */
  get(text: string): { out: string; data: T } | undefined {
    const hit = this.entries.get(text);
    if (!hit) return undefined;
    this.entries.delete(text);
    this.entries.set(text, hit); // least recently used is evicted first
    return hit;
  }

  /** Cache `text` -> `out`, with the placeholders `out` carries. A string over the character bound is not cached. */
  set(text: string, out: string, data: T, occurrences: readonly Occurrence[]): void {
    if (this.entries.has(text)) return;
    const echo: (readonly [string, string])[] = [];
    for (const o of occurrences) {
      const left = out.slice(Math.max(0, o.at - ECHO_WINDOW), o.at);
      const right = out.slice(o.end, o.end + ECHO_WINDOW);
      if (specific(left)) echo.push([windowKey("L", o.token, left), o.spelling]);
      if (specific(right)) echo.push([windowKey("R", o.token, right), o.spelling]);
    }
    const size = echo.reduce((n, [key, spelling]) => n + key.length + spelling.length, text.length + out.length);
    if (size > this.limits.chars) return;
    while (this.entries.size > 0 && (this.entries.size >= this.limits.entries || this.chars + size > this.limits.chars)) {
      this.evictOldest();
    }
    this.entries.set(text, { out, data, echo, size });
    this.chars += size;
    if (out !== text && specific(out)) this.byOut.set(out, (this.byOut.get(out) ?? new Set()).add(text));
    for (const [key, spelling] of echo) {
      const count = this.spellings.get(key) ?? new Map<string, number>();
      count.set(spelling, (count.get(spelling) ?? 0) + 1);
      this.spellings.set(key, count);
    }
  }

  /** The original of a whole string this cache redacted to `redacted`, when that redaction is specific and only
   *  one cached original has it. */
  original(redacted: string): string | undefined {
    const originals = this.byOut.get(redacted);
    return originals?.size === 1 ? originals.values().next().value : undefined;
  }

  /** The one spelling recorded for placeholder `token` at `[at, end)` of `text`, or undefined (no or several). */
  spellingAt(text: string, at: number, end: number, token: string): string | undefined {
    const found = new Set<string>();
    const collect = (key: string) => {
      for (const spelling of this.spellings.get(key)?.keys() ?? []) found.add(spelling);
    };
    // A full window is ECHO_WINDOW long; a shorter one was cut by the start or end of the string it came from.
    for (let k = ECHO_MIN_CONTEXT; k <= ECHO_WINDOW; k++) {
      if (at - k >= 0) collect(windowKey("L", token, text.slice(at - k, at)));
      if (end + k <= text.length) collect(windowKey("R", token, text.slice(end, end + k)));
    }
    return found.size === 1 ? found.values().next().value : undefined;
  }

  clear(): void {
    this.entries.clear();
    this.byOut.clear();
    this.spellings.clear();
    this.chars = 0;
  }

  use(): { entries: number; chars: number } {
    return { entries: this.entries.size, chars: this.chars };
  }

  private evictOldest(): void {
    const [text, entry] = this.entries.entries().next().value!;
    this.entries.delete(text);
    this.chars -= entry.size;
    const originals = this.byOut.get(entry.out);
    if (originals?.delete(text) && originals.size === 0) this.byOut.delete(entry.out);
    for (const [key, spelling] of entry.echo) {
      const count = this.spellings.get(key);
      if (!count) continue;
      const rest = (count.get(spelling) ?? 1) - 1;
      if (rest > 0) count.set(spelling, rest);
      else count.delete(spelling);
      if (count.size === 0) this.spellings.delete(key);
    }
  }
}
