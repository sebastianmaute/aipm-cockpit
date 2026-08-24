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
// ★ The subjects are the MEDIA-FREE packages, because that is the contract
// §216 found unpinned: both builders promise an empty `media` argument adds no
// Default entry, no part and no relationship. The two calls below are
// deliberately the SAME argument forms the primitives' own byte-identity tests
// use, so the baseline and those tests cannot drift onto different packages.
//
// ★ OUT is resolved against the process CWD, which `npm run` pins to the
// package root. Run it through the npm script, not by hand from a subdirectory.
//
// ★★ THE RUNNER IS `jiti`, NOT `vite-node`, AND THAT IS NOT A PREFERENCE.
// `vite-node` is not installed here -- it is absent from node_modules and
// undeclared in package.json, so the form AGENTS.md documents for
// scripts/generate-sample-workspace.ts (`npx vite-node ...`) would reach for
// the network on every run. `jiti` is present and executes this file's
// extensionless TS imports directly under plain node (verified: docx 5 parts,
// pptx 11 parts). ★ It is a TRANSITIVE dependency though -- pulled in by
// eslint, vite AND @tailwindcss/node, so it is well anchored, but nothing in
// this repo DECLARES it. If a dependency bump ever removes it this script
// breaks, and because regenerating is rare by design nobody will notice for a
// long time. Declaring it (or vite-node) in devDependencies would close that.

import { writeFileSync } from "node:fs";
import { buildDocxPackage } from "../src/app/ooxml-docx-primitives";
import { buildPptxPackage } from "../src/app/ooxml-pptx-primitives";
import { packageManifest } from "../src/test/ooxml-manifest";

const OUT = "docs/baselines/ooxml-parts.json";

async function main() {
  const docx = await packageManifest(buildDocxPackage("<w:p/>", "", "portrait"));
  const pptx = await packageManifest(buildPptxPackage([{ xml: "<p:sld/>", media: [] }]));

  const baseline = {
    $comment:
      "Ordered part manifests for the MEDIA-FREE .docx and .pptx packages. " +
      "Regenerate ONLY with `npm run ooxml:manifest`, and only when you intend " +
      "the package to change -- see docs/open-followups.md §216.",
    docx: { parts: docx },
    pptx: { parts: pptx },
  };

  writeFileSync(OUT, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`wrote ${OUT}: docx ${docx.length} parts, pptx ${pptx.length} parts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
