import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-assertion guard (mirrors the table-head-sweep idiom): the export
// dropdown must stack above the Gantt sticky date row (z-20) and its frozen
// left column (z-30), so it uses z-40.
const src = readFileSync(
  join(process.cwd(), "src", "app", "export-menu.tsx"),
  "utf8",
);

describe("export menu stacking", () => {
  it("renders its dropdown above the gantt sticky header (z-40, not z-20)", () => {
    expect(src).toContain("top-full z-40 mt-2 w-72");
    expect(src).not.toContain("top-full z-20 mt-2 w-72");
  });
});
