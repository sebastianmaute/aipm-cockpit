import { test, expect, gotoApp, openView } from "./seed";

/**
 * §677 — the Reports "By priority" block must hold its four tiles at the height it
 * opens with. Its catalogue height is one 120px row, and the batch 14 §426 probe
 * measured its content at 94px in an 89px body, so the tiles' bottom border was
 * cropped by 5px. The block now follows its content's height (`ADAPTIVE_BLOCKS` in
 * `reports.tsx`), as the "At a glance" strip does.
 *
 * ★ Content height is measured the way `use-measured-heights.ts` measures it — the
 * extent of the body's in-flow children plus the body's padding — and compared with
 * the body's clientHeight. jsdom has no layout, so only a browser can make this check.
 * Both widths are the ones the §426 probe used.
 */
for (const width of [1280, 1024]) {
  test(`the By priority block's content fits its default height at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page);
    await openView(page, "Reports");
    const block = page.getByTestId("report-block-byPriority");
    await expect(block).toBeVisible();
    // The height is decided one animation frame after layout; poll until it is stable.
    await expect
      .poll(async () =>
        block.evaluate((section) => {
          const body = section.querySelector<HTMLElement>("[data-arrangement-body]");
          if (!body) return "no body";
          const kids = Array.from(body.children)
            .filter((k) => !["fixed", "absolute"].includes(getComputedStyle(k).position))
            .map((k) => k.getBoundingClientRect())
            .filter((r) => r.width !== 0 || r.height !== 0);
          if (kids.length === 0) return "no content";
          const extent = Math.max(...kids.map((r) => r.bottom)) - Math.min(...kids.map((r) => r.top));
          const bs = getComputedStyle(body);
          const content = extent + parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom);
          return content <= body.clientHeight ? "fits" : `overflows: ${content}px in ${body.clientHeight}px`;
        }),
      )
      .toBe("fits");
  });
}
