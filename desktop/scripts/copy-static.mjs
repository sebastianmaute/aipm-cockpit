// Copy the two directories `next build --output standalone` does NOT copy.
//
// ★★★ Omitting this produces an app that starts, serves HTML and renders with
// NO CSS and NO images. It fails at RUNTIME and nothing at build time reports
// it, which is why this script asserts its own result rather than trusting the
// copy, and why the packaged smoke test asserts a computed style.
import { cpSync, existsSync, readdirSync } from "node:fs";
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
// ★ Where the bundler puts it is NOT fixed: webpack emits a dedicated
// `.next/static/css/` directory, but Turbopack (this repo's actual build —
// `.next/turbopack` exists once built) interleaves `.css` files into
// `.next/static/chunks/` alongside JS chunks. Hardcoding the webpack path
// made this check fail on every real build here, so it searches the whole
// copied static tree instead of one hardcoded subdirectory.
const staticDir = join(STANDALONE, ".next", "static");
const hasCss =
  existsSync(staticDir) &&
  readdirSync(staticDir, { recursive: true }).some((f) => String(f).endsWith(".css"));
if (!hasCss) {
  console.error(`No CSS bundle found under ${staticDir} — the packaged app would render unstyled.`);
  process.exit(1);
}

console.log("Copied .next/static and public/ into .next/standalone, and verified a CSS bundle is present.");
