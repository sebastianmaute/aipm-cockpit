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
//      block bodies included (they are published like the prose around them), matched across
//      the hard line wraps of a paragraph;
//   4. gaps: every CITED_GAPS number is an open register entry, and every register citation in
//      the prose (outside generated blocks and fences; `proseGapCitations` states the rule that
//      tells a register `§NNN` from a statute section such as "§ 87 BetrVG") is an open entry
//      listed in CITED_GAPS;
//   5. review line: each README has exactly one, both name the same version and date,
//      and the version is not newer than APP_VERSION (read from src/app/version.ts as text);
//   6. the root README links to en/README.md and de/README.md.
//   7. briefs (docs/briefs/{en,de}/): the same rules 1-4 over BRIEF_FILES and BRIEF_BLOCKS_BY_FILE, plus
//      figures.json (figuresViolations) and the evidence ids the pages cite (evidenceViolations);
// Whether the block BODIES match the code is the unit test pack-drift.test.ts, because
// rendering them needs the TypeScript sources; `npm run compliance:generate` rewrites them.
//
// Exit codes: 0 clean; 1 drift (fix the pack); 2 could not scan (a directory or file it
// must read is missing or unreadable) — a scan that reads nothing must never pass.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCKS_BY_FILE, BRIEF_BLOCKS_BY_FILE, CITED_GAPS } from "./compliance/pack-config.mjs";
import {
  BRIEF_FILES,
  PACK_FILES,
  PACK_LANGS,
  REVIEW_LINE,
  claimViolations,
  evidenceViolations,
  figuresViolations,
  gapViolations,
  linkViolations,
  parityViolations,
  parseBlocks,
  proseGapViolations,
  reviewLineViolations,
} from "./compliance/pack-lib.mjs";

const PACK_DIR = "docs/compliance";
const BRIEF_DIR = "docs/briefs";
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

/** One pack tree (docs/compliance or docs/briefs): its file list and block table name each other, every language
 *  directory holds exactly the listed files, each file carries exactly its blocks and no denied claim or
 *  unlisted gap citation. `prefix` leads each message ("" for the pack, "briefs/" for the briefs).
 *  @returns {Record<string, Record<string, string>>} language -> file name -> text. */
function scanTree({ dir, prefix, files, filesName, kind, blocksByFile, blocksName }) {
  for (const name of files) {
    if (!Object.hasOwn(blocksByFile, name)) violations.push(`${blocksName}: no entry for ${name}`);
  }
  for (const name of Object.keys(blocksByFile)) {
    if (!files.includes(name)) violations.push(`${blocksName}: ${name} is not a ${kind} (${filesName})`);
  }
  const tree = {};
  for (const lang of PACK_LANGS) {
    const langDir = join(dir, lang);
    const names = listMarkdown(langDir);
    if (names.length === 0) cannotScan(`${langDir} holds no Markdown files.`);
    for (const name of files) {
      if (!names.includes(name)) violations.push(`${prefix}${lang}/${name}: missing`);
    }
    for (const name of names) {
      if (!files.includes(name)) violations.push(`${prefix}${lang}/${name}: not a ${kind} (${filesName})`);
    }
    tree[lang] = Object.fromEntries(names.map((n) => [n, read(join(langDir, n))]));
  }
  for (const lang of PACK_LANGS) {
    for (const [name, src] of Object.entries(tree[lang])) {
      const at = `${prefix}${lang}/${name}`;
      const { blocks, errors } = parseBlocks(src);
      for (const e of errors) violations.push(`${at}: ${e}`);
      const expected = Object.hasOwn(blocksByFile, name) ? blocksByFile[name] : [];
      const actual = blocks.map((b) => b.name);
      if (actual.join(",") !== expected.join(",")) {
        violations.push(`${at}: blocks [${actual.join(", ")}], expected [${expected.join(", ")}] (${blocksName})`);
      }
      for (const c of claimViolations(src, lang)) violations.push(`${at}: ${c}`);
      for (const g of proseGapViolations(src, CITED_GAPS, register)) violations.push(`${at}: gaps: ${g}`);
    }
  }
  return tree;
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
for (const g of proseGapViolations(rootReadme, CITED_GAPS, register)) violations.push(`README.md: gaps: ${g}`);
const trees = scanTree({
  dir: PACK_DIR,
  prefix: "",
  files: PACK_FILES,
  filesName: "PACK_FILES",
  kind: "pack file",
  blocksByFile: BLOCKS_BY_FILE,
  blocksName: "BLOCKS_BY_FILE",
});

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

// The AI briefs: same machinery, their own file list and block table.
const briefReadme = read(join(BRIEF_DIR, "README.md"));
for (const lang of PACK_LANGS) {
  for (const c of claimViolations(briefReadme, lang)) violations.push(`briefs/README.md: ${c}`);
}
for (const l of linkViolations(briefReadme, BRIEF_FILES)) violations.push(`briefs/${l}`);
for (const g of proseGapViolations(briefReadme, CITED_GAPS, register)) violations.push(`briefs/README.md: gaps: ${g}`);
const briefTrees = scanTree({
  dir: BRIEF_DIR,
  prefix: "briefs/",
  files: BRIEF_FILES,
  filesName: "BRIEF_FILES",
  kind: "brief file",
  blocksByFile: BRIEF_BLOCKS_BY_FILE,
  blocksName: "BRIEF_BLOCKS_BY_FILE",
});
for (const p of parityViolations(briefTrees.en, briefTrees.de)) violations.push(`briefs parity: ${p}`);

let figures = null;
try {
  figures = JSON.parse(read(join(BRIEF_DIR, "figures.json")));
} catch (err) {
  violations.push(`briefs/figures.json: not valid JSON (${err.message})`);
}
if (figures !== null) for (const f of figuresViolations(figures)) violations.push(`briefs/${f}`);

const evidencePages = {};
for (const lang of PACK_LANGS) {
  for (const [name, src] of Object.entries(briefTrees[lang])) {
    if (name !== "appendix.md") evidencePages[`${lang}/${name}`] = src;
  }
}
// Every page against its own language's appendix; the two appendices must carry the same rows, and each en/de
// pair must cite the same ids.
for (const e of evidenceViolations(evidencePages, briefTrees.en["appendix.md"] ?? "", briefTrees.de["appendix.md"] ?? "")) {
  violations.push(`briefs evidence: ${e}`);
}

const fileCount =
  PACK_LANGS.reduce((n, lang) => n + Object.keys(trees[lang]).length, 0) +
  PACK_LANGS.reduce((n, lang) => n + Object.keys(briefTrees[lang]).length, 0);
if (violations.length > 0) {
  console.error(`Compliance pack: ${violations.length} problem(s) in ${fileCount} files.\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nBlock bodies are written by `npm run compliance:generate`; prose and headings by hand.");
  process.exit(1);
}
console.log(
  `Compliance pack: ${fileCount} files, ${CITED_GAPS.length} cited gaps, review line at ${appVersion} or older — clean.`,
);
