// scripts/update-ooxml-manifest.ts — regenerate docs/baselines/ooxml-parts.json.
//
// Run: npm run ooxml:manifest
//
// ★★★ THIS IS THE ONLY WAY TO MOVE THE BASELINE, AND THAT IS DELIBERATE. There
// is no `vitest -u` path to it. open-followups.md §216 names
// re-baselining-to-admit-your-own-change as the exact failure this fixture had
// to be designed against -- an inline snapshot would have handed that to
// anyone with a red pipeline. Regenerating must stay a decision somebody makes
// and a reviewer sees in the diff.
//
// ★★ THE SUBJECTS LIVE IN src/test/ooxml-manifest-subjects.ts AND ARE SHARED
// WITH THE GATE (src/app/ooxml-package-manifest.test.ts). They are the
// MEDIA-FREE packages, because that is the contract §216 found unpinned: both
// builders promise an empty `media` argument adds no Default entry, no part
// and no relationship. An earlier cut spelled the builder calls out here AND
// in the gate, held in step by a comment in each file -- and tsconfig.json
// excludes `scripts/`, so tsc never read this copy: a one-word divergence
// here stayed green until somebody regenerated, at which point the baseline
// moved to a package the gate does not build. Do not re-inline them.
//
// ★ OUT is resolved against the process CWD, which `npm run` pins to the
// package root. Run it through the npm script, not by hand from a subdirectory.
//
// ★★ THE RUNNER IS `jiti`, NOT `vite-node`, AND THAT IS NOT A PREFERENCE.
// `vite-node` is genuinely absent from this repo -- not in node_modules, and
// named in neither package.json nor package-lock.json -- so the form AGENTS.md
// documents for scripts/generate-sample-workspace.ts (`npx vite-node ...`)
// would reach for the network on every run. `jiti` is present and executes
// this file's extensionless TS imports directly under plain node.
//
// ★ It is DECLARED, as of commit 59f7fdb6 on this branch, and an earlier
// revision of this paragraph said the opposite. It had been transitive-only --
// pulled in by eslint, vite and @tailwindcss/node -- so a dependency bump
// could have dropped it while nothing in the repo asked for it, and because
// regenerating is rare by design the breakage would not have surfaced for a
// long time. It carries a CARET, not an exact pin: CONTRIBUTING.md's
// "Dependencies" section reserves exact pins for the four framework-coupled
// packages and gives everything else a caret, and jiti is not one of them.
// Check both halves with:
//   sed -n '/"devDependencies"/,/^  }/p' package.json | grep jiti   # ^2.7.0
//   grep -c vite-node package.json package-lock.json               # 0 and 0
// (the second exits 1 because it matches nothing -- that IS the result)

import { writeFileSync } from "node:fs";
import { packageManifest } from "../src/test/ooxml-manifest";
import { MANIFEST_SUBJECTS } from "../src/test/ooxml-manifest-subjects";

const OUT = "docs/baselines/ooxml-parts.json";

async function main() {
  const baseline: Record<string, unknown> = {
    $comment:
      "Ordered part manifests for the MEDIA-FREE packages listed in " +
      "src/test/ooxml-manifest-subjects.ts. Regenerate ONLY with " +
      "`npm run ooxml:manifest`, and only when you intend the package to " +
      "change -- see docs/open-followups.md §216.",
  };

  const summary: string[] = [];
  for (const subject of MANIFEST_SUBJECTS) {
    const parts = await packageManifest(subject.build());
    baseline[subject.key] = { parts };
    summary.push(`${subject.label} ${parts.length} parts`);
  }

  writeFileSync(OUT, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`wrote ${OUT}: ${summary.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
