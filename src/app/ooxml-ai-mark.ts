// src/app/ooxml-ai-mark.ts — the OOXML parts that carry the AI-generated mark
// (§801): a custom property and the core description, both holding the IPTC
// digital source type URI. Pure and i18n-free. Shared by the docx and pptx
// package builders, which add these only for a marked document.

import { AI_SOURCE_TYPE_URI } from "./ai-content-mark";

/** The custom-property name, the same in docx and pptx. */
export const AI_MARK_PROPERTY = "DigitalSourceType";

export const AI_MARK_CORE_PATH = "docProps/core.xml";
export const AI_MARK_CUSTOM_PATH = "docProps/custom.xml";

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

export const AI_MARK_CORE_XML = `${XML_DECL}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:description>${AI_SOURCE_TYPE_URI}</dc:description>
</cp:coreProperties>`;

export const AI_MARK_CUSTOM_XML = `${XML_DECL}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="${AI_MARK_PROPERTY}"><vt:lpwstr>${AI_SOURCE_TYPE_URI}</vt:lpwstr></property>
</Properties>`;

/** `[Content_Types].xml` overrides for the two parts (each line starts with a newline). */
export const AI_MARK_CONTENT_TYPE_OVERRIDES = `
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`;

/** Root relationships for the two parts, ids chosen above the officeDocument rId1. */
export const AI_MARK_ROOT_RELS = `
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>`;

export const AI_MARK_ZIP_ENTRIES = [
  { path: AI_MARK_CORE_PATH, data: AI_MARK_CORE_XML },
  { path: AI_MARK_CUSTOM_PATH, data: AI_MARK_CUSTOM_XML },
] as const;
