import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("no-flash boot script", () => {
  it("reads lop-style and sets the data-style attribute", () => {
    expect(src).toContain('localStorage.getItem("lop-style")');
    expect(src).toContain('setAttribute("data-style"');
  });
  it("pins light under mockup AND custom (forces d=false)", () => {
    expect(src).toContain('if(s==="mockup"||s==="custom"){d=false;}');
  });
  it("still applies the dark class from lop-theme", () => {
    expect(src).toContain('classList.toggle("dark"');
    expect(src).toContain('localStorage.getItem("lop-theme")');
  });
  it("applies the active custom scheme's colors pre-paint", () => {
    expect(src).toContain('localStorage.getItem("lop-active-scheme-colors")');
    expect(src).toContain('setProperty');
  });
});
