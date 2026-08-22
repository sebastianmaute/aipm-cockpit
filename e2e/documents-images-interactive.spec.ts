// e2e/documents-images-interactive.spec.ts
//
// The INTERACTIVE half of document images, driven against a REAL Turso
// database. `documents-images.spec.ts` proves a pre-seeded image renders
// through a stubbed transport; this file drives the paths a user actually
// takes — upload, paste, drop, rename, delete, the dangling marker, the §212
// repair, Safe Mode's refusal, and what a standalone HTML export contains —
// with nothing between the app and a live `document_asset_data` table.
//
// ★★★ HOW IT BECOMES LIVE, AND WHY NOTHING HERE CONFIGURES THE UI.
// `getTursoConfig` (turso-config.ts) reads NEXT_PUBLIC_TURSO_DATABASE_URL /
// NEXT_PUBLIC_TURSO_AUTH_TOKEN and those take PRECEDENCE over settings — it is
// not a fallback, env wins when set. Next inlines them at SERVER START from
// `.env.local`, so a dev server started with that file present serves an app
// whose asset pane is already live: no settings write, no route stub, no UI
// setup. Everything from `checkUploadCandidate` through `runTursoPipeline`'s
// real fetch to a real SQLite `INSERT OR REPLACE` is the product.
//
// ★★★ THE TRAP THIS FILE IS BUILT TO SURVIVE, BECAUSE IT FAILS **GREEN**.
// Next reads env at SERVER START and `playwright.config.ts` sets
// `reuseExistingServer: !CI`. Attach to a server that was started before
// `.env.local` existed and `process.env.NEXT_PUBLIC_TURSO_DATABASE_URL` is
// undefined INSIDE THAT SERVER, `getTursoConfig` returns null, the asset pane
// never mounts — and a suite gated only on a skip condition would SKIP every
// test and print as a pass. So the gate here is two-part and the second half is
// an ASSERTION, not a skip: `expectLiveAssetPane` fails loudly when the pane is
// absent, and it can only mount when the config reached the BROWSER. A skip is
// never evidence. Run against a fresh server on an isolated port:
//   PORT=3100 npm run dev
//   PORT=3100 npx playwright test e2e/documents-images-interactive.spec.ts --project=chromium --workers=1
//   PORT=3100 npm run stop
//
// ★★ PLAYWRIGHT DOES NOT LOAD `.env.local` — only Next does. `test.skip(
// !process.env.NEXT_PUBLIC_TURSO_DATABASE_URL, …)` written the obvious way is
// therefore ALWAYS TRUE in the test process and skips everything even when the
// database is live and the server is correctly configured. `readEnvLocal()`
// below parses the file itself. That is also what gives the node side the
// credentials it needs to read the table back — the only way to prove a byte
// actually landed, rather than that a control was clicked.
//
// ★★★ CREDENTIALS ARE NEVER PRINTED. No value from `.env.local` is echoed,
// logged, put in an assertion message or embedded in a failure diff — every
// check here is on a BOOLEAN or on observable app behaviour. A failing
// assertion in this file must never leak a token into CI output.
//
// ★★★ `naturalWidth`, NEVER the presence of an `<img>`. This branch has already
// shipped an image element with no usable src once; presence, visibility and a
// `src` attribute check all pass against that. Every image assertion compares
// against that image's OWN dimensions, so a resolver pointing two elements at
// one set of bytes cannot pass either.
//
// ★★ THE DATABASE IS TREATED AS DESTROYABLE BUT NOT AS EMPTY. Everything this
// file writes is scoped to the e2e project partition and cleaned up in
// `afterAll`; the §211 probe at the end deliberately breaks a table and then
// repairs it, and runs LAST for that reason.

import { readFileSync, existsSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { colDdl, ENTITY_SPECS, TABLE_NAMES } from "../src/app/turso-schema";
import {
  test, expect, gotoApp, openView, FROZEN_NOW,
  E2E_DOCUMENT_ASSET, E2E_DOCUMENT_ASSET_IMAGE_ONLY,
} from "./seed";

// ── Live-database configuration ─────────────────────────────────────────────

/** Parse `.env.local` in the TEST process. See the header: playwright does not
 *  load it, so `process.env` is not a usable source here.
 *  ★ Values are returned, never logged. Callers treat them as opaque. */
function readEnvLocal(): { url: string; token: string } {
  // `process.env` still wins when someone exports the pair explicitly (CI, or a
  // shell that sourced the file), so an env-only setup works without the file.
  const fromProcess = {
    url: process.env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? "",
    token: process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN ?? "",
  };
  if (fromProcess.url) return fromProcess;
  if (!existsSync(".env.local")) return { url: "", token: "" };
  const txt = readFileSync(".env.local", "utf8");
  const read = (key: string) => {
    const m = txt.match(new RegExp(`^${key}=(.*)$`, "m"));
    // Strip surrounding quotes and the CR of a CRLF file — both are silent
    // corruptions that would produce an unparseable URL rather than an error.
    return (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  };
  return {
    url: read("NEXT_PUBLIC_TURSO_DATABASE_URL"),
    token: read("NEXT_PUBLIC_TURSO_AUTH_TOKEN"),
  };
}

const ENV = readEnvLocal();
const LIVE = ENV.url !== "";

/** The pipeline base, normalised the way `turso-config.ts` normalises it. */
const PIPELINE_URL = LIVE ? `${ENV.url.replace(/^libsql:\/\//, "https://").replace(/\/$/, "")}/v2/pipeline` : "";

/** ★★★ THE PARTITION KEY THE APP WILL USE, DERIVED NOT GUESSED — and asserting
 *  against it is itself a real test of the `(id, project_id)` scheme.
 *  `workspace-panels.tsx` builds it as `loadPortfolioMode() === "turso" ? … :
 *  loadRegistry().currentProjectId || ASSET_PARTITION_FALLBACK`. `e2e/seed.ts`
 *  seeds the registry with `currentProjectId: "e2e-1"` and nothing puts the app
 *  in Turso PORTFOLIO mode (that is a separate switch from Turso STORAGE), so
 *  the app reads and writes bytes under this key. Write a row under the wrong
 *  one and the image simply never renders — which is the assertion failing for
 *  the right reason. */
const E2E_PROJECT_ID = "e2e-1";

/** Raw pipeline call from the TEST process, for setup, verification and
 *  cleanup. This is the only way to prove a byte reached the table rather than
 *  that the UI looked happy.
 *  ★ Throws with the HTTP status only — never the URL, never the token. */
async function pipeline(stmts: { sql: string; args?: { type: string; value: string }[] }[]) {
  const res = await fetch(PIPELINE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ENV.token ? { Authorization: `Bearer ${ENV.token}` } : {}),
    },
    body: JSON.stringify({ requests: stmts.map((stmt) => ({ type: "execute", stmt })) }),
  });
  if (!res.ok) throw new Error(`pipeline HTTP ${res.status}`);
  const json = (await res.json()) as {
    results?: { type: string; error?: { message?: string }; response?: { result?: { rows?: { value: string }[][] } } }[];
  };
  return json.results ?? [];
}

const txt = (value: string) => ({ type: "text", value });

const ASSET_DDL =
  "CREATE TABLE IF NOT EXISTS document_asset_data (id TEXT, project_id TEXT, data TEXT, PRIMARY KEY (id, project_id))";

/** Rows the app can see, for the e2e partition. */
async function readAssetBytes(id: string): Promise<string | null> {
  const results = await pipeline([
    { sql: ASSET_DDL },
    {
      sql: "SELECT data FROM document_asset_data WHERE id = ? AND project_id = ?",
      args: [txt(id), txt(E2E_PROJECT_ID)],
    },
  ]);
  const rows = results[1]?.response?.result?.rows ?? [];
  return rows.length ? (rows[0][0]?.value ?? null) : null;
}

async function writeAssetBytes(id: string, base64: string): Promise<void> {
  await pipeline([
    { sql: ASSET_DDL },
    {
      sql: "INSERT OR REPLACE INTO document_asset_data (id, project_id, data) VALUES (?, ?, ?)",
      args: [txt(id), txt(E2E_PROJECT_ID), txt(base64)],
    },
  ]);
}

async function deleteAssetBytes(id: string): Promise<void> {
  await pipeline([
    { sql: ASSET_DDL },
    {
      sql: "DELETE FROM document_asset_data WHERE id = ? AND project_id = ?",
      args: [txt(id), txt(E2E_PROJECT_ID)],
    },
  ]);
}

// ── Image fixtures ──────────────────────────────────────────────────────────

/** Real, decodable PNGs — 8-bit RGB, one flat colour, correct zlib IDAT and
 *  correct CRC32s. A byte string that merely LOOKS like base64 still yields an
 *  `<img>` with a blob: src and `naturalWidth === 0`, which is the exact
 *  signature of the CSP failure this suite exists to catch, so a fake fixture
 *  would make every assertion here vacuous.
 *
 *  ★ Each is a DIFFERENT size on purpose: assertions compare against the
 *  specific image's own dimensions, so a mixed-up resolver fails rather than
 *  passes. Distinct bytes also mean distinct SHA-256s, so the hash-keyed upload
 *  dedup treats them as three separate images.
 *
 *  ★★ THE ONE-CHARACTER MUTANT DOES NOT WORK ON THESE, and knowing that saves
 *  someone a wasted probe: flipping a base64 character corrupts IDAT and its
 *  CRC, and Chromium still reports the IHDR dimensions, so the mutant survives
 *  for a reason that says nothing about the test. Mutate the DECLARED width
 *  instead — that is what was actually used to prove these assertions live.
 *
 *  Regenerate (node, no dependencies):
 *    node -e 'const z=require("zlib");
 *    function crc32(b){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}
 *    let r=0xFFFFFFFF;for(const x of b)r=t[(r^x)&0xFF]^(r>>>8);return (r^0xFFFFFFFF)>>>0;}
 *    function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(ty,"ascii"),d]);
 *    const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
 *    function png(w,h,rgb){const i=Buffer.alloc(13);i.writeUInt32BE(w,0);i.writeUInt32BE(h,4);i[8]=8;i[9]=2;
 *    const raw=Buffer.alloc(h*(1+w*3));for(let y=0;y<h;y++){const o=y*(1+w*3);for(let x=0;x<w;x++){
 *    raw[o+1+x*3]=rgb[0];raw[o+2+x*3]=rgb[1];raw[o+3+x*3]=rgb[2];}}
 *    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch("IHDR",i),ch("IDAT",z.deflateSync(raw)),ch("IEND",Buffer.alloc(0))]);}
 *    console.log(png(6,6,[220,40,40]).toString("base64"))' */
const PNG_UPLOAD = {
  name: "uploaded-chart.png",
  width: 6,
  height: 6,
  base64: "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAGCAIAAABvrngfAAAAEUlEQVR4nGO4o6GBhhhoKwQAfvkqMfvTi9EAAAAASUVORK5CYII=",
} as const;

const PNG_PASTE = {
  name: "pasted-image.png",
  width: 5,
  height: 3,
  base64: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAEElEQVR4nGPQiLqDjBgI8AHh4xSDzY8fywAAAABJRU5ErkJggg==",
} as const;

const PNG_DROP = {
  name: "dropped-image.png",
  width: 7,
  height: 2,
  base64: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAACCAIAAAAb/VE3AAAAEUlEQVR4nGOQWxWFiRiwigIAWdsP3dZXAIYAAAAASUVORK5CYII=",
} as const;

/** The e2e-only document seeded in seed.ts that already carries image blocks.
 *  Selected EXPLICITLY: documents-panel.tsx falls back to `selectionPool[0]`,
 *  the UNSORTED `documents` array, which is the sample master's document — not
 *  this one. */
const DOC_TITLE = "Kickoff pack";
const OTHER_DOC_TITLE = "Steering update";

/** `rowLabel` in asset-library.tsx is `${verb} – ${token}` with an EN DASH, and
 *  the token is the asset NAME while names stay unique. Spelled once here so a
 *  hyphen never creeps in and silently matches nothing. */
const rowLabel = (verb: string, token: string) => `${verb} – ${token}`;

// ── Page helpers ────────────────────────────────────────────────────────────

/** ★★ ONLY `tourSeen` IS WRITTEN, AND NOTHING TURSO-RELATED. The guided tour
 *  auto-launches on a fresh device and drops a `fixed inset-0` overlay that
 *  intercepts every real pointer click; dodging it with a DOM `.click()` at
 *  each step would bypass Playwright's auto-waiting and turn every interaction
 *  into a race. The Turso credentials deliberately do NOT go here — they come
 *  from the environment, which is the whole point of this revision, and writing
 *  them into settings would re-introduce the coupling that made the Safe Mode
 *  test vacuous.
 *  ★ Settings are a SHALLOW merge over defaults (`{...defaultSettings,
 *  ...parsed}`), so this leaves storageConfig and everything else default. */
async function suppressTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
}

declare global {
  interface Window {
    __cspViolations?: { directive: string; blockedURI: string }[];
  }
}

/** ★★ THE DOM EVENT, NOT CONSOLE TEXT-MATCHING: `securitypolicyviolation`
 *  carries the violated directive as a field, so it cannot be defeated by
 *  Chromium rewording its console message. Must be installed before the app
 *  navigation or the violation fires with nothing watching. */
async function watchCsp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations?.push({
        directive: e.effectiveDirective || e.violatedDirective,
        blockedURI: e.blockedURI,
      });
    });
  });
}

async function expectNoCspViolations(page: Page): Promise<void> {
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  expect(violations, `CSP violations reported by the page: ${JSON.stringify(violations)}`).toEqual([]);
}

/** ★★ A DOM CLICK, mirroring e2e/a11y.spec.ts — the documents list rows are
 *  reachable this way even mid-render. ★ EXACT text match: every per-row
 *  control in documents-list.tsx is named "<action> – <title>", so a loose
 *  match would also hit Delete. */
async function selectDocument(page: Page, title: string): Promise<void> {
  const clicked = await page.evaluate((wanted) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === wanted,
    );
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  }, title);
  expect(clicked, `Document row "${title}" not found in the documents list`).toBe(true);
}

/**
 * ★★★ THE LOAD-BEARING GATE. This is an ASSERTION, never a skip — see the file
 * header. The asset surface mounts only when `tursoConfig !== null`, and with
 * no Turso settings written anywhere the ONLY thing that can make it non-null
 * is NEXT_PUBLIC_TURSO_DATABASE_URL having been inlined into the server this
 * page is talking to. So a visible drop zone proves the credential reached the
 * BROWSER; a skipped suite proves nothing at all.
 *
 * ★ The message names the three real causes so a red run is never mistaken for
 * a product defect. The first is by far the most likely and is invisible
 * otherwise.
 */
async function expectLiveAssetPane(page: Page): Promise<void> {
  await expect(
    page.locator("[data-asset-drop-zone]"),
    "the asset library did not mount, so getTursoConfig returned null in the BROWSER. Almost " +
      "certainly the dev server predates .env.local and playwright reused it (reuseExistingServer) " +
      "— Next reads env at server start. Restart on an isolated port and re-run. Other causes: the " +
      "URL is not https/loopback, or Safe Mode is on.",
  ).toBeVisible({ timeout: 30_000 });
}

/** Dispatch a real `paste` or `drop` carrying a real `File`, built in the page.
 *
 *  ★★★ SYNTHESIZED, NOT AN OS GESTURE, AND THAT LIMIT SURVIVES A LIVE DATABASE.
 *  Playwright cannot put an image on the system clipboard, and its `dragTo`
 *  moves DOM elements, not files from the desktop. This constructs a
 *  `DataTransfer`, adds a `File` and dispatches a bubbling
 *  `ClipboardEvent`/`DragEvent` — what the browser itself delivers, and
 *  React's `onPaste`/`onDrop` cannot tell the difference. NOT covered: that
 *  Chromium puts a PNG on the clipboard with `type === "image/png"` for a real
 *  Ctrl+V (the handler filters on exactly that), and that a real desktop drag
 *  reaches this element rather than the browser's navigate-to-file default.
 *  Both stay in the manual checklist. */
async function dispatchFileEvent(
  page: Page,
  selector: string,
  kind: "paste" | "drop",
  file: { name: string; base64: string },
): Promise<void> {
  const delivered = await page.evaluate(
    ({ selector, kind, name, base64 }) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: "image/png" }));
      const event =
        kind === "paste"
          ? new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
          : new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return true;
    },
    { selector, kind, name: file.name, base64: file.base64 },
  );
  expect(delivered, `${kind} target "${selector}" not found`).toBe(true);
}

/** The `data-asset-id` of every image currently in the preview, in DOM order.
 *
 *  ★★★ READ FROM THE DOM, NEVER FROM INDEXEDDB. An earlier cut read the
 *  `documentAssets` kv row and raced: an upload commits the metadata row to
 *  React state, and persistence is a DEBOUNCED workspace autosave — so a picker
 *  upload that inserts nothing has written no IDB row at the moment the next
 *  line runs. Reading rendered `<img>` elements also asserts the thing that
 *  matters: an id that reached the DOCUMENT. */
async function previewAssetIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("img[data-asset-id]")].map((i) => i.getAttribute("data-asset-id") ?? ""),
  );
}

/** Waits until a new `<img data-asset-id>` appears and returns its id. */
async function pollNewId(page: Page, before: string[]): Promise<string> {
  await expect
    .poll(() => previewAssetIds(page).then((ids) => ids.filter((id) => !before.includes(id)).length), {
      message: "no new image ever appeared in the document",
    })
    .toBeGreaterThan(0);
  const after = await previewAssetIds(page);
  const id = after.find((x) => !before.includes(x));
  expect(id, "the document changed but no new asset id appeared").toBeTruthy();
  return id!;
}

/** Everything this file uploads, so `afterAll` can clean the table. */
const minted = new Set<string>();
async function trackAndCollect(page: Page, before: string[]): Promise<string> {
  const id = await pollNewId(page, before);
  minted.add(id);
  return id;
}

// ── Suite ───────────────────────────────────────────────────────────────────

test.describe("document images — live Turso", () => {
  // The ONLY skip: no credentials anywhere. Everything past this point asserts.
  test.skip(!LIVE, "needs a live Turso database (.env.local NEXT_PUBLIC_TURSO_*)");

  test.beforeAll(async () => {
    // ★ Guarded independently of the describe-level skip: a `beforeAll` still
    // runs in some skip configurations, and unguarded it would POST to an empty
    // URL on a machine with no database — a confusing failure in the one
    // situation this file is supposed to stay quiet in.
    if (!LIVE) return;
    // The two assets `e2e/seed.ts` puts in the workspace METADATA have no bytes
    // in any real database, so without this every seeded image is dangling and
    // the render tests would measure a seeding gap rather than the product.
    // Written under E2E_PROJECT_ID — if that key is wrong the images do not
    // render and the assertion fails, which is the partition scheme being
    // tested rather than assumed.
    await writeAssetBytes(E2E_DOCUMENT_ASSET.id, E2E_DOCUMENT_ASSET.base64);
    await writeAssetBytes(E2E_DOCUMENT_ASSET_IMAGE_ONLY.id, E2E_DOCUMENT_ASSET_IMAGE_ONLY.base64);
  });

  test.afterAll(async () => {
    if (!LIVE) return;
    for (const id of [E2E_DOCUMENT_ASSET.id, E2E_DOCUMENT_ASSET_IMAGE_ONLY.id, ...minted]) {
      await deleteAssetBytes(id).catch(() => {});
    }
  });

  test("uploads a real PNG through the picker, stores the bytes, and renders it", async ({ page }) => {
    await watchCsp(page);
    await suppressTour(page);
    await gotoApp(page);
    await openView(page, "Documents");
    await selectDocument(page, DOC_TITLE);
    await expectLiveAssetPane(page);

    const before = await previewAssetIds(page);

    // The library's own picker. The input is `sr-only`, never display:none
    // (file-picker-button.tsx). The `accept` filter is what proves this is the
    // ASSET picker and not some other file input on the page.
    await page.locator('input[type="file"][accept*="image/png"]').first().setInputFiles({
      name: PNG_UPLOAD.name,
      mimeType: "image/png",
      buffer: Buffer.from(PNG_UPLOAD.base64, "base64"),
    });

    await expect(
      page.getByRole("button", { name: rowLabel("Rename", PNG_UPLOAD.name) }),
      "no library row for the uploaded image",
    ).toBeVisible();
    // The marker is only in the DOM when an asset is dangling, so an absent one
    // across the whole library means the byte write was accepted.
    await expect(page.locator("[data-dangling-marker]")).toHaveCount(0);

    // ★★ INSERT VIA THE MODAL. The inline `AssetLibrary` has NO per-row Insert
    // control — `documents-asset-section.tsx` passes `onInsert` only to
    // `AssetLibraryModal`, and `AssetLibrary` renders that button
    // conditionally. Reaching for an inline row Insert times out against a
    // control that has never existed.
    await page.getByRole("button", { name: "Insert image" }).click();
    await page.getByRole("button", { name: rowLabel("Insert", PNG_UPLOAD.name) }).click();
    await expect(
      page.locator("[data-modal-panel]"),
      "inserting did not close the picker — the dialog now covers the paragraph it changed",
    ).toHaveCount(0);

    const newId = await trackAndCollect(page, before);

    // ── THE BYTES ARE IN THE REAL TABLE ──────────────────────────────────────
    // Read back over a second connection, from the test process. This is the
    // assertion a stub could never make: it proves the app's own INSERT was
    // accepted by SQLite under the composite key, not that a mock recorded it.
    expect(
      await readAssetBytes(newId),
      "the uploaded image is not in document_asset_data under the e2e project partition",
    ).toBe(PNG_UPLOAD.base64);

    // ── AND THE PLACED IMAGE DECODES ─────────────────────────────────────────
    const img = page.locator(`img[data-asset-id="${newId}"]`);
    await expect(img, "the inserted image is not in the preview").toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight })), {
        message:
          "the uploaded image never decoded. A blob: src with naturalWidth 0 is the CSP img-src " +
          "regression signature; no blob: src at all means the byte store never delivered.",
      })
      .toEqual({ w: PNG_UPLOAD.width, h: PNG_UPLOAD.height });

    await expectNoCspViolations(page);
  });

  for (const { kind, file } of [
    { kind: "paste" as const, file: PNG_PASTE },
    { kind: "drop" as const, file: PNG_DROP },
  ]) {
    test(`${kind} uploads to the real store and inserts in one gesture`, async ({ page }) => {
      await watchCsp(page);
      await suppressTour(page);
      await gotoApp(page);
      await openView(page, "Documents");
      await selectDocument(page, DOC_TITLE);
      await expectLiveAssetPane(page);

      const before = await previewAssetIds(page);

      // ★ `[data-asset-drop-zone]` is the STRUCTURAL handle the component
      // exposes for exactly this (house convention, cf. `data-block-row`) —
      // deliberately NOT the role/label it also carries, so a mutation of
      // either cannot kill this test at the lookup and leave the assertion
      // silently unrun.
      await dispatchFileEvent(page, "[data-asset-drop-zone]", kind, file);

      const newId = await trackAndCollect(page, before);
      expect(await readAssetBytes(newId), `${kind}: bytes never reached document_asset_data`).toBe(file.base64);

      const img = page.locator(`img[data-asset-id="${newId}"]`);
      await expect(img, `${kind}: the image was uploaded but never inserted into the document`).toBeVisible();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight })), {
          message: `${kind}: the image never decoded`,
        })
        .toEqual({ w: file.width, h: file.height });

      await expectNoCspViolations(page);
    });
  }

  test("marks an asset dangling when the real table has no bytes for it", async ({ page }) => {
    // A metadata row whose bytes are genuinely absent from the live table — the
    // state the marker exists to disclose. Written and removed here rather than
    // faked, so this exercises the real ids-diff query
    // (`assetDataIdsSelect`) against a real table.
    await deleteAssetBytes(E2E_DOCUMENT_ASSET_IMAGE_ONLY.id);
    try {
      await suppressTour(page);
      await gotoApp(page);
      await openView(page, "Documents");
      await selectDocument(page, DOC_TITLE);
      await expectLiveAssetPane(page);

      await expect(
        page.locator("[data-dangling-marker]"),
        "an asset with no bytes in the live table was not marked dangling",
      ).toHaveCount(1);
      // ★ The marker is aria-hidden, so the sr-only text beside it is the ONLY
      // thing that tells a screen-reader user the bytes are gone. Asserted
      // because nothing else in any layer covers it.
      await expect(page.getByText("Image data missing").first()).toBeAttached();

      // The HEALTHY asset must NOT be marked — otherwise a marker on every row
      // would pass the assertion above for the wrong reason.
      const healthyRow = page.getByRole("row").filter({ hasText: E2E_DOCUMENT_ASSET.name });
      await expect(healthyRow.locator("[data-dangling-marker]")).toHaveCount(0);
    } finally {
      await writeAssetBytes(E2E_DOCUMENT_ASSET_IMAGE_ONLY.id, E2E_DOCUMENT_ASSET_IMAGE_ONLY.base64);
    }
  });

  test("renames a row, and deletes one — removing its bytes from the real table", async ({ page }) => {
    // Uploaded fresh so the delete cannot disturb the seeded pair the other
    // tests depend on.
    await suppressTour(page);
    await gotoApp(page);
    await openView(page, "Documents");
    await selectDocument(page, DOC_TITLE);
    await expectLiveAssetPane(page);

    const before = await previewAssetIds(page);
    await dispatchFileEvent(page, "[data-asset-drop-zone]", "paste", PNG_UPLOAD);
    const id = await trackAndCollect(page, before);
    expect(await readAssetBytes(id), "upload did not store bytes").toBe(PNG_UPLOAD.base64);

    // ── Usage counts come from the documents, not the byte store ─────────────
    const row = page.getByRole("row").filter({ hasText: PNG_UPLOAD.name });
    await expect(row, "the freshly inserted image is not counted as used once").toContainText("1");

    // ── Rename ───────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: rowLabel("Rename", PNG_UPLOAD.name) }).click();
    await page.getByRole("textbox", { name: rowLabel("Rename", PNG_UPLOAD.name) }).fill("renamed.png");
    await page.getByRole("button", { name: rowLabel("Confirm", PNG_UPLOAD.name) }).click();
    await expect(
      page.getByRole("button", { name: rowLabel("Rename", "renamed.png") }),
      "the rename did not reach the library",
    ).toBeVisible();

    // ── Delete, confirm-gated, with the usage count in the message ───────────
    await page.getByRole("button", { name: rowLabel("Delete", "renamed.png") }).click();
    const dialog = page.locator("[data-modal-panel]");
    await expect(
      dialog,
      "the delete confirmation does not disclose that the image is in use",
    ).toContainText("used in 1 document");
    // Scoped to the dialog: the library's own per-row rename control is also
    // called "Confirm".
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();

    await expect(
      page.getByRole("button", { name: rowLabel("Rename", "renamed.png") }),
      "the row survived the delete",
    ).toHaveCount(0);

    // ★★ THE BYTES ARE GONE FROM THE REAL TABLE. The cleanup is best-effort in
    // the product, but it must be ATTEMPTED and it must land — otherwise every
    // deleted image leaves its bytes behind for the life of the database, and
    // nothing but a direct read can see that.
    await expect
      .poll(() => readAssetBytes(id), { message: "delete left the bytes in document_asset_data" })
      .toBeNull();
  });

  // ★★★ EXPECTED RED. This is the most serious thing this file found and it is
  // a live product defect, not a harness artifact. It reproduces identically
  // against a STUBBED transport and against this live database, with a frozen
  // clock and with a real one, and it is why `e2e/documents-images.spec.ts` is
  // deterministically red at HEAD. Do NOT weaken it into a characterization
  // without a decision to ship the defect: unlike §210 and §126 this is not a
  // known, recorded gap.
  //
  // MEASURED, not inferred. Sampling `naturalWidth` every 500ms from the moment
  // a document is opened gives, for every image in the preview simultaneously,
  // seeded and freshly pasted alike:
  //     8,8,8,8,8, 0,0,0,0,0,0,0,0,0,0,0
  // At the zero point the `src` ATTRIBUTE IS ABSENT and `data-asset-missing` is
  // NOT stamped either, which rules out the loader having run and found
  // nothing: `attachAssetImages` sets one or the other for every
  // `<img data-asset-id>` it processes. Re-selecting the document brings every
  // image back — for another second or two.
  //
  // USER IMPACT: open a document containing an image and the image appears,
  // then silently vanishes. It is the headline feature of this branch.
  test("images stay rendered — they must not blank out after the document settles", async ({ page }) => {
    await watchCsp(page);
    await suppressTour(page);
    await gotoApp(page);
    await openView(page, "Documents");
    await selectDocument(page, DOC_TITLE);
    await expectLiveAssetPane(page);

    const img = page.locator(`img[data-asset-id="${E2E_DOCUMENT_ASSET.id}"]`);

    // First, it DOES render — so a red run below can never be read as "the
    // byte store never delivered". This also proves the beforeAll write landed
    // under the partition key the app actually reads.
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        message: "the seeded image never rendered at all — that is a different defect from the one below",
      })
      .toBe(E2E_DOCUMENT_ASSET.width);

    // ...and then it must STAY rendered. Sampled rather than polled: a poll
    // succeeds on the first good sample and would pass against an image that
    // blanks immediately afterwards, which is exactly the failure here.
    const widths: number[] = [];
    for (let i = 0; i < 16; i++) {
      widths.push(await img.evaluate((el: HTMLImageElement) => el.naturalWidth));
      await page.waitForTimeout(500);
    }
    expect(
      widths,
      "the document image blanked out after rendering. Every sample should be " +
        `${E2E_DOCUMENT_ASSET.width}; a run of zeros after a run of ${E2E_DOCUMENT_ASSET.width}s means the ` +
        "preview lost its blob: src and never re-resolved. See this test's header for the measurement.",
    ).toEqual(Array(16).fill(E2E_DOCUMENT_ASSET.width));

    await expectNoCspViolations(page);
  });

  test("a failed byte write goes dangling, and re-uploading the same image repairs it (§212)", async ({ page }) => {
    await watchCsp(page);
    await suppressTour(page);

    // ★★★ EXACTLY ONE REQUEST IS INTERCEPTED, and only the one that carries the
    // asset byte write. Everything else — the ids-diff query, the byte read
    // back, comm-templates, operating guides, scheduled jobs, and the RETRY
    // itself — goes to the real database via `route.continue()`. This is the
    // one thing a live database cannot produce on demand: a transport failure
    // at a chosen moment. It is a simulated NETWORK fault, not a simulated
    // store; the row it fails to write is a row the real table genuinely does
    // not have afterwards, which the assertions below verify directly.
    let failed = false;
    await page.route("**/v2/pipeline", async (route: Route) => {
      const body = route.request().postData() ?? "";
      if (!failed && /INSERT OR REPLACE INTO document_asset_data/i.test(body)) {
        failed = true;
        await route.fulfill({ status: 503, contentType: "text/plain", body: "one-shot transport failure" });
        return;
      }
      await route.continue();
    });

    await gotoApp(page);
    await openView(page, "Documents");
    await selectDocument(page, DOC_TITLE);
    await expectLiveAssetPane(page);

    const before = await previewAssetIds(page);

    // ── 1. The byte write fails ──────────────────────────────────────────────
    await dispatchFileEvent(page, "[data-asset-drop-zone]", "paste", PNG_UPLOAD);

    // The metadata row exists — metadata-first is the documented ordering, and
    // a rollback would have left no row at all, which is the state that
    // ordering exists to avoid.
    await expect(
      page.getByRole("button", { name: rowLabel("Rename", PNG_UPLOAD.name) }),
      "the failed upload left no metadata row — the metadata-first ordering has regressed",
    ).toBeVisible();
    await expect(page.getByText("The image could not be saved. Re-upload to retry.")).toBeVisible();

    const brokenId = await trackAndCollect(page, before);
    // Verified against the REAL table, not against a mock's bookkeeping.
    expect(
      await readAssetBytes(brokenId),
      "the intercept did not actually prevent the write — this test is not testing what it claims",
    ).toBeNull();
    expect(failed, "the one-shot intercept never fired").toBe(true);

    await expect(
      page.locator("[data-dangling-marker]"),
      "a failed byte write did not mark the row dangling",
    ).toHaveCount(1);

    const placed = page.locator(`img[data-asset-id="${brokenId}"]`);
    await expect(placed, "the image was not inserted despite the row existing").toBeVisible();

    // ── 2. Re-upload the SAME image; the retry reaches the real database ─────
    await page.locator('input[type="file"][accept*="image/png"]').first().setInputFiles({
      name: PNG_UPLOAD.name,
      mimeType: "image/png",
      buffer: Buffer.from(PNG_UPLOAD.base64, "base64"),
    });

    // ★★★ THE BYTES LAND UNDER THE ID THE DOCUMENT ALREADY POINTS AT. This is
    // the whole of §212: the dangling row carries the hash of exactly these
    // bytes, so before `e572760f` the hash-only dedup short-circuited and the
    // retry never reached the store. Read back from the real table.
    await expect
      .poll(() => readAssetBytes(brokenId), {
        message:
          "the retry never reached document_asset_data under the existing id — the hash dedup " +
          "swallowed it, which is the §212 regression",
        timeout: 15_000,
      })
      .toBe(PNG_UPLOAD.base64);

    // ★★ ONE ROW, read by its EXACT accessible name, is what detects a second
    // mint: `buildRowTokens` (asset-library.tsx) disambiguates duplicate names,
    // so two rows called "uploaded-chart.png" become "…(1)" and "…(2)" and this
    // exact label matches ZERO. A `toHaveCount(1)` fails in BOTH directions —
    // a lost row and a duplicated one.
    await expect(
      page.getByRole("button", { name: rowLabel("Rename", PNG_UPLOAD.name) }),
      "the repair minted a SECOND library row instead of re-writing the existing one",
    ).toHaveCount(1);
    expect(await previewAssetIds(page), "the placed image's id changed under the repair").toContain(brokenId);

    await expect(
      page.locator("[data-dangling-marker]"),
      "the dangling marker survived a successful repair — commitDangling did not clear the id",
    ).toHaveCount(0);

    // ── 3. The image already placed in the document resolves to the new bytes ─
    //
    // ★★★ THE RE-SELECT IS NOT A CONVENIENCE AND IT IS NOT PART OF §212. Every
    // image in the preview blanks out a second or two after it appears — see
    // the "images stay rendered" test above — so by this point the placed
    // `<img>` is at naturalWidth 0 whatever the repair did. Re-selecting forces
    // a fresh resolve and puts the assertion back inside a window where it
    // measures THIS test's subject.
    // ★★★ WITHOUT IT THIS ASSERTION WOULD BE VACUOUS IN THE OTHER DIRECTION.
    // An earlier cut asserted the placed image was still 0 here and PASSED —
    // but it would also have passed with the §212 fix reverted, with it never
    // written, and with the byte store empty, because the blanking defect makes
    // every image 0 at this point. Measured, not reasoned.
    await selectDocument(page, OTHER_DOC_TITLE);
    await selectDocument(page, DOC_TITLE);
    await expect
      .poll(() => placed.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight })), {
        message:
          "the repaired image never renders at the id the document already points at. The bytes are " +
          "in the real table (asserted above), so this is the repair failing to reach the placement " +
          "— the exact failure §212 exists to close.",
        timeout: 10_000,
      })
      .toEqual({ w: PNG_UPLOAD.width, h: PNG_UPLOAD.height });

    await expectNoCspViolations(page);
  });

  // ★★★ NOW NON-VACUOUS, AND ONLY BECAUSE THE CONFIG COMES FROM THE
  // ENVIRONMENT. When the credentials lived in localStorage this test could not
  // isolate the gate at all: Safe Mode ignores persisted settings entirely
  // (`use-settings.ts` returns defaultSettings before ever reading
  // SETTINGS_KEY), so the feature was off whether or not
  // `workspace-panels.tsx`'s `safeMode ? null :` existed. With
  // NEXT_PUBLIC_TURSO_DATABASE_URL set, `getTursoConfig` returns non-null from
  // DEFAULT settings — so that expression is now the only thing that can
  // disable the pane, and deleting it makes this test red. This is the exact
  // reachable path the gate's own comment says it closes.
  test("Safe Mode refuses the asset library even with an env-configured database", async ({ page }) => {
    await suppressTour(page);
    await page.clock.install({ time: FROZEN_NOW });

    // ★★★ THE POSITIVE CONTROL COMES FIRST, AND IT IS WHAT KEEPS THIS TEST
    // HONEST. Every other test in this file calls `expectLiveAssetPane`, which
    // fails loudly when the config never reached the browser. This one asserts
    // an ABSENCE, so it would PASS on a server with no credentials — exactly
    // the stale-server trap, and the one test in the file that could hide it.
    // Proving the pane mounts on the SAME server first turns the absence below
    // into evidence about Safe Mode rather than about the environment.
    await gotoApp(page);
    await openView(page, "Documents");
    await selectDocument(page, DOC_TITLE);
    await expectLiveAssetPane(page);

    await page.goto("/?safe=1");
    await expect(page.locator("main").first()).toBeVisible();
    await openView(page, "Documents");

    await expect(
      page.getByText("Images need a Turso project. Documents work on every backend."),
      "Safe Mode did not disable the asset library",
    ).toBeVisible();
    // Not merely a message beside a live control: the whole surface is gone, so
    // nothing can move or rewrite a byte under a re-partitioned key.
    await expect(page.locator("[data-asset-drop-zone]")).toHaveCount(0);
    await expect(page.locator('input[type="file"][accept*="image/png"]')).toHaveCount(0);
  });

  // ★★★ CHARACTERIZATION OF A KNOWN DEFECT — docs/open-followups.md §210.
  // Asserts the image is BROKEN in a standalone HTML export, which is what the
  // code does today: `renderDocumentHtml`'s `assets` argument has no production
  // caller, so `inlineDocumentImages` never runs. Meant to go RED when §210 is
  // fixed, at which point invert it to assert a `data:` URI. Same shape as
  // `e2e/seed-content.spec.ts`'s §126 count. A green run here is NOT "export
  // works".
  // ★ A live database changes nothing about this — the export path never reads
  // the byte store at all, which is the defect.
  test("standalone HTML export emits the image with no source at all (§210, characterization)", async ({ page }) => {
    await suppressTour(page);
    await gotoApp(page);
    await openView(page, "Documents");
    await selectDocument(page, DOC_TITLE);
    await expectLiveAssetPane(page);

    await page.getByRole("combobox", { name: /format/i }).selectOption("html");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /download/i }).first().click();
    const download = await downloadPromise;
    const html = readFileSync(await download.path(), "utf8");

    const imgTag = html.match(/<img\b[^>]*data-asset-id="e2e-asset-1"[^>]*>/);
    expect(imgTag, "the exported HTML carries no image element at all").toBeTruthy();
    expect(imgTag![0], "§210 appears FIXED — invert this test to assert a data: URI").not.toContain("src=");
    expect(html, "§210 appears FIXED — the missing-image marker is now stamped").not.toContain(
      'data-asset-missing="true"',
    );
  });
});

// ── §211: the idKind landmine, against a real SQLite engine ─────────────────
//
// ★★★ RUNS LAST AND DELIBERATELY BREAKS A TABLE. It drops and recreates
// `document_assets` on the throwaway database, and leaves it with the CORRECT
// DDL when it finishes. Nothing above depends on that table — the byte side
// table is `document_asset_data`, which this never touches — so the ordering is
// belt-and-braces rather than load-bearing.
//
// ★★★ WHY NO UNIT TEST CAN REACH THIS, WHICH IS THE WHOLE POINT.
// `colDdl` renders any column named `id` as `id INTEGER PRIMARY KEY` unless the
// spec declares `idKind: "text"` — a rowid alias, the ONE column type SQLite
// actually enforces. `DocumentAsset` is the first entity whose id is a
// `crypto.randomUUID()`, and `insertStmt` binds it as `{type:"text"}`. Against
// the pre-`idKind` DDL a real engine answers `datatype mismatch`; against
// `entity-persistence-registry.test.ts`, which MATCHES DDL STRINGS and never
// executes a statement, nothing happens at all. Only an engine can tell those
// two apart.
//
// ★★ THE HONEST SCOPE OF WHAT THIS REPRODUCES. It proves the ENGINE half: the
// bad DDL rejects the insert, and because the insert rides one shared
// BEGIN…COMMIT the transaction never commits, so a co-resident write in the
// same batch is lost with it. It does NOT drive the app into that state,
// because the workspace save only emits these statements when
// `settings.storageConfig.kind === "turso"`, and `e2e/seed.ts` seeds the
// BROWSER backend — asset METADATA rides IndexedDB there while only the BYTES
// go to Turso. Reproducing "every subsequent workspace save fails" through the
// UI needs a Turso-STORAGE workspace, which is a different seed. Stated rather
// than blurred.
test.describe("§211 — a text id against the pre-idKind DDL", () => {
  test.skip(!LIVE, "needs a live Turso database (.env.local NEXT_PUBLIC_TURSO_*)");

  /** A co-resident write, standing in for the tasks/RAID/milestone inserts that
   *  share the workspace save's single transaction. Its survival is the
   *  observable separating "one row was rejected" from "the whole save was
   *  lost". */
  const MARKER_DDL = "CREATE TABLE IF NOT EXISTS e2e_probe_marker (id TEXT PRIMARY KEY, note TEXT)";

  /** The app's OWN spec and builders, imported rather than restated, so this
   *  probe cannot drift from the DDL production actually emits. */
  const assetSpec = ENTITY_SPECS.find((s) => s.table === "document_assets")!;

  /** Mirrors `insertStmt`'s binding rule for `idKind: "text"` — every column
   *  bound as TEXT, id included. That binding is the thing under test. */
  const assetInsertArgs = (id: string) =>
    assetSpec.columns.map((c) => txt(c === "id" ? id : c === "name" ? "probe.png" : ""));

  const assetInsertSql = () =>
    `INSERT INTO document_assets (${assetSpec.columns.map((c) => `"${c}"`).join(",")}) ` +
    `VALUES (${assetSpec.columns.map(() => "?").join(",")})`;

  /** One workspace-save-shaped transaction: a co-resident row plus one asset
   *  row, inside a single BEGIN…COMMIT. */
  const saveShapedTransaction = (note: string) =>
    pipeline([
      { sql: MARKER_DDL },
      { sql: "BEGIN" },
      { sql: "INSERT OR REPLACE INTO e2e_probe_marker (id, note) VALUES (?, ?)", args: [txt("m1"), txt(note)] },
      { sql: assetInsertSql(), args: assetInsertArgs("11111111-2222-3333-4444-555555555555") },
      { sql: "COMMIT" },
    ]);

  async function markerNote(): Promise<string | null> {
    const results = await pipeline([
      { sql: MARKER_DDL },
      { sql: "SELECT note FROM e2e_probe_marker WHERE id = ?", args: [txt("m1")] },
    ]);
    const rows = results[1]?.response?.result?.rows ?? [];
    return rows.length ? (rows[0][0]?.value ?? null) : null;
  }

  test.afterAll(async () => {
    if (!LIVE) return;
    // Leave the database with the CORRECT schema and no probe leftovers.
    await pipeline([
      { sql: "DROP TABLE IF EXISTS e2e_probe_marker" },
      { sql: "DROP TABLE IF EXISTS document_assets" },
      { sql: `CREATE TABLE IF NOT EXISTS document_assets (${colDdl(assetSpec.columns, assetSpec.idKind)})` },
    ]).catch(() => {});
  });

  test("the spec declares a text id, and the bytes table stays out of TABLE_NAMES", async () => {
    // Two AGENTS.md claims checked against the code rather than restated: the
    // declaration that makes the DDL correct, and the exclusion that keeps a
    // workspace save's per-table DELETE sweep away from the image bytes.
    expect(assetSpec.idKind, "document_assets no longer declares a text id — §211 is live again").toBe("text");
    expect(TABLE_NAMES).toContain("document_assets");
    expect(
      TABLE_NAMES,
      "document_asset_data entered TABLE_NAMES — a workspace save would now wipe every image",
    ).not.toContain("document_asset_data");
  });

  test("the pre-idKind DDL rejects the insert — and the batch still COMMITS around it", async () => {
    await pipeline([
      { sql: "DROP TABLE IF EXISTS e2e_probe_marker" },
      { sql: "DROP TABLE IF EXISTS document_assets" },
      // The OLD shape, from the SAME builder with the default idKind — exactly
      // what production emitted before the fix, not an approximation of it.
      { sql: `CREATE TABLE document_assets (${colDdl(assetSpec.columns, "integer")})` },
    ]);

    const results = await saveShapedTransaction("before");
    const errors = results.map((r) => r?.error?.message ?? "").filter((m) => m !== "");

    // ── The §211 core, and it holds ─────────────────────────────────────────
    expect(
      errors.join(" | "),
      "a text id against `id INTEGER PRIMARY KEY` was accepted — SQLite's rowid-alias enforcement is " +
        "the only thing that makes idKind matter, so this probe is not reaching a real engine",
    ).toMatch(/datatype mismatch/i);

    // ── And here the measurement CONTRADICTS the documented mechanism ────────
    //
    // ★★★ `turso-schema.ts`'s own comment and AGENTS.md's `idKind` bullet both
    // say "COMMIT is never reached, and ONE such row stops the WHOLE workspace
    // from ever saving". Measured against this engine, the FIRST half is false
    // and that changes what the second half means. A libSQL `/v2/pipeline`
    // batch does NOT abort at a failing statement: it returns an error result
    // for that one and KEEPS EXECUTING, so the trailing COMMIT runs, returns
    // `ok`, and commits everything that succeeded. Reproduced standalone with
    // a two-table minimal case (`id INTEGER PRIMARY KEY` fed a text id inside
    // BEGIN…COMMIT): per-statement types came back
    // `ok, ok, error(datatype mismatch), ok` and the co-resident row was
    // readable afterwards over a fresh connection.
    //
    // ★★★ THE REAL FAILURE MODE IS WORSE THAN THE DOCUMENTED ONE, not milder.
    // `runTursoPipeline` scans the results, sees the error, calls
    // `rollbackBestEffort` — which now runs against a transaction that has
    // ALREADY COMMITTED, so it changes nothing — and throws. The user is shown
    // a failed save while the workspace was in fact written, minus the one
    // rejected row. "Every save reports failure" is right; "nothing is saved"
    // is not, and a reader who believes the latter will not go looking for the
    // partially-written data.
    //
    // ★★ This assertion therefore pins the MEASURED behaviour, deliberately not
    // the documented one. If it ever goes red because the marker is absent, the
    // engine (or the pipeline protocol) started aborting batches at the first
    // error — at which point the docs became right and this comment is what
    // needs deleting.
    expect(
      await markerNote(),
      "the co-resident write did NOT survive — this engine aborted the batch at the failing " +
        "statement. That would make turso-schema.ts's 'COMMIT is never reached' correct and this " +
        "test's premise stale; re-measure and rewrite both.",
    ).toBe("before");
  });

  test("dropping the table is a real remedy — the same transaction then commits", async () => {
    // The documented repair. `turso-migrate.ts` self-heals a MISSING COLUMN by
    // PRAGMA-diff plus ALTER ADD COLUMN, but a wrong TYPE on the primary key is
    // not something ALTER can fix, so the table has to go.
    await pipeline([
      { sql: "DROP TABLE IF EXISTS document_assets" },
      { sql: `CREATE TABLE document_assets (${colDdl(assetSpec.columns, assetSpec.idKind)})` },
    ]);

    const results = await saveShapedTransaction("after");
    const errors = results.map((r) => r?.error?.message ?? "").filter((m) => m !== "");
    expect(errors, "the corrected DDL still rejected the insert").toEqual([]);
    expect(
      await markerNote(),
      "the transaction reported no error but the co-resident write is still missing",
    ).toBe("after");
  });
});
