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
// ★★ THIS FILE COVERS ALL SIX VIEWS - but NOT every cell in them. An earlier cut
// measured only four while its own comment claimed six; Resources and Manage roles
// were simply missing. Found by a whole-branch review, not a per-task one.
//
// *** THE RESOURCES LINE IS BLIND TO THE ONE CELL THAT NEEDED THE FIX. The resource
// directory bulk-select <th> is gated on `bulkEnabled = !!onBulkEditResources`, and
// the e2e seed passes no such handler, so it never renders here. Measured: removing
// its `font-medium` leaves this spec GREEN at 37 cells, all 500. That cell is
// covered ONLY by a unit test in `resource-directory.test.tsx`, which asserts the
// CLASS rather than the computed weight. Do not read a green Resources run as
// covering it.
// comment claimed to close the gap for six — Resources and Manage roles were
// simply missing from the list, so a dropped `font-medium` on the resource
// directory's bulk-select cell or the roles table's trailing cell would have
// shipped silently. Found by a whole-branch review, not by a per-task one.
//
// ★ The uppercase assertion guards the activity log specifically: its three sort
// labels carried `uppercase tracking-wide` — the last such headers in the app —
// and the primitive emits neither.
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

// All SIX panels the slice converted. `hash` is for a view whose sidebar entry
// is a child that may be collapsed at scan time — the same fallback
// `e2e/a11y.spec.ts` uses for its own sub-children.
const VIEWS = [
  { label: "Changes" },
  { label: "Stakeholders" },
  { label: "RAID" },
  { label: "Activity" },
  { label: "Resources" },
  { label: "Manage roles", hash: "#manage-roles" },
] as const;

for (const view of VIEWS) {
  const label = view.label;
  const hash = (view as { hash?: string }).hash;
  test(`header row is uniform in ${label}`, async ({ page }) => {
    await gotoApp(page);
    if (hash) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
    } else {
      await openView(page, label);
    }
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
