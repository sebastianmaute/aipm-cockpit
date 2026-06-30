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
