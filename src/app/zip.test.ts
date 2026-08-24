import { describe, expect, it } from "vitest";
import { buildZip, type ZipEntry } from "./zip";
import { blobBytes, unzipBytes, partText } from "../test/unzip-bytes";

const ENTRIES: ZipEntry[] = [
  { path: "alpha.txt", data: "first" },
  { path: "nested/beta.txt", data: "second" },
];

// ★ Two dates that differ in the DOS time field (2-second granularity).
const T1 = new Date(2021, 4, 17, 9, 30, 0);
const T2 = new Date(2023, 10, 2, 14, 15, 30);

describe("buildZip — the injectable modification date", () => {
  it("produces byte-identical archives for the same injected date", async () => {
    const a = await blobBytes(buildZip(ENTRIES, "application/zip", T1));
    const b = await blobBytes(buildZip(ENTRIES, "application/zip", T1));
    expect([...a]).toEqual([...b]);
  });

  it("produces different archives for different injected dates", async () => {
    const a = await blobBytes(buildZip(ENTRIES, "application/zip", T1));
    const b = await blobBytes(buildZip(ENTRIES, "application/zip", T2));
    expect([...a]).not.toEqual([...b]);
  });

  it("leaves part DATA untouched by the date — this is why the manifest needs no clock", async () => {
    const a = await unzipBytes(buildZip(ENTRIES, "application/zip", T1));
    const b = await unzipBytes(buildZip(ENTRIES, "application/zip", T2));
    expect([...a.keys()]).toEqual([...b.keys()]);
    expect(partText(a, "alpha.txt")).toBe(partText(b, "alpha.txt"));
    expect(partText(a, "nested/beta.txt")).toBe(partText(b, "nested/beta.txt"));
  });

  it("still defaults to the wall clock, so real exports are unchanged", async () => {
    const withDefault = await blobBytes(buildZip(ENTRIES));
    const withEpoch = await blobBytes(buildZip(ENTRIES, "application/zip", new Date(1980, 0, 1)));
    expect([...withDefault]).not.toEqual([...withEpoch]);
  });
});
