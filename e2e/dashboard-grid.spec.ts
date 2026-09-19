import { test, expect, gotoApp, openView } from "./seed";
import { DASHBOARD_LAYOUT_KEY } from "../src/app/dashboard-layout-store";
import { DASHBOARD_BURN_UPGRADE } from "../src/app/dashboard-layout";

/**
 * The ONE measurement of the Dashboard grid that no unit test can make.
 *
 * ★★★ jsdom HAS NO LAYOUT ENGINE, so `dashboard-grid.test.tsx` can only assert
 * that a class STRING was rendered. It cannot see whether Tailwind ever EMITTED
 * that class — and an interpolated `col-span-${w}` emits nothing, leaving every
 * tile one column wide with the entire unit suite green. Everything here is
 * therefore read off COMPUTED GEOMETRY (`getComputedStyle` on the container,
 * `getBoundingClientRect` on real tiles); a class-string assertion in this file
 * would prove nothing the unit suite has not already proven.
 *
 * ★ The responsive clamp lives ENTIRELY in `W_CLASS`'s literal `lg:`/`xl:`
 * variants plus the container's `lg:grid-cols-2 xl:grid-cols-4` — there is no
 * width measurement and no ResizeObserver anywhere in the feature. Resizing the
 * viewport mid-test and re-reading the computed style is exactly the right probe
 * for that claim: if any of it were JavaScript, this would be the wrong test.
 */

/** Tailwind's default breakpoints: `lg` = 1024px, `xl` = 1280px. */
const XL = 1600;
const LG = 1100;
const SM = 900;

/** Computed grid-container facts, read in one round trip. */
async function gridMetrics(page: import("@playwright/test").Page) {
  return page.getByTestId("dashboard-grid").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      tracks: cs.gridTemplateColumns.split(/\s+/).filter(Boolean).map(parseFloat),
      autoRows: cs.gridAutoRows,
      autoFlow: cs.gridAutoFlow,
      colGap: parseFloat(cs.columnGap),
      rowGap: parseFloat(cs.rowGap),
      // Content box: the width every column track is resolved against.
      contentWidth: el.clientWidth,
    };
  });
}

async function tileBox(page: import("@playwright/test").Page, id: string) {
  const box = await page.getByTestId(`tile-${id}`).boundingBox();
  expect(box, `tile-${id} is not on the board`).not.toBeNull();
  return box!;
}

test.describe("dashboard grid geometry", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Dashboard");
  });

  test("resolves to four equal column tracks at xl", async ({ page }) => {
    const m = await gridMetrics(page);
    expect(m.tracks).toHaveLength(4);
    // ★★ WHICH ASSERTION CATCHES A MISSING `xl:grid-cols-4` DEPENDS ON THE
    // BOARD, and on this one it is the length check above. Measured 2026-09-19:
    // delete `xl:grid-cols-4` from `arrangement-grid.tsx` and this default board
    // (no stored layout, no tile wider than 2 since §585) resolves to TWO tracks,
    // so `toHaveLength(4)` goes red first. A board holding a w:4 tile behaves
    // differently: the width-span describe below seeds one, and under the same
    // mutant its template still lists four entries, of unequal width — so there
    // only a width comparison can see it. The equal-width loop is kept for that
    // shape of failure on this board too.
    for (const w of m.tracks) expect(Math.abs(w - m.tracks[0])).toBeLessThan(1);
    // Pins a DIFFERENT failure: four tracks that do not fill the content box.
    const spanned = m.tracks.reduce((a, b) => a + b, 0) + 3 * m.colGap;
    expect(Math.abs(spanned - m.contentWidth)).toBeLessThan(1.5);
  });

  test("clamps to two tracks below xl and one below lg — with no JavaScript", async ({ page }) => {
    await page.setViewportSize({ width: LG, height: 1000 });
    expect((await gridMetrics(page)).tracks).toHaveLength(2);

    await page.setViewportSize({ width: SM, height: 1000 });
    expect((await gridMetrics(page)).tracks).toHaveLength(1);

    // …and back up, to prove the clamp is a live media query rather than a
    // one-way measurement taken at mount.
    await page.setViewportSize({ width: XL, height: 1000 });
    expect((await gridMetrics(page)).tracks).toHaveLength(4);
  });

  test("applies the 80px comfortable row unit to the container AND to a real tile", async ({ page }) => {
    const m = await gridMetrics(page);
    expect(m.autoRows).toBe("80px");

    // ★ The container property alone would not prove the row unit reaches a
    // tile: `row-span-2` is a SECOND literal class table (`H_CLASS`) that
    // Tailwind must also have emitted. A h:2 tile is two row units plus the row
    // gap between them.
    const upcoming = await tileBox(page, "upcoming"); // catalogue default h: 2
    expect(Math.abs(upcoming.height - (2 * 80 + m.rowGap))).toBeLessThan(1.5);
  });

  test("emitted the Dashboard-only height utilities — an h:8 tile is eight row units tall", async ({ page }) => {
    // ★★ Spec C: `H_CLASS` gained literal `row-span-5`…`row-span-8`, and only
    // the rendered box can prove Tailwind emitted the rule — a missing one
    // would collapse the tile to one implicit row with every unit test green.
    // `burn` is 2×8 by default and first on a fresh board (this seed stores no
    // layout, so the default is what renders).
    const m = await gridMetrics(page);
    expect(m.autoRows).toBe("80px");
    const burn = await tileBox(page, "burn");
    expect(Math.abs(burn.height - (8 * 80 + 7 * m.rowGap))).toBeLessThan(1.5);
    // …and it is two of the four xl tracks wide.
    expect(Math.abs(burn.width - (m.contentWidth - m.colGap) / 2)).toBeLessThan(1.5);
  });

  test("places the KPI tile BESIDE the 2×8 burn tile on xl, not below it (§585)", async ({ page }) => {
    // ★ The default board (no stored layout): burn w2 h8 takes columns 1-2 for
    // eight rows, and the KPI tile's 2×3 default lets dense packing put it in
    // columns 3-4 of burn's first rows. At its former w:4 it could only fit
    // below all eight.
    const burn = await tileBox(page, "burn");
    const kpi = await tileBox(page, "kpi");
    expect(kpi.x).toBeGreaterThanOrEqual(burn.x + burn.width - 1.5);
    // Overlapping vertical ranges: each starts before the other ends.
    expect(kpi.y).toBeLessThan(burn.y + burn.height);
    expect(burn.y).toBeLessThan(kpi.y + kpi.height);
  });
});

/**
 * ★ No catalogue tile defaults to w:4 since §585 moved the KPI tile to 2×3, so
 * the full-row width is measured on a SEEDED w:4 KPI tile. The layout carries
 * the burn upgrade id, or `upgradeDashboardLayout` would resize that 4×2 to
 * 2×3 before it ever rendered.
 * ★ It names two tiles only. `reconcile` re-inserts every other catalogue tile
 * that is on neither list, beside its nearest present neighbour — harmless
 * here: the assertions read the widths of `kpi` and `upcoming`, which a
 * re-inserted tile cannot change, and never their positions.
 */
const W4_LAYOUT = {
  v: 1,
  board: [
    { id: "kpi", w: 4, h: 2 },
    { id: "upcoming", w: 2, h: 2 },
  ],
  hidden: [],
  upgrades: [DASHBOARD_BURN_UPGRADE],
};

test.describe("dashboard grid width spans", () => {
  test.beforeEach(async ({ page }) => {
    // `e2e-1`: see the dense-packing describe below.
    await page.addInitScript(
      ([key, layout]) => {
        localStorage.setItem(key as string, JSON.stringify({ "e2e-1": layout }));
      },
      [DASHBOARD_LAYOUT_KEY, W4_LAYOUT] as const,
    );
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Dashboard");
  });

  test("emitted the width-span utilities — a w:4 tile fills the row, a w:2 tile is half", async ({ page }) => {
    // ★★★ THIS IS THE FAILURE MODE THAT IS INVISIBLE EVERYWHERE ELSE. If
    // `W_CLASS` were built by interpolation, Tailwind would emit no rule, every
    // tile would fall back to a single implicit column, and this is the only
    // assertion in the repo that would notice.
    //
    // ★★ It is ALSO a detector for a missing container template, and on THIS
    // seeded board the only one. Measured 2026-09-19 with `xl:grid-cols-4`
    // deleted from `arrangement-grid.tsx`: the template here reads four entries
    // of unequal width, the seeded w:4 kpi still fills the content box, and the
    // w:2 line fails — upcoming renders about 55px wide instead of half the row.
    const m = await gridMetrics(page);
    const kpi = await tileBox(page, "kpi");           // seeded w: 4 (W4_LAYOUT above)
    const upcoming = await tileBox(page, "upcoming"); // seeded w: 2

    expect(Math.abs(kpi.width - m.contentWidth)).toBeLessThan(1.5);
    expect(Math.abs(upcoming.width - (m.contentWidth - m.colGap) / 2)).toBeLessThan(1.5);
    // Blunt sanity check: a one-column-wide collapse makes both roughly equal.
    expect(kpi.width).toBeGreaterThan(upcoming.width * 1.8);
  });
});

/**
 * §585: nothing that shows a value may be hidden, and a cell reachable only by
 * scrolling inside its tile counts as hidden.
 *
 * ★★ At a 1280px viewport the half-width KPI tile is too narrow for four or
 * five cells in one row, so `KPI_STRIP_COLS` wraps them to a second row — which
 * is why the KPI default is h:3. Only a real layout can show the second row
 * still fits the tile BODY (the `overflow-auto` box under the chrome), so this
 * measures it, in both densities.
 *
 * ★ The sample workspace carries no estimates, so its strip shows three cells
 * only. This seeds EVM data straight into the IndexedDB tasks store the seed
 * fixture wrote (the page is still on its same-origin `/favicon.ico` here):
 * every task gets an estimate, so the tasks already due by `FROZEN_NOW` make
 * SPI non-null; booked minutes also make CPI non-null (`evm.ts`).
 */
async function seedEvm(page: import("@playwright/test").Page, withBookedHours: boolean) {
  await page.evaluate((booked) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("aipm-cockpit");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const all = store.getAll();
      all.onsuccess = () => {
        for (const task of all.result as Record<string, unknown>[]) {
          store.put({ ...task, originalEstimateMinutes: 480, ...(booked ? { timeSpentMinutes: 240 } : {}) });
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), withBookedHours);
}

const KPI_FIT_VW = 1280;

for (const density of ["comfortable", "compact"] as const) {
  for (const cells of [5, 4] as const) {
    test(`the ${cells}-cell KPI strip fits its tile body at half-width xl — ${density} (§585)`, async ({ page }) => {
      await seedEvm(page, cells === 5);
      await page.addInitScript((d) => {
        localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ dashboardDensity: d }));
      }, density);
      await page.setViewportSize({ width: KPI_FIT_VW, height: 1000 });
      await gotoApp(page);
      await openView(page, "Dashboard");

      // Guards: the seed and the density both took, or this measures the wrong
      // board. The row unit is the density's (`dashboard-density.ts`).
      expect((await gridMetrics(page)).autoRows).toBe(density === "compact" ? "72px" : "80px");
      const tile = page.getByTestId("tile-kpi");
      await expect(tile.getByText("Effort SPI")).toBeVisible();
      await expect(tile.getByText("Effort CPI")).toHaveCount(cells === 5 ? 1 : 0);

      const fit = await tile.evaluate((section) => {
        const body = section.lastElementChild as HTMLElement; // the overflow-auto body
        const strip = body.querySelector('[class*="@container"] > div') as HTMLElement;
        const cellBottoms = [...strip.children].map((c) => c.getBoundingClientRect().bottom);
        return {
          count: strip.children.length,
          rows: new Set([...strip.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
          lowestCell: Math.max(...cellBottoms),
          bodyBottom: body.getBoundingClientRect().bottom,
          scrollHeight: body.scrollHeight,
          clientHeight: body.clientHeight,
        };
      });
      expect(fit.count).toBe(cells);
      // The case this exists for: the cells really did wrap.
      expect(fit.rows).toBe(2);
      // Every cell ends inside the body's visible box, and the body has nothing
      // to scroll.
      expect(fit.lowestCell).toBeLessThanOrEqual(fit.bodyBottom + 0.5);
      expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
    });
  }
}

/**
 * Dense packing, measured rather than asserted as a class.
 *
 * ★★ `grid-auto-flow: row dense` is what makes ORDER the entire placement model
 * — a tile too wide for the tail of a row moves down, and a LATER tile that
 * fits backfills the hole it left. A `toHaveCSS("grid-auto-flow", "row dense")`
 * assertion proves the declaration exists; it does not prove any tile ever
 * backfills. This seeds an arrangement whose only correct rendering REQUIRES the
 * backfill, then reads the resulting tops.
 *
 * Seeded board (all three are ungated catalogue tiles; `upcoming` and `progress`
 * are inside their own min/max so `reconcile` cannot clamp either — `kpi`'s
 * stored h:2 is NOT: its `minH` is now 3 (§585 fix round, `maxH` was already 3),
 * so `reconcile` clamps it up to h:3 on load. That clamp does not change what
 * this test measures — the backfill turns on `kpi`'s WIDTH (w:4 cannot fit the
 * two free columns beside `upcoming`), never its height):
 *   1. upcoming w2 h2        → rows 1-2, cols 1-2
 *   2. kpi      w4 h2(→h3)   → cannot fit the two free columns, so rows 3-5
 *   3. progress w2 h2        → dense pulls it UP into rows 1-2, cols 3-4
 * Without `dense` it would sit at rows 5-6, below kpi.
 *
 * ★ Every other tile is HIDDEN, not merely omitted: `reconcile` re-inserts any
 * catalogue tile that is absent from both lists, next to its nearest present
 * catalogue neighbour — which would silently rewrite this order.
 * ★ It carries no `upgrades` list, so the burn upgrade DOES run on it — and
 * leaves kpi at w:4 only because burn is hidden: the upgrade narrows a w:4 KPI
 * tile solely when it moves burn beside it (§585). Unhide burn here and kpi
 * becomes w:2, which fits beside upcoming and voids the backfill this measures.
 */
const DENSE_LAYOUT = {
  v: 1,
  board: [
    { id: "upcoming", w: 2, h: 2 },
    { id: "kpi", w: 4, h: 2 },
    { id: "progress", w: 2, h: 2 },
  ],
  hidden: [
    "topActions", "insights", "raid", "trends",
    "burn", "milestones", "changes", "completionTrend",
  ],
};

test.describe("dashboard grid dense packing", () => {
  test("a later tile backfills the gap an over-wide tile left behind", async ({ page }) => {
    // ★ `e2e-1` is the project id the registry seed in seed.ts installs, and
    // workspace-section passes `currentProjectId` straight through — a layout
    // stored under any other key is loaded by nothing and this test would
    // silently measure the DEFAULT arrangement instead.
    await page.addInitScript(
      ([key, layout]) => {
        localStorage.setItem(key as string, JSON.stringify({ "e2e-1": layout }));
      },
      [DASHBOARD_LAYOUT_KEY, DENSE_LAYOUT] as const,
    );
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Dashboard");

    // Guard: the seed has to have taken. If reconcile rewrote the board, the
    // hidden tiles would still be on it and the tops below would compare the
    // wrong things.
    await expect(page.getByTestId("tile-raid")).toHaveCount(0);

    const upcoming = await tileBox(page, "upcoming");
    const kpi = await tileBox(page, "kpi");
    const progress = await tileBox(page, "progress");

    // DOM order is upcoming → kpi → progress; only dense packing can put the
    // third one level with the first.
    expect(Math.abs(progress.y - upcoming.y)).toBeLessThan(1.5);
    expect(progress.y).toBeLessThan(kpi.y);
    // …and it lands in the columns kpi vacated, not on top of upcoming.
    expect(progress.x).toBeGreaterThan(upcoming.x + upcoming.width - 1.5);
  });
});
