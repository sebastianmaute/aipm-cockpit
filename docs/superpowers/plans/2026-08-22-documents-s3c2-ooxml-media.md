# Documents S3c-2 — real image bytes in every export format — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A document containing images exports with those images present — OOXML media parts in `.docx`/`.pptx`, `data:` URIs in standalone HTML and PDF. Closes `docs/open-followups.md` §202 and §210.

**Architecture:** One new async module resolves a document's asset bytes into three buckets (inlined / omitted-by-budget / missing) and is the only place that touches the byte store. Renderers stay synchronous and pure, taking that result as data. Two new pure leaves carry the OOXML media geometry and the picture shapes; the two package builders gain an additive `media` parameter whose empty case is byte-identical to today.

**Tech Stack:** TypeScript, React 19, Next 16, Vitest 4 (jsdom), hand-rolled `zip.ts` (STORE), OOXML (WordprocessingML / PresentationML).

**Spec:** `docs/superpowers/specs/2026-08-22-documents-s3c2-ooxml-media-design.md` (commit `bbf3c150`).

---

## Read before starting

- `docs/AGENTS/documents.md` — "Asset images (S3c-1)" is the as-built architecture this extends
- `AGENTS.md` — the gate discipline. In particular: **never read a gate's exit code through a pipe**, and `npm run lint` does not reproduce the CI gate (use `npx eslint --max-warnings=0 src/app`)
- The size ratchet counts `wc -l + 1`. Read a real number with
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`

## Ground rules for this slice

1. **Never regenerate `src/app/__fixtures__/golden-*` or the `export-ooxml` fixtures.** They are the guard that the empty-media path stayed byte-identical. A diff there means a bug, not a fixture to refresh.
2. **Renderers stay synchronous.** Only `document-download.ts` and the new `document-export-assets.ts` are async.
3. Commit after every task. Run `npx tsc --noEmit` before each commit — vitest never typechecks.

---

## File structure

| File | New? | Responsibility |
|---|---|---|
| `src/app/ooxml-media.ts` | new | DOM-free: mime → extension, px → EMU, aspect-preserving `fitExtent`, the `MediaPart` shape |
| `src/app/document-export-assets.ts` | new | The one `IMG_TAG_RE`; document → asset ids; async byte load with the inline budget → `ExportAssets` |
| `src/test/unzip-bytes.ts` | new | Test-only: unzip a Blob to `Map<string, Uint8Array>` (the existing test helper decodes everything as UTF-8 text and cannot byte-compare an image) |
| `src/app/ooxml-docx-primitives.ts` | modify | `buildDocxPackage` gains `media`; new `docxInlineDrawing` |
| `src/app/ooxml-pptx-primitives.ts` | modify | `buildPptxPackage` takes per-slide media; new `pptxPicture` |
| `src/app/doc-render-docx.ts` | modify | Split paragraphs around inlined images; mint media parts |
| `src/app/doc-render-pptx.ts` | modify | Image `SlideLine` variant; cost-based `paginateLines`; place pictures |
| `src/app/doc-render-html.ts` | modify | Third branch (omitted); `img[data-asset-missing]` rule in `DOCUMENT_PAGE_STYLES` |
| `src/app/document-download.ts` | modify | `async`; open the PDF tab before awaiting |
| `src/app/documents-panel.tsx` | modify | Pass `assetPane` config to the two download call sites |
| `src/app/chat-panel.tsx`, `src/app/chat-tool-block.tsx` | modify | Thread `tursoConfig` + `projectId` to the download card |

---

### Task 1: `ooxml-media.ts` — geometry and part naming

**Files:**
- Create: `src/app/ooxml-media.ts`
- Test: `src/app/ooxml-media.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/ooxml-media.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { emuFromPx, mediaExtension, fitExtent, EMU_PER_INCH } from "./ooxml-media";

describe("mediaExtension", () => {
  it("maps every allowed mime and rejects everything else", () => {
    expect(mediaExtension("image/png")).toBe("png");
    expect(mediaExtension("image/jpeg")).toBe("jpeg");
    expect(mediaExtension("image/webp")).toBe("webp");
    // SVG is permanently excluded upstream; a miss must be null, never a guess.
    expect(mediaExtension("image/svg+xml")).toBeNull();
    expect(mediaExtension("")).toBeNull();
  });
});

describe("emuFromPx", () => {
  it("converts at 96 CSS px per inch", () => {
    expect(emuFromPx(96)).toBe(EMU_PER_INCH);
    expect(emuFromPx(0)).toBe(0);
  });
});

describe("fitExtent", () => {
  it("returns null when either dimension is absent — OOXML needs a concrete extent", () => {
    expect(fitExtent({ width: 100 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ height: 100 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({}, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 0, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
  });

  it("leaves an image that already fits at its natural size", () => {
    const ext = fitExtent({ width: 96, height: 48 }, 10 * EMU_PER_INCH, 10 * EMU_PER_INCH);
    expect(ext).toEqual({ cxEmu: EMU_PER_INCH, cyEmu: EMU_PER_INCH / 2 });
  });

  it("scales down to the WIDTH bound", () => {
    const ext = fitExtent({ width: 192, height: 96 }, EMU_PER_INCH, 10 * EMU_PER_INCH);
    expect(ext).toEqual({ cxEmu: EMU_PER_INCH, cyEmu: Math.round(EMU_PER_INCH / 2) });
  });

  it("scales down to the HEIGHT bound", () => {
    const ext = fitExtent({ width: 96, height: 192 }, 10 * EMU_PER_INCH, EMU_PER_INCH);
    expect(ext).toEqual({ cxEmu: Math.round(EMU_PER_INCH / 2), cyEmu: EMU_PER_INCH });
  });

  it("never exceeds either bound and preserves aspect within rounding", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8000 }),
        fc.integer({ min: 1, max: 8000 }),
        fc.integer({ min: 10_000, max: 10_000_000 }),
        fc.integer({ min: 10_000, max: 10_000_000 }),
        (w, h, maxW, maxH) => {
          const ext = fitExtent({ width: w, height: h }, maxW, maxH);
          expect(ext).not.toBeNull();
          const { cxEmu, cyEmu } = ext!;
          expect(cxEmu).toBeLessThanOrEqual(maxW);
          expect(cyEmu).toBeLessThanOrEqual(maxH);
          expect(cxEmu).toBeGreaterThan(0);
          expect(cyEmu).toBeGreaterThan(0);
          // Aspect survives, with slack for the two independent roundings.
          const want = w / h;
          const got = cxEmu / cyEmu;
          expect(Math.abs(got - want)).toBeLessThan(Math.max(0.01, want * 0.01));
        },
      ),
      { numRuns: 300 },
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/ooxml-media.test.ts --reporter=dot`
Expected: FAIL — `Failed to resolve import "./ooxml-media"`.

- [ ] **Step 3: Implement**

```ts
// src/app/ooxml-media.ts — OOXML media-part naming and geometry.
//
// ★★ DOM-FREE BY CONTRACT: pure arithmetic and string building. No DOMParser,
// no Blob, no atob. Both OOXML renderers import it, and keeping the browser out
// means its tests are plain unit tests with no environment setup.
//
// ★★ It is its own file rather than living in either primitives module because
// BOTH need it, and because ooxml-docx-primitives.ts and ooxml-pptx-primitives.ts
// are each within ~230 lines of the 800-line ratchet.

/** EMUs (English Metric Units) per inch — the OOXML coordinate unit. */
export const EMU_PER_INCH = 914400;

/** CSS pixels are 96 to the inch by definition, and the stored asset
 *  dimensions ARE CSS pixels: they are captured from the downscale canvas. */
const PX_PER_INCH = 96;

export function emuFromPx(px: number): number {
  return Math.round((px * EMU_PER_INCH) / PX_PER_INCH);
}

export type MediaExtension = "png" | "jpeg" | "webp";

/** mime → the extension used by BOTH the part name and the
 *  `[Content_Types].xml` `Default` entry.
 *
 *  ★ Returns null outside `ASSET_MIME_ALLOWED` rather than guessing. A part
 *  whose declared type is wrong is a file Word refuses to open, which is worse
 *  than the placeholder the caller falls back to. The mapping is deliberately
 *  a literal switch and not a `mime.split("/")[1]`: that would happily mint
 *  `svg+xml` as an extension for the one type the upload path excludes.
 *
 *  ★★ Every member is also spelled `image/<ext>`, which the `Default` entry in
 *  both package builders relies on — see `contentTypeFor`. */
export function mediaExtension(mime: string): MediaExtension | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpeg";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

/** The `[Content_Types].xml` ContentType for an extension this module minted. */
export function contentTypeFor(ext: MediaExtension): string {
  return `image/${ext}`;
}

export type Extent = { cxEmu: number; cyEmu: number };

/**
 * Aspect-preserving fit of a pixel dimension pair into an EMU box.
 *
 * ★★★ RETURNS NULL WHEN EITHER DIMENSION IS ABSENT, and that is a real case,
 * not defensive noise: `DocumentAsset.width` and `.height` are declared
 * OPTIONAL in `document-asset.ts`, whose own header explains why (the module
 * is mime-generic by contract so the same table can serve a later non-image
 * asset type). OOXML needs a concrete extent, and the only ways to invent one
 * are to guess an aspect ratio — a silent visual corruption — or to decode the
 * bytes, which the stored dimensions exist to avoid. The caller falls back to
 * the placeholder.
 */
export function fitExtent(
  dim: { width?: number; height?: number },
  maxWidthEmu: number,
  maxHeightEmu: number,
): Extent | null {
  const { width, height } = dim;
  if (!width || !height || width <= 0 || height <= 0) return null;
  const naturalCx = emuFromPx(width);
  const naturalCy = emuFromPx(height);
  const scale = Math.min(1, maxWidthEmu / naturalCx, maxHeightEmu / naturalCy);
  return {
    cxEmu: Math.max(1, Math.round(naturalCx * scale)),
    cyEmu: Math.max(1, Math.round(naturalCy * scale)),
  };
}

/** One embedded image, as both package builders consume it. */
export type MediaPart = {
  /** Full path inside the package, e.g. `word/media/image1.png`. */
  path: string;
  data: Uint8Array;
  extension: MediaExtension;
  /** Relationship id the drawing references via `r:embed`. */
  relId: string;
};
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/ooxml-media.test.ts --reporter=dot`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/ooxml-media.ts src/app/ooxml-media.test.ts
git commit -m "feat(export): add the OOXML media geometry leaf"
```

---

### Task 2: `document-export-assets.ts` — one regex, one byte loader, one budget

**Files:**
- Create: `src/app/document-export-assets.ts`
- Test: `src/app/document-export-assets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-export-assets.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  documentAssetIds, loadExportAssets, EXPORT_INLINE_BUDGET_BYTES,
} from "./document-export-assets";
import type { ProjectDocument } from "./document-model";

const doc = (html: string[]): ProjectDocument => ({
  id: 1,
  title: "d",
  blocks: html.map((h) => ({ type: "paragraph", html: h })),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

/** `n` KiB of bytes as base64 — length drives the budget arithmetic. */
const b64OfBytes = (n: number) => "A".repeat(Math.ceil((n * 4) / 3));

describe("documentAssetIds", () => {
  it("collects ids in document order, without duplicates", () => {
    const d = doc([
      `<p><img data-asset-id="b" alt=""><img data-asset-id="a" alt=""></p>`,
      `<p><img data-asset-id="b" alt=""></p>`,
    ]);
    expect(documentAssetIds(d)).toEqual(["b", "a"]);
  });

  it("ignores non-paragraph blocks", () => {
    const d: ProjectDocument = {
      ...doc([]),
      blocks: [{ type: "heading", level: 1, text: `<img data-asset-id="x">` }],
    };
    expect(documentAssetIds(d)).toEqual([]);
  });
});

describe("loadExportAssets", () => {
  it("does not touch the byte store for a document with no images", async () => {
    const load = vi.fn();
    const out = await loadExportAssets(doc([`<p>plain</p>`]), load);
    expect(load).not.toHaveBeenCalled();
    expect(out.inlined).toEqual({});
  });

  it("inlines what fits and classifies a null row as missing, not omitted", async () => {
    const load = vi.fn(async (id: string) => (id === "gone" ? null : b64OfBytes(10)));
    const out = await loadExportAssets(
      doc([`<p><img data-asset-id="ok"><img data-asset-id="gone"></p>`]),
      load,
    );
    expect(Object.keys(out.inlined)).toEqual(["ok"]);
    expect([...out.missing]).toEqual(["gone"]);
    expect([...out.omitted]).toEqual([]);
  });

  it("classifies a REJECTED load as missing rather than failing the export", async () => {
    const load = vi.fn(async () => { throw new Error("network"); });
    const out = await loadExportAssets(doc([`<p><img data-asset-id="x"></p>`]), load);
    expect([...out.missing]).toEqual(["x"]);
    expect(out.inlined).toEqual({});
  });

  it("omits past the budget, in document order, and keeps inlining nothing after", async () => {
    // Budget 100 bytes. Three 60-byte images: first fits, the rest do not.
    const load = vi.fn(async () => b64OfBytes(60));
    const out = await loadExportAssets(
      doc([`<p><img data-asset-id="a"><img data-asset-id="b"><img data-asset-id="c"></p>`]),
      load,
      100,
    );
    expect(Object.keys(out.inlined)).toEqual(["a"]);
    expect([...out.omitted].sort()).toEqual(["b", "c"]);
    expect([...out.missing]).toEqual([]);
  });

  it("has a budget expressed in bytes, not images", () => {
    expect(EXPORT_INLINE_BUDGET_BYTES).toBe(25 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/document-export-assets.test.ts --reporter=dot`
Expected: FAIL — cannot resolve `./document-export-assets`.

- [ ] **Step 3: Implement**

```ts
// src/app/document-export-assets.ts — the ONE place an export resolves a
// document's image bytes.
//
// ★★★ THE SPLIT INTO THREE BUCKETS IS THE POINT. "omitted" (we chose not to
// include it, budget) and "missing" (there is no byte row) mean different
// things to whoever opens the exported file. Collapsing omitted into missing
// tells a user their image is lost when it is not; collapsing it into inlined
// blows the budget the bucket exists to enforce.

import type { ProjectDocument } from "./document-model";
import type { AssetByteLoader } from "./document-asset-images";

/**
 * The ONE regex for `<img data-asset-id>`.
 *
 * ★★ It lived as THREE separate copies — one each in doc-render-docx.ts,
 * doc-render-pptx.ts and doc-render-html.ts. Three copies of a pattern that
 * defines a storage format is three chances to fix a bug twice.
 *
 * ★★★ It carries /g, so `lastIndex` is shared state. Use it ONLY with
 * `String.replace` (which resets it) or `String.matchAll` (which clones it).
 * A `.test()` or bare `.exec()` in a loop would carry position between
 * unrelated callers — a bug that only shows up once two of them run in one
 * tick, i.e. in production and never in a focused test.
 */
export const IMG_TAG_RE = /<img\b[^>]*\bdata-asset-id="([^"]*)"[^>]*>/g;

/** Every asset id the document references, in document order, deduplicated.
 *
 *  ★ Order is load-bearing twice over: it numbers the OOXML media parts
 *  deterministically (so the golden comparison is stable) and it decides which
 *  images survive the byte budget. */
export function documentAssetIds(doc: ProjectDocument): string[] {
  const ids: string[] = [];
  for (const block of doc.blocks) {
    // Images live in paragraph HTML only — never in a heading, a table cell or
    // a dataSection (spec, "Out of scope").
    if (block.type !== "paragraph") continue;
    for (const match of block.html.matchAll(IMG_TAG_RE)) {
      const id = match[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Total STORED bytes an export may inline as base64 before it starts omitting.
 *
 *  ★★ A JUDGEMENT CALL, stated as one. The per-document cap is 20 images at
 *  5 MB stored, and base64 inflates by ~33% — so an uncapped worst case is a
 *  single ~133 MB string, which the PDF path then writes into a fresh tab.
 *  25 MB leaves a typical document (a few screenshots) entirely untouched
 *  while making a browser-hanging export impossible. Move it on evidence, not
 *  on taste; it is one constant precisely so that is cheap. */
export const EXPORT_INLINE_BUDGET_BYTES = 25 * 1024 * 1024;

export type ExportAssets = {
  /** id → base64. HTML needs the base64 directly; OOXML decodes it. */
  inlined: Record<string, string>;
  /** Bytes exist but the budget was already spent. A POLICY decision. */
  omitted: ReadonlySet<string>;
  /** No byte row, or the load failed. A DATA problem — the dangling case. */
  missing: ReadonlySet<string>;
};

/** What every renderer gets when there are no images, or no Turso config.
 *
 *  ★ Frozen and shared: it is passed on every export of an image-free
 *  document, and a caller mutating it would poison every later export. */
export const NO_EXPORT_ASSETS: ExportAssets = Object.freeze({
  inlined: Object.freeze({}) as Record<string, string>,
  omitted: new Set<string>(),
  missing: new Set<string>(),
});

/** Base64 length → the byte count it decodes to, without decoding it. */
function decodedByteLength(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Resolve every image a document references.
 *
 * ★★ Fetches in PARALLEL and applies the budget SERIALLY afterwards. The
 * parallel fetch is what makes a 20-image document tolerable — `loadAssetData`
 * is one asset per request by design. The serial pass is what makes the result
 * deterministic: whether an image is inlined must not depend on which network
 * response arrived first.
 *
 * ★★★ A REJECTED LOAD IS `missing`, NEVER A THROW. The byte store is a network
 * call. An export that throws on a flaky connection loses the user's whole
 * document to save one image — so each id is settled independently and a
 * failure is disclosed in the file instead.
 */
export async function loadExportAssets(
  doc: ProjectDocument,
  load: AssetByteLoader,
  budgetBytes: number = EXPORT_INLINE_BUDGET_BYTES,
): Promise<ExportAssets> {
  const ids = documentAssetIds(doc);
  if (ids.length === 0) return NO_EXPORT_ASSETS;

  const fetched = await Promise.all(
    ids.map(async (id) => {
      try {
        return { id, b64: await load(id) };
      } catch {
        return { id, b64: null };
      }
    }),
  );

  const inlined: Record<string, string> = {};
  const omitted = new Set<string>();
  const missing = new Set<string>();
  let spent = 0;

  for (const { id, b64 } of fetched) {
    // ★ An EMPTY string is a present-but-empty row, distinct from an absent
    // one (see loadAssetData's own comment). It costs nothing, inlines, and
    // the renderers' own validity checks then decline it — which lands it back
    // in the missing presentation without this function having to guess.
    if (b64 === null) {
      missing.add(id);
      continue;
    }
    const bytes = decodedByteLength(b64);
    if (spent + bytes > budgetBytes) {
      omitted.add(id);
      continue;
    }
    spent += bytes;
    inlined[id] = b64;
  }

  return { inlined, omitted, missing };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/document-export-assets.test.ts --reporter=dot`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/document-export-assets.ts src/app/document-export-assets.test.ts
git commit -m "feat(export): resolve a document's asset bytes into three buckets"
```

---

### Task 3: Point the three renderers at the shared regex

Pure de-duplication, no behaviour change. Doing it now means later tasks touch one definition.

**Files:**
- Modify: `src/app/doc-render-docx.ts:72`, `src/app/doc-render-html.ts:185`, `src/app/doc-render-pptx.ts:205`

- [ ] **Step 1: Delete each local declaration and import the shared one**

In all three files, delete the line

```ts
const IMG_TAG_RE = /<img\b[^>]*\bdata-asset-id="([^"]*)"[^>]*>/g;
```

and add to that file's imports:

```ts
import { IMG_TAG_RE } from "./document-export-assets";
```

Keep each file's surrounding comment about *why* the substitution exists — that is per-renderer reasoning, not shared.

- [ ] **Step 2: Prove nothing moved**

Run:
```bash
npx vitest run src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts src/app/doc-render-html.test.ts src/app/export-ooxml.test.ts --reporter=dot
```
Expected: PASS, no snapshot or fixture diff. A red `export-ooxml` here means the regex was not identical after all — investigate, do not regenerate.

- [ ] **Step 3: Confirm only one definition survives**

Run: `git grep -c "IMG_TAG_RE = " -- src/app`
Expected: exactly one file, `src/app/document-export-assets.ts`.

- [ ] **Step 4: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
git add src/app/doc-render-docx.ts src/app/doc-render-html.ts src/app/doc-render-pptx.ts
git commit -m "refactor(export): one img-tag regex, not three copies"
```

---

### Task 4: A bytes-preserving unzip for tests

The existing helper in `export-ooxml.test.ts` decodes every part with `TextDecoder`, so it can never byte-compare an image.

**Files:**
- Create: `src/test/unzip-bytes.ts`
- Test: `src/test/unzip-bytes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/unzip-bytes.test.ts
import { describe, it, expect } from "vitest";
import { buildZip } from "../app/zip";
import { unzipBytes } from "./unzip-bytes";

describe("unzipBytes", () => {
  it("round-trips binary that is not valid UTF-8", async () => {
    // 0xFF 0xFE 0x00 is invalid UTF-8 — TextDecoder would replace it with
    // U+FFFD, which is exactly why the text helper cannot check an image.
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x41, 0x89, 0x50]);
    const blob = buildZip([{ path: "media/image1.png", data: bytes }], "application/zip");
    const parts = await unzipBytes(blob);
    expect(Array.from(parts.get("media/image1.png")!)).toEqual(Array.from(bytes));
  });

  it("returns every entry", async () => {
    const blob = buildZip(
      [{ path: "a.xml", data: "<a/>" }, { path: "b/c.bin", data: new Uint8Array([1, 2]) }],
      "application/zip",
    );
    const parts = await unzipBytes(blob);
    expect([...parts.keys()].sort()).toEqual(["a.xml", "b/c.bin"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/test/unzip-bytes.test.ts --reporter=dot`
Expected: FAIL — cannot resolve `./unzip-bytes`.

- [ ] **Step 3: Implement**

```ts
// src/test/unzip-bytes.ts — TEST-ONLY. Read a STORE-only ZIP Blob back as raw
// bytes per part.
//
// ★★ `export-ooxml.test.ts` has a sibling helper that decodes every part with
// TextDecoder. That is right for XML and USELESS for an image: invalid UTF-8
// becomes U+FFFD, so a byte-comparison against the original would fail for
// correct output and pass for some wrong output. Media assertions use THIS one.

/**
 * jsdom's Blob shim omits `.arrayBuffer()`, and Node's Blob cannot wrap a jsdom
 * Blob as a BlobPart (it serialises to "[object Blob]"). FileReader is the one
 * path both shims implement — same reasoning as `export-ooxml.test.ts`.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const LOCAL_FILE_HEADER = 0x04034b50;

export async function unzipBytes(blob: Blob): Promise<Map<string, Uint8Array>> {
  const buf = await blobToArrayBuffer(blob);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  const files = new Map<string, Uint8Array>();

  let offset = 0;
  while (offset + 30 < buf.byteLength) {
    if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER) break;
    const fnLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const name = dec.decode(bytes.slice(nameStart, nameStart + fnLen));
    const dataStart = nameStart + fnLen + extraLen;
    files.set(name, bytes.slice(dataStart, dataStart + compSize));
    offset = dataStart + compSize;
  }
  return files;
}

/** Decode one part as UTF-8 — for asserting on XML alongside binary parts. */
export function partText(parts: Map<string, Uint8Array>, path: string): string {
  const part = parts.get(path);
  if (!part) throw new Error(`no such part: ${path} (have: ${[...parts.keys()].join(", ")})`);
  return new TextDecoder().decode(part);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/test/unzip-bytes.test.ts --reporter=dot`
Expected: PASS, 2 tests.

- [ ] **Step 5: Confirm it raises no coverage floor**

`vitest.config.ts` `coverage.include` is `src/**`, and `src/test/**` is a test helper. Check it is excluded, and add it to `coverage.exclude` if not:

Run: `grep -n "coverage" -A 20 vitest.config.ts | grep -n "exclude" -A 10`
Expected: `src/test/**` already listed. If it is not, add it in the same commit.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/test/unzip-bytes.ts src/test/unzip-bytes.test.ts
git commit -m "test: add a bytes-preserving unzip helper"
```

---

### Task 5: `buildDocxPackage` accepts media parts

**Files:**
- Modify: `src/app/ooxml-docx-primitives.ts` (`buildDocxPackage`, around line 520)
- Test: `src/app/ooxml-docx-primitives.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/app/ooxml-docx-primitives.test.ts
import { unzipBytes, partText } from "../test/unzip-bytes";
import type { MediaPart } from "./ooxml-media";

describe("buildDocxPackage media parts", () => {
  const png: MediaPart = {
    path: "word/media/image1.png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    extension: "png",
    relId: "rId2",
  };

  it("is byte-identical to the no-argument call when media is empty", async () => {
    const a = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait"));
    const b = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", []));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [path, bytes] of a) {
      expect(Array.from(b.get(path)!)).toEqual(Array.from(bytes));
    }
    // And the empty case adds NO image machinery at all.
    expect(partText(a, "[Content_Types].xml")).not.toContain("image/");
    expect(partText(a, "word/_rels/document.xml.rels")).not.toContain("/image");
  });

  it("writes the part bytes verbatim", async () => {
    const parts = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", [png]));
    expect(Array.from(parts.get("word/media/image1.png")!)).toEqual(Array.from(png.data));
  });

  it("declares the extension and relates the id to the part", async () => {
    const parts = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", [png]));
    expect(partText(parts, "[Content_Types].xml"))
      .toContain(`<Default Extension="png" ContentType="image/png"/>`);
    const rels = partText(parts, "word/_rels/document.xml.rels");
    expect(rels).toContain(`Id="rId2"`);
    expect(rels).toContain(`Target="media/image1.png"`);
    // The styles relationship must survive unshifted.
    expect(rels).toContain(`Id="rId1"`);
    expect(rels).toContain(`Target="styles.xml"`);
  });

  it("declares each extension ONCE even with several images of that type", async () => {
    const second: MediaPart = { ...png, path: "word/media/image2.png", relId: "rId3" };
    const parts = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", [png, second]));
    const types = partText(parts, "[Content_Types].xml");
    expect(types.match(/<Default Extension="png"/g)).toHaveLength(1);
  });

  it("refuses rId1, which would silently detach the styles part", () => {
    expect(() => buildDocxPackage("<w:p/>", "", "portrait", [{ ...png, relId: "rId1" }]))
      .toThrow(/rId1/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/ooxml-docx-primitives.test.ts --reporter=dot`
Expected: FAIL — `buildDocxPackage` takes 3 arguments; the media assertions find nothing.

- [ ] **Step 3: Implement**

Add the import at the top of `src/app/ooxml-docx-primitives.ts`:

```ts
import { contentTypeFor, type MediaPart } from "./ooxml-media";
```

Change the signature and the three derived strings:

```ts
export function buildDocxPackage(
  bodyXml: string,
  extraStyles = "",
  page: DocxPageLayout = "landscape",
  /** ★★★ ADDITIVE BY CONTRACT. The workspace exporter calls this with two or
   *  three arguments and its bytes are PINNED by the export-ooxml golden
   *  suite, so an empty array must add no Default entry, no part and no
   *  relationship. If that suite goes red for this slice, the contract broke —
   *  do not regenerate the fixture. */
  media: readonly MediaPart[] = [],
): Blob {
  // ★★ Relationship ids are minted by the CALLER, because the body XML already
  // references them by the time it gets here. rId1 is the styles part; a media
  // part claiming it would replace styles with an image and Word would open a
  // document with no Title style and no error. Cheap to assert, invisible
  // otherwise.
  for (const part of media) {
    if (part.relId === "rId1") {
      throw new Error(`media relId "rId1" is reserved for the styles part (${part.path})`);
    }
  }

  // ... documentXml and stylesXml unchanged ...

  const mediaDefaults = [...new Set(media.map((m) => m.extension))]
    .map((ext) => `\n  <Default Extension="${ext}" ContentType="${contentTypeFor(ext)}"/>`)
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${mediaDefaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  // ... rootRels unchanged ...

  const mediaRels = media
    .map(
      (m) =>
        `\n  <Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.path.slice("word/media/".length)}"/>`,
    )
    .join("");

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${mediaRels}
</Relationships>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "word/_rels/document.xml.rels", data: docRels },
    { path: "word/document.xml", data: documentXml },
    { path: "word/styles.xml", data: stylesXml },
    ...media.map((m) => ({ path: m.path, data: m.data })),
  ];

  return buildZip(
    entries,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}
```

- [ ] **Step 4: Run the tests, including the golden guard**

Run:
```bash
npx vitest run src/app/ooxml-docx-primitives.test.ts src/app/export-ooxml.test.ts --reporter=dot
```
Expected: PASS. **`export-ooxml.test.ts` must be green without touching a fixture** — that is the whole point of the empty-media contract.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/ooxml-docx-primitives.ts src/app/ooxml-docx-primitives.test.ts
git commit -m "feat(export): let a docx package carry media parts"
```

---

### Task 6: `docxInlineDrawing` — the WordprocessingML for one image

**Files:**
- Modify: `src/app/ooxml-docx-primitives.ts`
- Test: `src/app/ooxml-docx-primitives.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/app/ooxml-docx-primitives.test.ts
describe("docxInlineDrawing", () => {
  it("embeds by relationship id and sizes in EMU", () => {
    const xml = docxInlineDrawing({
      relId: "rId2", id: 7, name: "image1.png", descr: "A chart",
      extent: { cxEmu: 914400, cyEmu: 457200 },
    });
    expect(xml).toContain(`r:embed="rId2"`);
    expect(xml).toContain(`<wp:extent cx="914400" cy="457200"/>`);
    expect(xml).toContain(`<a:ext cx="914400" cy="457200"/>`);
  });

  it("escapes the description, which is user-supplied", () => {
    const xml = docxInlineDrawing({
      relId: "rId2", id: 7, name: "image1.png", descr: `a "&" <b>`,
      extent: { cxEmu: 1, cyEmu: 1 },
    });
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain(`<b>`);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/ooxml-docx-primitives.test.ts -t docxInlineDrawing --reporter=dot`
Expected: FAIL — `docxInlineDrawing is not defined`.

- [ ] **Step 3: Implement**

```ts
/** One embedded image as an inline drawing, ready to sit inside a `<w:r>`.
 *
 *  ★ `descr` is what Word exposes as alt text, so the asset's name goes there
 *  rather than being dropped — an image with no alternative text is a WCAG
 *  1.1.1 failure in the exported document, and nothing downstream can add it.
 *
 *  ★★ `name` and `descr` are both escaped. `name` is derived from the asset id
 *  (a UUID) and is safe today, but an XML attribute assembled by
 *  interpolation is exactly the shape that stops being safe when someone later
 *  passes the user-supplied asset name. */
export function docxInlineDrawing(opts: {
  relId: string;
  /** Unique within the document — Word tolerates duplicates, Pages does not. */
  id: number;
  name: string;
  descr: string;
  extent: Extent;
}): string {
  const { relId, id, name, descr, extent } = opts;
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <wp:extent cx="${extent.cxEmu}" cy="${extent.cyEmu}"/>
  <wp:docPr id="${id}" name="${xmlEscape(name)}" descr="${xmlEscape(descr)}"/>
  <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:nvPicPr>
          <pic:cNvPr id="${id}" name="${xmlEscape(name)}" descr="${xmlEscape(descr)}"/>
          <pic:cNvPicPr/>
        </pic:nvPicPr>
        <pic:blipFill>
          <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>
          <a:stretch><a:fillRect/></a:stretch>
        </pic:blipFill>
        <pic:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent.cxEmu}" cy="${extent.cyEmu}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </pic:spPr>
      </pic:pic>
    </a:graphicData>
  </a:graphic>
</wp:inline></w:drawing>`;
}
```

Add `import { contentTypeFor, type Extent, type MediaPart } from "./ooxml-media";` (extending Task 5's import).

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/ooxml-docx-primitives.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Check the size ratchet before committing**

Run:
```bash
node -e "console.log(require('fs').readFileSync('src/app/ooxml-docx-primitives.ts','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
```
Expected: under 800 and `EXIT=0`. If it is over, extract the drawing builder into `src/app/ooxml-docx-drawing.ts` rather than trimming comments.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/ooxml-docx-primitives.ts src/app/ooxml-docx-primitives.test.ts
git commit -m "feat(export): render one image as a docx inline drawing"
```

---

### Task 7: DOCX renderer — split paragraphs around inlined images

**Files:**
- Modify: `src/app/doc-render-docx.ts`
- Test: `src/app/doc-render-docx.test.ts`

★★★ Read this before writing code: a `<w:drawing>` blob **cannot** be substituted into the raw HTML the way the placeholder is. `docxRichParagraphs` feeds that HTML to `htmlToRichLines`, which parses it with DOMParser — XML put through an HTML parse is mangled. So the paragraph is split: html segments go through `docxRichParagraphs` unchanged (still carrying the placeholder substitution), and each **inlined** image becomes its own `<w:p>`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/app/doc-render-docx.test.ts
import { unzipBytes, partText } from "../test/unzip-bytes";
import { NO_EXPORT_ASSETS, type ExportAssets } from "./document-export-assets";

const PNG_B64 = "iVBORw0KGgo="; // 8 header bytes, enough to byte-compare

function docWith(html: string): ProjectDocument {
  return {
    id: 1, title: "T", blocks: [{ type: "paragraph", html }],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const wsWithAsset = (over: Partial<DocumentAsset> = {}): Workspace => ({
  ...emptyWorkspace(),
  documentAssets: [{
    id: "a1", name: "chart.png", mime: "image/png", size: 8,
    width: 480, height: 240, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  }],
});

describe("renderDocumentDocx images", () => {
  it("embeds an inlined image as a media part whose bytes match", async () => {
    const assets: ExportAssets = { inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() };
    const blob = renderDocumentDocx(
      docWith(`<p><img data-asset-id="a1" alt="chart"></p>`), wsWithAsset(), "en-US", assets,
    );
    const parts = await unzipBytes(blob);
    const media = [...parts.keys()].filter((p) => p.startsWith("word/media/"));
    expect(media).toHaveLength(1);
    expect(Array.from(parts.get(media[0])!)).toEqual(Array.from(base64ToBytes(PNG_B64)));

    // The drawing references a relationship that resolves to that part.
    const doc = partText(parts, "word/document.xml");
    const relId = doc.match(/r:embed="(rId\d+)"/)?.[1];
    expect(relId).toBeTruthy();
    const rels = partText(parts, "word/_rels/document.xml.rels");
    expect(rels).toContain(`Id="${relId}"`);
    expect(rels).toContain(`Target="media/${media[0].slice("word/media/".length)}"`);
  });

  it("keeps the placeholder when the asset was OMITTED by the budget", async () => {
    const assets: ExportAssets = { inlined: {}, omitted: new Set(["a1"]), missing: new Set() };
    const parts = await unzipBytes(renderDocumentDocx(
      docWith(`<p><img data-asset-id="a1"></p>`), wsWithAsset(), "en-US", assets,
    ));
    expect([...parts.keys()].some((p) => p.startsWith("word/media/"))).toBe(false);
    expect(partText(parts, "word/document.xml")).toContain("chart.png");
  });

  it("keeps the placeholder when the asset has NO stored dimensions", async () => {
    const assets: ExportAssets = { inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() };
    const ws = wsWithAsset({ width: undefined, height: undefined });
    const parts = await unzipBytes(renderDocumentDocx(
      docWith(`<p><img data-asset-id="a1"></p>`), ws, "en-US", assets,
    ));
    // OOXML needs a concrete extent; guessing one would stretch the image.
    expect([...parts.keys()].some((p) => p.startsWith("word/media/"))).toBe(false);
    expect(partText(parts, "word/document.xml")).toContain("chart.png");
  });

  it("keeps the text either side of an inlined image, in order", async () => {
    const assets: ExportAssets = { inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() };
    const parts = await unzipBytes(renderDocumentDocx(
      docWith(`<p>before<img data-asset-id="a1">after</p>`), wsWithAsset(), "en-US", assets,
    ));
    const doc = partText(parts, "word/document.xml");
    expect(doc.indexOf("before")).toBeLessThan(doc.indexOf("<w:drawing>"));
    expect(doc.indexOf("<w:drawing>")).toBeLessThan(doc.indexOf("after"));
  });

  it("renders unchanged when no assets are passed at all", async () => {
    const a = await unzipBytes(renderDocumentDocx(docWith(`<p>x</p>`), emptyWorkspace(), "en-US"));
    const b = await unzipBytes(
      renderDocumentDocx(docWith(`<p>x</p>`), emptyWorkspace(), "en-US", NO_EXPORT_ASSETS),
    );
    expect(partText(a, "word/document.xml")).toBe(partText(b, "word/document.xml"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/doc-render-docx.test.ts --reporter=dot`
Expected: FAIL — `renderDocumentDocx` takes 3 arguments and emits no media.

- [ ] **Step 3: Implement**

```ts
// src/app/doc-render-docx.ts — additions

import { IMG_TAG_RE, NO_EXPORT_ASSETS, type ExportAssets } from "./document-export-assets";
import { fitExtent, mediaExtension, type MediaPart } from "./ooxml-media";
import { base64ToBytes, ASSET_MIME_ALLOWED } from "./document-asset-upload";
import { docxInlineDrawing } from "./ooxml-docx-primitives";
import type { DocumentAsset } from "./document-asset";

/** Mints one media part per inlined image, numbering parts and relationship
 *  ids in document order.
 *
 *  ★★ Relationship ids start at rId2 — rId1 is the styles part, and
 *  `buildDocxPackage` throws if a media part claims it. */
function createMediaMinter(assets: ExportAssets, byId: ReadonlyMap<string, DocumentAsset>) {
  const parts: MediaPart[] = [];

  /** Returns the drawing run for `id`, or null to fall through to the
   *  placeholder. Null covers every reason an image cannot be embedded:
   *  not inlined (omitted or missing), no metadata row, a mime outside the
   *  upload allow-list, or absent stored dimensions. */
  function drawingFor(id: string): string | null {
    const b64 = assets.inlined[id];
    if (!b64) return null;
    const meta = byId.get(id);
    if (!meta) return null;
    if (!(ASSET_MIME_ALLOWED as readonly string[]).includes(meta.mime)) return null;
    const ext = mediaExtension(meta.mime);
    if (!ext) return null;
    const extent = fitExtent(meta, CONTENT_WIDTH, MAX_IMAGE_HEIGHT_EMU);
    if (!extent) return null;

    const index = parts.length + 1;
    const relId = `rId${index + 1}`;
    parts.push({
      // ★ The part name derives from the INDEX, never from the asset's
      // user-supplied name — a name must never become a zip path.
      path: `word/media/image${index}.${ext}`,
      data: base64ToBytes(b64),
      extension: ext,
      relId,
    });
    return `<w:r>${docxInlineDrawing({
      relId,
      id: index,
      name: `image${index}.${ext}`,
      descr: meta.name,
      extent,
    })}</w:r>`;
  }

  return { drawingFor, parts };
}

/** A page is 11in tall less 1in of margins; cap an image at roughly half of
 *  that so a portrait photo cannot push every following paragraph off the
 *  page. Derived from the same layout `CONTENT_WIDTH` comes from. */
const MAX_IMAGE_HEIGHT_EMU = Math.round(4.5 * 914400);

/** One paragraph block, split around every image that will actually embed.
 *
 *  ★★★ THE SPLIT IS FORCED, not stylistic. `docxRichParagraphs` parses its
 *  argument with DOMParser (via `htmlToRichLines`), so a `<w:drawing>` blob
 *  substituted into the HTML would be mangled by the HTML parse. Only TEXT can
 *  go in before the parse — which is exactly why the placeholder branch may
 *  stay where it is.
 *
 *  ★★ Consequence, accepted: an image that sat inline with text gets its own
 *  paragraph. The block editor inserts images as image-only paragraphs, so the
 *  shape the product actually produces is unaffected. */
function paragraphBlock(
  html: string,
  assetNames: ReadonlyMap<string, string>,
  lang: Lang,
  drawingFor: (id: string) => string | null,
): string {
  const out: string[] = [];
  let last = 0;

  for (const match of html.matchAll(IMG_TAG_RE)) {
    const drawing = drawingFor(match[1]);
    // Not embeddable: leave the tag in the segment so the placeholder pass
    // substitutes it exactly as it does today.
    if (!drawing) continue;
    const before = html.slice(last, match.index);
    if (before.trim()) out.push(docxRichParagraphs(withImagePlaceholders(before, assetNames, lang)));
    out.push(`<w:p>${drawing}</w:p>`);
    last = match.index + match[0].length;
  }

  const rest = html.slice(last);
  // The `out.length === 0` arm keeps an image-free paragraph byte-identical to
  // what this file produced before the split existed.
  if (rest.trim() || out.length === 0) {
    out.push(docxRichParagraphs(withImagePlaceholders(rest, assetNames, lang)));
  }
  return out.join("");
}
```

Then change `renderBlock`'s paragraph arm to call `paragraphBlock(block.html, assetNames, lang, drawingFor)`, thread `drawingFor` through `renderBlock`, and change the entry point:

```ts
export function renderDocumentDocx(
  doc: ProjectDocument,
  ws: Workspace,
  lang: Lang,
  assets: ExportAssets = NO_EXPORT_ASSETS,
): Blob {
  const list = ws.documentAssets ?? [];
  const assetNames = new Map(list.map((a) => [a.id, a.name]));
  const byId = new Map(list.map((a) => [a.id, a]));
  const { drawingFor, parts } = createMediaMinter(assets, byId);

  const body =
    para(doc.title, "Title") +
    doc.blocks.map((b) => renderBlock(b, ws, lang, assetNames, drawingFor)).join("");

  // ★ `parts` is populated BY the body render above — read it after, never
  // before. Building the package first would ship an empty media list.
  return buildDocxPackage(body, DOC_STYLES, PAGE, parts);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/doc-render-docx.test.ts src/app/export-ooxml.test.ts --reporter=dot`
Expected: PASS, including every pre-existing placeholder test unchanged.

- [ ] **Step 5: Mutation-check the dimension guard**

Temporarily change `if (!extent) return null;` to `if (false) return null;` and re-run. Expected: the "NO stored dimensions" test goes RED. Revert the mutation before committing.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
git add src/app/doc-render-docx.ts src/app/doc-render-docx.test.ts
git commit -m "feat(export): embed real images in the docx renderer"
```

---

### Task 8: `pptxPicture` — the PresentationML for one image

**Files:**
- Modify: `src/app/ooxml-pptx-primitives.ts`
- Test: `src/app/ooxml-pptx-primitives.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/app/ooxml-pptx-primitives.test.ts
describe("pptxPicture", () => {
  it("places and sizes the shape and embeds by relationship id", () => {
    const xml = pptxPicture({
      id: 4, name: "image1.png", descr: "A chart", relId: "rId2",
      xEmu: 457200, yEmu: 1188720, cxEmu: 914400, cyEmu: 457200,
    });
    expect(xml).toContain(`r:embed="rId2"`);
    expect(xml).toContain(`<a:off x="457200" y="1188720"/>`);
    expect(xml).toContain(`<a:ext cx="914400" cy="457200"/>`);
    expect(xml).toContain(`noChangeAspect="1"`);
  });

  it("escapes the description", () => {
    const xml = pptxPicture({
      id: 4, name: "i.png", descr: `a & <b>`, relId: "rId2",
      xEmu: 0, yEmu: 0, cxEmu: 1, cyEmu: 1,
    });
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain("<b>");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/ooxml-pptx-primitives.test.ts -t pptxPicture --reporter=dot`
Expected: FAIL — `pptxPicture is not defined`.

- [ ] **Step 3: Implement**

```ts
/** One embedded image as a `<p:pic>` shape.
 *
 *  ★ `descr` is PowerPoint's alt text. The asset name goes there so the
 *  exported deck is not a wall of undescribed images.
 *
 *  ★★ `noChangeAspect` stops a user's first drag from stretching the picture —
 *  the extent is already aspect-correct from `fitExtent`, and without this
 *  PowerPoint lets a corner handle distort it. */
export function pptxPicture(opts: {
  id: number;
  name: string;
  descr: string;
  relId: string;
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
}): string {
  return `<p:pic>
  <p:nvPicPr>
    <p:cNvPr id="${opts.id}" name="${xmlEscape(opts.name)}" descr="${xmlEscape(opts.descr)}"/>
    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
    <p:nvPr/>
  </p:nvPicPr>
  <p:blipFill>
    <a:blip r:embed="${opts.relId}"/>
    <a:stretch><a:fillRect/></a:stretch>
  </p:blipFill>
  <p:spPr>
    <a:xfrm>
      <a:off x="${opts.xEmu}" y="${opts.yEmu}"/>
      <a:ext cx="${opts.cxEmu}" cy="${opts.cyEmu}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
  </p:spPr>
</p:pic>`;
}
```

`wrapPptxSlide` already declares the `r:` namespace on `<p:sld>`, so `r:embed` needs no local declaration here.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/ooxml-pptx-primitives.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/ooxml-pptx-primitives.ts src/app/ooxml-pptx-primitives.test.ts
git commit -m "feat(export): render one image as a pptx picture shape"
```

---

### Task 9: `buildPptxPackage` takes per-slide media

Today every slide shares one `_rels` part. Image relationships are per-slide, so that has to end.

**Files:**
- Modify: `src/app/ooxml-pptx-primitives.ts` (`buildPptxPackage`), `src/app/doc-render-pptx.ts` (call site), `src/app/export-pptx.ts` if it calls it
- Test: `src/app/ooxml-pptx-primitives.test.ts`

- [ ] **Step 1: Find every caller first**

Run: `git grep -n "buildPptxPackage(" -- src | grep -v "\.test\."`
Expected: the declaration plus each production caller. Every one must be updated in this task — a missed caller is a tsc error, not a silent bug, but find them before editing.

- [ ] **Step 2: Write the failing test**

```ts
// append to src/app/ooxml-pptx-primitives.test.ts
import { unzipBytes, partText } from "../test/unzip-bytes";

describe("buildPptxPackage media", () => {
  const png = {
    path: "ppt/media/image1.png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    extension: "png" as const,
    relId: "rId2",
  };

  it("gives a media-free deck the same parts as before", async () => {
    const parts = await unzipBytes(buildPptxPackage([{ xml: "<p:sld/>", media: [] }]));
    expect(partText(parts, "ppt/slides/_rels/slide1.xml.rels"))
      .toContain("slideLayout1.xml");
    expect(partText(parts, "[Content_Types].xml")).not.toContain("image/");
  });

  it("writes per-slide rels so slide 2's image is not visible to slide 1", async () => {
    const parts = await unzipBytes(buildPptxPackage([
      { xml: "<p:sld/>", media: [] },
      { xml: "<p:sld/>", media: [png] },
    ]));
    expect(partText(parts, "ppt/slides/_rels/slide1.xml.rels")).not.toContain("rId2");
    const rels2 = partText(parts, "ppt/slides/_rels/slide2.xml.rels");
    expect(rels2).toContain(`Id="rId2"`);
    expect(rels2).toContain(`Target="../media/image1.png"`);
    // rId1 stays the layout on every slide.
    expect(rels2).toContain("slideLayout1.xml");
  });

  it("writes the bytes verbatim and declares the extension once", async () => {
    const parts = await unzipBytes(buildPptxPackage([{ xml: "<p:sld/>", media: [png] }]));
    expect(Array.from(parts.get("ppt/media/image1.png")!)).toEqual(Array.from(png.data));
    const types = partText(parts, "[Content_Types].xml");
    expect(types.match(/<Default Extension="png"/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/app/ooxml-pptx-primitives.test.ts -t "buildPptxPackage media" --reporter=dot`
Expected: FAIL — the function takes `string[]`.

- [ ] **Step 4: Implement**

```ts
/** One slide and the images it references. */
export type PptxSlide = { xml: string; media: readonly MediaPart[] };

export function buildPptxPackage(slides: readonly PptxSlide[]): Blob {
  // ★★ rId1 is the slide layout on EVERY slide, so media ids start at rId2 and
  // are numbered within the slide, not across the deck.
  for (const slide of slides) {
    for (const part of slide.media) {
      if (part.relId === "rId1") {
        throw new Error(`media relId "rId1" is reserved for the slide layout (${part.path})`);
      }
    }
  }

  const allMedia = slides.flatMap((s) => [...s.media]);
  const mediaDefaults = [...new Set(allMedia.map((m) => m.extension))]
    .map((ext) => `\n  <Default Extension="${ext}" ContentType="${contentTypeFor(ext)}"/>`)
    .join("");

  const slideOverrides = slides
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");

  // contentTypes: insert ${mediaDefaults} immediately after the `rels` Default,
  // exactly as the docx builder does. Everything else in this function's
  // static parts is unchanged; only `slideXmls` becomes `slides`, read as
  // `slides[i].xml`.

  // Per-slide rels — layout first, then this slide's images.
  const slideRelsFor = (slide: PptxSlide): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${slide.media
    .map(
      (m) =>
        `\n  <Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.path.slice("ppt/media/".length)}"/>`,
    )
    .join("")}
</Relationships>`;

  // ... then, in the entries loop:
  for (let i = 0; i < slides.length; i++) {
    entries.push({ path: `ppt/slides/slide${i + 1}.xml`, data: slides[i].xml });
    entries.push({ path: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRelsFor(slides[i]) });
  }
  for (const part of allMedia) entries.push({ path: part.path, data: part.data });
}
```

★★ Media part paths must be unique **across the deck**, not per slide — they all land in one `ppt/media/` directory. Task 10 numbers them deck-wide for that reason.

Update every caller found in Step 1 to pass `{ xml, media: [] }`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/ooxml-pptx-primitives.test.ts src/app/doc-render-pptx.test.ts src/app/export-ooxml.test.ts --reporter=dot`
Expected: PASS with no fixture change.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/ooxml-pptx-primitives.ts src/app/doc-render-pptx.ts
git commit -m "feat(export): give each pptx slide its own relationships"
```

---

### Task 10: PPTX — image lines, cost-based pagination, placed pictures

**Files:**
- Modify: `src/app/doc-render-pptx.ts`
- Test: `src/app/doc-render-pptx.test.ts`

- [ ] **Step 1: Write the failing test for pagination alone**

```ts
// append to src/app/doc-render-pptx.test.ts
import { paginateLines, lineCost, type SlideLine } from "./doc-render-pptx";

const img = (heightEmu: number): SlideLine => ({ kind: "image", id: "a1", cxEmu: 100, cyEmu: heightEmu });

describe("cost-based paginateLines", () => {
  it("still costs a text line as one", () => {
    expect(lineCost("hello")).toBe(1);
  });

  it("costs an image by its height in line-heights", () => {
    // One line of body text is BODY_SIZE/100 * LINE_SPACING points, in EMU.
    const oneLine = (1400 / 100) * 1.2 * 12700;
    expect(lineCost(img(oneLine))).toBe(1);
    expect(lineCost(img(oneLine * 2.1))).toBe(3);
  });

  it("breaks the slide when an image no longer fits", () => {
    const oneLine = (1400 / 100) * 1.2 * 12700;
    // Budget 4. Three text lines, then an image costing 2: the image moves on.
    const chunks = paginateLines(["a", "b", "c", img(oneLine * 2)], 4);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual(["a", "b", "c"]);
    expect(chunks[1]).toHaveLength(1);
  });

  it("puts an over-budget image on a slide of its own instead of looping", () => {
    const oneLine = (1400 / 100) * 1.2 * 12700;
    const chunks = paginateLines([img(oneLine * 500), "after"], 4);
    // The image is capped to the body box, so its cost can never exceed the
    // budget — without that cap this call would not terminate.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.flat()).toHaveLength(2);
  });

  it("keeps the existing text-only behaviour exactly", () => {
    expect(paginateLines(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(paginateLines([], 2)).toEqual([[]]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/doc-render-pptx.test.ts -t "cost-based" --reporter=dot`
Expected: FAIL — `lineCost` is not exported and the image shape is not a `SlideLine`.

- [ ] **Step 3: Implement the line model and pagination**

```ts
// src/app/doc-render-pptx.ts — changes

/** An image on its way to a slide. Extents are already fitted and CAPPED to
 *  the body box by `slideLines`, so `cyEmu` can never exceed one slide. */
export type ImageLine = { kind: "image"; id: string; cxEmu: number; cyEmu: number };

export type SlideLine = string | RichLine | ImageLine;

function isImageLine(line: SlideLine): line is ImageLine {
  return typeof line === "object" && "kind" in line && line.kind === "image";
}

/** Height of one body line in EMU, from the SAME arithmetic that yields
 *  BODY_LINES_PER_SLIDE — so there is one number to change, not two. */
const BODY_LINE_EMU = (BODY_SIZE / 100) * LINE_SPACING * EMU_PER_POINT;

/**
 * What one line costs against a slide's budget.
 *
 * ★★★ The image is CAPPED to the body box before this is called, so its cost
 * is at most `BODY_LINES_PER_SLIDE`. Without that cap an oversized image costs
 * more than any budget, every chunk comes out empty, and `paginateLines` does
 * not terminate.
 */
export function lineCost(line: SlideLine): number {
  return isImageLine(line) ? Math.max(1, Math.ceil(line.cyEmu / BODY_LINE_EMU)) : 1;
}

export function paginateLines(lines: readonly SlideLine[], perSlide: number): SlideLine[][] {
  if (lines.length === 0) return [[]];
  const chunks: SlideLine[][] = [];
  let current: SlideLine[] = [];
  let spent = 0;

  for (const line of lines) {
    const cost = lineCost(line);
    if (current.length > 0 && spent + cost > perSlide) {
      chunks.push(current);
      current = [];
      spent = 0;
    }
    // A gap between blocks is typography mid-slide and dead space at the top
    // of a continuation, so drop a blank that a break left leading.
    if (current.length === 0 && !isImageLine(line) && isBlankLine(line)) continue;
    current.push(line);
    spent += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}
```

`slideLineText` and `isBlankLine` must return `""`/`false` for an image line — add an `isImageLine` early return to each.

- [ ] **Step 4: Run the pagination tests**

Run: `npx vitest run src/app/doc-render-pptx.test.ts --reporter=dot`
Expected: PASS, including every pre-existing pagination test.

- [ ] **Step 5: Write the failing test for placement**

```ts
// append to src/app/doc-render-pptx.test.ts
describe("renderDocumentPptx images", () => {
  it("places a picture below the body text and embeds its bytes", async () => {
    const assets: ExportAssets = { inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() };
    const parts = await unzipBytes(renderDocumentPptx(
      docWith(`<p>intro<img data-asset-id="a1"></p>`), wsWithAsset(), "en-US", assets,
    ));
    const media = [...parts.keys()].filter((p) => p.startsWith("ppt/media/"));
    expect(media).toHaveLength(1);
    expect(Array.from(parts.get(media[0])!)).toEqual(Array.from(base64ToBytes(PNG_B64)));

    // Slide 2 is the first content slide (slide 1 is the title slide).
    const slide = partText(parts, "ppt/slides/slide2.xml");
    const y = Number(slide.match(/<p:pic>[\s\S]*?<a:off x="\d+" y="(\d+)"/)![1]);
    expect(y).toBeGreaterThan(1188720); // below BODY_BOX's top edge
  });

  it("keeps the placeholder for an omitted asset and writes no media part", async () => {
    const assets: ExportAssets = { inlined: {}, omitted: new Set(["a1"]), missing: new Set() };
    const parts = await unzipBytes(renderDocumentPptx(
      docWith(`<p><img data-asset-id="a1"></p>`), wsWithAsset(), "en-US", assets,
    ));
    expect([...parts.keys()].some((p) => p.startsWith("ppt/media/"))).toBe(false);
    expect(partText(parts, "ppt/slides/slide2.xml")).toContain("chart.png");
  });
});
```

- [ ] **Step 6: Implement placement**

In `blockLines`, when a paragraph's HTML contains an image that **is** inlined and sizable, emit an `ImageLine` instead of leaving the tag for `withImagePlaceholders`; cap its extent with
`fitExtent(meta, BODY_BOX.cxEmu, BODY_BOX.cyEmu)`.

In `buildContentSlide`, after the body text box, place one `pptxPicture` per image line:

```ts
// Shape ids 2 and 3 are the title and body; pictures continue from 4.
let shapeId = 4;
let yEmu = BODY_BOX.yEmu + textLineCount * BODY_LINE_EMU;
const pictures = imageLines.map((line) => {
  const part = mintPart(line.id);           // adds to this slide's media
  const xml = pptxPicture({
    id: shapeId++,
    name: part.path.slice("ppt/media/".length),
    descr: assetNames.get(line.id) ?? line.id,
    relId: part.relId,
    xEmu: BODY_BOX.xEmu + Math.round((BODY_BOX.cxEmu - line.cxEmu) / 2),
    yEmu,
    cxEmu: line.cxEmu,
    cyEmu: line.cyEmu,
  });
  yEmu += line.cyEmu;
  return xml;
}).join("");
```

`textLineCount` is the number of NON-image lines in the chunk. Media part paths are numbered **deck-wide** (`ppt/media/image${n}.${ext}` with `n` incrementing across all slides), since they share one directory; relationship ids are numbered **within the slide** starting at `rId2`.

`renderDocumentPptx` gains the same trailing `assets: ExportAssets = NO_EXPORT_ASSETS` parameter and passes `{ xml, media }` per slide to `buildPptxPackage`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/app/doc-render-pptx.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 8: Check the size ratchet**

```bash
node -e "console.log(require('fs').readFileSync('src/app/doc-render-pptx.ts','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
```
Expected: under 800 and `EXIT=0`. If over, extract the slide-assembly half into `src/app/doc-render-pptx-slides.ts`.

- [ ] **Step 9: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
git add src/app/doc-render-pptx.ts src/app/doc-render-pptx.test.ts
git commit -m "feat(export): place real images on pptx slides, budgeted"
```

---

### Task 11: HTML — the omitted branch and the missing-marker style

**Files:**
- Modify: `src/app/doc-render-html.ts`
- Test: `src/app/doc-render-html.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/app/doc-render-html.test.ts
describe("standalone image branches", () => {
  const html = (assets: ExportAssets) =>
    renderDocumentHtml(docWith(`<p><img data-asset-id="a1" alt="c"></p>`), wsWithAsset(), "en-US", "standalone", assets);

  it("inlines a data: URI when the asset is inlined", () => {
    const out = html({ inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() });
    expect(out).toContain(`src="data:image/png;base64,${PNG_B64}"`);
    expect(out).not.toContain("data-asset-missing");
  });

  it("substitutes the SAME placeholder text as docx when omitted by budget", () => {
    const out = html({ inlined: {}, omitted: new Set(["a1"]), missing: new Set() });
    expect(out).toContain("chart.png");
    // An omitted image is a policy decision, not a broken one.
    expect(out).not.toContain("data-asset-missing");
    expect(out).not.toContain("<img");
  });

  it("marks a missing asset, and the standalone stylesheet can draw the marker", () => {
    const out = html({ inlined: {}, omitted: new Set(), missing: new Set(["a1"]) });
    expect(out).toContain(`data-asset-missing="true"`);
    // ★ The marker is styled ONLY in globals.css, which a standalone file never
    // loads — so the rule must be inlined here or the attribute draws nothing.
    expect(out).toContain("img[data-asset-missing]");
  });

  it("preview mode is untouched by any of this", () => {
    const out = renderDocumentHtml(
      docWith(`<p><img data-asset-id="a1"></p>`), wsWithAsset(), "en-US", "preview",
      { inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() },
    );
    expect(out).not.toContain("data:image/png");
    expect(out).toContain(`data-asset-id="a1"`);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/doc-render-html.test.ts -t "standalone image branches" --reporter=dot`
Expected: FAIL — `assets` is a `Record<string,string>`, there is no omitted branch, and no marker rule is inlined.

- [ ] **Step 3: Implement**

Change the parameter type from `assets?: Record<string, string>` to `assets: ExportAssets = NO_EXPORT_ASSETS` and rewrite the substitution:

```ts
function inlineDocumentImages(
  html: string,
  assets: ExportAssets,
  mimeById: ReadonlyMap<string, string>,
  nameById: ReadonlyMap<string, string>,
  lang: Lang,
): string {
  return html.replace(IMG_TAG_RE, (tag, id: string) => {
    // ★★ OMITTED IS NOT MISSING. The budget decided not to carry these bytes;
    // the image exists and the user's document is intact. Disclosing it with
    // the broken-image marker would say the opposite, so it gets the same
    // translated placeholder DOCX and PPTX use — and replaces the <img>
    // entirely, because an <img> with no src is what §210 was about.
    if (assets.omitted.has(id)) {
      return htmlEscape(t(lang, "assetExportPlaceholder", nameById.get(id) ?? id));
    }
    const attr = assetSrcAttr(assets.inlined[id], mimeById.get(id));
    const selfClosing = tag.endsWith("/>");
    const withoutClose = tag.slice(0, selfClosing ? -2 : -1);
    return `${withoutClose}${attr ?? ` data-asset-missing="true"`}${selfClosing ? " />" : ">"}`;
  });
}
```

Add to `DOCUMENT_PAGE_STYLES`:

```css
/* ★★★ A standalone export loads NO app stylesheet. `globals.css` styles this
   marker for the live preview, and that file is not here — so without this
   rule the attribute would be set and NOTHING would draw it, which reads to a
   user as an image that simply vanished. Colours stay off-palette-free by
   using the same neutral the print styles already establish. */
img[data-asset-missing] {
  min-width: 6rem;
  min-height: 4rem;
  border: 1px dashed currentColor;
  opacity: 0.6;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/doc-render-html.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Mutation-check the style rule**

Delete the `img[data-asset-missing]` block and re-run. Expected: the "marks a missing asset" test goes RED. Restore it.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
git add src/app/doc-render-html.ts src/app/doc-render-html.test.ts
git commit -m "feat(export): disclose omitted and missing images in standalone html"
```

---

### Task 12: `downloadDocument` goes async without spending the gesture

**Files:**
- Modify: `src/app/document-download.ts`
- Test: `src/app/document-download.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/app/document-download.test.ts
describe("downloadDocument async", () => {
  it("opens the print tab BEFORE awaiting bytes, so the gesture is not spent", async () => {
    const order: string[] = [];
    const open = vi.spyOn(window, "open").mockImplementation(() => {
      order.push("open");
      return { document: { open() {}, write() { order.push("write"); }, close() {} } } as unknown as Window;
    });
    const load = vi.fn(async () => { order.push("load"); return PNG_B64; });

    await downloadDocument(docWithImage(), "pdf", ws, "en-US", load);

    // ★★★ If `open` moves after `load`, every user with a popup blocker lands
    // on the fallback path built for the genuinely-blocked case.
    expect(order[0]).toBe("open");
    expect(order).toContain("load");
    expect(order[order.length - 1]).toBe("write");
    open.mockRestore();
  });

  it("still falls back to an html download when the popup is blocked", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const trigger = vi.spyOn(downloadModule, "triggerDownload").mockImplementation(() => {});
    await downloadDocument(docWithImage(), "pdf", ws, "en-US", async () => PNG_B64);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0]).toMatch(/\.html$/);
    open.mockRestore();
    trigger.mockRestore();
  });

  it("does not load any bytes for a document with no images", async () => {
    const load = vi.fn();
    await downloadDocument(docWithNoImages(), "docx", ws, "en-US", load);
    expect(load).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/document-download.test.ts --reporter=dot`
Expected: FAIL — `downloadDocument` is synchronous and takes no loader.

- [ ] **Step 3: Implement**

```ts
/** Shown in the print tab while the bytes load. Deliberately minimal and
 *  unstyled: it is replaced within a tick or two, and anything richer would
 *  flash. */
const PREPARING_HTML = "<!doctype html><title></title>";

export async function downloadDocument(
  doc: ProjectDocument,
  format: DocFormat,
  ws: Workspace,
  lang: Lang,
  /** Resolves one asset id to base64. Omitted (no Turso config) means every
   *  image is disclosed as missing rather than the export failing. */
  load?: AssetByteLoader,
): Promise<void> {
  if (typeof window === "undefined") return;
  const today = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    // ★★★ OPEN FIRST. `window.open` is only permitted inside the user gesture,
    // and an `await` before it spends that gesture — so the blocker fires for
    // EVERYONE and the fallback below stops meaning "blocked".
    const tab = window.open("", "_blank");
    if (!tab) {
      const assets = load ? await loadExportAssets(doc, load) : NO_EXPORT_ASSETS;
      const html = renderDocumentHtml(doc, ws, lang, "standalone", assets);
      triggerDownload(documentFilename(doc, "html", today), new Blob([html], { type: HTML_MIME }));
      return;
    }
    tab.document.open();
    tab.document.write(PREPARING_HTML);
    const assets = load ? await loadExportAssets(doc, load) : NO_EXPORT_ASSETS;
    const html = renderDocumentHtml(doc, ws, lang, "standalone", assets);
    // A second open() resets the document, discarding the placeholder.
    tab.document.open();
    tab.document.write(withAutoPrint(html));
    tab.document.close();
    return;
  }

  const assets = load ? await loadExportAssets(doc, load) : NO_EXPORT_ASSETS;
  const blob =
    format === "html"
      ? new Blob([renderDocumentHtml(doc, ws, lang, "standalone", assets)], { type: HTML_MIME })
      : format === "docx"
        ? renderDocumentDocx(doc, ws, lang, assets)
        : renderDocumentPptx(doc, ws, lang, assets);

  triggerDownload(documentFilename(doc, format, today), blob);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/document-download.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
git add src/app/document-download.ts src/app/document-download.test.ts
git commit -m "feat(export): load asset bytes without spending the print gesture"
```

---

### Task 13: Wire the three call sites

**Files:**
- Modify: `src/app/documents-panel.tsx` (two call sites), `src/app/chat-panel.tsx`, `src/app/chat-tool-block.tsx`
- Test: `src/app/documents-panel.test.tsx`, `src/app/chat-tool-block.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/chat-tool-block.test.tsx
it("passes the asset loader to the download, so a chat download carries images", async () => {
  const download = vi.spyOn(downloadModule, "downloadDocument").mockResolvedValue();
  render(<ToolBlock name="create_document" input={{}} result={okResult}
                    lang="en-US" tursoConfig={config} projectId="p1" />);
  await userEvent.click(screen.getByRole("button", { name: /download/i }));
  // ★ The fifth argument is the loader. Without it the chat card silently
  // exports a different file than the identical-looking panel button.
  expect(download.mock.calls[0][4]).toBeTypeOf("function");
  download.mockRestore();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/chat-tool-block.test.tsx --reporter=dot`
Expected: FAIL — `ToolBlock` has no `tursoConfig` prop and passes four arguments.

- [ ] **Step 3: Implement**

In `documents-panel.tsx`, both call sites already have `assetPane`:

```tsx
const assetLoader = useMemo(() => {
  const config = assetPane?.tursoConfig ?? null;
  const projectId = assetPane?.projectId;
  if (!config || !projectId) return undefined;
  return (id: string) => loadAssetData(config, id, projectId);
}, [assetPane?.tursoConfig, assetPane?.projectId]);
```

★ `react-hooks/exhaustive-deps` REJECTS an `obj.member` dependency. Hoist both to locals first and depend on those:

```tsx
const assetsConfig = assetPane?.tursoConfig ?? null;
const assetsProjectId = assetPane?.projectId;
const assetLoader = useMemo(
  () =>
    assetsConfig && assetsProjectId
      ? (id: string) => loadAssetData(assetsConfig, id, assetsProjectId)
      : undefined,
  [assetsConfig, assetsProjectId],
);
```

Then `void downloadDocument(selected, format, ws, lang, assetLoader);` at both sites. `void` because these are click handlers and the promise is deliberately not awaited.

In `chat-panel.tsx`, `tursoConfig` and `projectId` are already in scope — pass both to `<ToolBlock>`. In `chat-tool-block.tsx`, add them to `ToolBlock`'s and `DocumentCard`'s prop types and build the same loader.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/chat-tool-block.test.tsx src/app/documents-panel.test.tsx --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Confirm no call site was missed**

Run: `git grep -n "downloadDocument(" -- src/app | grep -v "\.test\." | grep -v "export "`
Expected: three call sites, each passing five arguments.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
git add src/app/documents-panel.tsx src/app/chat-panel.tsx src/app/chat-tool-block.tsx src/app/chat-tool-block.test.tsx src/app/documents-panel.test.tsx
git commit -m "feat(export): give every download path the asset loader"
```

---

### Task 14: Documentation, follow-ups and release

**Files:**
- Modify: `docs/AGENTS/documents.md`, `docs/open-followups.md`, `CHANGELOG.md`, `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: Close §202 and §210**

Mark both **CLOSED** with the version that closed them, and state what is still NOT covered: OOXML output is verified by unzip-and-byte-compare, never by opening the file in Word.

- [ ] **Step 2: Document the as-built architecture**

In `docs/AGENTS/documents.md`, extend the "Asset images (S3c-1)" section with an S3c-2 subsection covering: the three-bucket `ExportAssets` contract, the additive `media` parameter on both package builders and why an empty array must stay byte-identical, the DOCX paragraph split and why a drawing cannot go through the HTML parse, cost-based PPTX pagination and the body-box cap that makes it terminate, and the 25 MB inline budget as a judgement call.

- [ ] **Step 3: Add the release highlight strings**

`i18n.ts` gets `versionHighlightDocumentImageExport`. `i18n.de.ts` is **CRLF and the Edit tool corrupts umlauts** — write it with a node UTF-8 write and verify the umlauts survived:

```bash
node -e "const l=require('fs').readFileSync('src/app/i18n.de.ts','utf8').split(/\r?\n/).find(x=>x.includes('versionHighlightDocumentImageExport'));console.log(l);console.log(/fuer|druecken|ae |oe |ue /.test(l)?'ASCII SUBSTITUTE':'ok')"
```

- [ ] **Step 4: Bump the version in all seven places**

`src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, **`APP_MILESTONE`** — the one that has shipped wrong twice), `APP_HIGHLIGHT_KEYS`, `CHANGELOG.md`, `package.json`, `package-lock.json` (**two** occurrences), the README shields badge (version **and** codename), and the `<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`.

Verify:
```bash
grep -n "APP_VERSION\|APP_MILESTONE" src/app/version.ts
grep -c "\"version\": \"$(node -p "require('./package.json').version")\"" package-lock.json
```
Expected: the milestone is the NEW codename, and the lock file shows 2.

- [ ] **Step 5: Record the known limitations honestly**

In `CHANGELOG.md`, in user terms: images over the 25 MB inline budget appear as a named placeholder in HTML and PDF (DOCX and PPTX carry all of them); an image with no stored dimensions stays a placeholder in DOCX and PPTX; and PowerPoint slide overflow is bounded but not measured.

- [ ] **Step 6: Run the doc gates**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```
Expected: both `EXIT=0`. Cite SYMBOLS, never `file:LINE` — the claims ratchet fails on a new line citation.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: record S3c-2 as built and close 202 and 210"
```

---

### Task 15: Full verification

- [ ] **Step 1: Gates, unpiped, one at a time**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/s3c2-suite.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/s3c2-suite.log
npm run test:coverage > /tmp/s3c2-cov.log 2>&1; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
```

★★★ Never read an exit code through a pipe — you get the pipe's status. Redirect, echo `$?`, then grep the file.

- [ ] **Step 2: The shuffled run, which is its own gate**

```bash
npm run test:shuffle > /tmp/s3c2-shuffle.log 2>&1; echo "EXIT=$?"
```
This slice adds several test files, and `unit-tests-shuffled` is the only thing that catches order dependence between them.

- [ ] **Step 3: axe on Documents**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" --workers=1; echo "EXIT=$?"
```
`--workers=1` is required: CI runs axe serially and local runs it at CPU count, and over-subscribed tests die on a 60 s timeout that prints as a failure with no violation text.

- [ ] **Step 4: The prod CSP smoke**

```bash
npm run build && npm run e2e:smoke:prod; echo "EXIT=$?"
```
The only local reproduction of the production CSP.

★ **Measured 2026-08-22, before this plan shipped: `src/proxy.ts` already declares
`img-src 'self' data: blob:`, so the `data:` URIs this slice introduces are permitted.** This step
is a REGRESSION guard, not an unknown to resolve — do not go looking for a CSP bug here.

★★ It still matters, and the reason is non-obvious: the PDF path writes into
`window.open("", "_blank")`, an `about:blank` that **inherits the app origin and therefore the app's
CSP**. So a future edit narrowing `img-src` would break PDF export — silently, in production only,
because dev and every other suite would stay green. Re-confirm the directive is intact:

```bash
grep -n "img-src" src/proxy.ts
```
Expected: `img-src 'self' data: blob:`.

- [ ] **Step 5: Manual verification — this is a gate, not a formality**

No test in this repo can do any of these:

1. Export a document with two images as **.docx**; open it in **Microsoft Word** AND **LibreOffice Writer**. Both images visible, neither stretched, alt text present in Word's Format Picture → Alt Text.
2. Export the same document as **.pptx**; open in **PowerPoint**. Images sit below their text and **do not run off the slide** — the cost-based budget bounds overflow but nothing measures it.
3. Export as **.html**; open the file directly (`file://`). Images render with no network access.
4. Export as **.pdf**; the print dialog opens on its own and the preview shows the images.
5. A document whose images exceed 25 MB: HTML shows named placeholders, DOCX still carries every image.
6. A document with a **dangling** asset (delete the bytes via the asset library): HTML shows the dashed marker, DOCX/PPTX show the named placeholder.

Record the result of each in the MR description. An unopened `.docx` is an unverified `.docx`.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: the async spine → 2 and 12; the gesture fix → 12; call sites → 13; `ooxml-media.ts` → 1; DOCX → 5, 6, 7; PPTX → 8, 9, 10; HTML/PDF → 11; the byte budget → 2 and 11; error handling → 2; testing → throughout, with the four anti-vacuity requirements landing in 1 (property), 5 (golden), 10 (forced break) and 2 (over-budget fixture); docs and release → 14; what no test reaches → 15 Step 5.

**Two things this plan adds that the spec did not name**, both discovered while writing it:

1. **The print tab inherits the app's CSP** (Task 15 Step 4). `window.open("", "_blank")` yields an `about:blank` on the app origin, so `img-src` governs the `data:` images written into it. Measured while writing this plan: `src/proxy.ts` already declares `img-src 'self' data: blob:`, so there is nothing to fix — but a later narrowing of that directive would break PDF export in production only, with every other suite green. That is the §54 shape, and the step exists to keep it visible.
2. **A deck-wide vs per-slide numbering split** (Task 10). PPTX media parts share one `ppt/media/` directory so their paths must be unique across the deck, while relationship ids are scoped to a slide and restart at `rId2`. Getting this backwards produces a deck that opens with the wrong image on a slide — valid XML, wrong output, and no test catches it unless two slides carry different images. Task 9's second test is written to catch exactly that.

**Type consistency.** `ExportAssets`, `MediaPart`, `Extent`, `PptxSlide`, `ImageLine` and `SlideLine` are each defined once and used with the same shape throughout. `loadExportAssets(doc, load, budgetBytes?)` and `downloadDocument(doc, format, ws, lang, load?)` keep their signatures across Tasks 2, 12 and 13.
