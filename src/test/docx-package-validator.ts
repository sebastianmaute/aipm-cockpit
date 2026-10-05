// src/test/docx-package-validator.ts — TEST-ONLY. A minimal structural
// validator for the .docx packages this repo writes (open-followups §154).
//
// ★★★ WHY IT EXISTS. Every other DOCX assertion in the suite is a STRING
// assertion over emitted markup, and Word fails SILENTLY on input that passes
// every such assertion: an undeclared `w:pStyle` is ignored, a `w:jc` of
// `justify` is dropped, `<w:pPr>` children out of their xsd:sequence make Word
// reject the properties or the part, and a part with no content type or an
// unwired relationship opens with the feature missing or does not open at all.
// This walks the PACKAGE and reports each of those, so a malformed part goes
// red in CI instead of green.
//
// ★★ IT IS NOT A SCHEMA VALIDATOR. It checks the classes of defect named
// above, over the elements this repo emits. A sequence list below names only
// the children it knows; an element it does not know is reported, so a new
// element forces whoever adds it to place it in the sequence here — which is
// the point. It cannot tell you Word RENDERS the result as intended; §154's
// Word open check (recorded in docs/open-followups.md) is the one that did.

import { readZipEntries } from "../app/unzip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_NUMBERING = `${R}/numbering`;

/** CT_PPr's xsd:sequence (ECMA-376 Part 1, §17.3.1.26), in order. */
const PPR_SEQUENCE = [
  "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr",
  "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap",
  "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd",
  "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc",
  "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr",
  "sectPr", "pPrChange",
];

/** CT_RPr's sequence (§17.3.2.28), in order. */
const RPR_SEQUENCE = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline",
  "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing",
  "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText",
  "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
];

const NUMPR_SEQUENCE = ["ilvl", "numId"];
const LVL_SEQUENCE = [
  "start", "numFmt", "lvlRestart", "pStyle", "isLgl", "suff", "lvlText", "lvlPicBulletId", "legacy",
  "lvlJc", "pPr", "rPr",
];
const ABSTRACT_NUM_SEQUENCE = ["nsid", "multiLevelType", "tmpl", "name", "styleLink", "numStyleLink", "lvl"];
const NUM_SEQUENCE = ["abstractNumId", "lvlOverride"];
const NUMBERING_SEQUENCE = ["numPicBullet", "abstractNum", "num", "numIdMacAtCleanup"];

/** ST_Jc (§17.18.44). `justify` is NOT a member — Word drops it. */
const ST_JC = new Set([
  "start", "center", "end", "both", "mediumKashida", "distribute", "numTab", "highKashida",
  "lowKashida", "thaiDistribute", "left", "right",
]);

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  // jsdom's Blob has no `.arrayBuffer()`; FileReader is the shim that works.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function childElements(el: Element): Element[] {
  return Array.from(el.children);
}

function checkSequence(el: Element, order: readonly string[], where: string, problems: string[]): void {
  let last = -1;
  for (const child of childElements(el)) {
    const at = order.indexOf(child.localName);
    if (at < 0) {
      problems.push(`${where}: <${el.localName}> has a child <${child.localName}> this validator does not know`);
      continue;
    }
    if (at < last) {
      problems.push(`${where}: <${el.localName}> children out of sequence at <${child.localName}>`);
    }
    last = Math.max(last, at);
  }
}

function eachW(doc: Document, localName: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W, localName));
}

/** Resolve a part-relative Target against the directory of its source part. */
function resolveTarget(sourcePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = sourcePart.includes("/") ? sourcePart.slice(0, sourcePart.lastIndexOf("/") + 1) : "";
  const segments: string[] = [];
  for (const seg of (base + target).split("/")) {
    if (seg === "..") segments.pop();
    else if (seg !== "." && seg !== "") segments.push(seg);
  }
  return segments.join("/");
}

/** `word/_rels/document.xml.rels` → `word/document.xml`; `_rels/.rels` → "" (the package). */
function relsSource(relsPath: string): string {
  const dir = relsPath.slice(0, relsPath.lastIndexOf("_rels/"));
  const name = relsPath.slice(relsPath.lastIndexOf("/") + 1, -".rels".length);
  return dir + name;
}

/** Every structural problem found in a .docx package; empty means valid. */
export async function validateDocxPackage(blob: Blob): Promise<string[]> {
  const problems: string[] = [];
  const entries = await readZipEntries(await blobBytes(blob));
  const decoder = new TextDecoder();
  const xml = new Map<string, Document>();
  for (const [path, bytes] of entries) {
    if (!path.endsWith(".xml") && !path.endsWith(".rels")) continue;
    const doc = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      problems.push(`${path}: not well-formed XML`);
      continue;
    }
    xml.set(path, doc);
  }

  // Content types: every part has one, every override names a part.
  const types = xml.get("[Content_Types].xml");
  if (!types) {
    problems.push("[Content_Types].xml is missing");
  } else {
    const defaults = new Set(
      Array.from(types.getElementsByTagName("Default")).map((d) => d.getAttribute("Extension")?.toLowerCase()),
    );
    const overrides = new Set(
      Array.from(types.getElementsByTagName("Override")).map((o) => (o.getAttribute("PartName") ?? "").slice(1)),
    );
    for (const path of entries.keys()) {
      if (path === "[Content_Types].xml") continue;
      const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      if (!overrides.has(path) && !defaults.has(ext)) problems.push(`${path}: no content type`);
    }
    for (const part of overrides) {
      if (!entries.has(part)) problems.push(`[Content_Types].xml: override for missing part /${part}`);
    }
  }

  // Relationships: every internal target resolves to a part.
  const docRelIds = new Map<string, string>();
  for (const [path, doc] of xml) {
    if (!path.endsWith(".rels")) continue;
    const source = relsSource(path);
    for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id") ?? "";
      const type = rel.getAttribute("Type") ?? "";
      if (path === "word/_rels/document.xml.rels") docRelIds.set(id, type);
      if (rel.getAttribute("TargetMode") === "External") continue;
      const target = resolveTarget(source, rel.getAttribute("Target") ?? "");
      if (!entries.has(target)) problems.push(`${path}: ${id} targets missing part ${target}`);
    }
  }

  const document = xml.get("word/document.xml");
  if (!document) {
    problems.push("word/document.xml is missing");
    return problems;
  }

  // Every r:id / r:embed the body uses is a document relationship.
  for (const el of Array.from(document.getElementsByTagName("*"))) {
    for (const attr of ["id", "embed"]) {
      const value = el.getAttributeNS(R, attr);
      if (value !== null && !docRelIds.has(value)) {
        problems.push(`word/document.xml: <${el.localName}> references undefined relationship ${value}`);
      }
    }
  }

  // Styles: every w:pStyle names a declared paragraph style.
  const styles = xml.get("word/styles.xml");
  const styleIds = new Set(styles ? eachW(styles, "style").map((s) => s.getAttributeNS(W, "styleId")) : []);
  for (const ps of eachW(document, "pStyle")) {
    const id = ps.getAttributeNS(W, "val");
    if (!styleIds.has(id)) problems.push(`word/document.xml: w:pStyle "${id}" is not declared in styles.xml`);
  }

  // Sequences and enumerations in every WordprocessingML part.
  for (const [path, doc] of xml) {
    if (!path.startsWith("word/") || path.endsWith(".rels")) continue;
    for (const el of eachW(doc, "pPr")) checkSequence(el, PPR_SEQUENCE, path, problems);
    for (const el of eachW(doc, "rPr")) checkSequence(el, RPR_SEQUENCE, path, problems);
    for (const el of eachW(doc, "numPr")) checkSequence(el, NUMPR_SEQUENCE, path, problems);
    for (const jc of eachW(doc, "jc")) {
      const value = jc.getAttributeNS(W, "val") ?? "";
      if (!ST_JC.has(value)) problems.push(`${path}: w:jc value "${value}" is not in ST_Jc`);
    }
  }

  // Numbering: a used numId resolves, through a wired part, to an abstractNum.
  const usedNumIds = new Set(eachW(document, "numId").map((n) => n.getAttributeNS(W, "val")));
  const numbering = xml.get("word/numbering.xml");
  if (numbering) {
    if (![...docRelIds.values()].includes(REL_NUMBERING)) {
      problems.push("word/numbering.xml exists but no document relationship of the numbering type points at it");
    }
    const root = numbering.documentElement;
    checkSequence(root, NUMBERING_SEQUENCE, "word/numbering.xml", problems);
    for (const el of eachW(numbering, "abstractNum")) checkSequence(el, ABSTRACT_NUM_SEQUENCE, "word/numbering.xml", problems);
    for (const el of eachW(numbering, "lvl")) checkSequence(el, LVL_SEQUENCE, "word/numbering.xml", problems);
    for (const el of eachW(numbering, "num")) checkSequence(el, NUM_SEQUENCE, "word/numbering.xml", problems);
    const abstractIds = new Set(eachW(numbering, "abstractNum").map((a) => a.getAttributeNS(W, "abstractNumId")));
    const numIds = new Map(
      eachW(numbering, "num").map((n) => [
        n.getAttributeNS(W, "numId"),
        eachW(numbering, "abstractNumId").find((a) => a.parentElement === n)?.getAttributeNS(W, "val") ?? null,
      ]),
    );
    for (const [numId, abstractId] of numIds) {
      if (!abstractIds.has(abstractId)) {
        problems.push(`word/numbering.xml: w:num ${numId} names undefined abstractNum ${abstractId}`);
      }
    }
    for (const id of usedNumIds) {
      if (!numIds.has(id)) problems.push(`word/document.xml: w:numId ${id} is not defined in numbering.xml`);
    }
  } else if (usedNumIds.size > 0) {
    problems.push("word/document.xml uses w:numId but the package has no word/numbering.xml");
  }

  return problems;
}
