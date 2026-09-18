// e2e/budget-chart-readout.spec.ts — the burn-down chart's hover/keyboard
// readout (Task 6 of the chart-hover-readout plan). Drives the Reports budget
// chart by mouse and by keyboard, and proves the trigger's accessible name,
// the box's visibility, the SVG guide line and the live region all track the
// same interaction, not just that SOMETHING renders.
//
// ★ `getByRole`'s `name` here is a case-insensitive SUBSTRING match by
// default (the opposite of Testing Library), so `exact: true` guards every
// name that could collide with another control on the page.
//
// ★ The box is queried by `[data-tooltip-portal]`, NOT `getByRole("tooltip")`.
// `TooltipSurface`'s `decorative` prop (chart-readout.tsx) takes the whole
// portaled node out of the accessibility tree — no `role`, `aria-hidden` — so
// a role query finds nothing whether the box is open or not. The live region
// (`[data-readout-live]`) is the box's only accessible counterpart.
import { test, expect, gotoApp, openView } from "./seed";

test("the budget chart reads out values on hover and from the keyboard", async ({ page }) => {
  // Suppress the guided tour, which otherwise intercepts the first real
  // pointer click/move on this view (mirrors e2e/visual.spec.ts's budget
  // history capture).
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await gotoApp(page);
  await openView(page, "Reports");

  const block = page.getByTestId("report-block-budget-report");
  const trigger = block.getByRole("button", { name: /arrow keys/i });
  await expect(trigger).toBeVisible();
  const tip = page.locator("[data-tooltip-portal]");
  await expect(tip).toHaveCount(0);

  // The block sits below several other report blocks and starts off-screen;
  // `boundingBox()` does not scroll the way `.click()`/`.focus()` do, so a
  // mouse.move built from its raw coordinates lands past the current
  // viewport and hits nothing — measured: the box never opened without this
  // (the failure screenshot showed the still-unscrolled top of the Reports
  // view, several blocks above this one).
  await trigger.scrollIntoViewIfNeeded();

  // Hover the chart's centre: the box opens, names the Actual series, and the
  // SVG draws exactly one guide line at the active stop.
  const box = await trigger.boundingBox();
  if (!box) throw new Error("chart has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Actual");
  await expect(page.locator("[data-readout-guide]")).toHaveCount(1);

  // Moving the mouse off the chart closes it again.
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);

  // The keyboard path opens the same box and speaks through the live region,
  // not just the (aria-hidden, roleless) box.
  await trigger.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tip).toBeVisible();
  await expect(page.locator("[data-readout-live]")).toContainText("Planned");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
});
