// src/app/office-extract.ts — public entry point for Office (OOXML) ingestion.
// Detects the format, unzips, routes to the per-format extractor, caps output.
// Pure + node-testable.

import { readZipEntries } from "./unzip";
import { readCfbfTree } from "./cfbf";
import { extractDocx } from "./docx-extract";
import { extractXlsx } from "./xlsx-extract";
import { extractPptx } from "./pptx-extract";

export type OfficeFormat = "docx" | "xlsx" | "pptx";

/** Hard cap on extracted Markdown so a huge workbook can't blow the token budget. */
export const MAX_EXTRACT_CHARS = 200_000;

const MIME_FORMAT: ReadonlyArray<readonly [string, OfficeFormat]> = [
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-excel.sheet.macroenabled.12", "xlsx"], // xlsm (lowercased)
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
];

const EXT_FORMAT: Record<string, OfficeFormat> = {
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xlsm": "xlsx",
  ".pptx": "pptx",
};

/** Classify a file as an Office format by MIME (preferred) then extension. */
export function officeKindOf(mimeType: string, fileName: string): OfficeFormat | null {
  const mime = mimeType.trim().toLowerCase();
  for (const [k, v] of MIME_FORMAT) if (k === mime) return v;
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return EXT_FORMAT[ext] ?? null;
}

/** The root-storage stream a password-protected OOXML file carries in place of
 *  the zip archive: the ciphertext (MS-OFFCRYPTO, "\EncryptedPackage Stream").
 *  Its sibling `EncryptionInfo` holds the key-derivation parameters; either
 *  alone identifies the shape, and matching on the payload stream keeps the
 *  test to the one entry that must exist for the file to hold any content. */
const ENCRYPTED_PACKAGE_STREAM = "EncryptedPackage";

/** True when these bytes are an ENCRYPTED Office file rather than a readable
 *  or a merely corrupt one.
 *
 *  ★★★ A PASSWORD-PROTECTED OOXML FILE IS NOT A ZIP AT ALL — that is the whole
 *  reason this exists. Office replaces the entire archive with an MS-CFB
 *  compound file whose root storage holds `EncryptedPackage` beside
 *  `EncryptionInfo`, so `readZipEntries` below never finds a local file header
 *  and `extractOfficeMarkdown` throws. Its caller could then only report the
 *  generic read failure, and the difference matters to the USER, not to us:
 *  "remove the password and re-attach" and "this file is damaged" are
 *  different instructions.
 *
 *  ★ `readCfbfTree` self-guards on the 8-byte MS-CFB signature and returns an
 *  empty map for anything else, so a non-compound file is rejected on the
 *  FIRST differing byte — a zip's 0x50 against 0xD0, so one comparison, not
 *  eight — and this needs no separate `looksLikeCfbf` call.
 *
 *  ★★ IT IS NOT FREE FOR A FILE THAT IS ACTUALLY COMPOUND. Answering this
 *  boolean for a real compound file walks the whole
 *  directory and materialises every stream's bytes into that map, all of it
 *  discarded: measured, 7.05 MB materialised and ~13 ms for a 10.5 MB input.
 *  Bounded by checkAttachmentSize (20 MB) so it is not a denial-of-service
 *  route, and only reachable for a legacy binary Office file renamed to an
 *  OOXML extension — but do not cite this as a cheap check for a compound
 *  input. A keys-only walk would fix it if that path ever gets hot.
 *
 *  ★★ Deliberately FALSE for a compound file WITHOUT that stream. A legacy
 *  binary .doc/.xls renamed to .docx is a compound file too, and it is
 *  unreadable-because-wrong-format, not unreadable-because-encrypted; it must
 *  keep falling through to the read failure. Widening this to "is a compound
 *  file" would tell those users to remove a password that was never set.
 *
 *  ★★ Root-storage streams are exactly the paths with no "/" in them
 *  (`readCfbfTree`'s path convention), so the bare name is a root-only match
 *  and a crafted file cannot smuggle one in from a nested storage. That last
 *  clause was FALSE until the walk started deriving root-ness from DEPTH: it
 *  keyed on whether the accumulated path was non-empty, so a root storage
 *  with an EMPTY NAME passed bare keys to its children and a nested
 *  `EncryptedPackage` was reported as a root one. The suite's own
 *  counter-test named its decoy storage, which is the one shape where the
 *  old test behaved as this sentence claimed. */
export function looksLikeEncryptedOfficeFile(bytes: Uint8Array): boolean {
  return readCfbfTree(bytes).has(ENCRYPTED_PACKAGE_STREAM);
}

/** Unzip + extract an Office file to structured Markdown. Rejects on a corrupt
 *  or non-OOXML archive (the caller surfaces a read/extract error). */
export async function extractOfficeMarkdown(
  input: ArrayBuffer | Uint8Array,
  fmt: OfficeFormat,
): Promise<string> {
  const entries = await readZipEntries(input);
  const raw =
    fmt === "docx" ? extractDocx(entries) : fmt === "xlsx" ? extractXlsx(entries) : extractPptx(entries);
  let md = raw.trim();
  if (md === "") md = "_(document contained no extractable text)_";
  if (md.length > MAX_EXTRACT_CHARS) {
    md = `${md.slice(0, MAX_EXTRACT_CHARS)}\n\n_(truncated — document exceeded the extraction limit)_`;
  }
  return md;
}
