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

// Each descriptor carries one or two patterns. `kind` says which source value a
// pattern is compared against: "version" or "milestone".
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
      { key: "milestone", kind: "milestone", re: /(badge\/version-v[^_]+_%22)([^%]+)(%22)/ },
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
    out[p.key] = m[2];
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
    const value = p.kind === "version" ? version : milestone;
    out = out.replace(p.re, (_m, a, _v, z) => a + value + z);
  }
  return out;
}

/** Compare one file's readings against the source. Returns an array of messages. */
export function diffSatellite(satellite, readings, version, milestone) {
  const problems = [];
  for (const p of satellite.patterns) {
    const want = p.kind === "version" ? version : milestone;
    const got = readings[p.key];
    if (got !== want) problems.push(`${satellite.file} ${p.key}: ${got} (expected ${want})`);
  }
  return problems;
}
