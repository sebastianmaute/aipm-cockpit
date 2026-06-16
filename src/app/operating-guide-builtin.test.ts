// src/app/operating-guide-builtin.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_GUIDE_CONTENT, BUILTIN_GUIDE_ID } from "./operating-guide-builtin.generated";

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
