// Barrel for the OOXML export builders, split by format into export-docx.ts,
// export-xlsx.ts, export-pptx.ts (shared helpers in export-ooxml-shared.ts).
// Re-exported here so the dynamic import("./export-ooxml") in export.ts and
// the export-ooxml.test.ts importer stay unchanged.
export { buildDocx } from "./export-docx";
export { buildXlsx } from "./export-xlsx";
export { buildPptx } from "./export-pptx";
