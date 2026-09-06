import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { ArrangementGrid, H_CLASS, W_CLASS } from "./arrangement-grid";

describe("span class tables", () => {
  it("resolves to the class strings the grid expects at runtime", () => {
    // ★★★ THIS CANNOT SEE AN INTERPOLATION, and it used to claim it could
    // ("emits literal class strings, never interpolated ones"). A runtime
    // assertion reads the PRODUCED string, and `col-span-1 lg:col-span-${2}`
    // produces a byte-identical one — the test stays green while Tailwind, which
    // scans SOURCE for candidates, emits no rule at all and every block silently
    // renders one column wide. The real detectors are the SOURCE scan below (the
    // source form) and `e2e/dashboard-grid.spec.ts` (the resulting geometry).
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

/**
 * The SOURCE FORM of the two span tables — the one property no runtime
 * assertion can reach.
 *
 * ★★★ WHY THIS BLOCK LIVES HERE AND NOT IN `dashboard-grid.test.tsx`, WHERE IT
 * WAS WRITTEN. It is the ONE sanctioned exception to Phase F's "every Dashboard
 * test passes unmodified" rule, and it was moved rather than deleted. This is
 * the only test in the extraction that asserts on the BYTES OF A FILE AT A PATH
 * rather than on behaviour through an API: it needs the literal text
 * `export const W_CLASS` and a matching object literal in the file it reads. No
 * re-export form can satisfy either, so an adapter cannot keep it green — the
 * usual "fix the adapter, never the test" remedy is unreachable by construction.
 * More importantly, leaving it pointed at the adapter would make it WORSE than
 * deleted: the property it guards is that TAILWIND SEES WHOLE LITERAL STRINGS IN
 * SOURCE, and after the extraction those strings are in `arrangement-grid.tsx`.
 * A scan of `dashboard-grid.tsx` would pass forever no matter what the real
 * tables did, while still reading as coverage of them. The rule itself is
 * unchanged; this is the single case where the test was coupled to a path.
 *
 * ★★★ TAILWIND v4 SCANS SOURCE, NOT VALUES. An interpolated `col-span-${w}`
 * emits no CSS, so every block falls back to one implicit column — and because
 * the resulting STRING is identical, every runtime assertion above stays green
 * and jsdom has no layout to notice. Reading the file back and scanning the
 * table bodies is the only unit-layer detector; `e2e/dashboard-grid.spec.ts`
 * catches the same defect one layer down, by measuring the geometry.
 *
 * Same pattern as the DOM-free guards in `rich-text-plain.test.ts` and
 * `document-model.test.ts`: strip comments first, then scan CODE. ★ The strip
 * is needed because of the file being SCANNED, not this one: the scan reads
 * `arrangement-grid.tsx`, whose own header warns against the interpolated form —
 * once, in prose. An unstripped scan would fail against perfectly correct
 * source. ★ That count was RE-MEASURED at the new home rather than inherited:
 * it was one in the old file and is one here, but nothing guaranteed that, and a
 * strip whose necessity has quietly lapsed is a strip somebody deletes.
 */
describe("span class tables (source form)", () => {
  const code = readFileSync(join(import.meta.dirname, "arrangement-grid.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("strips comments before scanning", () => {
    // ★ Not ceremony: `arrangement-grid.tsx`'s own header warns against the
    // interpolated form in prose. Without the strip every assertion below would
    // fail on correct code — and a scan tuned to pass ANYWAY would be blind.
    expect(code).not.toContain("col-span-${w}");
    expect(code).toMatch(/export const W_CLASS/);
    expect(code).toMatch(/export const H_CLASS/);
  });

  /** The `{...}` body of one exported table, from the stripped source. */
  const tableBody = (name: string): string => {
    const m = code.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([^}]*)\\}`));
    expect(m, `${name} is not an object literal in the source`).not.toBeNull();
    return m![1];
  };

  for (const name of ["W_CLASS", "H_CLASS"]) {
    it(`holds ${name} as whole double-quoted literals, never a template`, () => {
      const body = tableBody(name);
      expect(body).not.toContain("${");
      expect(body).not.toContain("`");
      const values = [...body.matchAll(/^\s*\d\s*:\s*(.+?),\s*$/gm)].map((m) => m[1]);
      expect(values).toHaveLength(4);          // one per BlockSpan; a miss means the regex drifted
      // Only class characters between the quotes — an interpolation cannot pass.
      for (const v of values) expect(v).toMatch(/^"[a-z0-9:\- ]+"$/);
    });
  }
});

describe("ArrangementGrid", () => {
  const grid = (testId = "test-grid") =>
    render(
      <ArrangementGrid rowClass="auto-rows-[80px]" gapClass="gap-3" testId={testId}>
        <div>block</div>
      </ArrangementGrid>,
    );

  it("addresses each surface's board under its own testId", () => {
    // ★ Two surfaces mount their own board; a hardcoded id here would make one
    // of them unaddressable and the other ambiguous.
    grid("reports-grid");
    expect(screen.getByTestId("reports-grid")).toBeInTheDocument();
  });

  it("applies the injected row and gap classes verbatim", () => {
    // ★ The Dashboard passes density classes and Reports passes a fixed pair, so
    // this component must not rewrite or default either one.
    grid();
    const el = screen.getByTestId("test-grid");
    expect(el.className).toContain("auto-rows-[80px]");
    expect(el.className).toContain("gap-3");
  });

  it("keeps the four-column dense template that IS the placement model", () => {
    grid();
    const el = screen.getByTestId("test-grid");
    for (const c of ["grid-cols-1", "lg:grid-cols-2", "xl:grid-cols-4", "grid-flow-row-dense"]) {
      expect(el.className).toContain(c);
    }
  });

  it("renders NO scroller of its own", () => {
    // ★★★ Pins the ★★★ block in `arrangement-grid.tsx`. A nested
    // `overflow-y-auto` here sizes to its content, so `scrollHeight ===
    // clientHeight` and the drag autoscroll silently stops working — the real
    // scroller is the enclosing card's `contentRef`. jsdom cannot measure the
    // consequence, so the class is the only thing assertable.
    grid();
    const el = screen.getByTestId("test-grid");
    expect(el.className).not.toContain("overflow-y-auto");
    expect(el.className).not.toContain("overflow-auto");
    expect(el.parentElement?.className ?? "").not.toContain("overflow");
  });
});
