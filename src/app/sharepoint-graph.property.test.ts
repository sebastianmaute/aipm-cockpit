import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { mapDriveItem } from "./sharepoint-graph";

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
