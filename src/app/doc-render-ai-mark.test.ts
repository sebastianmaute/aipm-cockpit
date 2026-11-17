// src/app/doc-render-ai-mark.test.ts — what a download of an AI-marked project
// document carries (§801): the IPTC source type in the file's metadata and a
// visible line in the body, in docx, pptx and html (PDF is the html printed).
// An unmarked document must come out exactly as it did before the mark existed.

import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { renderDocumentDocx } from "./doc-render-docx";
import { renderDocumentPptx } from "./doc-render-pptx";
import { renderDocumentHtml } from "./doc-render-html";
import { AI_SOURCE_TYPE_URI } from "./ai-content-mark";
import { loadI18n, t, type Lang } from "./i18n";
import { readZipEntries } from "./unzip";
import { decodeUtf8 } from "./office-xml";
import type { DocBlock, ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";

const ws = { tasks: [], raid: [] } as unknown as Workspace;
const BLOCKS: DocBlock[] = [
  { type: "heading", level: 1, text: "Intro" },
  { type: "paragraph", html: "<p>Hello</p>" },
];
const doc = (marked: boolean): ProjectDocument => ({
  id: 1,
  title: "Report",
  blocks: BLOCKS,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  ...(marked ? { aiGenerated: true as const } : {}),
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
async function unzip(blob: Blob): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [p, v] of await readZipEntries(await blob.arrayBuffer())) out.set(p, decodeUtf8(v));
  return out;
}
/** One digest over every part (path + content hash), order-independent. */
const packageDigest = (m: Map<string, string>) =>
  sha([...m].map(([p, v]) => `${p}:${sha(v)}`).sort().join("|"));

beforeAll(async () => {
  await loadI18n("de");
});

const LANGS: Lang[] = ["en-US", "de"];
const SLOT = "DigitalSourceType";

describe("unmarked documents are unchanged", () => {
  // Digests captured from the renderers before the mark existed.
  it("docx", async () => {
    expect(packageDigest(await unzip(renderDocumentDocx(doc(false), ws, "en-US")))).toBe("564ee90b07b5552f");
  });
  it("pptx", async () => {
    expect(packageDigest(await unzip(renderDocumentPptx(doc(false), ws, "en-US")))).toBe("868e09715567253f");
  });
  it("html", () => {
    expect(sha(renderDocumentHtml(doc(false), ws, "en-US", "standalone"))).toBe("f69f0b9edfbfa868");
  });
});

describe.each(LANGS)("marked document, %s", (lang) => {
  const line = () => t(lang, "aiContentMarkLine");

  it("the line is real text in both languages", () => {
    expect(line()).toBe(lang === "de" ? "Enthält KI-generierte Inhalte." : "Contains AI-generated content.");
  });

  for (const [name, render] of [
    ["docx", (d: ProjectDocument) => renderDocumentDocx(d, ws, lang)],
    ["pptx", (d: ProjectDocument) => renderDocumentPptx(d, ws, lang)],
  ] as const) {
    it(`${name}: custom property, core description, wiring and visible line`, async () => {
      const m = await unzip(render(doc(true)));
      const custom = m.get("docProps/custom.xml") ?? "";
      expect(custom).toContain(`name="${SLOT}"`);
      expect(custom).toContain(`<vt:lpwstr>${AI_SOURCE_TYPE_URI}</vt:lpwstr>`);
      expect(m.get("docProps/core.xml") ?? "").toContain(`<dc:description>${AI_SOURCE_TYPE_URI}</dc:description>`);
      expect(m.get("[Content_Types].xml")).toContain('PartName="/docProps/custom.xml"');
      expect(m.get("[Content_Types].xml")).toContain('PartName="/docProps/core.xml"');
      expect(m.get("_rels/.rels")).toContain('Target="docProps/custom.xml"');
      expect(m.get("_rels/.rels")).toContain('Target="docProps/core.xml"');
      const body = [...m].filter(([p]) => /^(word\/document|ppt\/slides\/slide\d+)\.xml$/.test(p)).map(([, v]) => v).join("");
      expect(body).toContain(line());
    });

    it(`${name}: an unmarked document has no docProps`, async () => {
      const m = await unzip(render(doc(false)));
      expect([...m.keys()].filter((p) => p.startsWith("docProps/"))).toEqual([]);
    });
  }

  it("docx: the visible line is set as a small run (9pt)", async () => {
    const m = await unzip(renderDocumentDocx(doc(true), ws, lang));
    const xml = m.get("word/document.xml") ?? "";
    expect(xml).toContain(`<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${line()}</w:t></w:r>`);
  });

  it("pptx: the visible line on the title slide is set in small type (10pt)", async () => {
    const m = await unzip(renderDocumentPptx(doc(true), ws, lang));
    const slide = m.get("ppt/slides/slide1.xml") ?? "";
    const run = slide.split("<a:r>").find((r) => r.includes(line()));
    expect(run).toBeDefined();
    expect(run).toContain('sz="1000"');
  });

  it("html: meta in head, visible line at the end of the body, inherits the text colour", () => {
    const html = renderDocumentHtml(doc(true), ws, lang, "standalone");
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain(`<meta name="digital-source-type" content="${AI_SOURCE_TYPE_URI}"/>`);
    const at = html.indexOf(`>${line()}<`);
    expect(at).toBeGreaterThan(html.indexOf("<body>"));
    expect(html.indexOf("</body>")).toBeGreaterThan(at);
    expect(html.indexOf("Hello")).toBeLessThan(at);
    expect(html).toContain('class="ai-content-mark"');
    expect(html.match(/.ai-content-mark {[^}]*}/)?.[0]).not.toMatch(/color|background|shadow|gradient/);
  });
});
