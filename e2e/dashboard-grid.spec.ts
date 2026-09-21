import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";
import { DASHBOARD_LAYOUT_KEY } from "../src/app/dashboard-layout-store";
import { DASHBOARD_BURN_UPGRADE } from "../src/app/dashboard-layout";
import { rowsForHeight } from "../src/app/arrangement-measure";
import { tileById, type DashboardTileId } from "../src/app/dashboard-tiles";
import { KPI_STRIP_COLS, type KpiCellCount } from "../src/app/dashboard-sections/dashboard-kpi-strip";

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

/**
 * Everything the measuring hook reads for one tile, read the same way from the live page.
 * ★★ Nothing here is quoted: the row unit, gap, padding and chrome are the page's own numbers, so
 * an expectation built from them follows a restyle instead of pinning today's pixels.
 */
async function tileReading(page: import("@playwright/test").Page, id: DashboardTileId) {
  const r = await page.getByTestId(`tile-${id}`).evaluate((section) => {
    const grid = section.closest("[data-arrangement-grid]") as HTMLElement;
    const body = section.querySelector("[data-arrangement-body]") as HTMLElement;
    const gs = getComputedStyle(grid);
    const bs = getComputedStyle(body);
    const kids = [...body.children].map((k) => k.getBoundingClientRect());
    return {
      rowUnit: parseFloat(gs.gridAutoRows),
      gap: parseFloat(gs.rowGap),
      sectionH: section.getBoundingClientRect().height,
      bodyClient: body.clientHeight,
      bodyScroll: body.scrollHeight,
      content: Math.max(...kids.map((k) => k.bottom)) - Math.min(...kids.map((k) => k.top))
        + parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom),
    };
  });
  const spec = tileById(id)!;
  return {
    ...r,
    /** Rows the tile spans on screen, inverted from `n * unit + (n - 1) * gap`. */
    renderedRows: Math.round((r.sectionH + r.gap) / (r.rowUnit + r.gap)),
    /** Rows the hook should have chosen, from the same readings. */
    measuredRows: rowsForHeight(r.content, r.rowUnit, r.gap, r.sectionH - r.bodyClient, spec.minH, spec.maxH),
  };
}

/** Seeds one stored layout for the e2e project (`e2e-1`, see the dense-packing describe). */
async function seedLayout(page: import("@playwright/test").Page, layout: unknown) {
  await page.addInitScript(
    ([key, l]) => {
      localStorage.setItem(key as string, JSON.stringify({ "e2e-1": l }));
    },
    [DASHBOARD_LAYOUT_KEY, layout] as const,
  );
}

/**
 * ★★ `hSet: true` MAKES A HEIGHT A RECORDED CHOICE, which is the only kind of height a
 * row-unit assertion can pin now: every tile WITHOUT it is measured to its content, so its height
 * says nothing about the `H_CLASS` rule it would otherwise prove. The layout carries the burn
 * upgrade id so `upgradeDashboardLayout` leaves these entries as written.
 */
const CHOSEN_HEIGHTS_LAYOUT = {
  v: 1,
  board: [
    { id: "burn", w: 2, h: 8, hSet: true },
    { id: "upcoming", w: 2, h: 2, hSet: true },
  ],
  hidden: [],
  upgrades: [DASHBOARD_BURN_UPGRADE],
};

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

  test("places the KPI tile BESIDE the burn tile on xl, not below it (§585)", async ({ page }) => {
    // ★ The default board (no stored layout): burn w2 takes columns 1-2, and
    // the KPI tile's w:2 default lets dense packing put it in columns 3-4 of
    // burn's first rows. At its former w:4 it could only fit below burn.
    // ★★ Neither tile carries `hSet` here, so both render at their MEASURED
    // heights — burn well under its stored h:8 on this seed. The assertion is
    // about WIDTH-driven placement and holds at any height.
    const burn = await tileBox(page, "burn");
    const kpi = await tileBox(page, "kpi");
    expect(kpi.x).toBeGreaterThanOrEqual(burn.x + burn.width - 1.5);
    // Overlapping vertical ranges: each starts before the other ends.
    expect(kpi.y).toBeLessThan(burn.y + burn.height);
    expect(burn.y).toBeLessThan(kpi.y + kpi.height);
  });

  test("a tile with no chosen height renders at its measured height", async ({ page }) => {
    // ★★ The expectation is computed from the page's own readings through the same pure
    // conversion the hook uses — never a row count written here. `expect.poll` because the
    // measurement lands one animation frame after mount.
    await expect.poll(async () => {
      const r = await tileReading(page, "upcoming");
      return r.renderedRows === r.measuredRows ? "match" : `rendered ${r.renderedRows}, measured ${r.measuredRows}`;
    }).toBe("match");
    // ★ Not vacuous: the measurement actually MOVED the tile off its stored default. Without
    // this, a `renderedH` that ignored the measurement would pass whenever the two coincide.
    expect((await tileReading(page, "upcoming")).renderedRows).not.toBe(tileById("upcoming")!.h);
    // …and below `maxH` the body holds its content without an inner scroll.
    const r = await tileReading(page, "upcoming");
    if (r.renderedRows < tileById("upcoming")!.maxH) expect(r.bodyScroll).toBeLessThanOrEqual(r.bodyClient);
  });

  test("a tile measured shorter than its default renders shorter", async ({ page }) => {
    // ★★ This is the test a `scrollHeight` measurement fails: scrollHeight equals the box when the
    // content fits, so it can grow a tile but never shrink one. `burn`'s chart has a natural
    // height well under its tall default on this seed; the guard below proves that precondition
    // from the page, so the test cannot pass on a tile that had nothing to shrink to.
    const spec = tileById("burn")!;
    await expect.poll(async () => (await tileReading(page, "burn")).renderedRows).toBeLessThan(spec.h);
    const r = await tileReading(page, "burn");
    expect(r.measuredRows).toBeLessThan(spec.h);
    expect(r.renderedRows).toBe(r.measuredRows);
  });
});

test.describe("dashboard grid chosen heights", () => {
  test.beforeEach(async ({ page }) => {
    await seedLayout(page, CHOSEN_HEIGHTS_LAYOUT);
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Dashboard");
    await waitForViewSettled(page);
  });

  test("applies the 80px comfortable row unit to the container AND to a real tile", async ({ page }) => {
    const m = await gridMetrics(page);
    expect(m.autoRows).toBe("80px");

    // ★ The container property alone would not prove the row unit reaches a
    // tile: `row-span-2` is a SECOND literal class table (`H_CLASS`) that
    // Tailwind must also have emitted. A h:2 tile is two row units plus the row
    // gap between them. ★★ `upcoming` carries `hSet: true` in the seed: an
    // unflagged tile is measured to its content, so its height would say
    // nothing about `row-span-2`.
    const upcoming = await tileBox(page, "upcoming"); // seeded h: 2, chosen
    expect(Math.abs(upcoming.height - (2 * 80 + m.rowGap))).toBeLessThan(1.5);
  });

  test("emitted the Dashboard-only height utilities — an h:8 tile is eight row units tall", async ({ page }) => {
    // ★★ Spec C: `H_CLASS` gained literal `row-span-5`…`row-span-8`, and only
    // the rendered box can prove Tailwind emitted the rule — a missing one
    // would collapse the tile to one implicit row with every unit test green.
    // ★★ `burn` is seeded at h:8 WITH `hSet: true`. Unflagged, it is measured,
    // and on this seed its chart measures well under eight rows — see "a tile
    // measured shorter than its default renders shorter".
    const m = await gridMetrics(page);
    expect(m.autoRows).toBe("80px");
    const burn = await tileBox(page, "burn");
    expect(Math.abs(burn.height - (8 * 80 + 7 * m.rowGap))).toBeLessThan(1.5);
    // …and it is two of the four xl tracks wide.
    expect(Math.abs(burn.width - (m.contentWidth - m.colGap) / 2)).toBeLessThan(1.5);
  });
});

test.describe("dashboard grid measured heights across reload and density", () => {
  test.beforeEach(async ({ page }) => {
    // ★ These tests CLICK, and the auto-launched guided tour's backdrop intercepts pointer
    // events (the same reason `seed-content.spec.ts` seeds `tourSeen`). The script re-runs on
    // the reload below, which only re-asserts the same flag.
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Dashboard");
  });

  const UPCOMING = "Upcoming & overdue";
  const storedUpcoming = (page: import("@playwright/test").Page) =>
    page.evaluate((key) => {
      const all = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, { board: { id: string }[] }>;
      return all["e2e-1"]?.board.find((b) => b.id === "upcoming") ?? null;
    }, DASHBOARD_LAYOUT_KEY);
  const pickHeight = async (page: import("@playwright/test").Page, v: number) => {
    await page.getByRole("button", { name: `More actions – ${UPCOMING}`, exact: true }).click();
    await page.getByRole("radio", { name: `Height ${v} – ${UPCOMING}`, exact: true }).click();
    await page.keyboard.press("Escape");
  };

  test("an explicitly resized tile keeps its height across a reload", async ({ page }) => {
    await expect.poll(async () => {
      const r = await tileReading(page, "upcoming");
      return r.renderedRows === r.measuredRows;
    }).toBe(true);
    const measured = (await tileReading(page, "upcoming")).renderedRows;
    const spec = tileById("upcoming")!;
    // A value the measurement did NOT choose, so the reload below can tell the two apart.
    const chosen = measured < spec.maxH ? measured + 1 : measured - 1;
    await pickHeight(page, chosen);
    await expect.poll(async () => (await tileReading(page, "upcoming")).renderedRows).toBe(chosen);
    await expect.poll(() => storedUpcoming(page)).toMatchObject({ h: chosen, hSet: true });

    await page.reload();
    await openView(page, "Dashboard");
    await waitForViewSettled(page);
    // After the frame in which an unflagged tile would have been re-measured.
    expect((await tileReading(page, "upcoming")).renderedRows).toBe(chosen);
  });

  test("choosing the height already shown still records it as a choice (review focus 3)", async ({ page }) => {
    await expect.poll(async () => {
      const r = await tileReading(page, "upcoming");
      return r.renderedRows === r.measuredRows;
    }).toBe(true);
    const shown = (await tileReading(page, "upcoming")).renderedRows;
    // ★ The ⋮ menu must show the RENDERED height, or this radio is not the checked one.
    await page.getByRole("button", { name: `More actions – ${UPCOMING}`, exact: true }).click();
    await expect(page.getByRole("radio", { name: `Height ${shown} – ${UPCOMING}`, exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await pickHeight(page, shown);
    await expect.poll(() => storedUpcoming(page)).toMatchObject({ h: shown, hSet: true });
  });

  test("a width change announces the RENDERED height, not the stored default", async ({ page }) => {
    // ★★ The third height reader. jsdom measures nothing, so a unit test sees rendered === stored
    // and cannot tell the two apart; only a measured tile can.
    await expect.poll(async () => {
      const r = await tileReading(page, "upcoming");
      return r.renderedRows === r.measuredRows;
    }).toBe(true);
    const shown = (await tileReading(page, "upcoming")).renderedRows;
    expect(shown).not.toBe(tileById("upcoming")!.h);   // else stored and rendered coincide
    const wider = tileById("upcoming")!.maxW;
    await page.getByRole("button", { name: `More actions – ${UPCOMING}`, exact: true }).click();
    await page.getByRole("radio", { name: `Width ${wider} – ${UPCOMING}`, exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "resized to" }))
      .toHaveText(`${UPCOMING} resized to ${wider} by ${shown}`);
  });

  test("a density change re-measures", async ({ page }) => {
    const before = await tileReading(page, "upcoming");
    expect(before.rowUnit).toBe(80);

    await openView(page, "Settings");
    await page.getByRole("button", { name: "Appearance", exact: true }).first().click();
    await page.getByRole("radiogroup", { name: "Density", exact: true })
      .getByRole("radio", { name: "Compact", exact: true }).click();
    // ★ Not `openView`: off the Dashboard its nav button carries a count badge, so its text is no
    // longer exactly "Dashboard" and `openView`'s whole-string match never resolves.
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Dashboard/ }).click();
    await waitForViewSettled(page);

    // Derived from the NEW page readings: the row unit moved, and the rendered height follows
    // the measurement taken against it.
    // ★★ What this does NOT cover: the modern shell renders only the active view, so the
    // Dashboard REMOUNTS on the way back and this pass is the MOUNT trigger at the new unit. The
    // in-place density trigger (the hook's `density` dependency) is pinned by
    // `use-measured-heights.test.tsx`, not here.
    await expect.poll(async () => {
      const r = await tileReading(page, "upcoming");
      return r.rowUnit !== before.rowUnit && r.renderedRows === r.measuredRows
        ? "match" : `unit ${r.rowUnit}, rendered ${r.renderedRows}, measured ${r.measuredRows}`;
    }).toBe("match");
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
 * ★★ At a 1280px viewport the half-width KPI tile is too narrow for five or
 * six cells in one row, so `KPI_STRIP_COLS` wraps them. The number of rows is
 * DERIVED here from that constant and the strip's measured container width
 * (`expectedKpiRows`), not written down, so a re-tuned breakpoint moves the
 * expectation with it. Only a real layout can show the wrapped rows still fit
 * the tile BODY (the `overflow-auto` box under the chrome) — since the tile is
 * measured, that no-scroll check is a check on measurement — so this runs in
 * both densities.
 * ★ R/A/G is always a cell since the Progress tile merged into this one, so
 * the two counts reachable by seeding are the strip with and without CPI.
 *
 * ★ This seeds EVM data straight into the IndexedDB tasks store the seed
 * fixture wrote (the page is still on its same-origin `/favicon.ico` here):
 * every task gets an estimate, so the tasks already due by `FROZEN_NOW` make
 * SPI non-null; booked minutes also make CPI non-null (`evm.ts`).
 *
 * ★★★ `timeSpentMinutes` IS WRITTEN ON BOTH BRANCHES, AND THE ZERO IS THE
 * LOAD-BEARING ONE. The sample master now authors effort on every task (SPI
 * 0.82 / CPI 0.88 as of `DEMO_AS_OF`), so a spread that merely OMITS the key
 * when `booked` is false inherits the master's booked minutes, CPI stays
 * non-null, and the five-cell case silently becomes a six-cell one — the test
 * would still pass its row-count and no-scroll assertions while measuring
 * the wrong strip. An earlier revision of this comment said the sample carried
 * no estimates and the strip showed three cells; that was true when written and
 * was falsified by authoring EVM data into the master.
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
          store.put({ ...task, originalEstimateMinutes: 480, timeSpentMinutes: booked ? 240 : 0 });
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), withBookedHours);
}

const KPI_FIT_VW = 1280;

/** Tailwind v4's named container sizes this strip's classes use, in rem. */
const CONTAINER_REM: Record<string, number> = { "2xs": 18, "2xl": 42, "4xl": 56 };

/** The rows `KPI_STRIP_COLS[cells]` lays `cells` cells into at a container
 *  `widthPx` wide (16px root): the widest active `grid-cols-N`, each cell's
 *  active `*:col-span-K`, the last two's active `nth-last` span, packed in order. */
function expectedKpiRows(cells: KpiCellCount, widthPx: number): number {
  const active = KPI_STRIP_COLS[cells].split(" ").map((tok) => {
    const m = /^@(?:\[(\d+)rem\]|([a-z0-9]+)):(.+)$/.exec(tok)!;
    const rem = m[1] ? Number(m[1]) : CONTAINER_REM[m[2]];
    if (rem === undefined) throw new Error(`unknown container size in ${tok}`);
    return { min: rem * 16, rule: m[3] };
  }).filter((t) => widthPx >= t.min).sort((a, b) => a.min - b.min);
  const last = (re: RegExp) => active.map((t) => re.exec(t.rule)).filter(Boolean).pop();
  const cols = Number(last(/^grid-cols-(\d+)$/)?.[1] ?? 1);
  const span = Number(last(/^\*:col-span-(\d+)$/)?.[1] ?? 1);
  const tailSpan = Number(last(/^\*:nth-last-\[-n\+2\]:col-span-(\d+)$/)?.[1] ?? span);
  let rows = 1, used = 0;
  for (let i = 0; i < cells; i++) {
    const w = Math.min(cols, i >= cells - 2 ? tailSpan : span);
    if (used + w > cols) { rows += 1; used = 0; }
    used += w;
  }
  return rows;
}

for (const density of ["comfortable", "compact"] as const) {
  for (const cells of [6, 5] as const) {
    test(`the ${cells}-cell KPI strip fits its tile body at half-width xl — ${density} (§585)`, async ({ page }) => {
      await seedEvm(page, cells === 6);
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
      await expect(tile.getByText("Effort CPI")).toHaveCount(cells === 6 ? 1 : 0);

      const fit = await tile.evaluate((section) => {
        const body = section.lastElementChild as HTMLElement; // the overflow-auto body
        const wrapper = body.querySelector('[class*="@container"]') as HTMLElement;
        const strip = wrapper.firstElementChild as HTMLElement;
        const cellBottoms = [...strip.children].map((c) => c.getBoundingClientRect().bottom);
        const cs = getComputedStyle(wrapper);
        return {
          count: strip.children.length,
          // The container query reads the wrapper's CONTENT box.
          containerWidth: wrapper.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          rows: new Set([...strip.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
          lowestCell: Math.max(...cellBottoms),
          bodyBottom: body.getBoundingClientRect().bottom,
          scrollHeight: body.scrollHeight,
          clientHeight: body.clientHeight,
        };
      });
      expect(fit.count).toBe(cells);
      const rows = expectedKpiRows(cells, fit.containerWidth);
      expect(fit.rows, `rows at a ${fit.containerWidth}px container`).toBe(rows);
      // The case this exists for: the cells really did wrap.
      expect(rows).toBeGreaterThan(1);
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
 * Seeded board (each tile inside its own min/max so `reconcile` clamps none of
 * them; `upcoming` and `kpi` are ungated, and `raid` is gated on `showRaid`,
 * which the seed turns on). ★★ None carries `hSet`, so all three render at
 * their MEASURED heights, not the stored h:2 below — `kpi` in particular is
 * adjustable (`minH`/`maxH` in DASHBOARD_TILES) and takes whatever its strip
 * measures at w:4. The row numbers are therefore nominal. That does not change
 * what this test measures: the backfill turns on `kpi`'s WIDTH (w:4 cannot fit
 * the two free columns beside `upcoming`), never on any height, and the
 * assertions compare tops:
 *   1. upcoming w2 h2        → rows 1-2, cols 1-2
 *   2. kpi      w4 h2        → cannot fit the two free columns, so below upcoming
 *   3. raid     w2 h2        → dense pulls it UP into rows 1-2, cols 3-4
 * Without `dense` it would sit below kpi.
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
    { id: "raid", w: 2, h: 2 },
  ],
  hidden: [
    "topActions", "insights", "trends",
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
    await expect(page.getByTestId("tile-milestones")).toHaveCount(0);

    const upcoming = await tileBox(page, "upcoming");
    const kpi = await tileBox(page, "kpi");
    const raid = await tileBox(page, "raid");

    // DOM order is upcoming → kpi → raid; only dense packing can put the
    // third one level with the first.
    expect(Math.abs(raid.y - upcoming.y)).toBeLessThan(1.5);
    expect(raid.y).toBeLessThan(kpi.y);
    // …and it lands in the columns kpi vacated, not on top of upcoming.
    expect(raid.x).toBeGreaterThan(upcoming.x + upcoming.width - 1.5);
  });
});
