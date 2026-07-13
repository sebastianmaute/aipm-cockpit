// src/app/office-extract.ts — public entry point for Office (OOXML) ingestion.
// Detects the format, unzips, routes to the per-format extractor, caps output.
// Pure + node-testable.

import { readZipEntries } from "./unzip";
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
