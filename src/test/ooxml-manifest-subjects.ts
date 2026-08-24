// src/test/ooxml-manifest-subjects.ts — TEST-ONLY. The exact packages
// docs/baselines/ooxml-parts.json pins, defined ONCE.
//
// ★★★ ONE DEFINITION, TWO CONSUMERS, AND THAT IS THE WHOLE POINT. The gate
// (src/app/ooxml-package-manifest.test.ts) and the regeneration script
// (scripts/update-ooxml-manifest.ts) used to spell these builder calls out
// separately, each carrying a comment asking the other to stay in step —
// and nothing enforced it. tsconfig.json EXCLUDES `scripts/`, so tsc never
// read the script's copy at all: changing `"portrait"` to `"landscape"` in
// the script alone left every gate green until the next person regenerated,
// at which point the baseline moved to a package the gate does not build.
// Importing one definition makes that drift impossible rather than forbidden.
//
// ★ The subjects are the MEDIA-FREE packages, because that is the contract
// open-followups §216 found unpinned: both builders promise that an empty
// `media` argument is ADDITIVE — no Default entry, no part, no relationship.
//
// ★ `key` is the property the baseline JSON stores each part list under, so
// adding a subject here means regenerating (`npm run ooxml:manifest`) before
// the gate can pass. That is the intended order: a new subject is a new
// baseline entry somebody decided to add, visible in the same diff.

import { buildDocxPackage } from "../app/ooxml-docx-primitives";
import { buildPptxPackage } from "../app/ooxml-pptx-primitives";

export type ManifestSubjectKey = "docx" | "docxLandscape" | "pptx";

export type ManifestSubject = {
  /** Property under which this subject's part list lives in the baseline. */
  key: ManifestSubjectKey;
  /** Names the subject in the gate's failure text and in its test title. */
  label: string;
  build: () => Blob;
};

export const MANIFEST_SUBJECTS: readonly ManifestSubject[] = [
  {
    key: "docx",
    label: "docx (portrait)",
    build: () => buildDocxPackage("<w:p/>", "", "portrait"),
  },
  {
    // ★★★ TWO ARGUMENTS ON PURPOSE, MIRRORING THE WORKSPACE EXPORTER.
    // `buildDocxPackage`'s `page` parameter DEFAULTS to "landscape", and
    // `export-docx.ts` calls it with two arguments -- so the media-free docx
    // `export-docx.ts` produces is the landscape one, and for a while
    // the only manifested docx was the portrait subject above. Passing the
    // default rather than spelling `"landscape"` out also puts the default
    // itself under the gate: flip it and this subject's parts move.
    key: "docxLandscape",
    label: "docx (landscape)",
    build: () => buildDocxPackage("<w:p/>", ""),
  },
  {
    key: "pptx",
    label: "pptx",
    build: () => buildPptxPackage([{ xml: "<p:sld/>", media: [] }]),
  },
];
