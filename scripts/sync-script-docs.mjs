#!/usr/bin/env node
// Regenerate the AUTO-GENERATED scripts tables in repo docs from
// package.json. Pass --check to verify without writing (CI mode).
//
// Conventions:
//   - Descriptions live in package.json -> "scriptsDescriptions".
//   - Scripts whose name starts with `pre` or `post` are excluded
//     (npm hook conventions, not user-facing commands).
//   - A doc file participates if it carries the marker pair:
//       <!-- AUTO-GENERATED from package.json scripts -->
//       ...
//       <!-- END AUTO-GENERATED -->
//   - Files scanned: top-level *.md and docs/**/*.md.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const START = "<!-- AUTO-GENERATED from package.json scripts -->";
const END = "<!-- END AUTO-GENERATED -->";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadScripts() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const scripts = pkg.scripts ?? {};
  const descs = pkg.scriptsDescriptions ?? {};
  const visible = Object.keys(scripts).filter((n) => !/^(pre|post)/.test(n));
  const missing = visible.filter((n) => !(n in descs));
  if (missing.length) {
    console.warn(
      `[sync-script-docs] missing description for: ${missing.join(", ")} ` +
        `(add to "scriptsDescriptions" in package.json)`,
    );
  }
  return visible.map((name) => ({
    name,
    description:
      descs[name] ??
      "_(no description — add one to `scriptsDescriptions` in package.json)_",
  }));
}

function buildTable(scripts) {
  const rows = scripts
    .map((s) => `| \`npm run ${s.name}\` | ${s.description} |`)
    .join("\n");
  return [
    START,
    "| Command | Description |",
    "|---------|-------------|",
    rows,
    END,
  ].join("\n");
}

function walkMd(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMd(p, out);
    else if (entry.isFile() && p.endsWith(".md")) out.push(p);
  }
}

function findDocs() {
  const out = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.join(ROOT, entry.name));
    }
  }
  const docsDir = path.join(ROOT, "docs");
  if (fs.existsSync(docsDir)) walkMd(docsDir, out);
  return out;
}

function syncFile(filePath, table, check) {
  const original = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(
    `${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}`,
    "g",
  );
  if (!pattern.test(original)) return { path: filePath, status: "no-marker" };
  const updated = original.replace(
    new RegExp(`${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}`, "g"),
    table,
  );
  if (updated === original) return { path: filePath, status: "unchanged" };
  if (check) return { path: filePath, status: "would-update" };
  fs.writeFileSync(filePath, updated);
  return { path: filePath, status: "updated" };
}

function main() {
  const check = process.argv.includes("--check");
  const scripts = loadScripts();
  const table = buildTable(scripts);
  const docs = findDocs();
  const results = docs
    .map((p) => syncFile(p, table, check))
    .filter((r) => r.status !== "no-marker");

  for (const r of results) {
    const rel = path.relative(ROOT, r.path).replaceAll("\\", "/");
    console.log(`[sync-script-docs] ${r.status}: ${rel}`);
  }

  if (results.length === 0) {
    console.warn(
      "[sync-script-docs] no doc files contain the marker pair — " +
        "nothing to update.",
    );
  }

  if (check && results.some((r) => r.status === "would-update")) {
    console.error(
      "[sync-script-docs] docs out of sync with package.json. " +
        "Run `npm run docs:scripts` to fix.",
    );
    process.exit(1);
  }
}

main();
