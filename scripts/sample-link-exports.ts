// scripts/sample-link-exports.ts — emit four link-bearing sample exports for
// the MANUAL pass (open them in Word and in LibreOffice).
//
// Run: npx jiti scripts/sample-link-exports.ts <output-dir>
//
// ★★★ WHY THIS EXISTS. Nothing in this repo can OPEN a .docx or a .pptx. Every
// test unzips the package and asserts on strings, so a wrong relationship
// `Type` URI, a missing `TargetMode`, or an out-of-sequence child element
// unzips clean, asserts clean, and then opens in Word with the link dead or the
// file "repaired". docs/open-followups.md §219 is the record of exactly that
// gap going unverified once already. These artifacts are the hand-off to a
// human; the byte checks below only prove they are worth opening, never that
// they open.
//
// ★★ THE RUNNER IS `jiti`, AND THAT IS WHY THE EXTENSION IS `.ts`. This script
// imports app modules by extensionless TS specifier, which plain `node` cannot
// resolve. `vite-node` is genuinely absent from this repo (AGENTS.md still
// documents it for scripts/generate-sample-workspace.ts), so the `jiti` form in
// scripts/update-ooxml-manifest.ts is the pattern that actually runs — read
// that file's header for the dependency reasoning.
//
// ★★ THE DOM IS LOAD-BEARING: the rich-text path parses with `DOMParser`, so
// jsdom globals are installed BEFORE the first app import — hence the dynamic
// `import()` inside `main` rather than a static one at the top.
//
// ★★★ ITS ABSENCE IS LOUD ON THESE PATHS, AND AN EARLIER REVISION OF THIS
// HEADER SAID THE OPPOSITE. It claimed a missing DOM would degrade silently
// into four well-formed but link-free packages, and presented the hyperlink
// assertion below as the guard against that. Measured, not reasoned: running
// `renderDocumentDocx` with no jsdom installed THROWS `DOMParser is not
// defined` before it can emit anything. So do NOT weaken the DOM setup on the
// theory that a check downstream will catch it — nothing gets that far. (The
// silent-empty behaviour is real for `jsonToWorkspace`, which this script
// never calls; that is where the folklore comes from.)
//
// ★★ WHAT THE HYPERLINK ASSERTION ACTUALLY BUYS is a positive observable: it
// fails if the FIXTURE stops carrying links or a SINK stops emitting them. It
// is demonstrably not vacuous — during development it went red for real, on
// `workspace-exporter.pptx` (0 occurrences). ★ That red was READ WRONG at the
// time: it was taken as proof the workspace .pptx was flat BY DESIGN, and a
// `sink: "flat"` expectation was written to match it. The exporter simply had
// not been wired yet. A genuine failure was turned into a pinned requirement,
// and it later refused to write the very file the fix had corrected — so treat
// a red here as a QUESTION about the sink, never as a specification of it.
//
// ★★ `Blob` IS DELIBERATELY NOT TAKEN FROM jsdom. jsdom's Blob shim has no
// `.arrayBuffer()` and Node cannot wrap one as a BlobPart, so installing it
// would break both the builders' return value and `unzipBytes`. Only the
// parsing/serialising globals are installed.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { JSDOM } from "jsdom";

// ---------------------------------------------------------------------------
// A real, viewable PNG — not the 8-byte header the unit tests use
// ---------------------------------------------------------------------------

/** ★ The unit fixtures use `iVBORw0KGgo=`, a PNG *signature* and nothing else.
 *  That is right for a byte-comparison assertion and useless here: a human has
 *  to SEE something render. This builds a real truecolour PNG so "does the
 *  image render?" is a question the manual pass can actually answer. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function samplePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 3;
      // Diagonal bands, so a stretched or mis-cropped render is obvious by eye.
      const band = Math.floor((x + y) / 24) % 3;
      const rgb = band === 0 ? [11, 46, 92] : band === 1 ? [0, 148, 132] : [235, 238, 242];
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const IMAGE_W = 240;
const IMAGE_H = 120;
const IMAGE_BYTES = samplePng(IMAGE_W, IMAGE_H);
const IMAGE_B64 = IMAGE_BYTES.toString("base64");

// ---------------------------------------------------------------------------
// The fixture — every shape §119/§30 had to close, in one document
// ---------------------------------------------------------------------------

const HANDBOOK = "https://example.com/handbook"; // linked TWICE, on purpose
const STATUS_URL = "https://example.com/status"; // its own link text
const POLICY = "https://example.com/policy";
const MAILBOX = "mailto:pmo@example.com";

/** ★ Assembled from parts so the forbidden scheme is not a contiguous literal
 *  in this file either. The whole claim is that it appears NOWHERE in a
 *  package, and a reviewer grepping the repo for it should land on the check
 *  rather than on the fixture that feeds it. */
const INERT_SCHEME = `java${"script"}:`;
const INERT_HREF = `${INERT_SCHEME}alert(1)`;

const RICH_PARAGRAPH =
  `<p>The <a href="${HANDBOOK}"><strong>delivery handbook</strong></a> is the source of truth. ` +
  `Live status is published at <a href="${STATUS_URL}">${STATUS_URL}</a>. ` +
  `Escalations go to <a href="${MAILBOX}">pmo@example.com</a>. ` +
  `Before escalating, re-read the <a href="${HANDBOOK}">delivery handbook</a> ` +
  `and the <strong><a href="${POLICY}">policy note</a></strong>. ` +
  `This one must be inert text: <a href="${INERT_HREF}">not a link</a>.</p>`;

const IMAGE_PARAGRAPH = `<p><img data-asset-id="a1" alt="Sample chart"></p>`;

/** ★★★ A `table` BLOCK'S CELLS ARE PLAIN TEXT BY CONTRACT — DO NOT PUT MARKUP
 *  HERE. `DocBlock`'s table variant types `rows` as `string[][]`, and
 *  `buildDocxTable` splits on `isRichCell`: a plain string always takes the
 *  plain-run branch, which XML-ESCAPES it. The two branches are deliberately
 *  byte-disjoint (routing a plain cell through the rich path would send author
 *  text through DOMParser), so an `<a href>` typed into a table cell is
 *  supposed to render as literal text.
 *
 *  ★★ Measured, not assumed. A first cut of this fixture put anchors in these
 *  cells and the package came back carrying
 *  `&lt;a href=&quot;…&quot;&gt;` verbatim in `word/document.xml` — which
 *  tripped the forbidden-scheme check and looked exactly like a sanitiser
 *  defect. It is not one: it is this contract, working. The RICH table path is
 *  reached through a `dataSection` block instead (see `MILESTONES` below),
 *  whose cells arrive as real `RichCell`s from `buildExportSections`. */
const TABLE_ROWS: string[][] = [
  ["Plain cell", "A table block's cells are plain text — markup is escaped, by design."],
  ["Rich table path", "See the Milestones data section below; its cells are RichCells."],
];

/** The RICH table path for the document renderer. `resolveDataSection` calls
 *  the REAL `buildExportSections`, so a milestone's `description` arrives as
 *  the same `RichCell` the workspace exporter lays out — and threading the
 *  link sink through it is exactly what §119 had to fix. Milestones is the
 *  narrowest register carrying a rich column (9 columns, one rich), which
 *  keeps the rendered table legible enough for a human to check by eye. */
/** ★★★ EVERY DESCRIPTION MUST START WITH A TAG — the `<p>` wrappers are
 *  LOAD-BEARING, not tidiness. These fields go through the per-sink
 *  `isHtmlStart` classifier, and the rich sink requires the value to BEGIN
 *  with a tag: measured, `isHtmlStart('Inert: <a href=…>x</a>.', RICH_SINK)` is
 *  FALSE. A description that merely CONTAINS an anchor is therefore classified
 *  as legacy PLAIN TEXT, and the resulting `RichCell` carries the raw source in
 *  BOTH `html` and `text`.
 *
 *  ★★ THAT IS WHAT MAKES IT DANGEROUS HERE, and it cost a full diagnosis
 *  cycle. `cellTextWithLinks` falls back to `cell.text` when it finds no SAFE
 *  link — so the misclassified inert row printed
 *  `Inert: <a href="…">not a link</a>.` onto a slide, address and all. It read
 *  exactly like a sanitiser hole in the .pptx path; it is neither, and the
 *  DOCX renderer was clean on the identical fixture, which is precisely the
 *  kind of split that sends someone hunting in the wrong file. Wrapping the
 *  value the way the rich-text editor actually stores it makes both renderers
 *  agree and the address vanish. */
const MILESTONES = [
  { id: 1, name: "Handbook read", date: "2026-09-10",
    description: `<p>Per the <a href="${HANDBOOK}"><strong>delivery handbook</strong></a>.</p>` },
  { id: 2, name: "Status watched", date: "2026-09-11",
    description: `<p><a href="${STATUS_URL}">${STATUS_URL}</a></p>` },
  { id: 3, name: "Escalation path", date: "2026-09-12",
    description: `<p>Mail <a href="${MAILBOX}">pmo@example.com</a>.</p>` },
  { id: 4, name: "Handbook re-read", date: "2026-09-13",
    description: `<p>Again, the <a href="${HANDBOOK}">delivery handbook</a>.</p>` },
  { id: 5, name: "Policy noted", date: "2026-09-14",
    description: `<p><strong><a href="${POLICY}">policy note</a></strong></p>` },
  { id: 6, name: "Inert link", date: "2026-09-15",
    description: `<p>Must be inert text: <a href="${INERT_HREF}">not a link</a>.</p>` },
];

// ---------------------------------------------------------------------------
// Byte-level checks — these only decide whether an artifact is worth opening
// ---------------------------------------------------------------------------

type Check = { label: string; ok: boolean; detail: string };

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, from)) {
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/** Every part as text.
 *
 *  ★★ Latin-1, not UTF-8, and deliberately: it is byte-exact for the ASCII
 *  being hunted and cannot turn an image part's invalid UTF-8 into a
 *  replacement character that swallows a match. */
function partsAsText(zip: Map<string, Uint8Array>): Map<string, string> {
  const dec = new TextDecoder("latin1");
  return new Map([...zip].map(([path, bytes]) => [path, dec.decode(bytes)]));
}

async function main(): Promise<void> {
  const outArg = process.argv[2];
  if (!outArg) {
    console.error("usage: npx jiti scripts/sample-link-exports.ts <output-dir>");
    process.exit(2);
  }
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });

  // --- DOM, installed BEFORE the first app import --------------------------
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
  const { buildDocx } = await import("../src/app/export-docx");
  const { buildPptx } = await import("../src/app/export-pptx");
  const { emptyWorkspace } = await import("../src/app/workspace");
  const { unzipBytes } = await import("../src/test/unzip-bytes");

  // --- Fixture -------------------------------------------------------------
  const doc = {
    id: 1,
    title: "Link fidelity sample",
    blocks: [
      { type: "heading", level: 2, text: "Links in prose" },
      { type: "paragraph", html: RICH_PARAGRAPH },
      { type: "heading", level: 2, text: "An embedded image" },
      { type: "paragraph", html: IMAGE_PARAGRAPH },
      { type: "heading", level: 2, text: "A plain table block" },
      {
        type: "table",
        caption: "Table-block cells are plain text",
        columns: ["Item", "Note"],
        rows: TABLE_ROWS,
      },
      { type: "heading", level: 2, text: "Links in a data section (rich cells)" },
      { type: "dataSection", key: "milestones" },
    ],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  } as unknown as Parameters<typeof renderDocumentDocx>[0];

  const ws = {
    ...emptyWorkspace(),
    milestones: MILESTONES,
    documentAssets: [{
      id: "a1",
      name: "sample-chart.png",
      mime: "image/png",
      size: IMAGE_BYTES.length,
      width: IMAGE_W,
      height: IMAGE_H,
      hash: "sample",
      createdAt: "2026-09-01T00:00:00.000Z",
    }],
  } as unknown as Parameters<typeof renderDocumentDocx>[1];

  const assets = {
    inlined: { a1: IMAGE_B64 },
    omitted: new Set<string>(),
    missing: new Set<string>(),
  };

  const sections = [{
    key: "tasks",
    title: "Tasks — link fidelity",
    columns: ["Task", "Reference"],
    rows: [
      ["Read the handbook", {
        html: `Per the <a href="${HANDBOOK}"><strong>delivery handbook</strong></a>.`,
        text: "Per the delivery handbook.",
      }],
      ["Watch live status", {
        html: `<a href="${STATUS_URL}">${STATUS_URL}</a>`,
        text: STATUS_URL,
      }],
      ["Escalate", {
        html: `Mail <a href="${MAILBOX}">pmo@example.com</a>.`,
        text: "Mail pmo@example.com.",
      }],
      ["Re-read the handbook", {
        html: `Again: <a href="${HANDBOOK}">delivery handbook</a>.`,
        text: "Again: delivery handbook.",
      }],
      ["Policy note in bold", {
        html: `<strong><a href="${POLICY}">policy note</a></strong>`,
        text: "policy note",
      }],
      ["Inert", {
        html: `<a href="${INERT_HREF}">not a link</a>`,
        text: "not a link",
      }],
    ],
  }] as unknown as Parameters<typeof buildDocx>[0];

  // --- Build ---------------------------------------------------------------
  //
  // ★★★ ALL FOUR ARTIFACTS ARE REAL SINKS AS OF THE §330 SCOPE FIX, and this
  // block used to say the opposite. It carried a `sink: "flat"` discriminator
  // and asserted that `export-pptx.ts` emits NO `<a:hlinkClick>` and no
  // external relationship "by design" — which was true when written and became
  // a REQUIREMENT PINNING THE OLD BEHAVIOUR the moment the workspace exporter
  // learned to mint per-slide relationships. It failed the regenerate that was
  // meant to hand a human the fixed file, and refused to write it.
  //
  // ★★ The flat `text (url)` projection is NOT gone — `doc-render-pptx.ts`
  // still uses it for TABLE cells, because that path flattens a row to one
  // line and no per-word run survives (open-followups §330). It is simply no
  // longer any ARTIFACT'S whole-package contract, so there is nothing left for
  // a per-artifact flag to discriminate. Its unit witnesses live in
  // `export-ooxml.test.ts` and `doc-render-pptx.test.ts`.
  //
  // ★ Historical note worth keeping: a first cut of this script demanded real
  // link elements from all four and reported three failures against correct
  // code. That was a genuine false alarm THEN. Re-adding a flat expectation
  // now would be the mirror mistake.
  const artifacts = [
    {
      file: "document-renderer.docx",
      kind: "docx" as const,
      media: true,
      blob: renderDocumentDocx(doc, ws, "en-US", assets),
    },
    {
      file: "document-renderer.pptx",
      kind: "pptx" as const,
      media: true,
      blob: renderDocumentPptx(doc, ws, "en-US", assets),
    },
    {
      file: "workspace-exporter.docx",
      kind: "docx" as const,
      media: false,
      blob: buildDocx(sections),
    },
    {
      file: "workspace-exporter.pptx",
      kind: "pptx" as const,
      media: false,
      blob: buildPptx(sections, "en-US"),
    },
  ];

  let failures = 0;
  for (const artifact of artifacts) {
    const zip = await unzipBytes(artifact.blob);
    const text = partsAsText(zip);
    const all = [...text.values()].join("\n");
    const checks: Check[] = [];

    const linkTag = artifact.kind === "docx" ? "<w:hyperlink" : "<a:hlinkClick";
    const linkTags = countOccurrences(all, linkTag);
    const relParts = [...text].filter(([p]) => p.endsWith(".rels"));
    const external = relParts.flatMap(([p, x]) =>
      [...x.matchAll(/<Relationship\b[^>]*TargetMode="External"[^>]*>/g)].map(() => p),
    );

    // 1. The rich parse actually produced link machinery. ★ NOT a no-DOM
    //    guard — a missing DOM throws long before this runs (see the header).
    //    It catches a fixture that stopped carrying links, or a sink that
    //    stopped emitting them.
    checks.push({
      label: `${linkTag} present`,
      ok: linkTags > 0,
      detail: `${linkTags} occurrence(s)`,
    });
    checks.push({
      label: 'TargetMode="External" relationship',
      ok: external.length > 0,
      detail: `${external.length} across ${new Set(external).size} rels part(s)`,
    });
    // 2. The repeated target is ONE relationship per relationship SCOPE.
    //    ★★ A docx has one scope (word/_rels/document.xml.rels); a pptx has
    //    one PER SLIDE, so "1 per rels part" is the right invariant for both
    //    and a bare package-wide count would flag correct pptx output.
    //    ★★ For the workspace .pptx that scope is now one rels part PER ROW
    //    SLIDE, each minting from its own sink at rId2 — so the same target
    //    appearing once in each of several parts is CORRECT here, and a
    //    package-wide "exactly one" would report a defect that is not there.
    const perPart = relParts
      .map(([p, x]) => ({ p, n: countOccurrences(x, `Target="${HANDBOOK}"`) }))
      .filter((e) => e.n > 0);
    checks.push({
      label: "repeated target = exactly ONE relationship per rels part",
      ok: perPart.length > 0 && perPart.every((e) => e.n === 1),
      detail: perPart.length === 0
        ? "target absent"
        : perPart.map((e) => `${e.p}:${e.n}`).join(", "),
    });

    // 3. The forbidden scheme appears NOWHERE — every part, not just the rels.
    const leaks = [...text].filter(([, x]) => x.includes(INERT_SCHEME));
    checks.push({
      label: "forbidden scheme absent from EVERY part",
      ok: leaks.length === 0,
      detail: leaks.length === 0
        ? `0 of ${zip.size} parts`
        : `LEAKED in ${leaks.map(([p]) => p).join(", ")}`,
    });

    // 4. A URL that is its OWN link text must not be doubled. Applies to all
    //    four. ★ The doubling it guards against is `cellTextWithLinks`'
    //    `text (url)` form, which no longer governs any whole artifact — but
    //    `doc-render-pptx.ts` still uses that projection for TABLE cells
    //    (open-followups §330), and any future change routing a package back
    //    through it would reintroduce the risk. Keep the check on all four.
    const doubled = `${STATUS_URL} (${STATUS_URL})`;
    checks.push({
      label: "URL used as its own link text is NOT doubled",
      ok: !all.includes(doubled),
      detail: all.includes(doubled) ? "DOUBLED" : "single occurrence form",
    });

    // 5. Media. The document renderer embeds images; the workspace exporter has
    //    no image path at all, so "none" is the correct answer there.
    const media = [...zip.keys()].filter((p) => /^(word|ppt)\/media\//.test(p));
    checks.push({
      label: artifact.media ? "image part present" : "no media (workspace exporter emits none)",
      ok: artifact.media ? media.length > 0 : media.length === 0,
      detail: media.length === 0 ? "none" : media.join(", "),
    });

    console.log(`\n${artifact.file}  (${artifact.blob.size} bytes, ${zip.size} parts)`);
    for (const c of checks) console.log(`  ${c.ok ? "OK  " : "FAIL"} ${c.label} — ${c.detail}`);

    const bad = checks.filter((c) => !c.ok);
    if (bad.length > 0) {
      failures += bad.length;
      console.error(`  ★ NOT WRITTEN: ${bad.length} check(s) failed for ${artifact.file}`);
      continue;
    }
    writeFileSync(resolve(outDir, artifact.file), Buffer.from(await artifact.blob.arrayBuffer()));
    console.log(`  wrote ${resolve(outDir, artifact.file)}`);
  }

  if (failures > 0) {
    throw new Error(
      `${failures} byte-level check(s) failed. That is a REAL DEFECT in the export path, ` +
      "not a script problem — nothing was written for the failing artifacts.",
    );
  }
  console.log(`\nAll four artifacts written to ${outDir}. Now OPEN them in Word and in LibreOffice.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
