import { test, expect, gotoApp, openView } from "./seed";

// ★★★ THE ONLY THING IN THIS REPO THAT CAN SEE THIS BUG. `documents-list.tsx`'s
// `shrink-0` + `max-h-80` exist to stop the document preview crushing the list
// to its header, and jsdom has NO LAYOUT ENGINE — `documents-panel.test.tsx`
// pins the three class names and can prove nothing about a rendered height.
// This spec MEASURES, which is also why it asserts numbers rather than saving a
// screenshot for a human to squint at.
//
// ★★ Deliberately NOT a visual-regression spec: a pixel baseline goes red on any
// unrelated restyle and never says WHICH invariant broke. Each assertion below
// names one.
//
// ★★★ HOW THE DOCUMENTS TABLE IS FOUND, and why not the obvious way. Three
// traps, all of them cost a run:
//   1. `[role="table"]` matches an EXPLICIT role attribute only. `DataTable`
//      renders a bare `<table>` whose table role is IMPLICIT, so that selector
//      finds nothing. (RTL's getByRole resolves implicit roles; the DOM API
//      does not.)
//   2. `document.querySelector("table")` returns a HIDDEN pane's table first —
//      `workspace-section.tsx` keeps two tabpanels permanently mounted — so the
//      measurement lands on a zero-height element in another view.
//   3. The document PREVIEW renders tables of its own inside the same column.
// The anchor below is therefore semantic and independent of the classes under
// test. ★★ BOTH halves of it are load-bearing: `data-deeplink-row` is set by
// nine non-test files (RAID's rows among them, inside the permanently-mounted
// `panel-raid`), so the attribute alone does NOT discriminate — the
// `getBoundingClientRect().height > 0` filter is what excludes the hidden
// panes. Do not drop either. Anchoring on `.max-h-80` instead would make the
// class assertions circular.
async function listBoxMetrics(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const table = [...document.querySelectorAll("table")].find(
      (t) => t.getBoundingClientRect().height > 0 && t.querySelector("tr[data-deeplink-row]"),
    );
    const box = table?.closest("div");
    if (!table || !box) return null;
    const rows = table.querySelectorAll("tbody tr");
    const head = table.querySelector("thead");
    const cs = getComputedStyle(box);
    return {
      boxHeight: box.getBoundingClientRect().height,
      scrollHeight: box.scrollHeight,
      maxHeight: cs.maxHeight,
      flexShrink: cs.flexShrink,
      overflowY: cs.overflowY,
      rowCount: rows.length,
      rowHeight: rows.length ? rows[0].getBoundingClientRect().height : 0,
      headHeight: head ? head.getBoundingClientRect().height : 0,
    };
  });
}

test.describe("Documents — the list is sized by its rows, not crushed by the preview", () => {
  test("the list box renders at its content height, not collapsed to the header", async ({ page }) => {
    await gotoApp(page);
    await openView(page, "Documents");

    const m = await listBoxMetrics(page);
    expect(m, "no visible documents table found — the seed or the view changed").not.toBeNull();
    if (!m) return;

    // The defect rendered the box at roughly header + scrollbar with every row
    // clipped away. Guard on the ROWS fitting, not on a magic pixel count.
    const wanted = Math.min(m.headHeight + m.rowCount * m.rowHeight, 320);
    expect(
      m.boxHeight,
      `box ${m.boxHeight}px for ${m.rowCount} rows of ${m.rowHeight}px + ${m.headHeight}px header`,
    ).toBeGreaterThanOrEqual(wanted - 2);

    // Read as COMPUTED style, so a Tailwind rename cannot pass this by leaving
    // the class string intact.
    expect(m.flexShrink, "the list box must not be shrinkable").toBe("0");
    expect(m.maxHeight, "max-h-80 must resolve to 320px").toBe("320px");
    expect(m.overflowY).toBe("auto");
  });

  test("the 20rem cap admits at least six rows", async ({ page }) => {
    await gotoApp(page);
    await openView(page, "Documents");

    const m = await listBoxMetrics(page);
    expect(m).not.toBeNull();
    if (!m || !m.rowHeight) {
      test.skip(true, "no seeded rows to measure a row height from");
      return;
    }

    // ★★ `max-h-80` is 320px and the sticky header lives INSIDE the capped
    // box, so the usable row budget is 320 - headHeight, NOT 320.
    // ★★ THE LOWER BOUND IS THE LOAD-BEARING HALF and it sits exactly on the
    // measured value — a taller row or header turns it red. The upper bound is
    // slack by construction: nothing here pins the row height from below, so
    // this test cannot certify any specific row COUNT quoted elsewhere.
    const usable = 320 - m.headHeight;
    const rowsThatFit = Math.floor(usable / m.rowHeight);
    console.log(
      `[geometry] row=${m.rowHeight}px header=${m.headHeight}px usable=${usable}px -> ${rowsThatFit} rows fit under the cap`,
    );
    expect(rowsThatFit).toBeGreaterThanOrEqual(6);
    expect(rowsThatFit).toBeLessThanOrEqual(9);
  });

  test("at the pane's minimum height the column does not clip content out of reach", async ({ page }) => {
    await gotoApp(page);
    await openView(page, "Documents");

    // ★★★ THE REGRESSION THE FIX COULD HAVE INTRODUCED, and the reason this
    // spec exists at all. Making the list uncrushable moves ALL remaining
    // shrink onto `document-preview.tsx`, which is `overflow-auto` with no
    // `min-h` floor, inside a column with `overflow: visible` under an
    // `overflow-hidden` pane. If that column overflows its pane, the excess is
    // clipped with NO scrollbar anywhere — unreachable by any gesture. The pane
    // is user-resizable down to `min-h-[300px]`, so that is where to look.
    const result = await page.evaluate(() => {
      const table = [...document.querySelectorAll("table")].find(
        (t) => t.getBoundingClientRect().height > 0 && t.querySelector("tr[data-deeplink-row]"),
      );
      const box = table?.closest("div");
      const column = box?.parentElement as HTMLElement | null;
      const pane = column?.closest(".print-root") as HTMLElement | null;
      if (!column || !pane) return null;

      const prevH = pane.style.height;
      const prevMin = pane.style.minHeight;
      // `min-h-[300px]` is the CSS floor, so height alone cannot go below it —
      // set both, matching what a user dragging the resize handle reaches.
      pane.style.height = "300px";
      pane.style.minHeight = "300px";
      void pane.offsetHeight;

      const paneHeight = pane.getBoundingClientRect().height;
      const measured = {
        paneHeight,
        columnClient: column.clientHeight,
        columnScroll: column.scrollHeight,
        columnOverflowY: getComputedStyle(column).overflowY,
        paneClient: pane.clientHeight,
        paneScroll: pane.scrollHeight,
        listHeight: box ? box.getBoundingClientRect().height : 0,
      };

      pane.style.height = prevH;
      pane.style.minHeight = prevMin;
      return measured;
    });

    expect(result, "documents pane not found").not.toBeNull();
    if (!result) return;

    console.log(
      `[geometry] pane squeezed to ${result.paneHeight}px: list=${result.listHeight}px ` +
        `column client=${result.columnClient}/scroll=${result.columnScroll} (${result.columnOverflowY}) ` +
        `pane client=${result.paneClient}/scroll=${result.paneScroll}`,
    );

    // ★★★ ANTI-VACUITY GUARD. If the squeeze did not take, every number above
    // describes the pane at its natural height and the assertion below passes
    // for the wrong reason.
    expect(
      result.paneHeight,
      `pane did not shrink (measured ${result.paneHeight}px) — this spec cannot answer the clipping question`,
    ).toBeLessThanOrEqual(340);

    const clipped = result.paneScroll - result.paneClient;
    expect(
      clipped,
      `content overflows the overflow-hidden pane by ${clipped}px with no scroller — unreachable by any gesture`,
    ).toBeLessThanOrEqual(1);
  });
});
