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
// ★★★ THE VIEW LIST TOOK FOUR CUTS, AND EVERY WRONG ONE PASSED GREEN.
// (1) It measured four panels while its comment claimed six.
// (2) A `Resources` entry was added — but `openView(page, "Resources")` clicks the
//     PARENT nav item, which renders `ResourcesReportPanel`, NOT the resource
//     directory. That table lives at `activeTab === "directory"`, reached only by
//     the `Directory` child entry or a `#directory` hash, so the line measured an
//     unrelated, already-converted file and would have passed forever.
// (3) The query was document-wide, and `panel-raid` is one of the two tabpanels
//     this app mounts UNCONDITIONALLY and merely `hidden`s — so EVERY view was
//     silently measuring the RAID header row on top of its own. Measured: it added
//     11 cells to every count.
// (4) `Activity` was in the list and contributed NOTHING. `e2e/seed.ts` never seeds
//     `activityLog`, so that view renders its empty state with no table at all —
//     its '11 cells' were the hidden RAID table's, every run. Its header classes
//     are covered by a unit test in `activity-log-panel.test.tsx` instead.
//
// ★★★ Read that list before adding a view: FOUR different wrong cuts all reported
// success. Check the logged cell COUNT and TEXTS against the table you meant —
// a plausible number is not evidence you measured the right thing.
//
// ★★ NOT EVERY CELL IS COVERED even now. The directory's bulk-select `<th>` is
// gated on `bulkEnabled = !!onBulkEditResources`, and the e2e seed passes no such
// handler, so it never renders here at all. That one cell is covered ONLY by a
// unit test in `resource-directory.test.tsx`, asserting the CLASS rather than the
// computed weight.
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
  { label: "Directory", hash: "#directory" },
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
      // ★★★ SCOPE TO THE VISIBLE PANEL. `panel-raid` and `panel-chat` are mounted
      // UNCONDITIONALLY and merely `hidden`, so a document-wide query picks up the
      // RAID header row in EVERY view — measured: it added 11 cells everywhere and
      // made each count meaningless.
      const panel = document.querySelector("[role=\"tabpanel\"]:not([hidden])");
      const th = Array.from((panel ?? document).querySelectorAll("thead th"));
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
        `transforms=${JSON.stringify(transforms)} TEXTS=${JSON.stringify(cells.map((c)=>c.text))}`,
    );

    // The row must not split: one weight across every header cell.
    expect(weights, `${label} header row has mixed font-weights`).toHaveLength(1);
    // And nothing may still be shouting.
    expect([...transforms, ...btnTransforms]).not.toContain("uppercase");
  });
}
