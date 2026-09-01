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
  /** The SAME package, built with an EXPLICITLY empty `links` list.
   *
   *  ★★ REQUIRED, not optional, so a new subject cannot quietly opt out of the
   *  links additive contract the gate asserts over this list.
   *
   *  ★★★ IT IS NOT ALWAYS A DIFFERENT CALL, and that is the point of pairing
   *  the two spellings here rather than asserting one of them. `buildDocxPackage`
   *  DEFAULTS `links` to `[]`, so for the two docx subjects "omitted" and
   *  "explicitly empty" are the same call and comparing them proves nothing on
   *  its own -- which is why the gate also compares this build against the
   *  committed baseline, the one reference that predates links. For pptx the
   *  distinction IS real: `PptxSlide.links` is an optional FIELD, so the
   *  builder sees `undefined` here and `[]` there.
   *
   *  ★ Spelling `page` out below is forced (`links` trails it positionally) and
   *  would re-open the drift this file exists to close -- except that the gate
   *  compares the two builds part-for-part, so a twin that stops matching its
   *  subject goes red rather than silent. */
  buildEmptyLinks: () => Blob;
};

export const MANIFEST_SUBJECTS: readonly ManifestSubject[] = [
  {
    key: "docx",
    label: "docx (portrait)",
    build: () => buildDocxPackage("<w:p/>", "", "portrait"),
    buildEmptyLinks: () => buildDocxPackage("<w:p/>", "", "portrait", [], []),
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
    buildEmptyLinks: () => buildDocxPackage("<w:p/>", "", "landscape", [], []),
  },
  {
    key: "pptx",
    label: "pptx",
    build: () => buildPptxPackage([{ xml: "<p:sld/>", media: [] }]),
    buildEmptyLinks: () => buildPptxPackage([{ xml: "<p:sld/>", media: [], links: [] }]),
  },
];
