#!/usr/bin/env node
// Rewrite the generated blocks of the compliance pack (`docs/compliance/{en,de}/*.md`).
//
//   node scripts/compliance/generate.mjs        (npm run compliance:generate)
//
// The blocks render from TypeScript sources (the AI data table, the i18n texts, the CSP
// constants, the destination and variable registries), so the rendering runs where those
// load: the drift test `src/app/compliance/pack-drift.test.ts`, run with COMPLIANCE_WRITE=1,
// rewrites the block bodies instead of asserting. Prose outside the markers is never touched.
// Exit code: vitest's. Run `npm run compliance:check` afterwards.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const TEST = "src/app/compliance/pack-drift.test.ts";

const run = spawnSync(process.execPath, [VITEST, "run", TEST], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, COMPLIANCE_WRITE: "1" },
});
if (run.error) {
  console.error(`could not start vitest: ${run.error.message}`);
  process.exit(2);
}
process.exit(run.status ?? 2);
