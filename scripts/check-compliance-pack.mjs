#!/usr/bin/env node
// Gate: the compliance pack under docs/compliance/ keeps its shape.
//
//   npm run compliance:check
//
// Checks, with the pure rules in scripts/compliance/pack-lib.mjs:
//   1. markers: every file parses (no unknown, unpaired or nested block) and carries
//      exactly the blocks BLOCKS_BY_FILE (pack-config.mjs) assigns it; BLOCKS_BY_FILE
//      names every PACK_FILES file and nothing else;
//   2. parity: en/ and de/ hold the same files, each pair with the same heading levels
//      and block names in the same order;
//   3. claims: no deny-listed phrase in either language, anywhere in a file, generated
//      block bodies included (they are published like the prose around them);
//   4. gaps: every CITED_GAPS number is an open register entry;
//   5. review line: each README has exactly one, both name the same version and date,
//      and the version is not newer than APP_VERSION (read from src/app/version.ts as text);
//   6. the root README links to en/README.md and de/README.md.
// Whether the block BODIES match the code is the unit test pack-drift.test.ts, because
// rendering them needs the TypeScript sources; `npm run compliance:generate` rewrites them.
//
// Exit codes: 0 clean; 1 drift (fix the pack); 2 could not scan (a directory or file it
// must read is missing or unreadable) — a scan that reads nothing must never pass.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCKS_BY_FILE, CITED_GAPS } from "./compliance/pack-config.mjs";
import {
  PACK_FILES,
  PACK_LANGS,
  REVIEW_LINE,
  claimViolations,
  gapViolations,
  parityViolations,
  parseBlocks,
  reviewLineViolations,
} from "./compliance/pack-lib.mjs";

const PACK_DIR = "docs/compliance";
const REGISTER = "docs/open-followups.md";
const VERSION_FILE = "src/app/version.ts";

function cannotScan(message) {
  console.error(`CANNOT SCAN: ${message}`);
  process.exit(2);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    return cannotScan(`${path} is unreadable (${err.code ?? err.message}).`);
  }
}

function listMarkdown(dir) {
  try {
    return readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  } catch (err) {
    return cannotScan(`${dir} is unreadable (${err.code ?? err.message}).`);
  }
}

const versionMatch = /export const APP_VERSION = "(\d+\.\d+\.\d+)"/.exec(read(VERSION_FILE));
if (!versionMatch) cannotScan(`${VERSION_FILE}: APP_VERSION declaration not found.`);
const appVersion = versionMatch[1];
const register = read(REGISTER);
const rootReadme = read(join(PACK_DIR, "README.md"));

const violations = [];
for (const lang of PACK_LANGS) {
  if (!rootReadme.includes(`](${lang}/README.md)`)) violations.push(`README.md: no link to ${lang}/README.md`);
}
for (const c of claimViolations(rootReadme, "en")) violations.push(`README.md: ${c}`);
for (const name of PACK_FILES) {
  if (!Object.hasOwn(BLOCKS_BY_FILE, name)) violations.push(`BLOCKS_BY_FILE: no entry for ${name}`);
}
for (const name of Object.keys(BLOCKS_BY_FILE)) {
  if (!PACK_FILES.includes(name)) violations.push(`BLOCKS_BY_FILE: ${name} is not a pack file (PACK_FILES)`);
}
const trees = {};
for (const lang of PACK_LANGS) {
  const dir = join(PACK_DIR, lang);
  const names = listMarkdown(dir);
  if (names.length === 0) cannotScan(`${dir} holds no Markdown files.`);
  for (const name of PACK_FILES) {
    if (!names.includes(name)) violations.push(`${lang}/${name}: missing`);
  }
  for (const name of names) {
    if (!PACK_FILES.includes(name)) violations.push(`${lang}/${name}: not a pack file (PACK_FILES)`);
  }
  trees[lang] = Object.fromEntries(names.map((n) => [n, read(join(dir, n))]));
}

for (const lang of PACK_LANGS) {
  for (const [name, src] of Object.entries(trees[lang])) {
    const { blocks, errors } = parseBlocks(src);
    for (const e of errors) violations.push(`${lang}/${name}: ${e}`);
    const expected = Object.hasOwn(BLOCKS_BY_FILE, name) ? BLOCKS_BY_FILE[name] : [];
    const actual = blocks.map((b) => b.name);
    if (actual.join(",") !== expected.join(",")) {
      violations.push(
        `${lang}/${name}: blocks [${actual.join(", ")}], expected [${expected.join(", ")}] (BLOCKS_BY_FILE)`,
      );
    }
    for (const c of claimViolations(src, lang)) violations.push(`${lang}/${name}: ${c}`);
  }
}

for (const p of parityViolations(trees.en, trees.de)) violations.push(`parity: ${p}`);
for (const g of gapViolations(CITED_GAPS, register)) violations.push(`gaps: ${g}`);

const enReadme = trees.en["README.md"];
const deReadme = trees.de["README.md"];
if (enReadme !== undefined && deReadme !== undefined) {
  for (const [lang, src] of [["en", enReadme], ["de", deReadme]]) {
    const all = new RegExp(REVIEW_LINE[lang].source, "gm");
    const count = (src.replace(/\r\n/g, "\n").match(all) ?? []).length;
    if (count > 1) violations.push(`review line: ${lang} README carries ${count} review lines, expected one`);
  }
  for (const r of reviewLineViolations(enReadme, deReadme, appVersion)) violations.push(`review line: ${r}`);
}

const fileCount = PACK_LANGS.reduce((n, lang) => n + Object.keys(trees[lang]).length, 0);
if (violations.length > 0) {
  console.error(`Compliance pack: ${violations.length} problem(s) in ${fileCount} files.\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nBlock bodies are written by `npm run compliance:generate`; prose and headings by hand.");
  process.exit(1);
}
console.log(
  `Compliance pack: ${fileCount} files, ${CITED_GAPS.length} cited gaps, review line at ${appVersion} or older — clean.`,
);
