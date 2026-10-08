// scripts/sample-image-exports.ts — emit the image sample exports for the
// §219 manual pass (batch 19 eye-verify kit, docs/eye-verify-batch-19.md).
//
// Run: npx jiti scripts/sample-image-exports.ts <output-dir>
//
// ★★★ WHY THIS EXISTS. Nothing in this repo can OPEN a .docx, a .pptx or a PDF.
// Every test unzips the package and asserts on strings, so whether an image
// DRAWS, at what size and in what order, is a question only a human with the
// reader can answer. scripts/sample-link-exports.ts did that for links (batch
// 17); this does it for the eight image items §219 still owes. The byte checks
// below only prove a sample is worth opening, never that it renders.
//
// ★★ THE ASSETS GO THROUGH THE REAL PER-FORMAT POLICY. Each sample's images
// are resolved by `assetsFor` (document-download.ts), the function a download
// uses, with a fake byte loader standing in for the Turso asset store. So the
// over-budget sample is budgeted exactly as a real HTML/PDF download is (25 MB,
// `EXPORT_INLINE_BUDGET_BYTES`), and Word/PowerPoint stay unbudgeted, as they
// are in the app. A dangling image is one whose loader returns null.
//
// ★★ PDF is the HTML renderer printed (docs/AGENTS/documents.md). The `.html`
// samples are the standalone render the PDF path prints; the reader opens one
// in a browser and prints it to PDF. The app adds only an auto-print script.
//
// ★ Runner, DOM and Blob notes: see scripts/sample-link-exports.ts's header.
// They apply here unchanged (jiti for extensionless TS imports, jsdom globals
// before the first app import, no jsdom Blob).

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import sharp from "sharp";

type Img = { id: string; name: string; mime: string; bytes: Buffer; width: number; height: number };

function labelSvg(w: number, h: number, label: string, sub: string, bg: string | null): Buffer {
  const fill = bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : "";
  const size = Math.round(Math.min(w, h) / 6);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${fill}` +
      `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="none" stroke="#111" stroke-width="8"/>` +
      `<text x="50%" y="46%" font-family="Arial" font-size="${size}" font-weight="bold" fill="#111" text-anchor="middle">${label}</text>` +
      `<text x="50%" y="${46 + 14}%" font-family="Arial" font-size="${Math.round(size / 2.5)}" fill="#111" text-anchor="middle">${sub}</text>` +
      `</svg>`,
  );
}

/** A flat, labelled image. The label and the pixel size are printed on it, so
 *  the reader can check order and size by eye. */
async function labelled(id: string, label: string, w: number, h: number, bg: string, format: "png" | "webp" = "png"): Promise<Img> {
  const svg = sharp(labelSvg(w, h, label, `${w} × ${h} px`, bg));
  const bytes = format === "webp" ? await svg.webp().toBuffer() : await svg.png().toBuffer();
  return { id, name: `${id}.${format}`, mime: `image/${format}`, bytes, width: w, height: h };
}

/** A labelled image of gaussian noise, which PNG cannot compress: about 4.7 MB,
 *  under the 5 MB upload cap, so six of them exceed the 25 MB HTML budget. */
async function noisy(id: string, label: string): Promise<Img> {
  const w = 1250;
  const h = 1250;
  const bytes = await sharp({ create: { width: w, height: h, channels: 3, background: "#888888", noise: { type: "gaussian", mean: 128, sigma: 60 } } })
    .composite([{ input: labelSvg(w, h, label, "noise, ~4.7 MB", null), top: 0, left: 0, blend: "over" }])
    .png()
    .toBuffer();
  return { id, name: `${id}.png`, mime: "image/png", bytes, width: w, height: h };
}

const para = (text: string) => ({ type: "paragraph", html: `<p>${text}</p>` });
const img = (id: string, alt: string) => ({ type: "paragraph", html: `<p><img data-asset-id="${id}" alt="${alt}"></p>` });
const PROSE =
  "This paragraph is filler so the document runs over several pages and slides. It carries no images and no " +
  "links; read past it. The checklist says what to look for around each picture.";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

async function main(): Promise<void> {
  const outArg = process.argv[2];
  if (!outArg) {
    console.error("usage: npx jiti scripts/sample-image-exports.ts <output-dir>");
    process.exit(2);
  }
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  for (const name of [
    "DOMParser", "XMLSerializer", "Node", "NodeFilter", "Element", "HTMLElement",
    "Document", "DocumentFragment", "Text", "Comment", "HTMLTemplateElement",
    "getComputedStyle",
  ]) {
    const value = (dom.window as unknown as Record<string, unknown>)[name];
    if (value !== undefined) g[name] = value;
  }

  const { renderDocumentDocx } = await import("../src/app/doc-render-docx");
  const { renderDocumentPptx } = await import("../src/app/doc-render-pptx");
  const { renderDocumentHtml } = await import("../src/app/doc-render-html");
  const { assetsFor } = await import("../src/app/document-download");
  const { emptyWorkspace } = await import("../src/app/workspace");
  const { unzipBytes } = await import("../src/test/unzip-bytes");
  const { t } = await import("../src/app/i18n");

  type Doc = Parameters<typeof renderDocumentDocx>[0];
  type Ws = Parameters<typeof renderDocumentDocx>[1];
  type Format = "html" | "docx" | "pptx";

  const failures: string[] = [];
  const written: string[] = [];

  /** Render `blocks` in each format through the real asset policy, check each
   *  result, and write only those that pass. `gone` ids have metadata but no bytes. */
  async function sample(
    file: string,
    title: string,
    blocks: unknown[],
    images: Img[],
    formats: Format[],
    check: (format: Format, text: string, media: string[], slides: string[]) => string | null,
    gone: string[] = [],
  ): Promise<void> {
    const doc = { id: 1, title, blocks, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" } as unknown as Doc;
    const ws = {
      ...emptyWorkspace(),
      documentAssets: images.map((i) => ({
        id: i.id, name: i.name, mime: i.mime, size: i.bytes.length, width: i.width, height: i.height,
        hash: i.id, createdAt: "2026-10-08T00:00:00.000Z",
      })),
    } as unknown as Ws;
    const byId = new Map(images.map((i) => [i.id, i]));
    const load = async (id: string) => (gone.includes(id) ? null : (byId.get(id)?.bytes.toString("base64") ?? null));
    for (const format of formats) {
      const assets = await assetsFor(doc, ws, format, load);
      let bytes: Buffer;
      let text: string;
      let media: string[] = [];
      let slides: string[] = [];
      if (format === "html") {
        text = renderDocumentHtml(doc, ws, "en-US", "standalone", assets);
        bytes = Buffer.from(text, "utf8");
      } else {
        const blob = format === "docx" ? renderDocumentDocx(doc, ws, "en-US", assets) : renderDocumentPptx(doc, ws, "en-US", assets);
        bytes = Buffer.from(await blob.arrayBuffer());
        const zip = await unzipBytes(blob);
        media = [...zip.keys()].filter((k) => /\/media\//.test(k));
        // Each slide's XML, in slide order, so a check can say which slide a picture is on.
        slides = [...zip.entries()]
          .filter(([k]) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
          .sort(([x], [y]) => Number(x.match(/\d+/)![0]) - Number(y.match(/\d+/)![0]))
          .map(([, v]) => new TextDecoder().decode(v));
        text = [...zip.entries()].filter(([k]) => k.endsWith(".xml")).map(([, v]) => new TextDecoder().decode(v)).join("\n");
      }
      const name = `${file}.${format}`;
      const problem = check(format, text, media, slides);
      if (problem) {
        failures.push(`${name}: ${problem}`);
        continue;
      }
      writeFileSync(resolve(outDir, name), bytes);
      written.push(`${name} (${(bytes.length / 1048576).toFixed(1)} MB)`);
    }
  }

  const dataSrc = (text: string) => count(text, 'src="data:image/');
  const placeholder = (name: string) => t("en-US", "assetExportPlaceholder", name);

  // Items 1, 2, 3: two images in a long document.
  const a = await labelled("image-a", "Image A", 1200, 600, "#9fd3c7");
  const b = await labelled("image-b", "Image B", 600, 900, "#f5c26b");
  const prose = Array.from({ length: 10 }, () => para(PROSE));
  await sample("1-two-images", "§219 items 1–3: two images in a long document", [
    { type: "heading", level: 2, text: "Text before Image A" }, para(PROSE), img("image-a", "Image A"),
    para("This paragraph sits between Image A and Image B."), img("image-b", "Image B"),
    { type: "heading", level: 2, text: "Text after Image B" }, ...prose,
  ], [a, b], ["docx", "pptx", "html"], (f, text, media) => {
    if (f === "html") return dataSrc(text) === 2 ? null : `expected 2 inlined images, found ${dataSrc(text)}`;
    return media.length === 2 ? null : `expected 2 media parts, found ${media.length}`;
  });

  // Item 4: over the 25 MB HTML budget — the sixth image becomes a placeholder in HTML only.
  const big = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => noisy(`big-${n}`, `Big ${n}`)));
  const totalMb = big.reduce((s, i) => s + i.bytes.length, 0) / 1048576;
  await sample("4-over-budget", "§219 item 4: images over the export budget",
    big.flatMap((i) => [para(`Next: ${i.name}`), img(i.id, i.name)]), big, ["html", "docx", "pptx"], (f, text, media) => {
      if (f === "html") {
        if (dataSrc(text) !== 5) return `expected 5 inlined images (total ${totalMb.toFixed(1)} MB), found ${dataSrc(text)}`;
        return text.includes(placeholder("big-6.png")) ? null : "the sixth image's placeholder is missing";
      }
      return media.length === 6 ? null : `expected all 6 images, found ${media.length}`;
    });

  // Item 5: a dangling image (metadata, no bytes).
  const present = await labelled("present", "Present", 800, 400, "#b5d99c");
  const gone = await labelled("gone", "SHOULD NOT DRAW", 800, 400, "#e8a0a0");
  await sample("5-dangling", "§219 item 5: one image whose bytes are missing",
    [para("Below: the image that exists."), img("present", "Present"), para("Below: the image whose bytes are gone."), img("gone", "Gone"), para("End.")],
    [present, gone], ["html", "docx", "pptx"], (f, text, media) => {
      if (f === "html") return text.includes('data-asset-missing="true"') && dataSrc(text) === 1 ? null : "expected one inlined image and one data-asset-missing marker";
      if (media.length !== 1) return `expected 1 media part, found ${media.length}`;
      return text.includes(placeholder("gone.png")) ? null : "the dangling image's placeholder text is missing";
    }, ["gone"]);

  // Item 6: WebP.
  const w = await labelled("webp-image", "WebP image", 900, 450, "#a8c8f0", "webp");
  await sample("6-webp", "§219 item 6: a WebP image", [para("Below: a WebP image."), img("webp-image", "WebP"), para("End.")],
    [w], ["docx", "pptx"], (_f, _text, media) => (media.some((m) => m.endsWith(".webp")) ? null : `expected a .webp media part, found ${media.join(", ") || "none"}`));

  // Item 7: deck length. Since §222 a picture is scaled onto the current slide when
  // at least half a slide (8 of 16 body lines) is left, else it starts the next one.
  // Two samples sit well clear of that threshold, and the check reads which slide
  // the picture landed on rather than trusting the line arithmetic.
  const shot = await labelled("screenshot", "Screenshot", 1600, 900, "#dddddd");
  const slideOf = (slides: string[], needle: string) => slides.findIndex((x) => x.includes(needle));
  await sample("7a-deck-short-lead", "§219 item 7a: one line, then a screenshot",
    [para("SHORT-LEAD: one line before the screenshot."), img("screenshot", "Screenshot")], [shot], ["pptx"],
    (_f, _text, media, slides) => {
      if (media.length !== 1) return `expected 1 media part, found ${media.length}`;
      const t = slideOf(slides, "SHORT-LEAD"), pic = slideOf(slides, "<p:pic>");
      return t >= 0 && t === pic ? null : `expected the screenshot on the text's slide, found text on ${t + 1}, picture on ${pic + 1}`;
    });
  const longLead = "LONG-LEAD: " + "This sentence fills the slide so the screenshot has too little room left. ".repeat(12);
  await sample("7b-deck-long-lead", "§219 item 7b: a long paragraph, then a screenshot",
    [para(longLead), img("screenshot", "Screenshot")], [shot], ["pptx"],
    (_f, _text, media, slides) => {
      if (media.length !== 1) return `expected 1 media part, found ${media.length}`;
      const t = slideOf(slides, "LONG-LEAD"), pic = slideOf(slides, "<p:pic>");
      return t >= 0 && pic === t + 1 ? null : `expected the screenshot on the slide after the text, found text on ${t + 1}, picture on ${pic + 1}`;
    });

  // Item 8: one image used several times — once alone twice, then twice in one paragraph.
  const reused = await labelled("reused", "Reused", 600, 300, "#d7b8e8");
  await sample("8-reused-image", "§219 item 8: one image used four times",
    [para("Use 1 (alone):"), img("reused", "Use 1"), para("Use 2 (alone):"), img("reused", "Use 2"),
      para("Uses 3 and 4 (one paragraph):"), { type: "paragraph", html: `<p><img data-asset-id="reused" alt="Use 3"> <img data-asset-id="reused" alt="Use 4"></p>` }],
    [reused], ["docx", "pptx"], (f, text, media) => {
      if (media.length !== 1) return `expected ONE shared media part, found ${media.length}`;
      const draws = f === "docx" ? count(text, "<w:drawing>") : count(text, "<p:pic>");
      return draws >= 4 ? null : `expected at least 4 drawings of it, found ${draws}`;
    });

  for (const line of written) console.log(`wrote ${line}`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`REFUSED ${f}`);
    process.exit(1);
  }
  console.log(`\n${written.length} samples in ${outDir}. Open each in the reader docs/eye-verify-batch-19.md names for it.`);
}

void main();
