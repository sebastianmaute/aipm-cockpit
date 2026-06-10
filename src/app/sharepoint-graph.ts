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

export function siteDrivesUrl(siteId: string): string {
  return `${GRAPH_BASE}/sites/${siteId}/drives`;
}

export function driveRootChildrenUrl(driveId: string): string {
  return `${GRAPH_BASE}/drives/${driveId}/root/children`;
}

export function folderChildrenUrl(driveId: string, itemId: string): string {
  return `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/children`;
}

/** Resolve a site addressed by hostname + server-relative path (paste fallback). */
export function siteByPathUrl(hostname: string, sitePath: string): string {
  return `${GRAPH_BASE}/sites/${hostname}:${sitePath}`;
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

export function readList<T>(json: unknown): { items: T[]; nextLink?: string } {
  const r = (json ?? {}) as GraphListResponse<T>;
  return {
    items: Array.isArray(r.value) ? r.value : [],
    nextLink: typeof r["@odata.nextLink"] === "string" ? r["@odata.nextLink"] : undefined,
  };
}
