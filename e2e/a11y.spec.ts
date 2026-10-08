import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, reseedWorkspace, seedTimelogSettings, skipTour, waitForViewSettled } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import {
  HARBOR_DARK, HARBOR_LIGHT,
  MERIDIAN_DARK, MERIDIAN_LIGHT,
  UMBER_DARK, UMBER_LIGHT,
  BEACON_LIGHT,
} from "../src/app/builtin-schemes";
import { resolveSchemeColors } from "../src/app/scheme-tokens";
import type { SchemeColorMap } from "../src/app/scheme-apply";
import { APP_VERSION } from "../src/app/version";
import {
  BOOT_NONCE_ENV,
  checkoutToken,
  judgeBootNonce,
  judgeServedCheckout,
  runStartsDevServer,
} from "../src/app/checkout-token";
import { sealPassphrase, type SealedSecret } from "../src/app/secrets";

// Accessibility gate: scan the critical views (with a DATA-SEEDED project, so
// colour-coded RAG/status states actually render) for WCAG 2.0/2.1 A & AA
// violations, failing on ANY `critical`/`serious` impact — structural (roles,
// names, labels, landmarks, ARIA) AND `color-contrast`, which now passes after
// the palette tuning, the status-chip rework (dark-blue text on the hue tint
// instead of same-hue text), and dropping the opacity-dim on completed rows.
const A11Y_VIEWS = ["Dashboard", "Open Points", "Gantt", "Resources", "Budget", "RAID", "Settings", "Stakeholders", "Changes", "Milestones", "Reports", "Activity", "Time bookings", "AI Assistant", "Next actions", "Insights", "Documents"] as const;

// Views reached by hash (not a top-level sidebar click): Dashboard sub-children
// whose sidebar entry may be collapsed at scan time. Navigating by hash mirrors
// the app's own deep-link path and lands the view deterministically.
const HASH_VIEW: Partial<Record<(typeof A11Y_VIEWS)[number], string>> = {
  "Next actions": "#actions",
  Insights: "#insights",
};

// ★★★ THE HASH MUST STICK, OR THESE TWO VIEWS ARE SCANNED AS THE DASHBOARD AND
// NOTHING SAYS SO. `gotoApp` waits for <main> and the "Dashboard" nav entry,
// both gated on `i18nReady` — NOT on `hydrated`. `useHashView` is enabled only
// once `hydrated` is true, and its early return sits ABOVE the
// `addEventListener` calls, so its hashchange/popstate listeners do not exist
// before hydration. For `en-US` `loadI18n` resolves on a microtask while
// `hydrated` waits on the IndexedDB secret reads, so a bare
// `location.hash = h` can fire into a window with NO listener attached and be
// lost outright. The later cold apply then reads the view-only hash live,
// applies the stale-residue rule and lands on the DASHBOARD — and nothing
// downstream notices: `waitForViewSettled` polls <main>'s innerHTML for
// STABILITY, never for WHICH view, so axe passes on the Dashboard and
// `Next actions` / `Insights` go permanently unscanned on a green run.
//
// SELF-HEALING rather than merely loud: the loss is a race, and a red nobody
// can reproduce is worth less than a spec that repairs itself. Each round
// re-assigns the hash when the app has rewritten it away. Once a rewrite is
// observable the cold apply has necessarily already run, so the repair is
// heard.
//
// ★★ A ONE-SHOT `expect.poll(...).toBe(hash)` CANNOT DISCRIMINATE HERE, which
// is why this is a stability window instead. `location.hash = h` updates
// `location.hash` SYNCHRONOUSLY whether or not any listener heard it, so the
// first read after the assignment returns the expected value on BOTH the
// success and the failure path — a poll that stops at its first success just
// races the rewrite it exists to catch. Requiring the value to SURVIVE several
// consecutive reads spanning ~1 s outlasts the hydration window instead. That
// is the same stability heuristic `waitForViewSettled` already uses, applied to
// the one value that actually tells the two paths apart. Bounded on both axes,
// so a genuine regression (a disabled view, a broken parse) still fails red
// rather than spinning forever.
const HASH_STABLE_READS = 5;
const HASH_POLL_MS = 200;
const HASH_MAX_ROUNDS = 40; // ~8 s ceiling

async function settleHash(page: Page, hash: string, name: string): Promise<void> {
  let stable = 0;
  let rounds = 0;
  for (; rounds < HASH_MAX_ROUNDS && stable < HASH_STABLE_READS; rounds++) {
    // Read BEFORE repairing, and judge the streak on what was SEEN — a round
    // that had to repair must not count towards it, or the repair would
    // certify itself.
    const seen = await page.evaluate((h) => {
      const cur = window.location.hash;
      if (cur !== h) window.location.hash = h;
      return cur;
    }, hash);
    stable = seen === hash ? stable + 1 : 0;
    await page.waitForTimeout(HASH_POLL_MS);
  }
  expect(
    stable,
    `${name}: the hash never held at "${hash}" for ${HASH_STABLE_READS} consecutive reads ` +
      `(gave up after ${rounds} rounds x ${HASH_POLL_MS} ms). The app keeps rewriting it — ` +
      `almost certainly to "#dashboard", meaning the cold apply treated the view-only hash as ` +
      `stale session residue. Scanning now would have run axe against the Dashboard instead ` +
      `of ${name}, and passed.`,
  ).toBe(HASH_STABLE_READS);
}

// Petrol and Dashboard are no longer BUILT-IN schemes and ship with nothing
// selecting them by default — each is only an importable theme file under
// public/themes/ (petrol.json / mockup.json) that a user loads through the
// gallery. The matrix runs on the four BUILT-IN schemes. Harbor/
// Meridian/Umber are dark-capable and ALL THREE run light AND dark. Umber-dark
// was MISSING from this matrix while `UMBER_DARK` was already imported above,
// already wired into SCHEME_SEED below, and BUILTIN_SCHEMES already marked
// umber `supportsDark: true` — so umber-dark was scanned in no view, ever,
// while everything around it read as covered. Beacon is LIGHT-ONLY by design
// (the app's default) and has no dark combo to add — there is nothing to scan.
// ★ 7 combos × 17 views = 119, + the Kanban-board scan below (ONE PER COMBO,
// its own `for (const combo of COMBOS)` loop — it scales with the combo count,
// it is NOT a fixed 5) = 126, + 1 notes-window toolbar scan + 1 Documents
// block-editor scan + 1 Reports cumulative-chart scan + 2 Turso-storage
// Settings tests (the second runs axe in two states, but counts once) (all
// five harbor-light only, hardcoded — none scales with the combo count) = 131,
// + the pink-count-badge scans (§681, ONE PER COMBO like the Kanban ones, so 7 today
// and scaling with COMBOS) = 138 `a11y:`-prefixed tests, + 1 chart-readout scan whose name does NOT carry
// that prefix (its name is asserted verbatim by the chart-hover-readout plan,
// so `grep -c "a11y:"` undercounts by exactly one) + the one non-scan guard
// below = 140 tests.
// MEASURE it in the same commit that changes A11Y_VIEWS or adds a scan rather
// than deriving it — this comment said 85 for as long as the list said 16
// views, and a beacon-added-combo draft of this very comment still said "108
// scans / 109 tests" by carrying forward the pre-beacon "5 Kanban variants"
// instead of re-measuring. The 128/129 above were likewise MEASURED, not
// derived, in the commit that added the umber-dark combo, and 129/130
// re-measured when the Reports cumulative scan was added (§557), and 131/133
// when the two Turso-storage tests were (§548), and 138/140 when the pink-count-badge
// scans were (§681), and 145/147 when the RAG-letter-chip scans were (§683). Reproduce (no browsers needed):
//   npx playwright test e2e/a11y.spec.ts --list   # 147 total
//   …then `grep -c "a11y:"` over that output       # 145 (+1 unprefixed)
const COMBOS = [
  { scheme: "harbor",   dark: false },
  { scheme: "harbor",   dark: true  },
  { scheme: "meridian", dark: false },
  { scheme: "meridian", dark: true  },
  { scheme: "umber",    dark: false },
  { scheme: "umber",    dark: true  },
  { scheme: "beacon",   dark: false },
] as const;

// Per-scheme maps, resolved node-side at seed time (mirrors how the app persists
// them). Built-ins carry no structural map.
const SCHEME_SEED: Record<
  (typeof COMBOS)[number]["scheme"],
  { light: SchemeColorMap; dark?: SchemeColorMap }
> = {
  harbor:   { light: HARBOR_LIGHT,   dark: HARBOR_DARK },
  meridian: { light: MERIDIAN_LIGHT, dark: MERIDIAN_DARK },
  umber:    { light: UMBER_LIGHT,    dark: UMBER_DARK },
  beacon:   { light: BEACON_LIGHT },
};

const comboLabel = (combo: (typeof COMBOS)[number]): string =>
  `${combo.scheme}-${combo.dark ? "dark" : "light"}`;

// The server under test must BE this run's server. Until §58 (b) playwright.config.ts
// reused any server already answering on the port outside CI, so a run could silently
// attach to a dev server left over from another worktree, or from an earlier run in
// this one, and report a full pass about code that is not on this branch
// (open-followups §58). Three checks, each naming what it compares:
//  1. data-app-version against this checkout's APP_VERSION — catches a server on
//     another release.
//  2. data-checkout (dev servers only) against checkoutToken() of THIS process's
//     cwd — catches a dev server started from another worktree on the same
//     version. Both sides use process.cwd(): the webServer has no `cwd`, so
//     Playwright starts `npm run dev` in the config's directory (the repo root),
//     a hand-started `npm run dev` runs in the package root, and this suite
//     already requires the runner to sit at the repo root (seed-workspace.ts reads
//     sample-workspace-small.json from process.cwd()).
//     An ABSENT data-checkout fails too, unless PLAYWRIGHT_NO_WEBSERVER is set
//     (judgeServedCheckout / runStartsDevServer in checkout-token.ts). That env
//     var is the only signal of which server a run targets: unset, the config
//     starts or reuses `npm run dev` (CI's e2e job included), so the server
//     should be this checkout's dev server and a missing attribute means a
//     production build or a dev server from a commit before the attribute. Set,
//     the run points at an external server, which may be production on purpose.
//  3. data-boot-nonce against this run's E2E_BOOT_NONCE (judgeBootNonce) — catches a
//     leftover dev server from THIS worktree, which matches both checks above. The
//     config mints the nonce once per run and boots its webServer with it, and since
//     §58 (b) it no longer reuses a server unless PLAYWRIGHT_REUSE_SERVER=1. With the
//     opt-in, a server the user started passes only if it was booted with the same
//     E2E_BOOT_NONCE as the run. An external (PLAYWRIGHT_NO_WEBSERVER) run is not
//     checked: it boots no server.
test("guard: the served app is this checkout", async ({ page }) => {
  await gotoApp(page);
  const served = await page.evaluate(() => ({
    version: document.documentElement.getAttribute("data-app-version"),
    checkout: document.documentElement.getAttribute("data-checkout"),
    bootNonce: document.documentElement.getAttribute("data-boot-nonce"),
  }));
  const remedy =
    `Stop that server, or run on a fresh port, where the run boots its own: ` +
    `PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium.`;
  expect(
    served.version,
    `Served app reports data-app-version ${served.version ?? "(absent)"}, but this checkout's ` +
      `APP_VERSION is ${APP_VERSION}. This compares release versions only: Playwright reused a ` +
      `server already answering on this port that runs a different version of the app. ${remedy}`,
  ).toBe(APP_VERSION);
  const expected = checkoutToken("development", () => process.cwd()) ?? "";
  const verdict = judgeServedCheckout(
    served.checkout,
    expected,
    runStartsDevServer(process.env),
  );
  expect(
    verdict,
    `Served app has no data-checkout attribute, but this run uses playwright.config.ts's ` +
      `\`npm run dev\` webServer (PLAYWRIGHT_NO_WEBSERVER is unset), and a dev server from this ` +
      `checkout always stamps it. The server answering on this port is a production build or a ` +
      `dev server built from a commit that predates data-checkout, from another worktree or ` +
      `this one. ${remedy} To scan a production server on purpose, set PLAYWRIGHT_NO_WEBSERVER=1 ` +
      `and PLAYWRIGHT_BASE_URL.`,
  ).not.toBe("absent-refused");
  // An external (PLAYWRIGHT_NO_WEBSERVER) run against a production server: no
  // path-derived value ships there, so the version check stands alone.
  if (verdict === "absent-external") return;
  expect(
    served.checkout,
    `Served app reports data-checkout ${served.checkout}, but this test process's ` +
      `checkoutToken(process.cwd()) is ${expected} (cwd ${process.cwd()}). The dev server on ` +
      `this port was started from a different directory — another worktree or checkout. ` +
      `${remedy} NOTE: a match does not rule out a stale dev server started earlier from ` +
      `THIS directory.`,
  ).toBe(expected);
  const expectedNonce = process.env[BOOT_NONCE_ENV];
  const nonceVerdict = judgeBootNonce(served.bootNonce, expectedNonce, runStartsDevServer(process.env));
  expect(
    nonceVerdict,
    `Boot-nonce check: ${nonceVerdict}. The served app's data-boot-nonce is ` +
      `${served.bootNonce ?? "(absent)"} and this run's ${BOOT_NONCE_ENV} is ${expectedNonce ?? "(unset)"}. ` +
      `playwright.config.ts mints one nonce per run and boots its own dev server with it, so a ` +
      `different or absent nonce means the server on this port was not started by this run: a ` +
      `leftover server, from this worktree or another. "unminted" means the config did not mint one. ` +
      `Stop that server, or run on a fresh port. To reuse a server you started yourself, boot it ` +
      `with ${BOOT_NONCE_ENV}=<value> and run with the same ${BOOT_NONCE_ENV} and ` +
      `PLAYWRIGHT_REUSE_SERVER=1.`,
  ).toMatch(/^(match|external)$/);
});

// Build the pre-navigation localStorage seed for a combo. Every combo is now a
// scheme-driven "custom" style, so we seed the SAME keys the real boot script +
// use-style read: the constant style, the theme, the boot-readable dark-capable
// flag, the resolved color map, the structural map, AND the scheme store's
// activeId — the latter is essential because post-mount use-style.syncScheme
// re-resolves from aipm-cockpit:color-schemes and would otherwise snap back to the
// default scheme, repainting a scan under the wrong palette.
function seedScript(combo: (typeof COMBOS)[number]): string {
  const spec = SCHEME_SEED[combo.scheme];
  const useDark = combo.dark && !!spec.dark;
  const map = resolveSchemeColors(useDark && spec.dark ? spec.dark : spec.light);
  // Every combo is a BUILT-IN now, so an empty schemes[] plus the activeId is
  // enough — reconcileBuiltins injects the scheme. Seeding aipm-cockpit:color-schemes
  // is still essential: post-mount, use-style.syncScheme re-resolves from it and
  // would otherwise overwrite the boot paint (scheme landmine 4).
  const store = { schemes: [], activeId: combo.scheme };
  return [
    `localStorage.setItem("aipm-cockpit-style", "custom");`,
    `localStorage.setItem("aipm-cockpit-theme", ${JSON.stringify(combo.dark ? "dark" : "light")});`,
    `localStorage.setItem("aipm-cockpit-scheme-supports-dark", ${JSON.stringify(spec.dark ? "1" : "0")});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-colors", ${JSON.stringify(JSON.stringify(map))});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-structural", ${JSON.stringify(JSON.stringify({}))});`,
    `localStorage.setItem("aipm-cockpit:color-schemes", ${JSON.stringify(JSON.stringify(store))});`,
  ].join("\n");
}

for (const combo of COMBOS) {
  for (const name of A11Y_VIEWS) {
    test(`a11y: ${comboLabel(combo)} — ${name}`, async ({ page }) => {
      // Seed localStorage BEFORE the app navigates so the no-flash boot script
      // in layout.tsx reads the right style/theme and sets data-style/.dark.
      // addInitScript runs before every navigation, so this fires on the
      // page.goto("/") inside gotoApp — after the page fixture's favicon seed.
      await page.addInitScript(seedScript(combo));
      // §171: without the integration switched on, this view renders only its
      // not-configured screen and the tables' controls reach no gate.
      const timelog = name === "Time bookings" ? await seedTimelogSettings(page) : null;

      await gotoApp(page);
      const hash = HASH_VIEW[name];
      if (hash) {
        await page.evaluate((h) => { window.location.hash = h; }, hash);
        // Make the assignment STICK before scanning — see settleHash above.
        await settleHash(page, hash, name);
        await waitForViewSettled(page);
        // ★★★ THE HASH IS ONLY A PROXY FOR THE THING THIS GUARDS, so pin the
        // thing itself: the finding is "axe silently scans the Dashboard
        // instead of the named view", and a correct hash does not entail a
        // routed view. It leaks BOTH ways. (a) If hydration opens later than
        // settleHash's ~1 s stability streak, the streak completes, the cold
        // apply then rewrites the hash during `waitForViewSettled`, and the
        // scan runs on the Dashboard — green, wrong view. (b) A hash pointing
        // at a DISABLED module is honoured-but-not-routed: `use-hash-view.ts`
        // returns above `setActiveTab` for such a view, so the hash stays
        // exactly right while `activeTab` never moves, and settleHash is
        // vacuous. The TopBar `<h1>` is `t(lang, navLabelKey(activeView))`
        // (modern-shell.tsx → top-bar.tsx), i.e. it is DERIVED from the routed
        // view and from nothing else — the only h1 the modern shell renders,
        // and the same label these A11Y_VIEWS entries are spelled with. So it
        // reads "Next actions" / "Insights" only when that view is genuinely
        // on screen, and "Dashboard" in every failure above.
        // ★★ `exact: true` is NOT optional: Playwright's `getByRole` name
        // matching defaults to a case-insensitive SUBSTRING (the opposite of
        // RTL's), so a bare name would match a longer view title — the very
        // defect class this assertion exists to close, one layer down.
        // ★ Retrying (`toBeVisible` polls), so a merely slow render still
        // passes while a wrong view fails.
        await expect(
          page.getByRole("heading", { name, level: 1, exact: true }),
        ).toBeVisible();
      } else {
        await openView(page, name);
      }
      // ★ The table must be on screen, or this scan is the empty state again.
      if (timelog) {
        await expect(page.getByRole("button", { name: "Clear link – 701", exact: true })).toBeVisible();
        // Proves the stub answered the mount-time project-list call
        // (seedTimelogSettings). Its empty reply changes nothing on screen.
        await expect.poll(() => timelog.paths()).toContain("/v1/project/get-all");
      }

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      const summary = blocking
        .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
        .join("\n");
      expect(blocking, `${name} a11y violations:\n${summary}`).toEqual([]);
    });
  }
}

// Kanban board is a MODE toggle inside Open Points (not a nav view), so it needs
// its own scan: open Open Points, switch to Board, then analyze.
for (const combo of COMBOS) {
  test(`a11y: ${comboLabel(combo)} — Open Points (Kanban board)`, async ({ page }) => {
    await page.addInitScript(seedScript(combo));

    await gotoApp(page);
    await openView(page, "Open Points");
    // DOM-click the Board toggle (mirrors openView) so the auto-launched guided
    // tour overlay can't intercept a real pointer click. Assert it was found so
    // a missing/renamed toggle fails loudly instead of silently scanning the
    // table view (which would make this a no-op duplicate of "Open Points").
    const clickedBoard = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === "Board",
      );
      if (!btn) return false;
      (btn as HTMLElement).click();
      return true;
    });
    expect(clickedBoard, "Board toggle not found in Open Points").toBe(true);
    await waitForViewSettled(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    const summary = blocking
      .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join("\n");
    expect(blocking, `Kanban board a11y violations:\n${summary}`).toEqual([]);
  });
}

// open-followups §144(b): seed one RichTextEditor toolbar into the a11y run.
// Every one of the app's 12 mounts sits behind a modal, an unscanned nav view,
// a non-default Settings section, or a closed <details> — none is reachable by
// the A11Y_VIEWS loop above. This is the cheapest reachable one: the floating
// notes window, opened from a seeded task's notes badge on Open Points.
// ★ A green scan here does NOT prove no duplicate accessible names exist —
// axe cannot see that at any seed size (open-followups §144, §126, AGENTS.md's
// a11y bullet). It only proves this ONE toolbar clears the structural rules.
test("a11y: harbor-light — Open Points (Notes window rich-text toolbar)", async ({ page }) => {
  // ★★★ THIS TEST NEEDS MORE THAN THE 60 s FILE DEFAULT, and the arithmetic is
  //   the reason rather than a hunch. The editor-chunk wait below is allowed
  //   30 s ON ITS OWN — half the whole budget — and it is the LAST thing this
  //   test does before scanning, after a cold first navigation (which
  //   `playwright.config.ts` documents as able to consume the 60 s by itself on
  //   a Turbopack compile), a view switch, a settle poll and the axe analyze.
  //   At the default, a run that is merely slow blows the budget and reports as
  //   "Test timeout of 60000ms exceeded" inside `page.evaluate` — a failure that
  //   names no rule and no impact, i.e. it reads exactly like a contention flake
  //   and nothing like the a11y violation it is not. Give the wait somewhere to
  //   fit so a red run here means a real finding.
  test.setTimeout(120_000);

  await page.addInitScript(seedScript(COMBOS[0]));

  await gotoApp(page);
  await openView(page, "Open Points");
  // DOM-click the notes badge (mirrors the Kanban-board test above) so the
  // auto-launched guided tour overlay can't intercept a real pointer click.
  // Assert it was found so a missing/renamed button fails loudly instead of
  // silently scanning the Open Points table (a no-op duplicate of the
  // existing "Open Points" scan).
  const clickedNotesBadge = await page.evaluate(() => {
    const btn = document.querySelector(
      'button[aria-label="Notes log – Design SSO architecture"]',
    );
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  expect(clickedNotesBadge, "Notes badge button not found on Open Points").toBe(true);
  await waitForViewSettled(page);

  // ★★★ `waitForViewSettled` IS STRUCTURALLY BLIND TO THIS WINDOW, so it cannot be
  // what gates the scan. It polls <main>'s innerHTML for stability, and
  // <NotesWindow> renders inside `modalsBlock` — a SIBLING of <ModernShell>,
  // whose <main> wraps only banners + content. It therefore returns after its
  // ~240 ms floor whether or not the window ever opened. Since the editor moved
  // behind `rich-text-editor-lazy.tsx` it also arrives over the NETWORK, against
  // a dev server that may compile the chunk on demand — so with no explicit wait
  // axe scans `RichTextEditorFallback` and reports GREEN over a toolbar that is
  // not in the DOM. That is the same silent no-op the badge assertion above
  // exists to prevent, one layer deeper. Locator matches the one
  // `rich-text-toolbar-keyboard.spec.ts` already drives on this surface.
  await expect(page.getByRole("button", { name: "Text style" }).first()).toBeVisible({
    timeout: 30_000,
  });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `Notes window a11y violations:\n${summary}`).toEqual([]);
});

// open-followups §184: the Documents block editor is a MODE toggle inside the
// Documents view, so the A11Y_VIEWS loop only ever scanned DocumentPreview.
// Every per-kind block editor and every gutter control was unscanned until
// this test.
// ★ A green scan here does NOT prove there are no duplicate accessible names —
// axe cannot see that in any view at any seed size (open-followups §144, §126,
// AGENTS.md's a11y bullet). Only a multi-row UNIT test can ever catch that
// class; document-block-gutter.test.tsx is where the gutter's names are pinned.
// ★★ WHICH document this opens is NOT the seeded 9001: documents-panel.tsx
// falls back to `selectionPool[0]`, and `selectionPool` is the UNSORTED
// `documents` array, so it lands on the sample master's id 1 — which already
// carries all six DocBlock kinds. e2e/seed-workspace.ts gives 9001 all six as well,
// so this scan covers every per-kind editor whichever one wins that fallback.
test("a11y: harbor-light — Documents (block editor)", async ({ page }) => {
  await page.addInitScript(seedScript(COMBOS[0]));

  await gotoApp(page);
  await openView(page, "Documents");
  // DOM-click the toggle (mirrors the two scans above) so the auto-launched
  // guided tour overlay cannot intercept a real pointer click. ★ The label is
  // PINNED to "Edit blocks" in BOTH states by design (documents-toolbar.tsx),
  // so matching on it is stable across the toggle flipping.
  const clickedEdit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Edit blocks",
    );
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  expect(clickedEdit, "Edit blocks toggle not found in Documents").toBe(true);
  await waitForViewSettled(page);

  // Assert the editor actually mounted — otherwise a broken toggle (or one
  // rendered `disabled`, which it is whenever no document is selected)
  // silently scans the preview and this becomes a no-op duplicate of the
  // existing "Documents" scan.
  expect(await page.locator("[data-block-row]").count()).toBeGreaterThan(1);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `Documents block editor a11y violations:\n${summary}`).toEqual([]);
});

// §557: the Budget report's chart draws the recorded budget history (stepped
// line, change markers) only in the CUMULATIVE orientation, and the Reports
// scan in the A11Y_VIEWS loop sees the default burn-down. e2e/seed-workspace.ts authors the
// history; this scan switches orientation and checks those surfaces too.
// ★ Same axe configuration as every scan above; harbor-light only, like the
// two scans before it.
test("a11y: harbor-light — Reports (budget chart, cumulative)", async ({ page }) => {
  await page.addInitScript(seedScript(COMBOS[0]));

  await gotoApp(page);
  await openView(page, "Reports");
  // DOM-click the radio (mirrors the scans above) so the auto-launched guided
  // tour overlay cannot intercept a real pointer click. Assert it was found so
  // a renamed control fails loudly instead of rescanning the burn-down chart.
  const clickedCumulative = await page.evaluate(() => {
    const group = document.querySelector('[role="radiogroup"][aria-label="Chart orientation"]');
    const radio = [...(group?.querySelectorAll('[role="radio"]') ?? [])].find(
      (r) => (r.textContent || "").trim() === "Cumulative",
    );
    if (!radio) return false;
    (radio as HTMLElement).click();
    return true;
  });
  expect(clickedCumulative, "Cumulative orientation radio not found in Reports").toBe(true);
  // Only the cumulative chart's name carries the recorded changes, so this
  // proves the stepped line and markers are on screen when axe runs.
  await expect(page.getByRole("img", { name: /Budget changes: / })).toHaveCount(1);
  await waitForViewSettled(page);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `Reports cumulative budget chart a11y violations:\n${summary}`).toEqual([]);
});

// Chart hover/keyboard readout (chart-hover-readout branch): the box and its
// SVG decorations (`[data-readout-guide]`/`[data-readout-dot]`) are taken out
// of the accessibility tree entirely (`TooltipSurface`'s `decorative` prop:
// `aria-hidden`, no `role`), so this scan is really checking the TRIGGER and
// the portaled box's STRUCTURE, not any content inside it — and it is what
// first caught `aria-tooltip-name`: the box used to keep `role="tooltip"`
// while hiding only its content, which left a nameless ARIA tooltip node in
// the tree. Re-adding that role here (without also re-adding an accessible
// name) must turn this scan red again — that is the mutation this test guards
// against, not merely renders beside.
// ★ Same axe configuration as every scan above; harbor-light only, like the
// two scans before it.
test("Reports with the chart readout open has no axe violations", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Reports");
  const trigger = page
    .getByTestId("report-block-budget-report")
    .getByRole("button", { name: /arrow keys/i });
  // `.focus()` auto-scrolls the trigger into view as part of Playwright's
  // actionability checks, unlike a raw `boundingBox()`/`mouse.move()` pair.
  await trigger.focus();
  await page.keyboard.press("ArrowRight");
  // Without this the scan can run before the box mounts and report GREEN over
  // markup that is not in the DOM — the silent no-op this file warns about.
  // The box carries no ARIA role, so its presence is checked via its own
  // `[data-readout-box]` hook, not `getByRole("tooltip")` — and not the
  // `[data-tooltip-portal]` hook every `TooltipSurface` sets, which would let
  // the scan pass with an unrelated tooltip up and the readout closed.
  await expect(page.locator("[data-readout-box]")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `Reports chart readout a11y violations:\n${summary}`).toEqual([]);
});

// §548: Settings → Integrations shows the Turso "Apply" button, its blocked-state
// hint, the "Wrong passphrase." error and the "Save & switch" blocked hint ONLY
// while `settings.storageConfig.kind === "turso"` (`tursoIsLive` in
// integrations-section.tsx). e2e/seed.ts seeds FILE mode, so the Settings scan
// in the A11Y_VIEWS loop never renders any of them. These two scans seed Turso
// as the storage kind against a database that does not exist.
// ★★ NOTHING LEAVES THE MACHINE. The URL is on the reserved `.invalid` TLD, and
// every request to it (plus any *.turso.io host, in case a deployment env var
// ever supplied a real URL) is aborted by `page.route`. The route is a
// backstop, never the mechanism — measured 2026-09-19, it recorded ZERO hits:
//   - device token: `connect-src` (src/proxy.ts) does not admit the fake host
//     and CSP is enforced in the renderer BEFORE routing, so every
//     `/v2/pipeline` fetch is refused by CSP and rejects at once;
//   - passphrase token: the sealed record is only unlocked by the boot gate in
//     TURSO portfolio mode (`showTursoUnlock`), and the seed is file mode, so
//     the token stays empty, `getTursoConfig` returns null for the https URL
//     and no request is made at all ("Storage isn't configured yet" toast).
// Either way the load fails fast and SETTLES (a failed load is a terminal
// branch of the load effect, so `loadPending` goes false) and the main tree
// renders with the "Saving is paused" storage banner — which is scanned too.
// ★ Same axe configuration as every scan above; harbor-light only.
const TURSO_FIXTURE_URL = "libsql://axe-fixture.invalid";
const TURSO_FIXTURE_TOKEN = "axe-fixture-token";

async function seedTursoLiveStorage(
  page: import("@playwright/test").Page,
  sealed: SealedSecret | null,
): Promise<void> {
  await page.route(/axe-fixture\.invalid|turso\.io/, (route) => route.abort());
  await page.addInitScript(seedScript(COMBOS[0]));
  await page.addInitScript(
    ({ url, token, sealedRecord }) => {
      localStorage.setItem(
        "aipm-cockpit:settings",
        JSON.stringify({
          tourSeen: true,
          storageConfig: { kind: "turso" },
          // A passphrase-sealed token is never kept in settings in plaintext.
          integrations: { turso: { enabled: true, databaseUrl: url, authToken: sealedRecord ? "" : token } },
        }),
      );
      if (sealedRecord) {
        localStorage.setItem("aipm-cockpit:secrets", JSON.stringify({ tursoAuthToken: sealedRecord }));
      }
    },
    { url: TURSO_FIXTURE_URL, token: TURSO_FIXTURE_TOKEN, sealedRecord: sealed },
  );
}

async function openTursoSettings(page: import("@playwright/test").Page): Promise<void> {
  await gotoApp(page);
  await openView(page, "Settings");
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await waitForViewSettled(page);
}

async function expectNoBlockingViolations(
  page: import("@playwright/test").Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `${label} a11y violations:\n${summary}`).toEqual([]);
}

test("a11y: harbor-light — Turso storage Apply controls (device token)", async ({ page }) => {
  test.setTimeout(120_000);
  await seedTursoLiveStorage(page, null);
  await openTursoSettings(page);

  // A dirty URL draft enables Apply. Assert the enabled state so the scan
  // cannot run over a missing or disabled button and report GREEN.
  await page.getByRole("textbox", { name: "Database URL", exact: true }).fill("libsql://axe-fixture-2.invalid");
  const apply = page.getByRole("button", { name: "Apply Turso connection", exact: true });
  await expect(apply).toBeEnabled();
  await expect(page.getByRole("button", { name: "Test connection – Turso", exact: true })).toBeVisible();
  await waitForViewSettled(page);

  await expectNoBlockingViolations(page, "Turso Apply (device token)");
});

test("a11y: harbor-light — Turso storage Apply controls (passphrase token)", async ({ page }) => {
  // PBKDF2 at 600k iterations runs twice (the node-side seal below, the in-page
  // verify after Apply) on top of a possibly cold first navigation.
  test.setTimeout(120_000);
  const sealed = await sealPassphrase("tursoAuthToken", TURSO_FIXTURE_TOKEN, "axe-fixture-passphrase");
  await seedTursoLiveStorage(page, sealed);
  await openTursoSettings(page);

  // State 1 — BLOCKED: a changed token in passphrase mode with no passphrase
  // typed. Apply is disabled and described by the blocked hint; picking the
  // Turso portfolio mode brings up "Save & switch" with its own blocked hint.
  await page.getByLabel("Auth token", { exact: true }).fill("axe-fixture-token-2");
  const apply = page.getByRole("button", { name: "Apply Turso connection", exact: true });
  await expect(apply).toBeDisabled();
  await expect(apply).toHaveAttribute("aria-describedby", /turso-apply-blocked/);
  await page.getByRole("combobox", { name: "Portfolio storage", exact: true }).selectOption("turso");
  const saveSwitch = page.getByRole("button", { name: "Save & switch portfolio", exact: true });
  await expect(saveSwitch).toBeDisabled();
  await expect(saveSwitch).toHaveAttribute("aria-describedby", /turso-switch-blocked/);
  await waitForViewSettled(page);
  await expectNoBlockingViolations(page, "Turso Apply (passphrase, blocked)");

  // State 2 — WRONG PASSPHRASE: a typed passphrase that does not open the
  // sealed record. Apply verifies it, commits nothing and shows the error.
  await page.getByRole("combobox", { name: "Portfolio storage", exact: true }).selectOption("file");
  await page.getByLabel("Passphrase", { exact: true }).fill("not-the-passphrase");
  await page.getByLabel("Confirm passphrase", { exact: true }).fill("not-the-passphrase");
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByText("Wrong passphrase.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(apply).toHaveAttribute("aria-describedby", /turso-apply-wrong-passphrase/);
  await waitForViewSettled(page);
  await expectNoBlockingViolations(page, "Turso Apply (passphrase, wrong passphrase)");
});

// §681: the pink CountBadge. The seed carries no "now" action, so no scanned view
// above renders a badge and the gate could not see white-on-pink at 3.83:1
// (beacon) or under 2.7:1 (every dark built-in). One overdue, blocked, urgent
// task makes `nowCount` positive, which draws the badge on the top bar's bell
// in every view. Records are put by id, so this adds the task to the seed.
const BADGE_TASK = {
  ...((SEED_WORKSPACE.tasks as Record<string, unknown>[]).find((t) => t.status !== "Done") ?? {}),
  id: 99001,
  taskName: "Vendor sign-off (overdue)",
  status: "In Progress",
  priority: "Urgent",
  dueDate: "2026-08-01",
  lastUpdateDate: "2026-07-01",
  blockers: "Waiting on vendor sign-off",
  completedDate: undefined,
};

for (const combo of COMBOS) {
  const id = `${combo.scheme}-${combo.dark ? "dark" : "light"}`;
  test(`a11y: ${id} — pink count badge (§681)`, async ({ page }) => {
    await page.addInitScript(seedScript(combo));
    await reseedWorkspace(page, { tasks: [BADGE_TASK] });
    await gotoApp(page);
    await waitForViewSettled(page);

    // ANTI-VACUITY: a scan with no badge on the page is the gap this closes.
    const badge = page.locator('[class*="count-badge-pink"]').first();
    await expect(badge, "no pink count badge rendered").toBeVisible();
    // The CASCADE, which the unit test cannot see: the badge paints the
    // derived token this combo resolves to, not raw --ui-pink.
    const spec = SCHEME_SEED[combo.scheme];
    const fill = resolveSchemeColors(combo.dark && spec.dark ? spec.dark : spec.light)["--count-badge-pink"]!;
    const rgb = fill.match(/[0-9a-f]{2}/gi)!.map((h) => parseInt(h, 16));
    await expect(badge).toHaveCSS("background-color", `rgb(${rgb.join(", ")})`);

    // The page as the gate sees it, default options.
    await expectNoBlockingViolations(page, `${id} pink count badge`);

    // ★★ That scan CANNOT see the badge. A one-character count is "too short
    //    to determine if it is actual text content" for axe, which files it
    //    under INCOMPLETE and never as a violation — measured: raw --ui-pink at
    //    3.83:1 passed the scan above. `ignoreLength` makes axe judge it, and
    //    the badge must then appear among the PASSES, so a scan that skipped it
    //    cannot read as clean. Scoped to the badge with `include`: page-wide,
    //    `ignoreLength` also judges every other one-letter chip, which is a
    //    separate finding, not this entry's.
    // `checks` is a run option axe honours but its RunOptions type omits, so it
    // rides in a variable (no excess-property check) beside the typed `runOnly`.
    const judgeShortText = {
      runOnly: { type: "rule" as const, values: ["color-contrast"] },
      checks: { "color-contrast": { options: { ignoreLength: true } } },
    };
    const results = await new AxeBuilder({ page })
      .include('[class*="count-badge-pink"]')
      .options(judgeShortText)
      .analyze();
    const badgeNodes = (list: typeof results.passes) =>
      list.filter((r) => r.id === "color-contrast").flatMap((r) => r.nodes).filter((n) => n.html.includes("count-badge-pink"));
    expect(badgeNodes(results.passes).length, "axe judged no badge").toBeGreaterThan(0);
    expect(badgeNodes(results.incomplete), "axe left a badge unjudged").toEqual([]);
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = blocking.map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`).join("\n");
    expect(blocking, `${id} pink count badge a11y violations:\n${summary}`).toEqual([]);
  });
}

// §683: the RAG letter chip (`RagBadge`). White on the raw RAG colours measured
// 1.68-5.02:1, and like the pink badge above the default scan could not see it:
// a one-letter chip is "too short" for axe and lands in INCOMPLETE. The seed
// computes amber everywhere, so the overall, schedule and budget overrides are
// pinned to R, A and G and the hero's "Adjust health ratings" panel is opened:
// all three letters are then on screen at once. Each chip must paint the token
// pair its letter resolves to in this combo, and a chip-scoped scan with
// `ignoreLength` must judge every chip and list it among the passes.
const CHIP_TOKENS = {
  R: ["--rag-badge-red", null],
  A: ["--rag-amber", "--rag-badge-amber-ink"],
  G: ["--rag-badge-green", null],
} as const;
const rgbOf = (hex: string) => `rgb(${hex.match(/[0-9a-f]{2}/gi)!.map((h) => parseInt(h, 16)).join(", ")})`;

for (const combo of COMBOS) {
  const id = `${combo.scheme}-${combo.dark ? "dark" : "light"}`;
  test(`a11y: ${id} — RAG letter chip (§683)`, async ({ page }) => {
    await page.addInitScript(seedScript(combo));
    await skipTour(page);
    await reseedWorkspace(page, { status: { ragOverride: "R", scheduleOverride: "A", budgetOverride: "G" } });
    await gotoApp(page);
    await openView(page, "Dashboard");
    await waitForViewSettled(page);
    await page.locator("summary", { hasText: "Adjust health ratings" }).click();

    // A hidden chip is skipped by axe, so only visible ones count.
    const chips = page.locator("[data-rag-chip]:visible");
    await expect(chips.first(), "no RAG letter chip rendered").toBeVisible();
    const spec = SCHEME_SEED[combo.scheme];
    const colors = resolveSchemeColors(combo.dark && spec.dark ? spec.dark : spec.light);
    const letters = new Set<string>();
    for (const chip of await chips.all()) {
      const letter = ((await chip.textContent()) ?? "").trim() as keyof typeof CHIP_TOKENS;
      expect(Object.keys(CHIP_TOKENS), `unexpected chip text "${letter}"`).toContain(letter);
      letters.add(letter);
      const [fill, ink] = CHIP_TOKENS[letter];
      // The CASCADE, which the unit test cannot see.
      await expect(chip).toHaveCSS("background-color", rgbOf(colors[fill]!));
      await expect(chip).toHaveCSS("color", ink ? rgbOf(colors[ink]!) : "rgb(255, 255, 255)");
    }
    // ANTI-VACUITY: a letter never rendered is a letter never checked.
    expect([...letters].sort().join(""), "RAG letters on screen").toBe("AGR");

    await expectNoBlockingViolations(page, `${id} RAG letter chip`);

    const judgeShortText = {
      runOnly: { type: "rule" as const, values: ["color-contrast"] },
      checks: { "color-contrast": { options: { ignoreLength: true } } },
    };
    const results = await new AxeBuilder({ page })
      .include("[data-rag-chip]")
      .options(judgeShortText)
      .analyze();
    const chipNodes = (list: typeof results.passes) =>
      list.filter((r) => r.id === "color-contrast").flatMap((r) => r.nodes).filter((n) => n.html.includes("data-rag-chip"));
    for (const letter of ["R", "A", "G"]) {
      const judged = chipNodes(results.passes).filter((n) => n.html.includes(`data-rag-chip="${letter}"`));
      expect(judged.length, `axe judged no ${letter} chip`).toBeGreaterThan(0);
    }
    expect(chipNodes(results.incomplete), "axe left a chip unjudged").toEqual([]);
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = blocking.map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`).join("\n");
    expect(blocking, `${id} RAG letter chip a11y violations:\n${summary}`).toEqual([]);
  });
}
