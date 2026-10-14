import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { imageRefs } from "./doc-image-refs.mjs";

describe("imageRefs", () => {
  it("collects markdown and <img> refs, repo-relative to the file's folder", () => {
    expect(imageRefs('![a](docs/assets/x.png) <img src="docs/assets/y.png">', "README.md")).toEqual([
      "docs/assets/x.png",
      "docs/assets/y.png",
    ]);
    expect(imageRefs("![a](assets/z.png)", "docs/guide.md")).toEqual(["docs/assets/z.png"]);
  });

  it("skips fenced code and remote images, and strips a fragment or query", () => {
    const md = ["```", "![in fence](fenced.png)", "```", "![remote](https://example.com/r.png)", "![a](x.png#frag)", '<img src="q.png?v=1">'].join("\n");
    expect(imageRefs(md, "README.md")).toEqual(["x.png", "q.png"]);
  });
});

// §713 — a renamed or deleted docs image must fail here, not show a broken picture on GitHub.
describe("every image the README and the install guide show exists", () => {
  for (const [file, floor] of [["README.md", 17], ["docs/desktop-rollout.md", 9]]) {
    it(`${file}`, () => {
      const refs = imageRefs(readFileSync(file, "utf8"), file);
      // Anti-vacuity: a pattern that matched nothing would pass the existence loop.
      expect(refs.length).toBeGreaterThanOrEqual(floor);
      const missing = refs.filter((r) => !existsSync(r));
      expect(missing).toEqual([]);
    });
  }
});
