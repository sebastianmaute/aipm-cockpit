import { describe, expect, test } from "vitest";
import {
  GRAPH_BASE,
  searchSitesUrl,
  siteDrivesUrl,
  driveRootChildrenUrl,
  folderChildrenUrl,
  siteDefaultDriveRootChildrenUrl,
  mapSite,
  mapDriveItem,
  type GraphDriveItem,
} from "./sharepoint-graph";

describe("URL builders", () => {
  test("searchSitesUrl encodes the query", () => {
    expect(searchSitesUrl("my proj")).toBe(`${GRAPH_BASE}/sites?search=my%20proj`);
  });
  test("siteDrivesUrl", () => {
    expect(siteDrivesUrl("site-id")).toBe(`${GRAPH_BASE}/sites/site-id/drives`);
  });
  test("driveRootChildrenUrl", () => {
    expect(driveRootChildrenUrl("d1")).toBe(`${GRAPH_BASE}/drives/d1/root/children`);
  });
  test("folderChildrenUrl", () => {
    expect(folderChildrenUrl("d1", "item9")).toBe(`${GRAPH_BASE}/drives/d1/items/item9/children`);
  });
});

describe("mappers", () => {
  test("mapSite -> SiteRef", () => {
    const s = mapSite({ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" });
    expect(s).toEqual({ id: "s1", name: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" });
  });
  test("mapDriveItem (file) -> DocumentLink", () => {
    const raw: GraphDriveItem = {
      id: "01", name: "Spec.docx",
      webUrl: "https://c.sharepoint.com/sites/proj/Docs/Spec.docx",
      file: { mimeType: "application/msword" },
      parentReference: { driveId: "d1" },
    };
    expect(mapDriveItem(raw)).toEqual({
      id: "01", name: "Spec.docx",
      url: "https://c.sharepoint.com/sites/proj/Docs/Spec.docx",
      kind: "file", driveId: "d1", itemId: "01",
      mimeType: "application/msword",
    });
  });
  test("mapDriveItem (folder) -> DocumentLink kind folder", () => {
    const raw: GraphDriveItem = {
      id: "02", name: "Docs", webUrl: "https://c.sharepoint.com/sites/proj/Docs",
      folder: { childCount: 3 }, parentReference: { driveId: "d1" },
    };
    const link = mapDriveItem(raw);
    expect(link.kind).toBe("folder");
    expect(link.mimeType).toBeUndefined();
  });
  test("folder mapping yields kind folder", () => {
    expect(mapDriveItem({ id: "x", name: "n", webUrl: "u", folder: {} }).kind).toBe("folder");
  });
});

describe("siteDefaultDriveRootChildrenUrl", () => {
  test("addresses the site default drive by path", () => {
    expect(siteDefaultDriveRootChildrenUrl("c.sharepoint.com", "/sites/proj"))
      .toBe(`${GRAPH_BASE}/sites/c.sharepoint.com:/sites/proj:/drive/root/children`);
  });
});
