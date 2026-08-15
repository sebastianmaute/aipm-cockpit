import { describe, expect, it } from "vitest";
import { H_CLASS, W_CLASS } from "./dashboard-grid";

describe("span class tables", () => {
  it("emits literal class strings, never interpolated ones", () => {
    // ★ Tailwind v4 scans SOURCE for class candidates. `col-span-${w}` emits no
    // CSS at all, so these tables must hold whole literal strings.
    for (const v of Object.values(W_CLASS)) expect(v).toMatch(/^col-span-1( lg:col-span-\d)?( xl:col-span-\d)?$/);
    for (const v of Object.values(H_CLASS)) expect(v).toMatch(/^row-span-\d$/);
  });

  it("carries the whole responsive clamp on the width axis", () => {
    expect(W_CLASS[4]).toBe("col-span-1 lg:col-span-2 xl:col-span-4");
    expect(W_CLASS[1]).toBe("col-span-1");
  });

  it("does not clamp height", () => {
    expect(H_CLASS[3]).toBe("row-span-3");
  });
});
