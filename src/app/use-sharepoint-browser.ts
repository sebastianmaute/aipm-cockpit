// src/app/use-sharepoint-browser.ts
"use client";

import { useCallback, useState } from "react";
import type { KnowledgeLink } from "./document-link";
import {
  searchSitesUrl, siteDrivesUrl, driveRootChildrenUrl, folderChildrenUrl,
  siteDefaultDriveRootChildrenUrl,
  mapSite, mapDrive, mapDriveItem, readList,
  type GraphSite, type GraphDrive, type GraphDriveItem, type SiteRef, type DriveRef,
} from "./sharepoint-graph";

export type AcquireToken = (
  scopes: readonly string[],
  options?: { interactive?: boolean },
) => Promise<string | null>;

/** Delegated scopes: file R/W (drive items + storage) + site search/read. */
export const PICKER_SCOPES = ["Files.ReadWrite.All", "Sites.Read.All"] as const;

interface Crumb { driveId: string; itemId: string | null; name: string; }

interface BrowserState {
  loading: boolean;
  error: string | null;
  searchForbidden: boolean;
  sites: SiteRef[];
  drives: DriveRef[];
  items: KnowledgeLink[];
  breadcrumb: Crumb[];
  currentDriveId: string | null;
}

const INITIAL: BrowserState = {
  loading: false, error: null, searchForbidden: false, sites: [], drives: [], items: [],
  breadcrumb: [], currentDriveId: null,
};

function messageForStatus(status: number): string {
  if (status === 401) return "spPickerErrorAuth";
  if (status === 403) return "spPickerErrorForbidden";
  if (status === 404) return "spPickerErrorNotFound";
  return "spPickerErrorGeneric";
}

export function useSharePointBrowser(acquireToken: AcquireToken) {
  const [state, setState] = useState<BrowserState>(INITIAL);

  const call = useCallback(async <T,>(url: string): Promise<T | null> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const token = await acquireToken([...PICKER_SCOPES], { interactive: true });
      if (!token) {
        setState((s) => ({ ...s, loading: false, error: "spPickerErrorSignIn" }));
        return null;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false, error: messageForStatus(res.status) }));
        return null;
      }
      const json = (await res.json()) as T;
      setState((s) => ({ ...s, loading: false }));
      return json;
    } catch {
      setState((s) => ({ ...s, loading: false, error: "spPickerErrorGeneric" }));
      return null;
    }
  }, [acquireToken]);

  const searchSites = useCallback(async (query: string) => {
    setState((s) => ({ ...s, searchForbidden: false }));
    const json = await call<unknown>(searchSitesUrl(query));
    if (!json) {
      setState((s) => ({
        ...s,
        searchForbidden: s.error === "spPickerErrorForbidden",
      }));
      return;
    }
    const { items } = readList<GraphSite>(json);
    setState((s) => ({ ...s, sites: items.map(mapSite).filter((x) => x.id), drives: [], items: [], breadcrumb: [], currentDriveId: null }));
  }, [call]);

  const openSite = useCallback(async (site: SiteRef) => {
    const json = await call<unknown>(siteDrivesUrl(site.id));
    if (!json) return;
    const { items } = readList<GraphDrive>(json);
    setState((s) => ({ ...s, drives: items.map(mapDrive).filter((d) => d.id), items: [], breadcrumb: [], currentDriveId: null }));
  }, [call]);

  const openDrive = useCallback(async (drive: DriveRef) => {
    const json = await call<unknown>(driveRootChildrenUrl(drive.id));
    if (!json) return;
    const { items } = readList<GraphDriveItem>(json);
    setState((s) => ({
      ...s, currentDriveId: drive.id, items: items.map(mapDriveItem),
      breadcrumb: [{ driveId: drive.id, itemId: null, name: drive.name }],
    }));
  }, [call]);

  const openFolder = useCallback(async (link: KnowledgeLink) => {
    if (!link.driveId || !link.itemId) return;
    const json = await call<unknown>(folderChildrenUrl(link.driveId, link.itemId));
    if (!json) return;
    const { items } = readList<GraphDriveItem>(json);
    setState((s) => ({
      ...s, items: items.map(mapDriveItem),
      breadcrumb: [...s.breadcrumb, { driveId: link.driveId!, itemId: link.itemId!, name: link.name }],
    }));
  }, [call]);

  const openSiteByPath = useCallback(async (hostname: string, sitePath: string) => {
    const json = await call<unknown>(siteDefaultDriveRootChildrenUrl(hostname, sitePath));
    if (!json) return;
    const { items } = readList<GraphDriveItem>(json);
    const mapped = items.map(mapDriveItem);
    const driveId = mapped[0]?.driveId ?? null;
    setState((s) => ({
      ...s,
      items: mapped,
      currentDriveId: driveId,
      breadcrumb: [{ driveId: driveId ?? "", itemId: null, name: sitePath }],
    }));
  }, [call]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, searchSites, openSite, openDrive, openFolder, openSiteByPath, reset };
}
