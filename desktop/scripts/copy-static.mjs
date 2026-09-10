// Copy the two directories `next build --output standalone` does NOT copy.
//
// ★★★ Omitting this produces an app that starts, serves HTML and renders with
// NO CSS and NO images. It fails at RUNTIME and nothing at build time reports
// it, which is why this script asserts its own result rather than trusting the
// copy, and why the packaged smoke test asserts a computed style.
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const STANDALONE = join(ROOT, ".next", "standalone");

if (!existsSync(STANDALONE)) {
  console.error("No .next/standalone — run: NEXT_STANDALONE=1 npm run build");
  process.exit(1);
}

const copies = [
  { from: join(ROOT, ".next", "static"), to: join(STANDALONE, ".next", "static") },
  { from: join(ROOT, "public"), to: join(STANDALONE, "public") },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.error(`Source missing: ${from}`);
    process.exit(1);
  }
  // ★★ Clear the destination first. cpSync merges rather than replaces, so a
  // stale file from an EARLIER build survives a copy from a source that no
  // longer contains it — and the CSS guard below then passes on that stale
  // file while the current build emitted none. That is the exact failure this
  // script exists to prevent, one layer down: measured during this task, where
  // the destination had to be cleared by hand for the guard test to be real.
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

// Assert the result. A silent no-op copy is the failure mode this guards.
for (const { to } of copies) {
  if (!existsSync(to) || readdirSync(to).length === 0) {
    console.error(`Copy produced nothing at ${to}`);
    process.exit(1);
  }
}

// The CSS bundle is the specific artifact whose absence renders the app
// unstyled, so name it rather than trusting a non-empty directory.
//
// ★★ Scan RECURSIVELY and do not hardcode a subdirectory. Next 16 / Turbopack
// emits the bundle to .next/static/chunks/, NOT the .next/static/css/ that
// older Next versions used — a guard pinned to either literal path passes
// vacuously or fails on a correct copy the next time that emit path moves.
const staticRoot = join(STANDALONE, ".next", "static");
const cssFiles = existsSync(staticRoot)
  ? readdirSync(staticRoot, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".css"))
  : [];
if (cssFiles.length === 0) {
  console.error(`No .css bundle anywhere under ${staticRoot} — the packaged app would render unstyled.`);
  process.exit(1);
}

console.log(
  `Copied .next/static and public/ into .next/standalone; verified ${cssFiles.length} CSS bundle(s) present.`,
);
