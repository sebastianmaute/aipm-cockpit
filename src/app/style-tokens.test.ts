import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

describe("CI-style role tokens", () => {
  it.each(["--rag-red","--rag-amber","--rag-green","--rag-red-text","--rag-amber-text","--rag-green-text","--table-head-bg","--table-head-fg","--shadow-card","--shadow-control","--gradient-kpi"])(
    "defines %s in :root", (t) => expect(rootBlock).toContain(`${t}:`),
  );
  it("defines a mockup override block", () => {
    expect(css).toContain(':root[data-style="mockup"]');
  });
  it("AIPM table header stays dark-blue + shadows none (no-op for existing users)", () => {
    expect(rootBlock).toMatch(/--table-head-bg:\s*var\(--AIPM-dark-blue\)/);
    expect(rootBlock).toMatch(/--shadow-card:\s*none/);
  });
  it("maps the role tokens into the @theme block", () => {
    expect(css).toContain("--color-rag-amber:");
    expect(css).toContain("--color-table-head-bg:");
  });
});
