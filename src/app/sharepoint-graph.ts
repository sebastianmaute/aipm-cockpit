// src/app/sharepoint-graph.ts
//
// Pure core for the SharePoint browse picker: Graph response types, URL
// builders, and mappers to the app's DocumentLink / SiteRef. No fetch, no
// React, no window — the hook (use-sharepoint-browser.ts) owns I/O.

import type { DocumentLink } from "./document-link";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface GraphSite {
  id?: string;
  displayName?: string | null;
  name?: string | null;
  webUrl?: string | null;
}

export interface GraphDrive {
  id?: string;
  name?: string | null;
  driveType?: string | null;
}

export interface GraphDriveItem {
  id?: string;
  name?: string | null;
  webUrl?: string | null;
  file?: { mimeType?: string | null } | null;
  folder?: { childCount?: number } | null;
  parentReference?: { driveId?: string | null } | null;
}

export interface SiteRef {
  id: string;
  name: string;
  webUrl: string;
}

export interface DriveRef {
  id: string;
  name: string;
}

export function searchSitesUrl(query: string): string {
  return `${GRAPH_BASE}/sites?search=${encodeURIComponent(query)}`;
}

// Graph IDs come back from Graph responses, but a poisoned/spoofed response
// could carry a path-traversal "id" (e.g. "../me/...") that would pivot the
// next authenticated fetch. encodeURIComponent confines each id to a single
// path segment; Graph accepts percent-encoded ids (incl. the `,`/`:` that
// composite site ids legitimately contain → %2C / %3A).
export function siteDrivesUrl(siteId: string): string {
  return `${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/drives`;
}

export function driveRootChildrenUrl(driveId: string): string {
  return `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root/children`;
}

export function folderChildrenUrl(driveId: string, itemId: string): string {
  return `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children`;
}

/** Encode each segment of a server-relative site path. Constraint: the `/`
 *  separators must stay literal — Graph's `:/path:` site addressing needs a
 *  slash-separated path — so only the segments between them are encoded.
 *  The leading empty segment produced by split("/") on a path like "/sites/x"
 *  is intentional: it encodes to "" and rejoins as the leading "/" — do not
 *  skip it. */
function encodeSitePath(sitePath: string): string {
  return sitePath.split("/").map(encodeURIComponent).join("/");
}

/** Resolve a site addressed by hostname + server-relative path (paste fallback). */
export function siteByPathUrl(hostname: string, sitePath: string): string {
  return `${GRAPH_BASE}/sites/${encodeURIComponent(hostname)}:${encodeSitePath(sitePath)}`;
}

/** Default document library (drive) root children of a site addressed by path.
 *  Works with Files.ReadWrite.All — no Sites.Read.All needed (unlike /sites/{id}/drives). */
export function siteDefaultDriveRootChildrenUrl(hostname: string, sitePath: string): string {
  return `${GRAPH_BASE}/sites/${encodeURIComponent(hostname)}:${encodeSitePath(sitePath)}:/drive/root/children`;
}

export function isFolder(item: GraphDriveItem): boolean {
  return item.folder != null;
}

export function mapSite(raw: GraphSite): SiteRef {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: (raw.displayName ?? raw.name ?? "").trim(),
    webUrl: (raw.webUrl ?? "").trim(),
  };
}

export function mapDrive(raw: GraphDrive): DriveRef {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: (raw.name ?? "").trim(),
  };
}

export function mapDriveItem(raw: GraphDriveItem): DocumentLink {
  const folder = isFolder(raw);
  const link: DocumentLink = {
    id: typeof raw.id === "string" ? raw.id : "",
    name: (raw.name ?? "").trim(),
    url: (raw.webUrl ?? "").trim(),
    kind: folder ? "folder" : "file",
  };
  const driveId = raw.parentReference?.driveId;
  if (typeof driveId === "string" && driveId) link.driveId = driveId;
  if (link.id) link.itemId = link.id;
  const mime = raw.file?.mimeType;
  if (!folder && typeof mime === "string" && mime) link.mimeType = mime;
  return link;
}

/** Graph list responses wrap items in `value` + an optional `@odata.nextLink`. */
export interface GraphListResponse<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

/** A pagination/next link is only safe to follow with the user's bearer token
 *  when it stays on the Graph origin (same guard as the Outlook hooks).
 *  Intentional divergence in how callers react to a violation: `readList`
 *  treats a violating nextLink as absent (silent truncation of pagination),
 *  while the Outlook hooks throw — each caller chooses its failure mode, so
 *  do not unify them. */
export function isSafeGraphLink(link: string): boolean {
  return link.startsWith("https://graph.microsoft.com/");
}

export function readList<T>(json: unknown): { items: T[]; nextLink?: string } {
  const r = (json ?? {}) as GraphListResponse<T>;
  const rawNext = r["@odata.nextLink"];
  // A foreign-origin nextLink is treated as absent: truncated pagination
  // beats sending the bearer token to an attacker-chosen host.
  const nextLink =
    typeof rawNext === "string" && isSafeGraphLink(rawNext) ? rawNext : undefined;
  return {
    items: Array.isArray(r.value) ? r.value : [],
    nextLink,
  };
}
