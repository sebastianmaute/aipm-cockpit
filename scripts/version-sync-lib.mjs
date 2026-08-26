// scripts/version-sync-lib.mjs — shared layer for the version-sync gate.
//
// WHY: src/app/version.ts is the source of truth for the app version and
// codename, and six other places restate one or both. Nothing compared them
// until this gate: `grep -rn "APP_VERSION" scripts/ .gitlab-ci.yml` returned
// nothing. They have drifted before and silently — package.json six releases
// behind, package-lock.json eleven, while version.ts and CHANGELOG.md were
// correct.
//
// ★★★ ONE REGEX PER SATELLITE, THREE CAPTURE GROUPS: prefix, value, suffix.
// The reader takes the value group; the writer replaces it and re-emits the
// other two verbatim. Reader and writer therefore cannot drift, and a shape
// change breaks BOTH at once rather than silently breaking one — which is the
// failure this register keeps recording, a probe reporting IN SYNC because its
// regex stopped matching.
//
// ★★★ package-lock.json carries 681 `"version":` keys. Both of its targets are
// anchored on the `"name": "aipm-cockpit",` line directly above them. An
// unanchored replace would rewrite every dependency pin in the lockfile.
//
// ★★ NEVER JSON.parse -> JSON.stringify these files. It reformats the whole
// document and normalises line endings; package.json and package-lock.json are
// CRLF in the working tree under core.autocrlf while *.md is pinned LF by
// .gitattributes. Targeted text replacement only.

export const SOURCE_FILE = "src/app/version.ts";

/** Read APP_VERSION and APP_MILESTONE out of version.ts source text. */
export function readSourceFrom(text) {
  const v = /export const APP_VERSION = "([^"]+)"/.exec(text);
  if (!v) throw new Error(`${SOURCE_FILE}: APP_VERSION declaration not found — shape moved`);
  const m = /export const APP_MILESTONE = "([^"]+)"/.exec(text);
  if (!m) throw new Error(`${SOURCE_FILE}: APP_MILESTONE declaration not found — shape moved`);
  return { version: v[1], milestone: m[1] };
}

/** shields.io badge text: `_` renders as a space, so a real space must be sent
 *  as `_`. ★ REFUSES rather than guesses on a codename containing `_`: the
 *  scheme cannot represent both unambiguously (shields' own escape is `__`,
 *  which collides the moment a name holds a space AND an underscore), and this
 *  file's rule is to fail loudly rather than round-trip a value wrong. Every
 *  codename so far is an author surname, so the throw is unreachable in
 *  practice and is there to stay unreachable. */
export function encodeBadgeText(value) {
  if (value.includes("_")) {
    throw new Error(
      `README badge: codename ${JSON.stringify(value)} contains "_", which shields.io renders ` +
        `as a space — it cannot be encoded unambiguously. Rename the milestone.`,
    );
  }
  return value.replace(/ /g, "_");
}

/** Inverse of `encodeBadgeText` for any value that encoder would accept. */
export function decodeBadgeText(text) {
  return text.replace(/_/g, " ");
}

// Each descriptor carries one or two patterns. `kind` says which source value a
// pattern is compared against: "version" or "milestone". A pattern MAY carry
// `encode`/`decode` when the file's own syntax cannot hold the raw value — see
// the README badge below, the only such case today.
export const SATELLITES = [
  {
    file: "package.json",
    label: "package.json version",
    patterns: [
      { key: "version", kind: "version", re: /("name": "[^"]+",\r?\n  "version": ")([^"]+)(")/ },
    ],
  },
  {
    file: "package-lock.json",
    label: "package-lock.json root + packages[''] version",
    patterns: [
      { key: "version", kind: "version", re: /(^\{\r?\n  "name": "[^"]+",\r?\n  "version": ")([^"]+)(")/ },
      {
        key: "version2",
        kind: "version",
        re: /(    "": \{\r?\n      "name": "[^"]+",\r?\n      "version": ")([^"]+)(")/,
      },
    ],
  },
  {
    file: "README.md",
    label: "README shields badge",
    patterns: [
      { key: "version", kind: "version", re: /(badge\/version-v)([^_]+)(_%22)/ },
      {
        key: "milestone",
        kind: "milestone",
        re: /(badge\/version-v[^_]+_%22)([^%]+)(%22)/,
        // ★★★ THE ONLY SATELLITE THAT IS NOT PLAIN TEXT — it is a URL inside a
        // markdown link, and BOTH layers reject a raw space. shields.io renders
        // `_` as a space in badge text (which is why the existing badge reads
        // `v0.260.1_%22Cho%22`), and a space in a CommonMark link destination
        // ENDS the destination: the URL would truncate mid-codename and the
        // rest of the line, closing paren included, would become body text.
        // ★★ Without these hooks the failure is SILENT AND SELF-CERTIFYING:
        // the writer emits the raw space, the reader's `([^%]+)` reads it back
        // verbatim, `diffSatellite` compares equal, and the gate reports IN
        // SYNC over a badge whose link is broken. Measured on a scratch copy
        // with a two-word codename before this was added — `--update` exited 0
        // and the follow-up check exited 0.
        encode: encodeBadgeText,
        decode: decodeBadgeText,
      },
    ],
  },
  {
    // Glob, not a path: every file under docs/CODEMAPS carries the header.
    file: "docs/CODEMAPS/*.md",
    label: "codemap generated header",
    patterns: [
      { key: "version", kind: "version", re: /(\| App )([^ ]+)( ")/ },
      { key: "milestone", kind: "milestone", re: /(\| App [^ ]+ ")([^"]+)(")/ },
    ],
  },
];

/** Read every pattern's value out of one file's text. Throws if a shape moved. */
export function readValue(satellite, text) {
  const out = {};
  for (const p of satellite.patterns) {
    const m = p.re.exec(text);
    if (!m) {
      throw new Error(
        `${satellite.file}: the ${p.key} pattern did not match — the shape moved. ` +
          `Refusing to report a reading rather than reporting a wrong one.`,
      );
    }
    out[p.key] = p.decode ? p.decode(m[2]) : m[2];
  }
  return out;
}

/** Rewrite every pattern's value in one file's text. Throws if a shape moved. */
export function applyValue(satellite, text, version, milestone) {
  let out = text;
  for (const p of satellite.patterns) {
    if (!p.re.test(out)) {
      throw new Error(`${satellite.file}: the ${p.key} pattern did not match — the shape moved.`);
    }
    const raw = p.kind === "version" ? version : milestone;
    const value = p.encode ? p.encode(raw) : raw;
    out = out.replace(p.re, (_m, a, _v, z) => a + value + z);
  }
  return out;
}

/** Compare one file's readings against the source. Returns an array of messages.
 *  ★ `file` is the RESOLVED path, defaulting to the descriptor's own. It matters
 *  only for the codemap descriptor, whose `file` is a GLOB: without it, two
 *  codemaps drifting to different values both report as `docs/CODEMAPS/*.md`
 *  and the operator cannot tell which file to open. The readings printed above
 *  the verdict carry the path, but the problem list is where anyone looks. */
export function diffSatellite(satellite, readings, version, milestone, file = satellite.file) {
  const problems = [];
  for (const p of satellite.patterns) {
    const want = p.kind === "version" ? version : milestone;
    const got = readings[p.key];
    if (got !== want) problems.push(`${file} ${p.key}: ${got} (expected ${want})`);
  }
  return problems;
}
