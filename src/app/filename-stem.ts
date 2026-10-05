// src/app/filename-stem.ts — free text (a document or project title) → the
// stem of a downloaded file's name. Shared by document-download.ts's
// `documentFilename` and export.ts's `exportFilename`, so a document and a
// whole-project export slug a title by the SAME rule. Kept out of
// document-download.ts because that module pulls in every document renderer,
// which export.ts has no reason to load.

/** Longest slug we put in front of the `-YYYY-MM-DD.ext` suffix.
 *
 *  ★ MAX_TITLE_CHARS is 200, so an uncapped stem produces a ~211-character
 *  name. File systems generally cap a path COMPONENT at 255 BYTES — and a
 *  non-ASCII title costs two bytes per character there — while browsers append
 *  " (1)", " (2)" on a name collision. Capping is cheaper than discovering the
 *  limit at write time. */
export const MAX_FILENAME_STEM = 80;

/** C0 controls, DEL and C1 — expressed as the complement of the printable
 *  ranges. Every bound is an ESCAPE, not the character itself: a literal one
 *  would trip eslint's no-control-regex, and an invisible byte in source is
 *  exactly what a stray editor pass silently mangles. */
const NON_PRINTABLE = /[^\u0020-\u007E\u00A0-\uFFFF]/g;

/** Path separators, the characters Windows reserves, and any whitespace run.
 *  Collapsing these is what stops a title from introducing a directory
 *  component or a name Explorer refuses to create. */
const FS_UNSAFE = /[<>:"/\\|?*\s]+/g;

/** Title → filename stem, or `fallback` when nothing survives.
 *
 *  ★★ Non-ASCII LETTERS ARE KEPT ON PURPOSE. The obvious slug — lowercase then
 *  `[^a-z0-9]+` → "-" — silently ASCII-mangles German: "Änderung" becomes
 *  "nderung", "Übersicht" becomes "bersicht". German is a first-class language
 *  in this app and the i18n-encoding test already bans ASCII substitutions in
 *  German strings; a filename is no place to reintroduce them. Only characters
 *  a FILE SYSTEM objects to are removed. */
export function filenameStem(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    // ★★ ORDER IS LOAD-BEARING. Tab, newline and CR are BOTH control
    // characters and whitespace. Dropping non-printables first fuses the words
    // either side of a pasted line break ("Q1\tStatus" → "q1status"); mapping
    // whitespace to a separator first keeps them apart, and only the truly
    // invisible controls are then dropped. Caught by test, not by review.
    .replace(FS_UNSAFE, "-")
    .replace(NON_PRINTABLE, "")
    .replace(/-{2,}/g, "-")
    // Leading dots would make a dotfile; leading/trailing dashes are noise.
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
  return capStem(slug, MAX_FILENAME_STEM) || fallback;
}

/** The first `max` UTF-16 units of a stem, cut so it never ends inside a
 *  character or on a separator.
 *
 *  ★ `NON_PRINTABLE` keeps U+D800–DFFF, so an emoji or other astral character
 *  is TWO units here, and a plain `slice` can stop between them — leaving a
 *  lone high surrogate, i.e. a broken character, at the end of the name. Trim
 *  it, then trim again: slicing mid-word can also leave a dangling "-". */
function capStem(stem: string, max: number): string {
  return stem.slice(0, max).replace(/[\uD800-\uDBFF]$/, "").replace(/-+$/, "");
}

/** A project code → its filename stem, held to HALF of `MAX_FILENAME_STEM`.
 *  §509 — the code leads a name, so an uncapped one (the field allows far more
 *  than 80 characters) would push the title out of the name entirely. */
export const MAX_CODE_STEM = MAX_FILENAME_STEM / 2;

export function projectCodeStem(code: string | undefined): string {
  return capStem(filenameStem(code ?? "", ""), MAX_CODE_STEM);
}

/** Already-slugged stems → ONE stem, joined with "-", empty ones dropped, and
 *  held to the same `MAX_FILENAME_STEM` cap as a single stem. §509 — a project
 *  code in front of a title must not let the name grow past the limit the cap
 *  exists for (each half alone may already be at it). The cut falls on the
 *  LAST stem, so pass the code first via `projectCodeStem`, which leaves the
 *  title at least half the budget. */
export function joinFilenameStems(...stems: readonly string[]): string {
  return capStem(stems.filter((s) => s !== "").join("-"), MAX_FILENAME_STEM);
}
