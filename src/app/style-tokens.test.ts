import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const start = css.indexOf(":root {");
const rootBlock = css.slice(start, css.indexOf("\n}", start));

describe("CI-style role tokens", () => {
  it.each(["--rag-red","--rag-amber","--rag-green","--rag-red-text","--rag-amber-text","--rag-green-text","--table-head-bg","--table-head-fg","--shadow-card","--shadow-control","--gradient-kpi","--shadow-card-hover","--rag-green-chip","--rag-red-chip","--segment-track-bg","--segment-active-bg","--segment-active-fg"])(
    "defines %s in :root", (t) => expect(rootBlock).toContain(`${t}:`),
  );
  it("defines a mockup override block", () => {
    expect(css).toContain(':root[data-style="mockup"]');
  });
  it("AIPM role values reproduce today's look exactly (no-op)", () => {
    expect(rootBlock).toMatch(/--table-head-bg:\s*var\(--AIPM-dark-blue\)/);
    expect(rootBlock).toMatch(/--table-head-fg:\s*#ffffff/);
    expect(rootBlock).toMatch(/--shadow-card:\s*none/);
    expect(rootBlock).toMatch(/--shadow-control:\s*none/);
    expect(rootBlock).toMatch(/--gradient-kpi:\s*var\(--AIPM-green\)/);
    expect(rootBlock).toMatch(/--rag-red:\s*#ef4444/);
    expect(rootBlock).toMatch(/--rag-amber:\s*#f59e0b/);
    expect(rootBlock).toMatch(/--rag-green:\s*#10b981/);
    expect(rootBlock).toMatch(/--rag-red-text:\s*var\(--AIPM-pink-strong\)/);
    expect(rootBlock).toMatch(/--rag-amber-text:\s*var\(--AIPM-purple\)/);
    expect(rootBlock).toMatch(/--rag-green-text:\s*var\(--AIPM-green-strong\)/);
  });
  it("new polish tokens are AIPM no-ops", () => {
    expect(rootBlock).toMatch(/--shadow-card-hover:\s*none/);
    expect(rootBlock).toMatch(/--rag-green-chip:\s*transparent/);
    expect(rootBlock).toMatch(/--rag-red-chip:\s*transparent/);
    expect(rootBlock).toMatch(/--segment-track-bg:\s*var\(--surface\)/);
    expect(rootBlock).toMatch(/--segment-active-bg:\s*var\(--AIPM-dark-blue\)/);
    expect(rootBlock).toMatch(/--segment-active-fg:\s*#ffffff/);
  });
  it("maps the role tokens into the @theme block", () => {
    expect(css).toContain("--color-rag-amber:");
    expect(css).toContain("--color-table-head-bg:");
  });
});
