// TEMPORARY migration scaffolding — deleted with the heroicons dependency.
//
// Rewrites `from "@heroicons/react/24/outline"` to the barrel, computing the
// relative path per file. The specifier LIST is never touched: the barrel
// exports the heroicons names, so `{ XMarkIcon, PrinterIcon as PrinterHeroIcon }`
// is already correct.
//
// Usage: node scripts/codemod-icons.mjs <file> [<file>...]
import fs from "node:fs";
import path from "node:path";

const IMPORT_RE = /(import\s*\{[^}]*\}\s*from\s*)"@heroicons\/react\/[^"]+"/g;

let changed = 0;
let skipped = 0;

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  if (!IMPORT_RE.test(src)) {
    console.log(`SKIP  ${file} (no heroicons import)`);
    skipped += 1;
    continue;
  }
  IMPORT_RE.lastIndex = 0;

  // Relative path from this file's directory to src/app/icons.ts, POSIX-style.
  let rel = path
    .relative(path.dirname(path.resolve(file)), path.resolve("src/app/icons"))
    .split(path.sep)
    .join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;

  const out = src.replace(IMPORT_RE, `$1"${rel}"`);
  if (out === src) throw new Error(`no-op rewrite for ${file} — investigate`);
  fs.writeFileSync(file, out);
  console.log(`OK    ${file} -> ${rel}`);
  changed += 1;
}

console.log(`\nchanged=${changed} skipped=${skipped}`);
