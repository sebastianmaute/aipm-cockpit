import { describe, expect, it } from "vitest";
import { buildZip } from "../app/zip";
import { packageManifest, formatManifestDiff, type PartDigest } from "./ooxml-manifest";

describe("packageManifest", () => {
  it("lists parts in ZIP ORDER, not sorted", async () => {
    const zip = buildZip([
      { path: "zebra.txt", data: "z" },
      { path: "alpha.txt", data: "a" },
    ]);
    const manifest = await packageManifest(zip);
    expect(manifest.map((p) => p.path)).toEqual(["zebra.txt", "alpha.txt"]);
  });

  it("digests each part's own bytes", async () => {
    // sha256("a") -- the well-known value, so this pins the algorithm and the
    // hex encoding, not merely self-consistency.
    const zip = buildZip([{ path: "alpha.txt", data: "a" }]);
    const manifest = await packageManifest(zip);
    expect(manifest[0].sha256).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
  });

  it("gives the same digests regardless of the archive timestamp", async () => {
    const entries = [{ path: "alpha.txt", data: "a" }];
    const early = await packageManifest(buildZip(entries, "application/zip", new Date(1999, 0, 1)));
    const late = await packageManifest(buildZip(entries, "application/zip", new Date(2031, 0, 1)));
    expect(early).toEqual(late);
  });
});

describe("formatManifestDiff", () => {
  const base: PartDigest[] = [
    { path: "a.xml", sha256: "aa" },
    { path: "b.xml", sha256: "bb" },
  ];

  it("returns null when the manifests match", () => {
    expect(formatManifestDiff(base, [...base])).toBeNull();
  });

  it("names the part whose content changed", () => {
    const changed = [base[0], { path: "b.xml", sha256: "cc" }];
    expect(formatManifestDiff(base, changed)).toContain("b.xml");
  });

  it("names a part that was added", () => {
    const added = [...base, { path: "c.xml", sha256: "dd" }];
    const msg = formatManifestDiff(base, added);
    expect(msg).toContain("c.xml");
  });

  it("names a part that was removed", () => {
    const msg = formatManifestDiff(base, [base[0]]);
    expect(msg).toContain("b.xml");
  });

  it("reports a REORDER as a reorder, which a sorted manifest could not see", () => {
    const swapped = [base[1], base[0]];
    const msg = formatManifestDiff(base, swapped);
    expect(msg).toMatch(/order/i);
    expect(msg).toContain("a.xml");
  });
});
