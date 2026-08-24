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
import { MANIFEST_SUBJECTS } from "../test/ooxml-manifest-subjects";

const REGEN = "npm run ooxml:manifest";

async function expectMatchesBaseline(pkg: Blob, expected: readonly PartDigest[], label: string) {
  const actual = await packageManifest(pkg);
  const diff = formatManifestDiff(expected, actual);
  if (diff !== null) {
    throw new Error(
      `The media-free ${label} package no longer matches its baseline.\n\n${diff}\n\n` +
        `If this change is INTENDED, regenerate with \`${REGEN}\` and say so in the commit.\n` +
        `If it is not, you have changed what every exported ${label} contains.`,
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

  // ★★★ THE TWO ASSERTIONS BELOW GUARD THE BASELINE, NOT THE PACKAGE, AND
  // THAT IS WHY THEY ARE NOT REDUNDANT WITH THE DIGEST COMPARISON ABOVE.
  // That comparison pits the live package against the baseline -- and a
  // regeneration moves BOTH sides in the same step, so it can never object to
  // whatever regeneration produced. These are the only claims here that hold
  // still while the baseline moves.
  //
  // Yes, the literals below can also be edited. That is the point: editing
  // them is a deliberate change a reviewer sees in the same diff, which is
  // exactly the property §216 asked for when it ruled out a `vitest -u` path.

  it("the baseline holds no media part, which is what makes it the media-FREE contract", () => {
    // Catches a regeneration run against media-BEARING packages, which would
    // quietly redefine what this gate guards. docx media lands under
    // `word/media/` and pptx under `ppt/media/`, so one substring covers both.
    const allPaths = [...baseline.docx.parts, ...baseline.pptx.parts].map((p) => p.path);
    expect(allPaths.filter((p) => p.includes("media/"))).toEqual([]);
  });

  it("the baseline still holds every part each package is supposed to have", () => {
    // The complement of the check above: that one catches a regeneration that
    // ADDED parts, this one catches a regeneration that silently DROPPED them.
    // A builder that stopped emitting word/styles.xml shrinks the package and
    // the baseline together, leaving formatManifestDiff with nothing to say.
    // Measured 2026-08-22 against the committed baseline: docx 5, pptx 11.
    expect(baseline.docx.parts).toHaveLength(5);
    expect(baseline.pptx.parts).toHaveLength(11);
  });
});
