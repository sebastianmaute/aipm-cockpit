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

  // ★★★ THIS DECODES THE STAMP; IT DOES NOT MERELY SHOW IT IS NOT 1980. The
  // earlier form of this test built with the default and with
  // `new Date(1980, 0, 1)` and asserted the two archives differ, under the name
  // "still defaults to the wall clock". That proves only that the default is
  // not exactly 1980-01-01: set `zip.ts`'s default to `new Date(2020, 0, 1)`
  // and every test in this file stays green, while `buildZip`'s own docstring
  // calls a frozen default "a visible user-facing change ... deliberately NOT
  // part of this seam". Naming a property a test does not check is the
  // pathology open-followups §216 exists to record.
  //
  // ★ Offsets come from `zip.ts`'s local-header writes, in order: signature
  // u32 (0), version u16 (4), flag u16 (6), method u16 (8), DOS time u16 (10),
  // DOS date u16 (12). The first local header sits at offset 0.
  //
  // ★ DOS date packing, from `dosDateTime`: ((year-1980) << 9) | (month << 5)
  // | day, month 1-based. Decoded here rather than re-encoded, so this is an
  // independent inverse and not a copy of the code under test.
  it("stamps the local header with TODAY, so the default really is the wall clock", async () => {
    // ★ Bracketing the build removes the midnight flake entirely: if the run
    //   straddles a date boundary (New Year's Eve included) one of these two
    //   readings is the date the archive was stamped with. No tolerance, no
    //   "or next year" fudge.
    const before = new Date();
    const bytes = await blobBytes(buildZip(ENTRIES));
    const after = new Date();

    const dosDate = new DataView(bytes.buffer, bytes.byteOffset).getUint16(12, true);
    const stamped = {
      year: (dosDate >> 9) + 1980,
      month: (dosDate >> 5) & 0x0f,
      day: dosDate & 0x1f,
    };
    const wallClock = (d: Date) => ({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    });

    expect([wallClock(before), wallClock(after)]).toContainEqual(stamped);
  });
});
