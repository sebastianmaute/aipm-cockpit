// src/app/asset-export-placeholder.ts — the text an export shows in place of
// an image it does not embed (DOCX and PPTX; HTML/PDF use the same key).
//
// ★★ §320 — a refused TYPE is not a missing image. `isBlockedAssetMime` is the
//  one spelling of "this stored mime is refused" (§230/§225: an EMPTY mime is
//  not refused), so a policy refusal says so, and every other reason keeps
//  the neutral "[Image: name]".
import type { DocumentAsset } from "./document-asset";
import { isBlockedAssetMime } from "./document-asset-upload";
import { t, type Lang } from "./i18n";

export function assetExportPlaceholder(id: string, byId: ReadonlyMap<string, DocumentAsset>, lang: Lang): string {
  const meta = byId.get(id);
  const key = isBlockedAssetMime(meta?.mime) ? "assetExportBlocked" : "assetExportPlaceholder";
  return t(lang, key, meta?.name ?? id);
}
