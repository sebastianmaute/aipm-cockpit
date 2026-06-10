import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { GRAPH_BASE, mapDriveItem, siteDrivesUrl, folderChildrenUrl } from "./sharepoint-graph";

describe("URL builder encoding properties", () => {
  test("siteDrivesUrl keeps any id inside a single path segment (round-trip)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (siteId) => {
        const url = siteDrivesUrl(siteId);
        const segment = url.slice(`${GRAPH_BASE}/sites/`.length, -"/drives".length);
        // Encoded id never introduces extra path separators or query/fragment cuts…
        expect(segment).not.toMatch(/[/?#]/);
        // …and decodes back to the original id.
        expect(decodeURIComponent(segment)).toBe(siteId);
        expect(url.startsWith(`${GRAPH_BASE}/sites/`)).toBe(true);
        expect(url.endsWith("/drives")).toBe(true);
      }),
    );
  });
  test("folderChildrenUrl round-trips both ids", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (driveId, itemId) => {
        const url = folderChildrenUrl(driveId, itemId);
        const m = /^.*\/drives\/([^/?#]*)\/items\/([^/?#]*)\/children$/.exec(url);
        expect(m).not.toBeNull();
        expect(decodeURIComponent(m![1])).toBe(driveId);
        expect(decodeURIComponent(m![2])).toBe(itemId);
      }),
    );
  });
});

describe("mapDriveItem properties", () => {
  test("never throws; kind is always file|folder", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.option(fc.string(), { nil: undefined }),
          name: fc.option(fc.string(), { nil: undefined }),
          webUrl: fc.option(fc.string(), { nil: undefined }),
          folder: fc.option(fc.record({}), { nil: undefined }),
        }),
        (raw) => {
          const link = mapDriveItem(raw);
          expect(["file", "folder"]).toContain(link.kind);
        },
      ),
    );
  });
});
