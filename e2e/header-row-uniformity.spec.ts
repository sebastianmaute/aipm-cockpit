// Header rows must not SPLIT. `SortResizeTh` emits `font-medium` (500) while
// Tailwind preflight resets font-weight on h1-h6 ONLY — there is no `th` rule,
// `globals.css` declares none, and `TABLE_HEAD_CLASS` sets none — so a raw `<th>`
// left beside a converted one keeps the UA `bold` (700) and the row renders at
// TWO weights. Six panels adopted the primitive, and each had raw cells in the
// same row that needed `font-medium` added by hand.
//
// ★★★ NOTHING ELSE CAN SEE THIS. jsdom has no layout, so no unit test can read a
// computed weight in either direction; axe has no rule for it; and these panels
// carry no visual baseline. The slice that converted them owed a manual
// eye-verify here — this measures it instead, because an owed manual check rots
// and a gate does not.
//
// ★ The uppercase assertion guards the activity log specifically: its three sort
// labels carried `uppercase tracking-wide` — the last such headers in the app —
// and the primitive emits neither.
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

const VIEWS = [
  { label: "Changes" },
  { label: "Stakeholders" },
  { label: "RAID" },
  { label: "Activity" },
] as const;

for (const { label } of VIEWS) {
  test(`header row is uniform in ${label}`, async ({ page }) => {
    await gotoApp(page);
    await openView(page, label);
    await waitForViewSettled(page);

    const cells = await page.evaluate(() => {
      const th = Array.from(document.querySelectorAll("thead th"));
      return th.map((el) => {
        const cs = getComputedStyle(el);
        const btn = el.querySelector("button");
        const bcs = btn ? getComputedStyle(btn) : null;
        return {
          text: (el.textContent ?? "").trim().slice(0, 24),
          weight: cs.fontWeight,
          transform: cs.textTransform,
          btnTransform: bcs?.textTransform ?? null,
        };
      });
    });

    // Positive observable: a view that failed to render would report zero cells
    // and every assertion below would pass vacuously.
    expect(cells.length).toBeGreaterThan(2);

    const weights = [...new Set(cells.map((c) => c.weight))];
    const transforms = [...new Set(cells.map((c) => c.transform))];
    const btnTransforms = [...new Set(cells.map((c) => c.btnTransform ?? "").filter((x) => x !== ""))];

    console.log(
      `[MEASURE] ${label}: cells=${cells.length} weights=${JSON.stringify(weights)} ` +
        `transforms=${JSON.stringify(transforms)} btnTransforms=${JSON.stringify(btnTransforms)}`,
    );

    // The row must not split: one weight across every header cell.
    expect(weights, `${label} header row has mixed font-weights`).toHaveLength(1);
    // And nothing may still be shouting.
    expect([...transforms, ...btnTransforms]).not.toContain("uppercase");
  });
}
