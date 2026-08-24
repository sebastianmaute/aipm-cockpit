// src/app/ooxml-package-manifest.test.ts — the §216 gate.
//
// ★★★ WHY THIS EXISTS. Both builders promise that an empty `media` argument is
// ADDITIVE: no Default entry, no part, no relationship. Before this file that
// promise was pinned by hand-written substring assertions and nothing else --
// and measured on 2026-08-22, a mutant (`<Default Extension="png"/>` forced
// into the empty-media case) reddened four tests without EITHER of the two
// tests with "byte" in their names catching it by its byte comparison. The
// DOCX one compares the builder against ITSELF; the PPTX one never read
// [Content_Types].xml at all.
//
// This gate fails on ANY change to a media-free package, including the ones
// nobody thought to assert.
//
// ★★ THE SUBJECTS ARE SHARED, NOT DUPLICATED. This file and
// scripts/update-ooxml-manifest.ts both import `MANIFEST_SUBJECTS` from
// src/test/ooxml-manifest-subjects.ts, so the gate cannot build a different
// package from the one the baseline was generated against. An earlier cut
// spelled the builder calls out in both places and asked a comment to hold
// them in step; tsconfig.json excludes `scripts/`, so tsc never read the
// script's copy and a one-word divergence there stayed green until the next
// regeneration.

import { describe, expect, it } from "vitest";
import baseline from "../../docs/baselines/ooxml-parts.json";
import { formatManifestDiff, packageManifest, type PartDigest } from "../test/ooxml-manifest";
import { MANIFEST_SUBJECTS, type ManifestSubjectKey } from "../test/ooxml-manifest-subjects";
import { partText, unzipBytes } from "../test/unzip-bytes";

const REGEN = "npm run ooxml:manifest";

async function expectMatchesBaseline(pkg: Blob, expected: readonly PartDigest[], label: string) {
  const actual = await packageManifest(pkg);
  const diff = formatManifestDiff(expected, actual);
  if (diff !== null) {
    throw new Error(
      `The media-free ${label} package no longer matches its baseline.\n\n${diff}\n\n` +
        `If this change is INTENDED, regenerate with \`${REGEN}\` and say so in the commit.\n` +
        `If it is not, you have changed the media-free ${label} package.\n` +
        `That is ONE package shape, not every export: the shapes this gate pins are\n` +
        `listed in src/test/ooxml-manifest-subjects.ts, and any shape absent from\n` +
        `that list -- a media-BEARING package above all -- is unguarded here.`,
    );
  }
  expect(diff).toBeNull();
}

describe("the media-free OOXML packages match their committed manifests", () => {
  for (const subject of MANIFEST_SUBJECTS) {
    it(subject.label, async () => {
      await expectMatchesBaseline(subject.build(), baseline[subject.key].parts, subject.label);
    });
  }

  // ★★★ EVERYTHING BELOW HOLDS STILL WHILE THE BASELINE MOVES, WHICH IS WHY
  // NONE OF IT IS REDUNDANT WITH THE DIGEST COMPARISON ABOVE. That comparison
  // pits the live package against the baseline -- and a regeneration moves
  // BOTH sides in the same step, so it can never object to whatever
  // regeneration produced.
  //
  // Yes, the literals below can also be edited. That is the point: editing
  // them is a deliberate change a reviewer sees in the same diff, which is
  // exactly the property §216 asked for when it ruled out a `vitest -u` path.

  // ★★★ THIS ONE READS THE LIVE PACKAGE, AND IT IS THE ONLY CHECK HERE THAT
  // CAN SEE A CONTENT-ONLY CHANGE. The path lists and the media filter below
  // both read the baseline, so a mutant that changes what a part SAYS without
  // changing which parts exist survives them all: force
  // `<Default Extension="png" ContentType="image/png"/>` into a builder's
  // empty-media case and regenerate, and the part list is identical, no path
  // holds `media/`, the counts hold -- while the digests moved on both sides
  // together. Reading the live [Content_Types].xml is what stays red.
  //
  // ★★ pptx is the case that needed it, and the reason is written down in
  // `ooxml-pptx-primitives.test.ts`: that builder's byte test never reads
  // [Content_Types].xml, which is how the §216 mutant survived it. The docx
  // primitives' tests carry a `not.toContain("image/")` of their own; pptx had
  // no equivalent anywhere.
  for (const subject of MANIFEST_SUBJECTS) {
    it(`${subject.label}: the LIVE package declares no image content type`, async () => {
      const parts = await unzipBytes(subject.build());
      expect(partText(parts, "[Content_Types].xml")).not.toContain("image/");
    });
  }

  // ★★ THE ORDERED PATH LIST, NOT A COUNT. A count catches a regeneration that
  // dropped a part and one that added a part; it does NOT catch an add-and-drop
  // PAIR, and when it fails it names nothing. Spelling the paths out costs a
  // longer literal and buys both. (The previous form asserted `toHaveLength(5)`
  // and `toHaveLength(11)`.)
  const EXPECTED_PATHS: Record<ManifestSubjectKey, readonly string[]> = {
    docx: [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/styles.xml",
    ],
    // ★ Identical to the portrait list BY PART SET, not by content -- the two
    //   differ only inside word/document.xml, which is precisely the difference
    //   the digest comparison sees and this list cannot.
    docxLandscape: [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/styles.xml",
    ],
    pptx: [
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/theme/theme1.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/_rels/slide1.xml.rels",
    ],
  };

  for (const subject of MANIFEST_SUBJECTS) {
    it(`${subject.label}: the baseline holds exactly the parts it is supposed to`, () => {
      expect(baseline[subject.key].parts.map((p) => p.path)).toEqual(EXPECTED_PATHS[subject.key]);
    });
  }

  it("the baseline holds no media part, which is what makes it the media-FREE contract", () => {
    // Subsumed by the lists above -- no `media/` path appears in any of them --
    // and kept anyway, because a filter naming `media/` says WHY it failed and
    // a list mismatch does not. docx media lands under `word/media/` and pptx
    // under `ppt/media/`, so one substring covers both.
    const allPaths = MANIFEST_SUBJECTS.flatMap((s) => baseline[s.key].parts.map((p) => p.path));
    expect(allPaths.filter((p) => p.includes("media/"))).toEqual([]);
  });
});
