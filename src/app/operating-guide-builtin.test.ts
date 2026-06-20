// src/app/operating-guide-builtin.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_GUIDE_CONTENT, BUILTIN_GUIDE_ID, BUILTIN_FEATURE_GUIDES } from "./operating-guide-builtin.generated";
import { parseFeatureGuide, VALID_VIEWS } from "../../scripts/gen-operating-guide.mjs";
import { selectActiveGuides } from "./operating-guide";
import { builtinSeeds } from "./use-operating-guides";

describe("builtin operating guide", () => {
  it("matches the source markdown (run `node scripts/gen-operating-guide.mjs` if this fails)", () => {
    const src = readFileSync(
      join(process.cwd(), "lib", "project-leadership-operating-guide.md"),
      "utf8",
    );
    expect(BUILTIN_GUIDE_CONTENT).toBe(src);
  });
  it("has a stable id", () => {
    expect(BUILTIN_GUIDE_ID).toBe("builtin-leadership");
  });
});

describe("builtin feature guides", () => {
  it("BUILTIN_FEATURE_GUIDES matches lib/app-feature-guide.md (run gen-operating-guide.mjs if this fails)", () => {
    const src = readFileSync(join(process.cwd(), "lib", "app-feature-guide.md"), "utf8");
    const expected = parseFeatureGuide(src, VALID_VIEWS);
    expect(BUILTIN_FEATURE_GUIDES).toEqual(expected);
  });
  it("are non-empty with stable ids", () => {
    expect(BUILTIN_FEATURE_GUIDES.length).toBeGreaterThan(1);
    expect(BUILTIN_FEATURE_GUIDES[0].id).toBe("builtin-app-overview");
    for (const g of BUILTIN_FEATURE_GUIDES) expect(g.id).toMatch(/^builtin-(app-overview|feature-[a-z-]+)$/);
  });
});

describe("selectActiveGuides view scoping", () => {
  it("selects the overview + the current view's feature guide, excludes other views", () => {
    const guides = builtinSeeds();
    const active = selectActiveGuides(guides, { mode: "advanced", modules: [], view: "steering-committee" });
    const ids = active.map((g) => g.id);
    expect(ids).toContain("builtin-app-overview");
    expect(ids).toContain("builtin-feature-steering-committee");
    expect(ids).not.toContain("builtin-feature-open-points");
  });
});
