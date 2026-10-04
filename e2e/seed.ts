import { test as base, expect, type Page } from "@playwright/test";
import { SEED_WORKSPACE } from "./seed-workspace";
import { IDB_CORE_KV_KEYS, IDB_DB_NAME, IDB_DB_VERSION, IDB_ENTITY_STORES, IDB_KV_STORE, IDB_OPTIONAL_KV_KEYS } from "../src/app/idb-layout";

// Registry + File System Access stub. Runs in the browser before app code on
// every navigation. A `kind:"browser"` project loads from IndexedDB (no
// save-picker, which headless Chromium can't satisfy); the FSA pickers are
// stubbed in-memory for any flow that still reaches them.
function seedRegistryAndFsa(): void {
  localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "e2e-1", name: "E2E Project", code: "E2E-001", storageConfig: { kind: "browser" } }],
      currentProjectId: "e2e-1",
    }),
  );
  const ref = { content: "" };
  const handle = {
    name: "e2e-project.json",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => new File([ref.content], "e2e-project.json", { type: "application/json" }),
    createWritable: async () => ({
      write: async (c: unknown) => {
        ref.content = typeof c === "string" ? c : ((c as { data?: string })?.data ?? "");
      },
      close: async () => {},
    }),
  };
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => handle;
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => [handle];
}

interface SeedLayout {
  readonly name: string;
  readonly version: number;
  readonly kvStore: string;
  /** Workspace field → record store. */
  readonly entity: Readonly<Record<string, string>>;
  /** Workspace field → kv key; every kv slice BrowserBackend persists. */
  readonly kv: Readonly<Record<string, string>>;
}

// ★ Derived from idb-layout.ts, the list idb.ts and browser-backend.ts take
// their store names and kv keys from — never a hand list here (§99). A hand
// list silently dropped every slice added after it was written (seven at one
// point), so their views were scanned on an EMPTY state. Which slices carry
// data is SEED_WORKSPACE's job, checked by src/app/idb-layout.test.ts.
const SEED_LAYOUT: SeedLayout = {
  name: IDB_DB_NAME,
  version: IDB_DB_VERSION,
  kvStore: IDB_KV_STORE,
  entity: IDB_ENTITY_STORES,
  kv: { ...IDB_CORE_KV_KEYS, ...IDB_OPTIONAL_KV_KEYS },
};

// Writes the sample workspace into IndexedDB in the exact shape BrowserBackend
// reads (see browser-backend.ts / idb.ts). Runs in the browser via evaluate so
// it completes BEFORE the app loads (addInitScript can't block on async IDB).
// ★ Serialized into the page, so it can close over nothing: the layout comes
// in as an argument.
function seedIndexedDb({ ws, layout }: { ws: Record<string, unknown>; layout: SeedLayout }): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(layout.name, layout.version);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(layout.kvStore)) db.createObjectStore(layout.kvStore);
      for (const s of Object.values(layout.entity)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(db.objectStoreNames, "readwrite");
      for (const [field, store] of Object.entries(layout.entity))
        for (const rec of (ws[field] as unknown[]) ?? []) tx.objectStore(store).put(rec);
      const kv = tx.objectStore(layout.kvStore);
      for (const [field, key] of Object.entries(layout.kv)) if (ws[field] != null) kv.put(ws[field], key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

// Test fixture: every test's context is pre-seeded with the registry + FSA stub,
// and its page has the sample workspace written to IndexedDB before first use.
export const test = base.extend({
  context: async ({ context }, run) => {
    await context.addInitScript(seedRegistryAndFsa);
    await run(context);
  },
  page: async ({ page }, run) => {
    // Same-origin lightweight document so IndexedDB (per-origin) is reachable
    // and seeded before any app navigation.
    await page.goto("/favicon.ico");
    await page.evaluate(seedIndexedDb, { ws: SEED_WORKSPACE, layout: SEED_LAYOUT });
    await run(page);
  },
});

export { expect };

/** The seeded document image: metadata mirrored from SEED_WORKSPACE's
 *  `documentAssets` row, plus the BYTES that slice can never carry.
 *
 *  A real 8x8 RGB PNG, 84 bytes, built by hand (zlib IDAT + correct CRCs) so it
 *  actually DECODES — a placeholder that merely looks like base64 would still
 *  produce an `<img>` with a blob: src and `naturalWidth === 0`, which is the
 *  exact failure signature a CSP regression produces. The bytes and `hash` were
 *  generated together; regenerate both or neither. */
export const E2E_DOCUMENT_ASSET = {
  id: "e2e-asset-1",
  name: "burndown.png",
  mime: "image/png",
  width: 8,
  height: 8,
  byteLength: 84,
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAG0lEQVR4nGOQt5r8//9/TJIBq6i81WSGQakDANWYfSG99zMiAAAAAElFTkSuQmCC",
} as const;

/** The image behind the IMAGE-ONLY paragraph block — the shape
 *  documents-asset-section.tsx actually inserts. See that block's comment in
 *  SEED_WORKSPACE for why the pair exists.
 *
 *  ★ DELIBERATELY 4x4, not another 8x8: the spec asserts each image's own
 *  dimensions, so a resolver that pointed both `<img>` elements at the same
 *  bytes would fail rather than pass. Distinct bytes also mean a distinct
 *  `hash`, which keeps the pair consistent with the hash-keyed upload dedup. */
export const E2E_DOCUMENT_ASSET_IMAGE_ONLY = {
  id: "e2e-asset-2",
  name: "velocity.png",
  mime: "image/png",
  width: 4,
  height: 4,
  byteLength: 83,
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGklEQVR4nGM4IaD3//9/CMkAZ50Q0GPAKQMAR6EgGSlBvb8AAAAASUVORK5CYII=",
} as const;

/** Both seeded assets, for the byte-store stub's id lookup. */
const E2E_DOCUMENT_ASSETS = [E2E_DOCUMENT_ASSET, E2E_DOCUMENT_ASSET_IMAGE_ONLY] as const;

/**
 * Make the seeded document image RENDER — opt-in, per spec.
 *
 * ★★★ WHY THIS IS NEEDED AT ALL, and why the seed cannot just carry the bytes:
 * a `DocumentAsset` row is workspace data and rides IndexedDB like any other
 * slice, but its BYTES live in `document_asset_data`, a Turso side table
 * (document-assets-schema.ts) deliberately kept out of TABLE_NAMES. There is no
 * file-mode equivalent, so a plain file-mode seed can never resolve an image:
 * the img never gets a blob: src, and a spec built on it could not observe a
 * CSP `img-src` regression, because no image load is ever attempted.
 * ★★ CORRECTED: this used to say `loadAssetData(null, ...)` throws
 * StorageNotReadyError and `attachAssetImages` "stamps `data-asset-missing`", so
 * a file-mode seed "can only ever produce the DANGLING state". Both previews now
 * BAIL on a null Turso config before calling the loader at all — a null config
 * means asset storage is off, not that the bytes are missing — so no marker is
 * stamped and the image renders its alt text. The conclusion above is unchanged;
 * only the mechanism, and the claim about which state you can observe, were.
 *
 * ★★ THE GATE IS `tursoConfig !== null`, NOT THE STORAGE BACKEND, and that is
 * what makes this possible without distorting anything. task-manager.tsx builds
 * it as `getTursoConfig(settings.integrations?.turso?.databaseUrl, ...authToken)`
 * — read off the INTEGRATIONS settings and completely independent of
 * `settings.storageConfig.kind`. The workspace therefore keeps loading from
 * IndexedDB exactly as every other spec sees it, while the asset byte store
 * comes alive. (It also means the sidebar is unaffected: nav pruning is
 * `filterNavGroups(settings.features, settings.storageConfig.kind)`, which this
 * does not touch.)
 *
 * ★★ EVERYTHING CLIENT-SIDE STAYS REAL. Only the remote database is stubbed —
 * there is no Turso server in CI and there never will be. The spec still
 * exercises getTursoConfig, loadAssetData, runTursoPipeline's real fetch, the
 * real base64 decode, the real Blob + URL.createObjectURL, the real
 * `img.src = blob:` assignment, Chromium's real CSP enforcement and a real PNG
 * decode. Stubbing the transport is the only part that is not the product.
 *
 * ★★★ `location.origin` IS THE DATABASE URL ON PURPOSE — three constraints
 * intersect and only this satisfies all three:
 *   - CSP: `connect-src` (src/proxy.ts) admits 'self', so a same-origin POST is
 *     allowed. Route interception happens in the network layer, but CSP is
 *     enforced in the RENDERER first — a connect-src-blocked request never
 *     reaches the handler at all, so an arbitrary host would silently degrade
 *     to the dangling case and look like a product failure.
 *   - CORS: same-origin means no preflight. A cross-origin pipeline POST sends
 *     `Content-Type: application/json`, which is not a simple request, and the
 *     OPTIONS preflight is not reliably interceptable.
 *   - getTursoConfig: plaintext http is accepted ONLY for loopback hosts, and
 *     token-less ONLY for those — so `http://localhost:<port>` needs no
 *     authToken and never engages the sealed-secret machinery (`writeSettings`
 *     blanks `integrations.turso.authToken`; an empty one has nothing to blank).
 *     A local self-hosted tursodb is a genuinely supported configuration, so
 *     this is a real product shape, not a test-only one.
 * ★ Consequence: pointing PLAYWRIGHT_BASE_URL at a NON-loopback host makes
 * getTursoConfig return null and every image dangle. That fails loudly on the
 * naturalWidth assertion rather than passing quietly, which is the right way
 * round.
 *
 * ★ The service worker cannot swallow the request: public/sw.js registers no
 * `fetch` handler at all, so nothing competes with the route.
 *
 * Call BEFORE gotoApp — the init script has to land before the app boots.
 */
export async function installAssetByteStore(page: Page): Promise<void> {
  // Settings are a SHALLOW merge over defaults in use-settings.ts
  // (`{...defaultSettings, ...parsed}`), so writing this one key leaves
  // storageConfig and everything else at its default. `integrations` is not
  // deep-merged, which is fine: m365 is optional and nothing here needs it.
  await page.addInitScript(() => {
    localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ integrations: { turso: { enabled: true, databaseUrl: location.origin } } }),
    );
  });

  await page.route("**/v2/pipeline", async (route) => {
    const body = route.request().postDataJSON() as
      | { requests?: { type?: string; stmt?: { sql?: string; args?: { value?: string }[] } }[] }
      | null;
    const requests = body?.requests ?? [];

    // ★★ ONE RESULT PER REQUEST, IN ORDER — non-negotiable. Callers index the
    // array positionally (`results[DOCUMENT_ASSET_DATA_DDL.length]`), so a
    // short array silently yields `undefined`, `rowObjects` returns [] and the
    // asset reads as dangling. Every non-asset statement therefore still gets
    // an empty ok: enabling tursoConfig also wakes comm-templates, operating
    // guides and the action-learning store, and each must get a well-formed
    // reply rather than an error that could surface a banner mid-scan.
    const results = requests.map((r) => {
      const sql = r?.stmt?.sql ?? "";
      const args = r?.stmt?.args ?? [];
      if (!/FROM\s+document_asset_data/i.test(sql)) return ok([], []);

      // ★ The ids-only select bills itself as `'' AS data` — the library diffs
      // ids to mark rows dangling and must never pull bytes.
      const idsOnly = /''\s+AS\s+data/i.test(sql);
      // ★★ MATCHED ON ID ALONE, project_id DELIBERATELY IGNORED. The partition
      // key is `assetPane.projectId`, which is being reworked
      // (ASSET_PARTITION_FALLBACK) and differs between the single-tenant and
      // tenant layouts. This spec's subject is whether an image RENDERS, not
      // how bytes are partitioned; keying on it here would make the spec fail
      // for a reason it does not test. Pin partitioning separately if wanted.
      // ★ The ids select must return EVERY seeded id, not just the first: the
      // hook diffs this set against the metadata slice, so a short list would
      // mark the missing rows dangling in the library even though their bytes
      // resolve fine in the preview.
      const cols = ["id", "project_id", "data"];
      if (idsOnly) return ok(cols, E2E_DOCUMENT_ASSETS.map((a) => [a.id, "", ""]));
      const wanted = E2E_DOCUMENT_ASSETS.find((a) => args.some((arg) => arg?.value === a.id));
      if (!wanted) return ok(cols, []);
      return ok(cols, [[wanted.id, "", wanted.base64]]);
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ baton: null, base_url: null, results }),
    });
  });
}

/** A libSQL `/v2/pipeline` execute result, in the shape `rowObjects`
 *  (turso-schema.ts) destructures: `response.result.cols[].name` +
 *  `response.result.rows[][].value`. */
function ok(cols: string[], rows: string[][]) {
  return {
    type: "ok" as const,
    response: {
      type: "execute" as const,
      result: {
        cols: cols.map((name) => ({ name })),
        rows: rows.map((row) => row.map((value) => ({ type: "text", value }))),
      },
    },
  };
}

/** Primary sidebar views worth smoke-checking. Names match their accessible labels. */
export const PRIMARY_VIEWS = [
  "Dashboard",
  "Open Points",
  "Gantt",
  "Milestones",
  "Resources",
  "Budget",
  "RAID",
  "Changes",
  "Stakeholders",
  "Reports",
  "Activity",
  "Settings",
] as const;

const NAV_SELECTOR = 'aside a, aside button, nav a, nav button, [role="tab"]';

// Freeze "now" so anything the app derives from the current date (RAG status,
// due-soon highlighting, "as of …" captions, Gantt today-line / visible window)
// renders identically on every run — otherwise the a11y and visual specs drift
// with the calendar date.
// ★ It is the master's own as-of date (DEMO_AS_OF, 2026-09-18 — the date
// sample-workspace-small.json is authored to represent, mid-project), so the
// done / overdue / upcoming split, the past / current / future buckets and the
// dated actuals render as the demo shows them. It was 2026-06-15 while the
// master's plan ran 2026-04 … 2026-07; moving the master without moving this
// would scan a project two weeks old with all of its history in the future.
export const FROZEN_NOW = new Date("2026-09-18T09:00:00.000Z");

/**
 * Navigate to the app and wait until the sidebar shell is interactive. The
 * timeout is generous because the FIRST navigation against the dev `webServer`
 * pays a one-time Turbopack compile (well over the default action timeout);
 * subsequent in-app navigations are fast.
 *
 * `time` defaults to `FROZEN_NOW` (every existing caller is unaffected). The
 * visual project (§573) passes its OWN fixed instant so that bumping
 * `FROZEN_NOW` to follow a `DEMO_AS_OF` refresh — a periodic, expected edit —
 * no longer invalidates the visual baselines too.
 */
export async function gotoApp(page: Page, time: Date = FROZEN_NOW): Promise<void> {
  await page.clock.install({ time });
  await page.goto("/");
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForFunction(
    ({ name, sel }) =>
      [...document.querySelectorAll(sel)].some(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      ),
    { name: "Dashboard", sel: NAV_SELECTOR },
    { timeout: 90_000 },
  );
}

export async function openView(page: Page, name: string): Promise<void> {
  // The shell is already up (see gotoApp); a short poll covers per-view lazy bits.
  await page.waitForFunction(
    ({ name, sel }) =>
      [...document.querySelectorAll(sel)].some(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      ),
    { name, sel: NAV_SELECTOR },
    { timeout: 20_000 },
  );
  await page.evaluate(
    ({ name, sel }) => {
      const el = [...document.querySelectorAll(sel)].find(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      );
      (el as HTMLElement | undefined)?.click();
    },
    { name, sel: NAV_SELECTOR },
  );
  await waitForViewSettled(page);
}

/**
 * Wait until the main view's DOM stops changing, so axe (and visual specs) scan
 * a FULLY-rendered view. A fixed `waitForTimeout` could scan mid-render of the
 * heavy data tables, so whether a given row is present — and thus whether its
 * a11y violations are caught — became non-deterministic (a real contrast bug
 * could pass one run and fail another depending on runner timing). Polling for
 * DOM stability makes the scan deterministic.
 *
 * The poll MUST be driver-side: `page.clock.install` (see gotoApp) fakes the
 * page's `setTimeout`, so an in-page timer-based settle would never fire.
 */
export async function waitForViewSettled(page: Page): Promise<void> {
  // Fonts affect text metrics (→ the large-vs-normal contrast threshold); let
  // them settle if the browser exposes the API. Tolerant — never blocks.
  await page
    .evaluate(() => (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready)
    .catch(() => {});
  let prev = -1;
  let stable = 0;
  // ~240ms of stability (3×80ms), capped at ~4s so a perpetually-animating
  // element can never hang the scan.
  for (let i = 0; i < 50 && stable < 3; i++) {
    const len = await page.evaluate(() => document.querySelector("main")?.innerHTML.length ?? 0);
    if (len === prev) stable += 1;
    else {
      stable = 0;
      prev = len;
    }
    await page.waitForTimeout(80);
  }
}
