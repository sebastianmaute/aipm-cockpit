// src/test/ooxml-manifest.ts — TEST-ONLY. Reduce an OOXML package to an
// ORDERED list of {part path, SHA-256 of that part's bytes}.
//
// ★★★ ORDERED, NOT SORTED, AND THAT IS THE WHOLE DESIGN. A sorted manifest
// cannot see a reordering of the archive's entries, and OPC readers can care
// which part leads a package. Ordered, four failure classes -- reorder,
// addition, removal, content change -- go red, and each names a part.
//
// ★★ A FIFTH IS INVISIBLE, and an earlier revision of the line above said
// "all four" as if the list were exhaustive. A DUPLICATED part path is not
// seen at all: `unzipBytes` keys a Map, so a second entry at the same path
// OVERWRITES the first -- the manifest then carries neither the extra entry
// nor the shadowed bytes, and the path list, the order and every digest come
// out unchanged. Nothing here goes red. It is out of reach by construction
// rather than by oversight (a Map is also what makes the ordering property
// below hold), and these builders emit each path once from fixed code, so it
// is a blind spot this gate is not asked to cover -- not a covered case.
//
// ★★ It deliberately says NOTHING about the zip CONTAINER. Part data carries
// no timestamp -- the DOS date is written into the local file header and again
// into the central directory, never into a part's own bytes
// (`grep -n "writeU16(dosDate)" src/app/zip.ts` returns exactly those two
// lines; an earlier wording here named only the local header). That is why
// this is stable without any clock injection; the container's determinism is
// pinned separately by zip.test.ts. Neither covers the other.
//
// ★ Shared by the gate (ooxml-package-manifest.test.ts) and the regeneration
// script (scripts/update-ooxml-manifest.ts) ON PURPOSE. A manifest the script
// and the gate computed differently is a gate that cannot fail.

import { createHash } from "node:crypto";
import { unzipBytes } from "./unzip-bytes";

export type PartDigest = { path: string; sha256: string };

/** Every part of the package, in the order the archive stores them.
 *
 *  ★ `unzipBytes` returns a Map built by walking local file headers front to
 *  back, and a Map iterates in insertion order — so spreading it preserves
 *  ZIP order. That property is asserted by this module's own test rather than
 *  assumed, because it is the single thing the ordered design rests on. */
export async function packageManifest(pkg: Blob): Promise<PartDigest[]> {
  const parts = await unzipBytes(pkg);
  return [...parts].map(([path, bytes]) => ({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
}

/** A human-readable description of how `actual` differs from `expected`, or
 *  null when they match.
 *
 *  ★★ "Bytes differ" is not an acceptable failure message for this gate --
 *  diagnosability is the reason a manifest was chosen over a committed package
 *  blob in the first place. Every branch below names a part path. */
export function formatManifestDiff(
  expected: readonly PartDigest[],
  actual: readonly PartDigest[],
): string | null {
  const expectedPaths = expected.map((p) => p.path);
  const actualPaths = actual.map((p) => p.path);

  const added = actualPaths.filter((p) => !expectedPaths.includes(p));
  const removed = expectedPaths.filter((p) => !actualPaths.includes(p));
  if (added.length > 0 || removed.length > 0) {
    const lines = [
      ...added.map((p) => `  + part not in the baseline: ${p}`),
      ...removed.map((p) => `  - part missing from the package: ${p}`),
    ];
    return `the package's part LIST changed:\n${lines.join("\n")}`;
  }

  if (expectedPaths.join(" ") !== actualPaths.join(" ")) {
    return [
      "the package's part ORDER changed (a sorted manifest could not see this):",
      `  baseline: ${expectedPaths.join(", ")}`,
      `  actual:   ${actualPaths.join(", ")}`,
    ].join("\n");
  }

  const changed = expected
    .map((e, i) => ({ path: e.path, expected: e.sha256, actual: actual[i].sha256 }))
    .filter((c) => c.expected !== c.actual);
  if (changed.length > 0) {
    const lines = changed.map(
      (c) => `  ${c.path}\n      baseline ${c.expected}\n      actual   ${c.actual}`,
    );
    return `the CONTENT of ${changed.length} part(s) changed:\n${lines.join("\n")}`;
  }

  return null;
}
