import { describe, expect, test } from "vitest";
import {
  GRAPH_BASE,
  searchSitesUrl,
  siteDrivesUrl,
  driveRootChildrenUrl,
  folderChildrenUrl,
  siteDefaultDriveRootChildrenUrl,
  isSafeGraphLink,
  readList,
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
  test("siteDrivesUrl percent-encodes real-shaped composite site ids (commas)", () => {
    expect(siteDrivesUrl("contoso.sharepoint.com,abc-123,def-456")).toBe(
      `${GRAPH_BASE}/sites/contoso.sharepoint.com%2Cabc-123%2Cdef-456/drives`,
    );
  });
  test("siteDrivesUrl neutralizes a hostile path-traversal id", () => {
    const url = siteDrivesUrl("../me/messages");
    expect(url).toBe(`${GRAPH_BASE}/sites/..%2Fme%2Fmessages/drives`);
    expect(url).not.toContain("/me/messages");
  });
  test("driveRootChildrenUrl", () => {
    expect(driveRootChildrenUrl("d1")).toBe(`${GRAPH_BASE}/drives/d1/root/children`);
  });
  test("driveRootChildrenUrl encodes a hostile drive id", () => {
    expect(driveRootChildrenUrl("../../me/drive")).toBe(
      `${GRAPH_BASE}/drives/..%2F..%2Fme%2Fdrive/root/children`,
    );
  });
  test("folderChildrenUrl", () => {
    expect(folderChildrenUrl("d1", "item9")).toBe(`${GRAPH_BASE}/drives/d1/items/item9/children`);
  });
  test("folderChildrenUrl encodes both ids", () => {
    expect(folderChildrenUrl("d:1", "it,em")).toBe(
      `${GRAPH_BASE}/drives/d%3A1/items/it%2Cem/children`,
    );
  });
});

describe("mappers", () => {
  test("mapSite -> SiteRef", () => {
    const s = mapSite({ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" });
    expect(s).toEqual({ id: "s1", name: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" });
  });
  test("mapDriveItem (file) -> KnowledgeLink", () => {
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
  test("mapDriveItem (folder) -> KnowledgeLink kind folder", () => {
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
  test("encodes path segments but preserves slash separators and :path: syntax", () => {
    expect(siteDefaultDriveRootChildrenUrl("c.sharepoint.com", "/sites/My Proj"))
      .toBe(`${GRAPH_BASE}/sites/c.sharepoint.com:/sites/My%20Proj:/drive/root/children`);
  });
  test("a hostile hostname cannot break out of the sites segment", () => {
    expect(siteDefaultDriveRootChildrenUrl("evil/..", "/sites/proj"))
      .toBe(`${GRAPH_BASE}/sites/evil%2F..:/sites/proj:/drive/root/children`);
  });
});

describe("isSafeGraphLink", () => {
  test("accepts Graph-origin https links", () => {
    expect(isSafeGraphLink("https://graph.microsoft.com/v1.0/sites?$skiptoken=x")).toBe(true);
  });
  test.each([
    "https://evil.example.com/v1.0/sites",
    "http://graph.microsoft.com/v1.0/sites",
    "https://graph.microsoft.com.evil.com/v1.0/sites",
    "https://graph.microsoft.com@evil.com/v1.0/sites",
    "",
  ])("rejects %j", (link) => {
    expect(isSafeGraphLink(link)).toBe(false);
  });
});

describe("readList", () => {
  test("returns items and a Graph-origin nextLink", () => {
    const next = `${GRAPH_BASE}/sites?$skiptoken=abc`;
    expect(readList<string>({ value: ["a"], "@odata.nextLink": next }))
      .toEqual({ items: ["a"], nextLink: next });
  });
  test("treats a foreign-origin nextLink as absent (no throw)", () => {
    const out = readList<string>({ value: ["a"], "@odata.nextLink": "https://evil.example.com/next" });
    expect(out.items).toEqual(["a"]);
    expect(out.nextLink).toBeUndefined();
  });
  test("treats a non-string nextLink as absent", () => {
    expect(readList<string>({ value: [], "@odata.nextLink": 42 as unknown as string }).nextLink)
      .toBeUndefined();
  });
});
