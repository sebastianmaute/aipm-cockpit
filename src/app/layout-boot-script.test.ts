import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("no-flash boot script", () => {
  it("reads lop-style and sets the data-style attribute", () => {
    expect(src).toContain('localStorage.getItem("lop-style")');
    expect(src).toContain('setAttribute("data-style"');
  });
  it("pins light under mockup (forces d=false)", () => {
    expect(src).toContain('if(s==="mockup"){d=false;}');
  });
  it("still applies the dark class from lop-theme", () => {
    expect(src).toContain('classList.toggle("dark"');
    expect(src).toContain('localStorage.getItem("lop-theme")');
  });
});
