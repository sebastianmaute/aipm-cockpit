"use client";

// src/app/document-preview.tsx — read-only render of the selected document.
//
// ★★ PREVIEW MODE RENDERS NO TITLE. `renderDocumentHtml(..., "preview")` returns
// a FRAGMENT by design — the standalone mode used for print carries the title,
// the fragment does not. So this chrome renders `doc.title` itself; without it
// the pane shows an untitled body and reads as broken. That is the
// fragment/standalone split working as intended, not a renderer bug to patch.
//
// ★★ NO SECOND SANITIZE PASS HERE. The renderer sanitizes at every unescaped
// sink it has, and there are TWO — `renderBlock`'s `paragraph` case runs
// sanitizeDocumentHtml (doc-render-html.ts), and `tableHtml` reaches
// `exportCellHtml`, whose rich branch runs sanitizeRichHtml (download.ts).
// Adding another pass here would imply those are optional; removing either
// would be a stored-XSS hole in THIS pane, which renders the result with
// dangerouslySetInnerHTML. Leave all of it alone.
// ★★ An earlier revision of this note named ONE sink and quoted the renderer's
// own "the ONE unescaped path" comment as its warrant. That comment was stale:
// the rich table cell is a second sink, guarded by a different sanitizer in a
// different file. The safety argument here now rests on both, and both are
// named, because a warrant that under-counts its sinks is how a new one gets
// added with nobody checking it.
// ★ It was the since-retired sanitizeTemplateHtml until S3a gave documents their
// own, wider allow-list; naming the old one as if it were current would send a
// reader to a list that no longer exists, let alone governs this pane.
// ★★★ CITE THE SYMBOL, NOT A LINE RANGE. This said "doc-render-html.ts:84-86,
// verified — not taken on trust", and 84-86 is `tableHtml`'s ESCAPING, a
// different guard on a different path. A reader following it lands on table
// escaping, finds no sanitize call for paragraphs, and can only conclude the
// paragraph path is unguarded — worse than an uncited claim, because the note
// advertises itself as checked. Line numbers rot on the next edit above them.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type Lang, t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { DocumentAsset } from "./document-asset";
import type { Workspace } from "./workspace";
import type { TursoConfig } from "./turso-config";
import { renderDocumentHtml } from "./doc-render-html";
import { attachAssetImages } from "./document-asset-images";
import { loadAssetData } from "./document-assets-store";
import { ASSET_PARTITION_FALLBACK } from "./document-assets-schema";
import {
  subscribeAssetRepairs, getAssetRepairGeneration, getServerAssetRepairGeneration,
} from "./document-asset-repairs";
import { AssetPreviewModal } from "./asset-preview-modal";
import { buildRowTokens } from "./row-tokens";

const ASSET_IMG = "img[data-asset-id]";

/** The inserted asset images, in the order the reader sees them. ★★ THIS ORDER
 *  IS THE CONTRACT with the lightbox: "next" must mean the next picture ON THE
 *  PAGE, so the list comes from the DOM and never from `ws.documentAssets`
 *  (which is the library's order, and holds assets this document never
 *  placed). */
function assetImagesIn(root: HTMLElement): HTMLImageElement[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>(ASSET_IMG));
}

/**
 * What one inserted image is CALLED, for its accessible name and the lightbox
 * title.
 *
 * ★ Metadata first, `alt` second, id last. The insert path writes the asset's
 * name into `alt`, so the two normally agree; they diverge after a rename,
 * where the CURRENT name is the better answer. A byte row can also outlive its
 * metadata (an import that dropped the slice) — then `alt` is all there is, and
 * the id is a last resort rather than the label, because a uuid reads as 36
 * characters of character-salad aloud.
 */
function imageName(img: HTMLImageElement, byId: ReadonlyMap<string, DocumentAsset>): string {
  const id = img.getAttribute("data-asset-id") ?? "";
  return byId.get(id)?.name || img.getAttribute("alt") || id;
}

/** One image as the lightbox wants it. A placed image whose metadata row is
 *  gone still has to occupy its POSITION in the list, or every index after it
 *  points at the wrong picture — so it is synthesised rather than dropped, and
 *  the byte load then reports it unavailable, which is the truth. */
function asAsset(id: string, name: string, byId: ReadonlyMap<string, DocumentAsset>): DocumentAsset {
  return byId.get(id) ?? { id, name, mime: "", size: 0, hash: "", createdAt: "" };
}

export interface DocumentPreviewProps {
  lang: Lang;
  /** Null only when the workspace holds no documents at all — the list shows
   *  its own empty state in that case, so this renders nothing rather than
   *  competing with it. */
  doc: ProjectDocument | null;
  ws: Workspace;
  // Same asset-library gate `documents-panel.tsx` threads to
  // `DocumentsAssetSection` (null disables). Resolves `<img data-asset-id>`
  // references left in the rendered HTML to real bytes — see the effect
  // below. Optional: missing here means "no images resolve", since document
  // images are Turso-gated (S3c-1).
  tursoConfig?: TursoConfig | null;
  projectId?: string;
}

export function DocumentPreview({
  lang, doc, ws, tursoConfig = null, projectId = ASSET_PARTITION_FALLBACK,
}: DocumentPreviewProps) {
  // ★★ MEMOIZED, and the cost it avoids is not theoretical. `renderDocumentHtml`
  // runs DOMPurify once PER PARAGRAPH block and `resolveDataSection` once per
  // dataSection block — and that one projects the WHOLE workspace through
  // buildExportSections. Called inline, it re-ran on every parent render, so
  // each keystroke in the rename modal (which re-renders the panel) re-projected
  // the entire workspace to produce byte-identical HTML.
  // ★★★ IT MUST SIT ABOVE THE `!doc` EARLY RETURN. A hook after a conditional
  // return is a rules-of-hooks violation and `npm run lint` is `--max-warnings=0`
  // in CI, so the guard moves INTO the memo body rather than the hook moving
  // below the guard.
  const html = useMemo(
    () => (doc ? renderDocumentHtml(doc, ws, lang, "preview") : ""),
    [doc, ws, lang],
  );

  // ★★★ MEMOIZED FOR ITS IDENTITY, NOT FOR THE ALLOCATION — and without it NO
  // image in this pane renders reliably at all. React 19 diffs host props by
  // `Object.is` and treats `dangerouslySetInnerHTML` like any other
  // (`updateProperties`'s `_propKey8 === propKey` guard in
  // `react-dom-client.development.js`), so an inline `{{ __html: html }}` is a
  // NEW object every render and React re-assigns `domElement.innerHTML` —
  // rebuilding this whole subtree — on EVERY re-render, byte-identical `html`
  // or not. The effect below then does NOT re-run (its deps are unchanged), so
  // every `src` and every marker it wrote is gone for good: a rename keystroke,
  // a dangling-diff landing, any parent render at all blanks the images
  // permanently. Measured, not reasoned — a node the effect had stamped was
  // `isConnected` at write time and a DIFFERENT node was in the document a tick
  // later. Pinned by "keeps a resolved image across an unrelated re-render".
  const bodyHtml = useMemo(() => ({ __html: html }), [html]);

  // `ws.documentAssets` is an obj-member dep — react-hooks/exhaustive-deps
  // rejects that shape directly in a dependency array, so it is hoisted to a
  // local first (AGENTS.md's `snapshots.rebaselineNow` note carries the same
  // rule).
  const documentAssets = ws.documentAssets;

  const bodyRef = useRef<HTMLDivElement | null>(null);

  // ★★★ THE ONE SIGNAL NO PROP CARRIES. A §212 repair re-writes an asset's
  // BYTES over its existing id and writes NO metadata — so `documentAssets`
  // keeps its identity and `html` is unchanged, and without this the effect
  // below never re-runs: the picture already placed in this document stays
  // stamped `data-asset-missing` while the library row beside it (same pane)
  // goes healthy. Bumping the assets array's identity instead would re-run it,
  // and would also mark the workspace dirty and write every table — see
  // `document-asset-repairs.ts` for that measurement and for why the signal
  // rides its own wire.
  const assetRepairGeneration = useSyncExternalStore(
    subscribeAssetRepairs, getAssetRepairGeneration, getServerAssetRepairGeneration,
  );

  // ★★★ IMPERATIVE, NOT REACT STATE — see document-asset-images.ts's own doc
  // comment for why: the body below is one dangerouslySetInnerHTML string, so
  // there is no React element to hand a `src`, and this needs no state at all
  // (react-hooks/set-state-in-effect is banned and fatal regardless).
  // ★★ MUST SIT ABOVE THE `!doc` EARLY RETURN, same reason as the memo above.
  // A null `doc` means no preview body mounts this render, so `bodyRef.current`
  // is null and the effect below is a no-op — it still has to be CALLED,
  // unconditionally, every render.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // ★★★ A NULL CONFIG MEANS ASSET STORAGE IS OFF, NOT THAT THE IMAGES ARE
    // MISSING — the same bail `documents-history-modal.tsx` carries, for the
    // same reason, and the two must stay in step. `loadAssetData(null, …)`
    // throws `StorageNotReadyError` at once and `attachAssetImages` swallows it
    // per id, so without this EVERY `<img data-asset-id>` in file mode and in
    // Safe Mode was stamped `data-asset-missing` — the dashed red frame that
    // tells the reader their image is gone. Bailing leaves each image with no
    // `src` at all, which is not a failed load — the browser renders its alt
    // text, which the insert path populates from the asset name.
    if (tursoConfig === null) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    const mimeFor = (id: string) => documentAssets?.find((a) => a.id === id)?.mime;
    attachAssetImages(el, (id) => loadAssetData(tursoConfig, id, projectId), mimeFor,
      () => !cancelled).then((d) => {
      // The subtree may have been replaced (a new `html` landed) or this
      // component may have unmounted before the byte loads resolved — either
      // way, revoke rather than leave the blob URLs it minted dangling.
      if (cancelled) { d(); return; }
      detach = d;
    });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [html, documentAssets, tursoConfig, projectId, assetRepairGeneration]);

  const assetsById = useMemo(
    () => new Map((documentAssets ?? []).map((a) => [a.id, a] as const)),
    [documentAssets],
  );

  // ★★★ THE IMAGES ARE MADE INTERACTIVE IMPERATIVELY, FOR THE SAME REASON THEIR
  // `src` IS. The body below is one `dangerouslySetInnerHTML` string, so these
  // `<img>` nodes are not React elements — there is no element to hand a
  // `tabIndex`, a role or a handler to. This stamps the attributes; activation
  // itself is DELEGATED from the container (see the handlers on that div).
  // ★★ IT MUST DEPEND ON `html`. React re-assigns `innerHTML` whenever that
  // string changes, discarding every attribute written here — the same hazard
  // the `bodyHtml` memo above exists to bound.
  // ★★ KEYBOARD REACHABILITY IS NOT OPTIONAL: a click-only region is unusable
  // for keyboard and touch users, so `tabIndex` and `role="button"` go on with
  // the name, never after it as a follow-up.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const imgs = assetImagesIn(el);
    // ★★★ A NULL CONFIG MEANS ASSET STORAGE IS OFF — the same bail the resolve
    // effect above carries. No byte can ever load, so an affordance promising a
    // lightbox would be a lie. Attributes are REMOVED rather than merely not
    // added: `html` is unchanged when the config flips to null, so React keeps
    // the very nodes a previous run stamped.
    if (tursoConfig === null) {
      for (const img of imgs) {
        img.removeAttribute("role");
        img.removeAttribute("tabindex");
        img.removeAttribute("aria-label");
        img.style.removeProperty("cursor");
      }
      return;
    }
    // ★★★ TOKENS ARE KEYED BY POSITION, NOT BY ASSET ID. `buildRowTokens`
    // returns a Map keyed on the row id, so keying on the ASSET id would
    // collapse the same picture inserted twice into ONE entry — both images
    // would then read the same BARE name, which is the WCAG 2.4.6 failure this
    // is here to prevent and which no `documentAssets` fixture can reproduce.
    const tokens = buildRowTokens(imgs.map((img, i) => ({ id: i, name: imageName(img, assetsById) })));
    imgs.forEach((img, i) => {
      img.setAttribute("role", "button");
      img.setAttribute("tabindex", "0");
      // ★ `aria-label` OVERRIDES `alt` as the accessible name here, which is
      // wanted: the control is "open this picture", not the picture itself, and
      // the token it carries is what disambiguates two of them.
      img.setAttribute("aria-label", t(lang, "assetPreviewOpen", tokens.get(i) ?? ""));
      // Inline rather than a Tailwind class: these nodes come from an HTML
      // string, so no class written here would be in Tailwind's scan set for
      // any file it actually reads.
      img.style.cursor = "pointer";
    });
  }, [html, assetsById, lang, tursoConfig]);

  // The lightbox's list, snapshotted from the DOM at activation. Ids and names
  // only — the DocumentAsset rows are re-derived at render, so a METADATA
  // change (a rename) landing while the lightbox is open is picked up rather
  // than frozen.
  //
  // ★★★ A REPAIR IS NOT SUCH A CHANGE, AND AN EARLIER WORDING HERE SAID IT
  // WAS. It claimed re-derivation picked up a repair; the refutation is a
  // hundred lines up in this same file, where `assetRepairGeneration` is
  // introduced: a §212 repair rewrites BYTES over an existing id and writes NO
  // metadata, so `documentAssets` keeps its identity, `assetsById` is
  // unchanged, and the re-derived rows are byte-for-byte what they were. The
  // lightbox's own load effect keys on the asset id and mime, so nothing in it
  // moves either — it would go on showing "Data missing" while the pane behind
  // it went healthy in the same commit. That is why the generation is threaded
  // to the modal as `reloadNonce` below, and why re-deriving the rows is NOT
  // on its own the mechanism this comment used to claim.
  const [preview, setPreview] = useState<
    { readonly images: readonly { id: string; name: string }[]; readonly index: number } | null
  >(null);

  // ★★ NO STATE IS SET FROM AN EFFECT here, deliberately —
  // `react-hooks/set-state-in-effect` is banned and fatal. The list is read out
  // of the live DOM inside the ACTIVATION handler, which is also the more
  // correct moment: it is exactly what the reader had in front of them.
  const openPreview = useCallback((target: Element) => {
    // ★★ GATE THE HANDLER, NOT ONLY THE STAMPING. The interactivity effect
    // removes `role`/`tabindex`/`aria-label` when storage is off, but
    // `data-asset-id` lives in the rendered document HTML and survives — so
    // `closest(ASSET_IMG)` still matches and this still fired in file mode.
    // Nothing rendered (the modal below is behind the same `tursoConfig`), so
    // the state was simply stuck set with no way to clear it — and if storage
    // was later switched on, the modal mounted with `open` ALREADY true and
    // the lightbox popped up unbidden on an image clicked in another mode.
    if (tursoConfig === null) return;
    const el = bodyRef.current;
    if (!el) return;
    const imgs = assetImagesIn(el);
    const index = imgs.indexOf(target as HTMLImageElement);
    if (index < 0) return;
    setPreview({
      images: imgs.map((img) => ({
        id: img.getAttribute("data-asset-id") ?? "", name: imageName(img, assetsById),
      })),
      index,
    });
  }, [assetsById, tursoConfig]);

  // ★ Scoped to the container, never to `document` — a document-level key
  // listener would fire for every view in the app, and the shared `Modal`
  // already owns Escape through the dismissal stack.
  const activationTarget = (e: { target: EventTarget | null }): Element | null =>
    e.target instanceof Element ? e.target.closest(ASSET_IMG) : null;

  if (!doc) return null;

  const previewAssets = (preview?.images ?? []).map((i) => asAsset(i.id, i.name, assetsById));

  const titleId = `document-preview-title-${doc.id}`;

  return (
    // ★★ tabIndex={0} IS AN ACCESSIBILITY FIX, NOT A STYLE CHOICE. This element
    // scrolls (`overflow-auto`) and its content is rendered document HTML, which
    // contains nothing focusable — so a keyboard-only user could not scroll it at
    // all. axe's scrollable-region-focusable flagged it `serious` on all five
    // scheme combos the moment the e2e seed started delivering real documents;
    // before that the pane had nothing to scroll and the gate saw nothing.
    // ★★ The name rides `aria-labelledby` on the heading THIS PANE ALREADY
    // RENDERS, so a focusable region is announced as the document it shows
    // ("Steering update") rather than a generic "Document preview" — and it needs
    // NO new i18n key, which also keeps it correct in DE for free. A named
    // <section> is implicitly `role="region"`, so an explicit role would be
    // redundant. Do not swap this for an aria-label literal: that is both a
    // hardcoded English string and a less specific name.
    <>
      <section
        tabIndex={0}
        aria-labelledby={titleId}
        className="overflow-auto rounded-md border border-line bg-surface p-4"
      >
        <h2 id={titleId} className="mb-3 text-base font-semibold text-foreground">
          {doc.title}
        </h2>
        <div
          ref={bodyRef}
          data-document-preview-body
          className="text-sm text-foreground"
          // ★★★ DELEGATED, because there is no React element for the image. A
          // handler on THIS div still sees the bubbled event from a node React
          // only ever wrote as innerHTML, and `closest` finds the image the
          // reader actually hit.
          onClick={(e) => { const img = activationTarget(e); if (img) openPreview(img); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            const img = activationTarget(e);
            if (!img) return;
            // Space would otherwise scroll the region this body sits in.
            e.preventDefault();
            openPreview(img);
          }}
          dangerouslySetInnerHTML={bodyHtml}
        />
      </section>
      {/* Mounted whenever asset storage is on, never conditionally on
          `preview` — `Modal` returns null while closed, and the lightbox's
          re-seed-on-reopen logic depends on staying mounted across opens.
          ★ Turso gating is INHERITED from `tursoConfig`, the same prop the
          resolve effect bails on; nothing here re-derives it. */}
      {tursoConfig !== null && (
        <AssetPreviewModal
          lang={lang}
          open={preview !== null}
          onClose={() => setPreview(null)}
          assets={previewAssets}
          startIndex={preview?.index ?? 0}
          loadImage={(id) => loadAssetData(tursoConfig, id, projectId)}
          reloadNonce={assetRepairGeneration}
        />
      )}
    </>
  );
}
