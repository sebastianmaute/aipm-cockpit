// e2e/version-history-documents.spec.ts
// Proves §242: a project holding ONLY documents captures a version. Before this
// slice, `isEmptyWorkspacePayload` counted nine legacy lists and none of the
// document slices, so such a project read as an empty transient and every
// capture was dropped with a `version.skipEmptyTransientCapture` diagnostic.
//
// ★★★ THE GATE IS TWO-PART AND THE SECOND HALF IS AN ASSERTION, NOT A SKIP.
// A suite gated only on a skip condition SKIPS every test and prints as a PASS.
// `playwright.config.ts` sets `reuseExistingServer: !CI`, so this will happily
// attach to a server started before `.env.local` existed — where the config
// never reached the browser and nothing can load. So this file asserts the live
// path is up before testing anything through it, TWICE and on two different
// signals: the app's own tenant DDL appearing in the database, and the seeded
// document rendering in the DOM. A skip is never evidence.
// ★★ AND NEITHER OF THEM IS "THE HISTORY PANEL MOUNTED" — that check is VACUOUS
// here, for reasons measured below under "what liveness had to become".
//
// ★★★ THE ABSENCE ASSERTION CARRIES A NEGATIVE CONTROL, and without it the
// absence proves much less than it reads as. Asserting that
// `version.skipEmptyTransientCapture` did NOT fire is only evidence if the same
// run has shown that code CAN fire — otherwise "the guard behaved" and "the
// guard is unreachable, or the ring is unreadable, or the code was renamed" all
// look identical. So the test ends by DELETING the only document (leaving
// `documents: []` with `documentVersions` non-empty, which
// `isEmptyWorkspacePayload` deliberately does not count) and asserting the code
// then DOES appear. `storage.loaded` proves the ring is live; this proves this
// particular code is observable.
//
// ★★★ CREDENTIALS ARE NEVER PRINTED. No value from `.env.local` may be echoed,
// logged, put in an assertion message or embedded in a failure diff — every
// check here is on a BOOLEAN or on observable app behaviour.
//
// ★ CI is permanently silent on this file (open-followups §215: no live Turso
// database in CI). It exists so the claim can be RE-MEASURED by whoever has a
// database, not looked at once.
//
// ★★ MUTATION-PROVED, 2026-08-26, against a live database — the only evidence
// that a green run here means anything. Deleting `"documents"` from
// `isEmptyWorkspacePayload`'s list (use-version-history.ts), i.e. restoring the
// pre-slice nine, turns this test RED at `pollForCapturedVersion` with its own
// §242 message; restoring the word turns it green again. Re-do that before
// trusting a green run after any refactor of the capture path — a live-database
// test that has quietly stopped exercising the product still passes.
//
// Run against a fresh server on an isolated port, never the reused one:
//   PORT=3100 npm run dev
//   PORT=3100 npx playwright test e2e/version-history-documents.spec.ts --project=chromium --workers=1
//   PORT=3100 npm run stop
//
// ── WHAT "THE HISTORY PANEL IS LIVE" HAD TO BECOME HERE, AND WHY ────────────
//
// ★★★ THE OBVIOUS LIVENESS CHECK IS VACUOUS FOR THIS FEATURE, so do not
// "simplify" back to it. The sibling `documents-images-interactive.spec.ts`
// asserts a mounted asset pane, which works there because that surface mounts
// only when `getTursoConfig` returned non-null IN THE BROWSER. Version history
// has no such surface: the sidebar's History entry is pruned by
// `filterNavGroups(settings.features, settings.storageConfig.kind)` — a
// localStorage value THIS FILE WRITES ITSELF — and `HistoryPanel` carries no
// config guard of its own (`workspace-section.tsx` renders it unconditionally
// on `activeTab === "history"`). Both would therefore pass against a dev server
// started with no `.env.local` at all, i.e. they would assert nothing.
//
// So liveness rides the LOAD PATH instead: the seeded document's title exists
// ONLY as a row in the live database. This file deliberately does NOT use
// `e2e/seed.ts`'s fixture (see the `base` import below), so there is no sample
// workspace in IndexedDB, nothing in localStorage carries a document, and the
// only way that title can reach the DOM is a real tenant load against a real
// database. With no env the browser's `getTursoConfig` returns null, the tenant
// backend has no config, and the row cannot render. `expectLiveDocumentFromTurso`
// is that assertion, and it doubles as a check that the partition key is right.
//
// ── WHY THIS NEEDS PORTFOLIO (MULTI-TENANT) TURSO MODE ──────────────────────
//
// ★★★ THERE IS NO SINGLE-DB PATH TO VERSION HISTORY, and reaching for one wastes
// a day. `useVersionHistory` is `active` only when `enabled && !!config &&
// !!projectId` (use-version-history.ts), and task-manager.tsx passes
// `projectId: portfolioMode === "turso" ? (tursoProjectId ?? "") : ""`. On the
// single-DB Turso BACKEND that is the empty string, so the hook is inert and no
// capture of any kind can happen. Hence the three localStorage writes in
// `installPortfolioTursoMode`.
//
// ★★★ CONSEQUENCE FOR THE TARGET DATABASE, STATED PLAINLY: the app's own tenant
// load runs `tenantSchemaDdl()` (`turso-backend.ts`), which is ~20
// `CREATE TABLE IF NOT EXISTS` statements. Against a database that has never
// held workspace data those tables are CREATED — by the product, on the product's
// load path, exactly as they would be for a user switching to portfolio mode.
// THIS FILE ISSUES NO DDL OF ITS OWN. Everything it writes is a row under
// E2E_PROJECT_ID and is deleted in `afterAll`; nothing here drops, truncates,
// alters, or deletes unscoped. But the tables it causes the app to create cannot
// be removed without a DROP, so they stay behind empty. Point this at a database
// you are willing to leave in that state.

import { readFileSync, existsSync } from "node:fs";
// ★★★ THE BASE FIXTURE, NOT `e2e/seed.ts`'s EXTENDED ONE, AND IT IS LOAD-BEARING
// TWICE. That fixture writes the sample workspace into IndexedDB. (1) It would
// make this test VACUOUS: with 35 seeded tasks in play, `isEmptyWorkspacePayload`
// is false and `diffWorkspaces` non-empty no matter which guard is in the code,
// so the capture would happen with the fix reverted. (2) The default
// `storageConfig` is the browser backend, so the app's FIRST load can read that
// seed before the settings write below flips it to Turso — and the next autosave
// would push the whole sample workspace into the target database. `FROZEN_NOW`
// and `openView` are a constant and a plain function, so they are safe to
// borrow; `gotoApp` deliberately is NOT (see `waitForShell`).
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { FROZEN_NOW, openView } from "./seed";
import { TABLE_NAMES } from "../src/app/turso-schema";

// ── Live-database configuration ─────────────────────────────────────────────

/** Parse `.env.local` in the TEST process. Playwright does not load it — only
 *  Next does — so `process.env` is not a usable source here and the obvious
 *  `test.skip(!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL, …)` is ALWAYS true
 *  and skips everything against a perfectly live database.
 *  ★ Values are returned, never logged. Callers treat them as opaque.
 *  Copied from `documents-images-interactive.spec.ts`; keep the two in step. */
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
const PIPELINE_URL = LIVE
  ? `${ENV.url.replace(/^libsql:\/\//, "https://").replace(/\/$/, "")}/v2/pipeline`
  : "";

/** ★★★ THE PARTITION EVERY WRITE IN THIS FILE IS SCOPED TO. Deliberately NOT
 *  `e2e-1` (the id `e2e/seed.ts` uses for the file-mode registry) so a stray run
 *  of this file can never collide with, or clean up after, another suite. The
 *  app reads and writes under it because `installPortfolioTursoMode` puts it in
 *  `aipm-cockpit:turso-current-project`, which is where
 *  `use-storage-backend.ts` reads `tursoProjectId` from. */
const E2E_PROJECT_ID = "e2e-version-history";

/** Raw pipeline call from the TEST process, for seeding, verification and
 *  cleanup. Reading the table back is the only way to prove a version row
 *  actually landed, rather than that the UI looked happy.
 *  ★ Throws with the HTTP status only — never the URL, never the token. */
async function pipeline(
  stmts: { sql: string; args?: { type: string; value: string }[] }[],
): Promise<PipelineResult[]> {
  const res = await fetch(PIPELINE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ENV.token ? { Authorization: `Bearer ${ENV.token}` } : {}),
    },
    body: JSON.stringify({ requests: stmts.map((stmt) => ({ type: "execute", stmt })) }),
  });
  if (!res.ok) throw new Error(`pipeline HTTP ${res.status}`);
  const json = (await res.json()) as { results?: PipelineResult[] };
  return json.results ?? [];
}

interface PipelineResult {
  type: string;
  error?: { message?: string };
  response?: { result?: { rows?: { value: string }[][] } };
}

const txt = (value: string) => ({ type: "text", value });

const rowsOf = (r: PipelineResult | undefined): { value: string }[][] =>
  r?.response?.result?.rows ?? [];

// ── The seeded project ──────────────────────────────────────────────────────

/** ★★ UNIQUE AND UNGUESSABLE-BY-ACCIDENT ON PURPOSE. This exact string exists
 *  nowhere else in the repo — not in `sample-workspace-small.json`, not in
 *  `e2e/seed.ts` — so `expectLiveDocumentFromTurso` finding it in the DOM cannot
 *  be satisfied by any local fixture. That is what makes it a liveness proof
 *  rather than a rendering check. */
const DOC_TITLE = "S242 documents-only capture probe";
const RENAMED_TITLE = "S242 documents-only capture probe (edited)";

/** ★★★ A NUMBER, AND `ProjectDocument.id` BEING ONE IS NOT OBVIOUS FROM THE
 *  NEIGHBOURHOOD — `DocumentAsset.id` next door is a `crypto.randomUUID()`
 *  string, which is exactly why `turso-schema.ts` had to grow `idKind: "text"`.
 *  `sanitizeDocument` (document-model.ts) opens with
 *  `const id = Math.floor(Number(d.id)); if (!Number.isFinite(id) || id <= 0)
 *  return null;`, so a string id makes the whole document vanish at load with
 *  no error anywhere — measured: the app came up live on Turso with the project
 *  loaded and the pane reading "No documents yet." Deliberately high so it
 *  cannot collide with a hand-created document in the same partition. */
const DOC_ID = 90242;

/** One document, one paragraph, and NOTHING else in the project — the shape the
 *  pre-fix `isEmptyWorkspacePayload` classified as an empty transient. Shape per
 *  `document-model.ts`: a `ProjectDocument` is `{id, title, blocks, createdAt,
 *  updatedAt}` over a `DocBlock` union whose discriminant is `type`. */
const SEED_DOCUMENTS = [
  {
    id: DOC_ID,
    title: DOC_TITLE,
    blocks: [{ type: "paragraph", html: "<p>Charter drafted before any task exists.</p>" }],
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
  },
];

/** Everything this file writes, scoped to E2E_PROJECT_ID. Used for the
 *  before-run pre-clean AND the `afterAll` cleanup, so the two cannot drift.
 *
 *  ★★★ NO `DROP`, NO `TRUNCATE`, NO `ALTER`, NO UNSCOPED `DELETE`. Every
 *  statement carries `WHERE project_id = ?` (or, for the single `projects` row,
 *  `WHERE id = ?`) — the same shape as the product's own
 *  `hardDeleteProjectStatements` (`turso-tenant-schema.ts`), which is where
 *  `TABLE_NAMES` in the loop comes from.
 *  ★ `project_versions` is NOT in `TABLE_NAMES` — deliberately, so a workspace
 *  save's per-table DELETE sweep can never reach version history — so it needs
 *  its own line here or the rows this test creates would be left behind. */
function partitionCleanupStatements() {
  return [
    { sql: "DELETE FROM project_versions WHERE project_id = ?", args: [txt(E2E_PROJECT_ID)] },
    ...TABLE_NAMES.map((t) => ({
      sql: `DELETE FROM ${t} WHERE project_id = ?`,
      args: [txt(E2E_PROJECT_ID)],
    })),
    { sql: "DELETE FROM projects WHERE id = ?", args: [txt(E2E_PROJECT_ID)] },
  ];
}

/** ★ Per-statement errors are TOLERATED here and nowhere else: on the very first
 *  run against a database that has never held workspace data the tenant tables
 *  do not exist yet, and "no such table" is the correct answer to "delete this
 *  partition's rows". Only the count is reported — never a message, which could
 *  in principle carry a host name. */
async function cleanPartition(): Promise<void> {
  // Deliberately does not assert on per-statement errors: every statement
  // failing means the schema is absent, which is the expected state before the
  // app's first load. The test's own "the partition starts at zero rows"
  // assertion is what catches a cleanup that silently did nothing.
  await pipeline(partitionCleanupStatements());
}

/** The `projects` columns a row must carry to survive decoding, and NOT ONE
 *  MORE. ★★★ "A partial row is fine because `rowsToProjectList` is LENIENT" is
 *  FALSE and cost a run: `buildProjectFromObjLenient`'s `lenientRequiredArrays`
 *  relaxes the ARRAY fields only. `sanitizeProjectMeta` still returns null
 *  unless name · code · projectManager · customer · products · profitCenter are
 *  non-empty, `naceSection` is in `NACE_SECTION_SET`, `deployment` is in
 *  `DEPLOYMENT_SET`, and `startDate` parses as ISO. A row missing any of them
 *  decodes to null, `tursoProjects` comes back EMPTY, and task-manager renders
 *  the "No projects yet" dialog INSTEAD of the app — no `<main>`, no shell, and
 *  a failure that points at the wait rather than at the row. Measured: a
 *  four-column row did exactly that.
 *  ★ Still a deliberate subset of `PROJECT_CSV_COLUMNS` — restating that whole
 *  list here would rot the moment a column is added, and the optional ones are
 *  genuinely optional. */
const PROJECT_ROW: Record<string, string> = {
  name: "S242 probe",
  code: "S242",
  projectManager: "E2E Runner",
  customer: "E2E Customer",
  products: "E2E Product",
  profitCenter: "E2E",
  naceSection: "J",          // NACE_SECTIONS: "Information and communication"
  deployment: "Cloud",       // Deployment = "Cloud" | "On-premise" | "Hybrid"
  startDate: "2026-06-01",
};

/** Writes the project row + the documents meta blob under E2E_PROJECT_ID.
 *  ★★★ This file issues no DDL: both tables must already exist, which they do
 *  because the app's own tenant load created them (see the header). A "no such
 *  table" here is therefore a REAL failure and is asserted on. */
async function seedDocumentsOnlyProject(): Promise<void> {
  const cols = ["id", "archived", ...Object.keys(PROJECT_ROW)];
  const results = await pipeline([
    {
      sql:
        `INSERT OR REPLACE INTO projects (${cols.map((c) => `"${c}"`).join(", ")}) ` +
        `VALUES (${cols.map(() => "?").join(", ")})`,
      args: [txt(E2E_PROJECT_ID), txt("0"), ...Object.values(PROJECT_ROW).map(txt)],
    },
    {
      sql: "INSERT INTO meta (key, value, project_id) VALUES (?, ?, ?)",
      args: [txt("documents"), txt(JSON.stringify(SEED_DOCUMENTS)), txt(E2E_PROJECT_ID)],
    },
  ]);
  const failed = results.filter((r) => r.error).length;
  expect(
    failed,
    "seeding the documents-only project failed. The most likely cause is that the app's own " +
      "tenant load has not run yet, so `projects` / `meta` do not exist — this file issues no " +
      "DDL by design (see the header).",
  ).toBe(0);
}

/** Whether the two tables this file seeds into exist yet.
 *  ★★ THE FIRST LIVENESS SIGNAL, and it is the app's own work: this file issues
 *  no DDL, so `projects` and `meta` can only appear because `turso-backend.ts`'s
 *  `loadTenant` prepended `tenantSchemaDdl()` to a load that actually reached
 *  the database — which requires the env pair to have been inlined into the
 *  server AND `getTursoConfig` to have returned non-null in the browser.
 *  ★ Read-only: `sqlite_master` is queried, never written. */
async function tenantSchemaExists(): Promise<boolean> {
  const results = await pipeline([
    {
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('projects', 'meta')",
    },
  ]);
  return rowsOf(results[0]).length === 2;
}

async function readVersionRows(): Promise<{ id: string; summary: string; payload: string }[]> {
  const results = await pipeline([
    {
      sql: "SELECT id, summary, payload FROM project_versions WHERE project_id = ? ORDER BY captured_at ASC",
      args: [txt(E2E_PROJECT_ID)],
    },
  ]);
  return rowsOf(results[0]).map((r) => ({
    id: r[0]?.value ?? "",
    summary: r[1]?.value ?? "",
    payload: r[2]?.value ?? "",
  }));
}

/** The title currently stored in the project's documents blob — the DB-side
 *  signal that the app's debounced save actually completed. Polling the UI
 *  cannot tell "saved" from "rendered". */
async function storedDocumentTitle(): Promise<string | null> {
  const results = await pipeline([
    {
      sql: "SELECT value FROM meta WHERE key = ? AND project_id = ?",
      args: [txt("documents"), txt(E2E_PROJECT_ID)],
    },
  ]);
  const raw = rowsOf(results[0])[0]?.[0]?.value;
  if (!raw) return null;
  try {
    const docs = JSON.parse(raw) as { title?: string }[];
    return docs[0]?.title ?? null;
  } catch {
    return null;
  }
}

// ── Page helpers ────────────────────────────────────────────────────────────

/** ★★★ THE THREE localStorage WRITES THAT MAKE VERSION HISTORY REACHABLE AT ALL,
 *  and every one is required — see the header's portfolio-mode note.
 *   - `aipm-cockpit:settings`: `storageConfig.kind === "turso"` is the first
 *     conjunct of the hook's `enabled`. Settings are a SHALLOW merge over
 *     `defaultSettings` (`use-settings.ts`), so `features` keeps its default
 *     `[...ALL_MODULE_IDS]` and `isModuleEnabled("history", …)` — the third
 *     conjunct — is satisfied without naming it. `tourSeen` keeps the guided
 *     tour's `fixed inset-0` overlay from swallowing every click.
 *   - `aipm-cockpit:portfolio-mode`: without `"turso"` here, task-manager passes
 *     `projectId: ""` and the hook is inert however live the database is.
 *   - `aipm-cockpit:turso-current-project`: read by `loadCurrentTursoProjectId()`
 *     into `use-storage-backend.ts`'s `tursoProjectId` state, which is both the
 *     tenant backend's partition and the version table's `project_id`.
 *  ★★ NO CREDENTIAL IS WRITTEN HERE. The url/token come from the environment
 *  (Next inlines them at SERVER START), which is exactly what makes the liveness
 *  assertion meaningful — writing them into settings would let the test pass
 *  against a server that never saw `.env.local`. */
async function installPortfolioTursoMode(page: Page, projectId: string): Promise<void> {
  await page.addInitScript(
    ({ projectId }) => {
      localStorage.setItem(
        "aipm-cockpit:settings",
        JSON.stringify({ tourSeen: true, storageConfig: { kind: "turso" } }),
      );
      localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
      localStorage.setItem("aipm-cockpit:turso-current-project", projectId);
    },
    { projectId },
  );
}

const NAV_SELECTOR = 'aside a, aside button, nav a, nav button, [role="tab"]';

/** Wait for the shell. This file deliberately does NOT use `seed.ts`'s `gotoApp`
 *  — it navigates TWICE (once to let the app create the tenant schema, once
 *  after seeding), and `gotoApp` calls `page.clock.install`, which cannot run
 *  twice. The clock is installed once, by hand, in the test. Same wait
 *  otherwise; keep it in step with `gotoApp`. */
async function waitForShell(page: Page): Promise<void> {
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

/**
 * ★★★ THE LOAD-BEARING GATE. An ASSERTION, never a skip — see the file header,
 * which also records why the two obvious alternatives (a nav entry, a mounted
 * HistoryPanel) are both vacuous for this feature.
 *
 * The only place `DOC_TITLE` exists is the row this file wrote into the live
 * database. This spec uses the BASE playwright fixture, so no sample workspace
 * is in IndexedDB and nothing in localStorage carries a document. Rendering that
 * title therefore proves all three of: the env pair reached the SERVER, Next
 * inlined it so `getTursoConfig` returned non-null in the BROWSER, and the
 * partition key the app read under is the one this file wrote under.
 */
async function expectLiveDocumentFromTurso(page: Page): Promise<void> {
  await expect(
    // ★★★ `exact: true` IS LOAD-BEARING ON EVERY LOCATOR IN THIS FILE, and the
    // opposite is written down elsewhere in this repo. Playwright's `name`
    // option is a case-insensitive SUBSTRING match by default — it is `exact`
    // that makes it a full-string one. Measured, not read: without it this line
    // resolved to SIX elements, because `documents-list.tsx` names every per-row
    // control `"<verb> – <title>"` and each one CONTAINS the title. The failure
    // is a strict-mode violation, so it is loud here; on the "Rename"/"Delete"
    // commit buttons below the same mistake is SILENT and much worse — a bare
    // `"Rename"` also matches the row's `"Rename – …"` trigger sitting behind
    // the open modal, so the click lands on whichever Playwright picks.
    page.getByRole("button", { name: DOC_TITLE, exact: true }),
    "the seeded document never rendered, so the workspace did not load from the live database. " +
      "Almost certainly the dev server predates .env.local and playwright reused it " +
      "(reuseExistingServer) — Next reads env at server start. Restart on an isolated port and " +
      "re-run. Other causes: the URL is not https/loopback, or Safe Mode is on.",
  ).toBeVisible({ timeout: 30_000 });
}

/** The diagnostic ring, as CODES only.
 *  ★★ Codes, never whole events: a failing `toContain` prints the received
 *  array, and while `diagnostics.ts` redacts fields by contract, an assertion
 *  diff is the last place to rely on that. Codes are fixed literals. */
async function diagCodes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("aipm-cockpit:diag-log");
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((e) => String((e as { code?: unknown }).code ?? ""))
        : [];
    } catch {
      return [];
    }
  });
}

/** `VERSION_IDLE_MS` in task-manager.tsx, which does not export it.
 *  Re-read it with: grep -n "VERSION_IDLE_MS" src/app/task-manager.tsx */
const VERSION_IDLE_MS = 180_000;

/** The debounced workspace autosave in `use-storage-backend.ts` is 500ms.
 *  Re-read it with: grep -n "debounced 500ms" src/app/use-storage-backend.ts */
const SAVE_DEBOUNCE_MS = 500;

/** ★★★ THE CLOCK IS FAKE AND THAT IS WHY THIS TEST IS FAST RATHER THAN FOUR
 *  MINUTES LONG. The test calls `page.clock.install`, so in-page `setTimeout`
 *  does not advance in real time at all — the 3-minute idle capture would NEVER
 *  fire on its own, and a test that merely waited would report "no version was
 *  captured" against perfectly working code.
 *  ★★ TWO SEPARATE ADVANCES, NOT ONE, AND COLLAPSING THEM BREAKS IT. The idle
 *  timer is armed by `notifySaved`, which task-manager calls from
 *  `reportStorageOutcome(null)` — i.e. only after the save's REAL network round
 *  trip resolves, which happens in real time, after a `runFor` has already
 *  returned. Advance once to fire the debounce, wait (in real time) for the save
 *  to land in the database, and only then advance past the idle window. */
/** Advance past the save debounce until the edit is readable in the database.
 *  ★ Advancing INSIDE the poll for the same reason `pollForCapturedVersion`
 *  does: a single advance issued before React's save effect had armed its timer
 *  fires nothing, and the test would then blame the product. */
async function pollForSavedTitle(page: Page, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(SAVE_DEBOUNCE_MS * 4);
        return storedDocumentTitle();
      },
      {
        message:
          "the renamed document never reached the database, so no save completed and the idle " +
          "capture was never armed",
        timeout: 60_000,
      },
    )
    .toBe(expected);
}

/** ★★★ ADVANCE INSIDE THE POLL, NOT ONCE BEFORE IT — a single advance races and
 *  the race loses SILENTLY. `notifySaved` arms the idle timer only when the
 *  app's own save promise resolves, and the DB row this test polls on can be
 *  readable a few milliseconds before that. Advance once at exactly the wrong
 *  moment and the timer is armed AFTER the jump, i.e. at fake-time T+210s,
 *  expiring at T+390s — which never arrives, so a working build reports "no
 *  version was captured". Re-advancing on every poll iteration cannot lose that
 *  race: whenever the timer was armed, the next iteration jumps past it.
 *  ★ Extra advances are harmless — a second capture would only add a row, and
 *  the assertions read the FIRST. */
async function pollForCapturedVersion(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(VERSION_IDLE_MS + 30_000);
        return (await readVersionRows()).length;
      },
      {
        message:
          "no version was captured for a documents-only project — this is §242 itself. Check that " +
          "`isEmptyWorkspacePayload` (use-version-history.ts) still counts `documents`, and read " +
          "the diagnostic ring for version.skipEmptyTransientCapture.",
        timeout: 60_000,
      },
    )
    .toBeGreaterThan(0);
}

/** Rename the only document through the real modal. `documents-list.tsx` names
 *  each per-row control `rowLabel(verb, token)` = "<verb> – <title>" with an EN
 *  DASH (U+2013), and with one document the token is the bare title. */
async function renameDocument(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole("button", { name: `Rename – ${from}`, exact: true }).click();
  // The visible <label> IS the accessible name (documents-rename-modal.tsx).
  await page.getByLabel("Title", { exact: true }).fill(to);
  // ★★ `exact: true` is what keeps this off the row's "Rename – …" trigger —
  // see the measurement on `expectLiveDocumentFromTurso`.
  await page.getByRole("button", { name: "Rename", exact: true }).click();
}

/** Delete the only document through the real confirm dialog
 *  (`documents-panel.tsx` `handleDelete` → `useConfirm`, never `window.confirm`).
 *  ★★ Both buttons are named from `documentsDelete`, so `exact: true` is the
 *  only thing separating the dialog's bare "Delete" from the row's
 *  "Delete – <title>" trigger — see the measurement on
 *  `expectLiveDocumentFromTurso`. */
async function deleteDocument(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Delete – ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
}

/** The documents blob is ABSENT or empty for this partition — the state the
 *  negative control needs. `tenantWorkspaceToStatements` only writes the `meta`
 *  row `if (ws.documents && ws.documents.length)`, so a delete leaves no row at
 *  all rather than a row holding `[]`; both count. */
async function storedDocumentCount(): Promise<number> {
  const results = await pipeline([
    {
      sql: "SELECT value FROM meta WHERE key = ? AND project_id = ?",
      args: [txt("documents"), txt(E2E_PROJECT_ID)],
    },
  ]);
  const raw = rowsOf(results[0])[0]?.[0]?.value;
  if (!raw) return 0;
  try {
    const docs = JSON.parse(raw) as unknown[];
    return Array.isArray(docs) ? docs.length : 0;
  } catch {
    return 0;
  }
}

/** Advance past the debounce until the delete has landed in the database. */
async function pollForEmptyDocuments(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(SAVE_DEBOUNCE_MS * 4);
        return storedDocumentCount();
      },
      {
        message: "the delete never reached the database, so the negative control never got its " +
          "documents-empty payload",
        timeout: 60_000,
      },
    )
    .toBe(0);
}

// ── The pre-fix predicate, restated ─────────────────────────────────────────

/** ★★★ THE NINE LISTS `isEmptyWorkspacePayload` COUNTED BEFORE THIS SLICE.
 *  Restated here ON PURPOSE rather than imported: this is a claim about the code
 *  as it WAS, and importing today's list would make the assertion below
 *  tautological the moment anyone edits it — the classic derived-assertion trap.
 *  Task 8 added `knowledgeItems`, `documents`, `calendarEvents` to the live one. */
const PRE_FIX_LISTS = [
  "tasks", "raid", "milestones", "stakeholders", "resources",
  "changes", "budgets", "absences", "shifts",
] as const;

/** The pre-fix predicate, verbatim in behaviour: every one of the nine lists
 *  absent or empty. `workspaceToJson` omits empty slices entirely, so "absent"
 *  has to count as empty exactly as `!Array.isArray(w[k])` did. */
function preFixWouldHaveSkipped(payload: string): boolean {
  const w = JSON.parse(payload) as Record<string, unknown>;
  return PRE_FIX_LISTS.every((k) => !Array.isArray(w[k]) || (w[k] as unknown[]).length === 0);
}

// ── Suite ───────────────────────────────────────────────────────────────────

test.describe("version history — a documents-only project, live Turso", () => {
  // The ONLY skip: no credentials anywhere. Everything past this point asserts.
  test.skip(!LIVE, "needs a live Turso database (.env.local NEXT_PUBLIC_TURSO_*)");

  test.beforeAll(async () => {
    // ★ Guarded independently of the describe-level skip: a `beforeAll` still
    // runs in some skip configurations, and unguarded it would POST to an empty
    // URL on a machine with no database — a confusing failure in the one
    // situation this file is supposed to stay quiet in.
    if (!LIVE) return;
    // ★★ A PRE-CLEAN, NOT JUST A TIDY-UP. A version row left by an aborted
    // earlier run would satisfy "a version exists" without the app doing
    // anything, so the test would pass with the fix reverted. The test asserts
    // the partition starts at zero rows for the same reason.
    await cleanPartition();
  });

  test.afterAll(async () => {
    if (!LIVE) return;
    await cleanPartition().catch(() => {});
  });

  test("captures a version for a project whose only content is one document", async ({ page }) => {
    // Two navigations, a real save round trip and DB polling — but the 3-minute
    // idle window is fake-clock time, so this is not a 4-minute test.
    test.setTimeout(180_000);

    await installPortfolioTursoMode(page, E2E_PROJECT_ID);
    // Frozen "now", exactly as `gotoApp` installs it — and the fake clock both
    // `runFor` helpers below depend on. Installed by hand because this file
    // navigates twice; `clock.install` cannot run twice.
    await page.clock.install({ time: FROZEN_NOW });

    // ── Boot 1: the app's own tenant load creates the multi-tenant schema.
    // This file issues no DDL; `turso-backend.ts`'s `loadTenant` prepends
    // `tenantSchemaDdl()` (CREATE TABLE IF NOT EXISTS) to every load, so the
    // tables exist after this even on a database that never held workspace data.
    // ★ NOT waiting for the shell here: with an empty project the app can render
    // its project empty state instead, and this boot exists only to run the DDL.
    await page.goto("/");
    await expect
      .poll(() => tenantSchemaExists(), {
        message:
          "the app never ran its own tenant schema DDL against the database, so its load did not " +
          "reach Turso at all. Almost certainly the dev server predates .env.local and playwright " +
          "reused it (reuseExistingServer) — Next reads env at server start.",
        timeout: 90_000,
      })
      .toBe(true);

    // ── Seed the documents-only project, then load it for real.
    await seedDocumentsOnlyProject();

    expect(
      await readVersionRows(),
      "the partition already held versions before the test acted — the pre-clean did not run or " +
        "did not reach this table, and 'a version exists' would prove nothing",
    ).toHaveLength(0);

    await page.goto("/");
    await waitForShell(page);
    await openView(page, "Documents");

    // ── The liveness half of the gate. A skip is never evidence.
    await expectLiveDocumentFromTurso(page);

    // ── Edit the document. This is the ONLY content the project has, so the
    // save it triggers carries a payload the pre-fix predicate called empty.
    await renameDocument(page, DOC_TITLE, RENAMED_TITLE);

    await pollForSavedTitle(page, RENAMED_TITLE);

    // ── Past the idle window: `writeVersion("auto", null)` runs here.
    await pollForCapturedVersion(page);
    const versions = await readVersionRows();

    // ── The payload is the proof, not the row count. Assert the captured
    // workspace is exactly the shape the pre-fix guard dropped: every one of the
    // nine legacy lists empty, and documents non-empty. Without this the test
    // would pass against a project that had quietly acquired a task.
    const captured = versions[0];
    expect(captured.payload.length, "the version row stored an empty payload").toBeGreaterThan(0);

    const w = JSON.parse(captured.payload) as Record<string, unknown>;
    expect(
      Array.isArray(w.documents) ? (w.documents as unknown[]).length : 0,
      "the captured payload carried no documents, so this run did not exercise §242",
    ).toBeGreaterThan(0);
    expect(
      preFixWouldHaveSkipped(captured.payload),
      "the captured payload carries one of the nine pre-fix content lists, so the pre-fix " +
        "`isEmptyWorkspacePayload` would NOT have skipped it and this run proves nothing about §242",
    ).toBe(true);

    // ── The diagnostic that used to fire, and the proof we could have seen it.
    const codes = await diagCodes(page);
    // ★★★ THE POSITIVE CONTROL FOR THE CHANNEL, and it comes FIRST for a reason.
    // "no skipEmptyTransientCapture" and "cannot read diagnostics at all" look
    // identical from an assertion that only checks absence. `storage.loaded` is
    // written by `use-storage-backend.ts` on every successful load, so its
    // presence proves the ring is live, app-authored and readable from here.
    expect(
      codes,
      "the diagnostic ring holds no app-authored entry, so the absence check below would be " +
        "unfalsifiable — it would pass just as well against a ring we cannot read",
    ).toContain("storage.loaded");
    expect(
      codes,
      "the capture path logged version.skipEmptyTransientCapture, which is §242's exact signature",
    ).not.toContain("version.skipEmptyTransientCapture");

    // ── ★★★ THE NEGATIVE CONTROL, and it is what makes the absence assertion
    // above worth anything. `storage.loaded` proves the RING is live; it does
    // not prove that THIS code is observable in THIS run, and an absence check
    // against a code nothing has ever shown could pass for a dozen reasons that
    // have nothing to do with §242.
    //
    // Deleting the only document leaves `documents: []` while `documentVersions`
    // stays non-empty — the delete's before-image is the only surviving copy of
    // the document, which is what makes Restore possible. `isEmptyWorkspacePayload`
    // deliberately does NOT count `documentVersions` (it is derived from
    // `documents`, so it inherits the project-switch-transient objection), so the
    // next payload is genuinely empty by that predicate and the auto capture is
    // skipped WITH the diagnostic. That is the pre-fix behaviour, reproduced on
    // purpose against post-fix code — the guard is still there, it is simply
    // right this time.
    await deleteDocument(page, RENAMED_TITLE);
    await pollForEmptyDocuments(page);

    await expect
      .poll(
        async () => {
          await page.clock.runFor(VERSION_IDLE_MS + 30_000);
          return diagCodes(page);
        },
        {
          message:
            "the negative control never fired: a payload with documents:[] did not log " +
            "version.skipEmptyTransientCapture, so nothing in this run demonstrates that code is " +
            "observable at all — which means the absence assertion above proved less than it looks.",
          timeout: 60_000,
        },
      )
      .toContain("version.skipEmptyTransientCapture");
  });
});
