import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

// Print regression guard. Under emulated print media, a print-root view must:
//   1. carry NO inner clipping scrollers (overflow auto/scroll/hidden) — those
//      print a scrollbar AND clip content to one page;
//   2. NOT pin the .print-root box to a single page height (bottom:auto, so the
//      abs box grows to content height and paginates);
//   3. render NO rounded/bordered container boxes (border + radius stripped).
// Open Points is a print-root view with the heavy table scroller, a good probe.

test("print media: no clipping scrollers, no pinned height, no rounded boxes", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Open Points");
  await waitForViewSettled(page);

  await page.emulateMedia({ media: "print" });

  const evidence = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".print-root");
    if (!root) return { error: "no .print-root found" } as const;

    const scrollers: string[] = [];
    let roundedBoxes = 0;

    root.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const cs = getComputedStyle(el);
      // A REAL print clipper: a visible scrollbar (auto/scroll), or an
      // overflow:hidden box that actually clips taller content. Tiny inline
      // `truncate` spans and fixed-size <svg> icons (overflow:hidden but not
      // clipping a scroll region) are NOT the bug.
      const oy = cs.overflowY;
      const ox = cs.overflowX;
      const scrolls = oy === "auto" || oy === "scroll" || ox === "auto" || ox === "scroll";
      const clipsTall =
        (oy === "hidden" && el.scrollHeight > el.clientHeight + 1) ||
        (ox === "hidden" && el.scrollWidth > el.clientWidth + 1);
      const srOnly = /(^|\s)sr-only(\s|$)/.test(String(el.className));
      if ((scrolls || clipsTall) && el.tagName !== "svg" && !srOnly) {
        scrollers.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`);
      }
      // The user's "rounded boxes" = the structural card/scroller wrappers:
      // a corner radius AND a `border-line` border. That is exactly the fix
      // target — small semantic chips/badges are out of scope.
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const borderW = parseFloat(cs.borderTopWidth) || 0;
      const cls = String(el.className);
      if (radius > 0 && borderW > 0 && /border-line/.test(cls) && /rounded/.test(cls)) {
        roundedBoxes++;
      }
    });

    // Pagination check: the print-root box must CONTAIN its own content (box
    // height ≈ scrollHeight). When pinned to one page (the bug), the box is a
    // page tall while scrollHeight is the full content → clipped.
    const rect = root.getBoundingClientRect();
    return {
      scrollerCount: scrollers.length,
      scrollersSample: scrollers.slice(0, 6),
      roundedBoxes,
      rootHeight: Math.round(rect.height),
      rootScrollHeight: root.scrollHeight,
      rootBottom: getComputedStyle(root).bottom,
    } as const;
  });

  console.log("PRINT EVIDENCE:", JSON.stringify(evidence, null, 2));

  if ("error" in evidence) throw new Error(evidence.error);

  expect(evidence.scrollerCount, "clipping scrollers under print").toBe(0);
  expect(evidence.roundedBoxes, "rounded bordered boxes under print").toBe(0);
  expect(
    evidence.rootHeight,
    "print-root box must contain full content (not clipped to one page)",
  ).toBeGreaterThanOrEqual(evidence.rootScrollHeight - 2);
});

/**
 * The Dashboard is the one print-root whose layout is a GRID WITH A FIXED ROW
 * TRACK, and that interacts badly with the overflow reset the test above pins.
 *
 * ★★★ THE TWO RULES ARE ONLY SAFE TOGETHER. `.print-root [class*="overflow-"]`
 * frees every tile's content, but `auto-rows-[80px]` matches neither that
 * selector nor `[class*="max-h-"]`, so before `.print-root [class*="auto-rows-"]`
 * existed a tile box stayed `span x 80px` while its content spilled straight over
 * the tiles below — and the border-strip rule removes the only delimiter. On the
 * seeded board this was the NORMAL case, not an edge one: six of nine tiles
 * overflowed and seven pairs painted into one another, `insights` covering the
 * whole of `raid`.
 *
 * ★★ BOX RECTS CANNOT SEE IT — grid never overlaps its own items, so every
 * `getBoundingClientRect` pair was disjoint while the printout was unreadable
 * (measured: the first cut of this probe reported zero overlaps against the
 * broken CSS). What overlaps is the PAINTED extent, which is the box unioned
 * with every descendant's rect. That distinction is the whole test.
 *
 * ★ Screen geometry is `e2e/dashboard-grid.spec.ts`'s job; this only ever runs
 * under emulated print media.
 */
test("print media: no dashboard tile paints over another", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await gotoApp(page);
  await openView(page, "Dashboard");
  await waitForViewSettled(page);

  await page.emulateMedia({ media: "print" });

  const evidence = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid^="tile-"]')];
    const rows = tiles.map((el) => {
      const r = el.getBoundingClientRect();
      let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
      el.querySelectorAll<HTMLElement>("*").forEach((c) => {
        const cr = c.getBoundingClientRect();
        if (cr.width === 0 && cr.height === 0) return;   // display:none / print:hidden
        top = Math.min(top, cr.top); bottom = Math.max(bottom, cr.bottom);
        left = Math.min(left, cr.left); right = Math.max(right, cr.right);
      });
      return {
        id: el.getAttribute("data-testid")!,
        box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        painted: { top, bottom, left, right },
        overflow: Math.round(bottom - r.bottom),
      };
    });

    const collisions: string[] = [];
    for (const a of rows) {
      for (const b of rows) {
        if (a === b) continue;
        const vx = Math.min(a.painted.right, b.box.right) - Math.max(a.painted.left, b.box.left);
        const vy = Math.min(a.painted.bottom, b.box.bottom) - Math.max(a.painted.top, b.box.top);
        if (vx > 1 && vy > 1) {
          collisions.push(`${a.id} paints ${Math.round(vx)}x${Math.round(vy)} into ${b.id}`);
        }
      }
    }
    const grid = document.querySelector<HTMLElement>('[data-testid="dashboard-grid"]');
    return {
      autoRows: grid ? getComputedStyle(grid).gridAutoRows : "NO GRID",
      tileCount: rows.length,
      spilling: rows.filter((r) => r.overflow > 1).map((r) => `${r.id} +${r.overflow}px`),
      collisions,
    };
  });

  console.log("DASHBOARD PRINT EVIDENCE:", JSON.stringify(evidence, null, 2));

  // Guard: with no tiles on the board every assertion below is vacuous.
  expect(evidence.tileCount, "the seeded dashboard rendered no tiles").toBeGreaterThan(4);
  expect(evidence.autoRows, "the row track must be content-sized on paper").toBe("auto");
  expect(evidence.spilling, "tiles whose content escapes their own box").toEqual([]);
  expect(evidence.collisions, "tiles painting over one another").toEqual([]);
});
