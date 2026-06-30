// src/app/document-meta.ts
// Pure, i18n-free display-metadata helpers for DocumentLink lists: host label
// (from URL), file type (icon + i18n key), and list filter/sort/counts for the
// Documents card grid. Deterministic — no Date/Math.random.

import type { DocRef, DocSourceKind } from "./documents";

/** Host label from a URL: known SaaS hosts mapped to a stable name, else the
 *  bare hostname (www. stripped). Unparseable → "" (caller renders a fallback). */
export function hostLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host) return "";
  if (host.endsWith("-my.sharepoint.com") || host === "onedrive.live.com") return "OneDrive";
  if (host.endsWith(".sharepoint.com")) return "SharePoint";
  if (host.endsWith(".atlassian.net")) return url.includes("/wiki") ? "Confluence" : "Jira";
  if (host === "github.com" || host.endsWith(".github.com")) return "GitHub";
  if (host === "docs.google.com" || host === "drive.google.com") return "Google";
  return host.replace(/^www\./, "");
}

export type DocTypeKey = "Pdf" | "Word" | "Excel" | "Ppt" | "Image" | "Folder" | "Link" | "File";
export interface FileType {
  icon: string;
  labelKey: DocTypeKey;
}

const TYPE_ICON: Record<DocTypeKey, string> = {
  Pdf: "📕", Word: "📘", Excel: "📗", Ppt: "📙", Image: "🖼️", Folder: "📁", Link: "🔗", File: "📄",
};

const EXT_TYPE: Record<string, DocTypeKey> = {
  pdf: "Pdf",
  doc: "Word", docx: "Word",
  xls: "Excel", xlsx: "Excel", csv: "Excel",
  ppt: "Ppt", pptx: "Ppt",
  png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", svg: "Image", webp: "Image",
};

function typeFromMime(mime: string | undefined): DocTypeKey | null {
  if (!mime) return null;
  if (mime === "application/pdf") return "Pdf";
  if (mime.includes("wordprocessingml") || mime === "application/msword") return "Word";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "Excel";
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint") return "Ppt";
  if (mime.startsWith("image/")) return "Image";
  return null;
}

/** File-type descriptor: folder → extension → mimeType → link-vs-file fallback. */
export function fileTypeOf(link: { name: string; url?: string; kind: "file" | "folder"; mimeType?: string }): FileType {
  if (link.kind === "folder") return { icon: TYPE_ICON.Folder, labelKey: "Folder" };
  const dot = link.name.lastIndexOf(".");
  const ext = dot >= 0 ? link.name.slice(dot + 1).toLowerCase() : "";
  const byExt = ext ? EXT_TYPE[ext] : undefined;
  if (byExt) return { icon: TYPE_ICON[byExt], labelKey: byExt };
  const byMime = typeFromMime(link.mimeType);
  if (byMime) return { icon: TYPE_ICON[byMime], labelKey: byMime };
  const key: DocTypeKey = hostLabel(link.url ?? "") ? "Link" : "File";
  return { icon: TYPE_ICON[key], labelKey: key };
}

export type DocSort = "name" | "added" | "source" | "type";

const SOURCE_RANK: Record<DocSourceKind, number> = {
  project: 0, milestone: 1, task: 2, raid: 3, change: 4, stakeholder: 5,
};

export function filterDocs(refs: readonly DocRef[], sourceKind: DocSourceKind | "all", query: string): DocRef[] {
  const q = query.trim().toLowerCase();
  return refs.filter(
    (r) =>
      (sourceKind === "all" || r.source.kind === sourceKind) &&
      (q === "" || r.link.name.toLowerCase().includes(q)),
  );
}

/** Sort a doc list. For `"type"`, an optional `typeLabel` resolver supplies the
 *  localized type name so the order matches what the UI shows; without it the
 *  comparison falls back to the (English) type key — keeps the engine i18n-free. */
export function sortDocs(
  refs: readonly DocRef[],
  by: DocSort,
  typeLabel?: (r: DocRef) => string,
): DocRef[] {
  const out = [...refs];
  out.sort((a, b) => {
    switch (by) {
      case "name":
        return a.link.name.localeCompare(b.link.name);
      case "added": {
        const av = a.link.addedAt ?? "";
        const bv = b.link.addedAt ?? "";
        if (av === bv) return 0;
        if (av === "") return 1;
        if (bv === "") return -1;
        return bv.localeCompare(av);
      }
      case "source": {
        const r = SOURCE_RANK[a.source.kind] - SOURCE_RANK[b.source.kind];
        return r !== 0 ? r : a.source.name.localeCompare(b.source.name);
      }
      case "type": {
        const al = typeLabel ? typeLabel(a) : fileTypeOf(a.link).labelKey;
        const bl = typeLabel ? typeLabel(b) : fileTypeOf(b.link).labelKey;
        return al.localeCompare(bl);
      }
    }
  });
  return out;
}

/** The filter to actually apply: a selected source whose count has dropped to 0
 *  (e.g. its last doc was removed) collapses back to "all" so the grid never
 *  gets stuck showing an empty result under a now-hidden chip. */
export function effectiveSourceFilter(
  sourceFilter: DocSourceKind | "all",
  counts: Record<DocSourceKind | "all", number>,
): DocSourceKind | "all" {
  return sourceFilter !== "all" && counts[sourceFilter] === 0 ? "all" : sourceFilter;
}

export function sourceCounts(refs: readonly DocRef[]): Record<DocSourceKind | "all", number> {
  const counts: Record<DocSourceKind | "all", number> = {
    all: refs.length, project: 0, milestone: 0, task: 0, raid: 0, change: 0, stakeholder: 0,
  };
  for (const r of refs) counts[r.source.kind] += 1;
  return counts;
}
