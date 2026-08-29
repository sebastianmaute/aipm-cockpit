// e2e/meta-decode-loss.spec.ts
//
// Proves §284 END TO END against a REAL Turso database — the one thing no green
// suite in this repo could establish, and which the register records as OWED
// precisely because CI has no live database (§215).
//
// THE CHAIN THIS FILE EXERCISES, in the order a user meets it:
//   1. A `documents` meta blob is malformed in the database.
//   2. The app loads. `rowsToWorkspace` cannot decode that slice, leaves it
//      undefined, and — before this slice — said nothing.
//   3. The next save runs `DELETE FROM meta` for the dirty table and re-inserts
//      only the rows it has. An absent `documents` writes no row, so the blob is
//      destroyed and nothing replaces it.
// Step 3 is what this file has to catch, and it is why the load-bearing
// assertion is on the DATABASE ROW after an edit, never on the UI.
//
// ★★★ THE GATE IS TWO-PART AND THE SECOND HALF IS AN ASSERTION, NOT A SKIP.
// `playwright.config.ts` sets `reuseExistingServer: !CI`, so this will happily
// attach to a server started before `.env.local` existed — where the config
// never reached the browser, nothing loads from Turso, and a suite gated only on
// a skip prints as a PASS having tested nothing. So liveness is asserted: the
// seeded document must RENDER, which can only happen if the env pair reached the
// SERVER, Next inlined it so `getTursoConfig` returned non-null in the BROWSER,
// and the partition the app read is the one this file wrote. A skip is never
// evidence.
//
// ★★★ THE NEGATIVE CONTROL IS THE WHOLE TEST. "The row is unchanged after an
// edit" is worthless on its own — it reads identically to "no save ever happens
// in this setup", which would be true of a broken harness, a workspace that
// never went dirty, or a debounce that never fired. So the same run ends by
// clicking "Save anyway" and asserting the row DOES change. Withheld-then-
// committed is the evidence; withheld alone is not.
//
// ★★★ CREDENTIALS ARE NEVER PRINTED. No value from `.env.local` is echoed,
// logged, put in an assertion message or embedded in a failure diff — every
// check is on a BOOLEAN or on observable app behaviour.
//
// ★★ PARTITION-SCOPED, NOTHING DROPPED. Every write is under E2E_PROJECT_ID and
// removed in `afterAll`. This file never runs DROP or TRUNCATE and never touches
// a row outside its partition — unlike `documents-images-interactive.spec.ts`,
// whose §211 probe drops a shared table. It is still a destructive test BY
// DESIGN (it corrupts a blob and then proves the app can be made to overwrite
// it), so point it at a scratch database, never one you care about.
//
// ★ CI is permanently silent on this file (§215). It exists so §284 can be
// RE-MEASURED by whoever has a database, not asserted once and believed forever.
//
// Run against a FRESH server on an isolated port, never the reused one — the
// env pair is inlined at server start:
//   PORT=3100 npm run dev
//   PORT=3100 npx playwright test e2e/meta-decode-loss.spec.ts --project=chromium --workers=1
//   PORT=3100 npm run stop

import { readFileSync, existsSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

// ── Live-database configuration ─────────────────────────────────────────────

/** Parse `.env.local` in the TEST process: playwright does not load it, only
 *  Next does, so `process.env` is not a usable source here. A `test.skip` on
 *  `process.env.NEXT_PUBLIC_TURSO_DATABASE_URL` written the obvious way is
 *  ALWAYS true here and would skip everything against a perfectly live database.
 *  ★ Values are returned, never logged. Callers treat them as opaque. */
function readEnvLocal(): { url: string; token: string } {
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
    // corruptions that yield an unparseable URL rather than an error.
    return (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  };
  return {
    url: read("NEXT_PUBLIC_TURSO_DATABASE_URL"),
    token: read("NEXT_PUBLIC_TURSO_AUTH_TOKEN"),
  };
}

const ENV = readEnvLocal();
const LIVE = ENV.url !== "";
const PIPELINE_URL = LIVE
  ? `${ENV.url.replace(/^libsql:\/\//, "https://").replace(/\/$/, "")}/v2/pipeline`
  : "";

/** This file's own partition. Nothing outside it is read or written. */
const E2E_PROJECT_ID = "e2e-decode-loss";

const DOC_TITLE = "Decode loss charter";
/** ★★★ A NUMBER, NOT A STRING. `sanitizeDocument` does
 *  `Math.floor(Number(d.id))` and rejects anything not finite and > 0, so a
 *  string id sanitizes the whole document away: `docs.length` is 0, `ws.documents`
 *  is never set, and the panel renders "No documents yet" — which reads as a
 *  partition or config problem, not as a bad seed. Measured on this file's
 *  third run. */
const DOC_ID = 284001;

/** Raw pipeline call from the TEST process — the only way to prove a byte
 *  reached the table rather than that the UI looked happy.
 *  ★ Throws with the HTTP status only: never the URL, never the token. */
async function pipeline(
  stmts: { sql: string; args?: { type: string; value: string }[] }[],
): Promise<
  { error?: { message?: string }; response?: { result?: { rows?: { value: string | null }[][] } } }[]
> {
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
    results?: {
      error?: { message?: string };
      response?: { result?: { rows?: { value: string | null }[][] } };
    }[];
  };
  return json.results ?? [];
}

/** ★★★ A LIBSQL PIPELINE DOES NOT FAIL THE REQUEST WHEN A STATEMENT FAILS — it
 *  returns an error for that ONE statement and keeps going, and the HTTP status
 *  is still 200. A seed helper that ignores per-statement errors therefore
 *  reports success while writing nothing, and the failure only surfaces much
 *  later as an unrelated-looking UI assertion. That happened on this file's
 *  first run: a `tasks` INSERT naming a column that does not exist errored
 *  silently and the test failed at `waitForShell`. Never skip this check.
 *  ★ Messages are from the DATABASE ENGINE about our own SQL — no credential is
 *  in them — but only the message is surfaced, never the URL or token. */
function assertNoStatementErrors(
  results: { error?: { message?: string } }[],
  what: string,
): void {
  const errs = results.map((r, i) => (r.error ? `#${i}: ${r.error.message ?? "?"}` : "")).filter(Boolean);
  if (errs.length) throw new Error(`${what}: ${errs.length} statement(s) failed — ${errs.join(" | ")}`);
}

const txt = (value: string) => ({ type: "text", value });

/** The `documents` meta blob's current value for this partition, or null when
 *  the row is absent. ★ null and "" are DIFFERENT outcomes here and the test
 *  distinguishes them: an absent row is the destruction §284 is about. */
async function readDocumentsBlob(): Promise<string | null> {
  const [r] = await pipeline([
    {
      sql: "SELECT value FROM meta WHERE key = ? AND project_id = ?",
      args: [txt("documents"), txt(E2E_PROJECT_ID)],
    },
  ]);
  const rows = r?.response?.result?.rows ?? [];
  return rows.length === 0 ? null : (rows[0]?.[0]?.value ?? null);
}

/** ★ The block discriminator is `type`, NOT `kind`. A wrong key sanitizes to an
 *  empty document set, the panel renders "No documents yet", and the liveness
 *  assertion fails pointing at the title rather than at the shape — measured on
 *  this file's second run. */
/** Poll until two consecutive reads of the documents blob agree, i.e. no save is
 *  still in flight against it. ★ Returns the settled value; throws rather than
 *  returning a moving one, because every downstream assertion in this file is
 *  about that row and a racing write makes all of them unreadable. */
async function waitForBlobStable(timeoutMs = 30_000): Promise<string | null> {
  const started = Date.now();
  let prev = await readDocumentsBlob();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1_500));
    const next = await readDocumentsBlob();
    if (next === prev) return next;
    prev = next;
  }
  throw new Error("documents blob never stopped changing — a save is still in flight");
}

const SEED_DOCUMENTS = [
  {
    id: DOC_ID,
    title: DOC_TITLE,
    blocks: [{ type: "paragraph", html: "<p>Seeded for the decode-loss proof.</p>" }],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  },
];

/** Everything this file writes, scoped to E2E_PROJECT_ID. Every statement
 *  carries `WHERE project_id = ?`; nothing is dropped or truncated. */
async function cleanup(): Promise<void> {
  await pipeline([
    { sql: "DELETE FROM meta WHERE project_id = ?", args: [txt(E2E_PROJECT_ID)] },
    { sql: "DELETE FROM tasks WHERE project_id = ?", args: [txt(E2E_PROJECT_ID)] },
    { sql: "DELETE FROM projects WHERE id = ?", args: [txt(E2E_PROJECT_ID)] },
  ]);
}

/** ★★★ NINE FIELDS, NOT THREE, AND THE SHORTFALL IS INVISIBLE UNTIL THE SHELL
 *  NEVER RENDERS. `sanitizeProjects` drops a row whose required fields are
 *  missing, `tursoProjects` then comes back EMPTY, and task-manager renders the
 *  "No projects yet" dialog INSTEAD of the app — no `<main>`, so the failure
 *  points at the shell wait rather than at the row. Measured on this file's
 *  first run with a three-column row, and `version-history-documents.spec.ts`
 *  records the same measurement for a four-column one.
 *  ★ Deliberately a subset of PROJECT_CSV_COLUMNS — restating that whole list
 *  would rot the moment a column is added, and the rest are genuinely optional. */
const PROJECT_ROW: Record<string, string> = {
  name: "Decode loss probe",
  code: "S284",
  projectManager: "E2E Runner",
  customer: "E2E Customer",
  products: "E2E Product",
  profitCenter: "E2E",
  naceSection: "J",
  deployment: "Cloud",
  startDate: "2026-06-01",
};

const ANCHOR_TASK = "Anchor task for the decode-loss probe";

/** Seed a project holding one document AND one task.
 *  ★★★ THE TASK IS LOAD-BEARING, not decoration. `isWorkspaceEmpty` refuses a
 *  TOTALLY empty read, and §284's whole premise is that the load PROCEEDS
 *  because the ENTITY tables came back populated while the meta blob did not.
 *  Seed documents alone and the post-corruption workspace is empty, the load is
 *  REFUSED, and this file would silently be testing the refusal path instead of
 *  the save path it exists to test — passing, for the wrong reason.
 *  ★ The task column is `taskName`, NOT `title`. A wrong column name errors the
 *  statement without failing the request; see assertNoStatementErrors. */
async function seedProject(): Promise<void> {
  await cleanup();
  const cols = ["id", "archived", ...Object.keys(PROJECT_ROW)];
  const results = await pipeline([
    {
      sql:
        `INSERT OR REPLACE INTO projects (${cols.map((c) => `"${c}"`).join(", ")}) ` +
        `VALUES (${cols.map(() => "?").join(", ")})`,
      args: [txt(E2E_PROJECT_ID), txt("0"), ...Object.values(PROJECT_ROW).map(txt)],
    },
    {
      sql: 'INSERT INTO tasks (id, project_id, "taskName", status) VALUES (?, ?, ?, ?)',
      args: [txt("1"), txt(E2E_PROJECT_ID), txt(ANCHOR_TASK), txt("To Do")],
    },
    {
      sql: "INSERT INTO meta (key, value, project_id) VALUES (?, ?, ?)",
      args: [txt("documents"), txt(JSON.stringify(SEED_DOCUMENTS)), txt(E2E_PROJECT_ID)],
    },
  ]);
  assertNoStatementErrors(results, "seedProject");
}

/** Replace the documents blob with bytes that cannot be JSON-parsed. This is
 *  the entry point §284 describes: our own encoder never writes this, so it
 *  takes truncation, corruption or a foreign write — but the CONSEQUENCE, once
 *  malformed, was not narrow at all. */
async function corruptDocumentsBlob(): Promise<void> {
  await pipeline([
    {
      // ★ INSERT OR REPLACE, not UPDATE. An UPDATE silently matches zero rows if
      // the app deleted the row a moment earlier (its save is DELETE-then-
      // re-insert), and the verification then fails with no clue why. This lands
      // either way, so a failure downstream means something real.
      sql: "INSERT OR REPLACE INTO meta (key, value, project_id) VALUES (?, ?, ?)",
      args: [txt("documents"), txt("{not json"), txt(E2E_PROJECT_ID)],
    },
  ]);
}

/** The localStorage writes that put the app in TENANT Turso mode on its first
 *  load. ★★ NO CREDENTIAL IS WRITTEN HERE — the url/token come from the
 *  environment, which is exactly what makes the liveness assertion meaningful:
 *  writing them into settings would let this pass against a server that never
 *  saw `.env.local`. `tourSeen` keeps the guided tour's `fixed inset-0` overlay
 *  from swallowing every click. */
async function installTursoMode(page: Page): Promise<void> {
  await page.addInitScript(
    ({ projectId }) => {
      localStorage.setItem(
        "aipm-cockpit:settings",
        JSON.stringify({ tourSeen: true, storageConfig: { kind: "turso" } }),
      );
      localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
      localStorage.setItem("aipm-cockpit:turso-current-project", projectId);
    },
    { projectId: E2E_PROJECT_ID },
  );
}

const NAV_SELECTOR = 'aside a, aside button, nav a, nav button, [role="tab"]';

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

async function openDocuments(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Documents", exact: true }).first().click();
}

test.describe("§284 — a malformed meta blob is caught before the next save destroys it", () => {
  test.skip(!LIVE, "no .env.local Turso credentials — see the header; a skip is never evidence of a pass");

  test.afterAll(async () => {
    if (LIVE) await cleanup();
  });

  test("withholds the save that would destroy the blob, and commits it only on Save anyway", async ({ page }) => {
    // ── 1. Seed a healthy project and prove the live path is up ─────────────
    await seedProject();
    await installTursoMode(page);
    await page.goto("/");
    await waitForShell(page);
    await openDocuments(page);

    // ★★★ LIVENESS, AS AN ASSERTION. DOC_TITLE exists in exactly one place: the
    // row this file wrote into the live database. This spec uses the BASE
    // playwright fixture, so no sample workspace is in IndexedDB and nothing in
    // localStorage carries a document. Rendering it proves the env pair reached
    // the server, Next inlined it, and the partition matches.
    // ★ `exact: true` is load-bearing — playwright's `name` is a case-
    // insensitive SUBSTRING by default, and `documents-list.tsx` names every
    // per-row control "<verb> – <title>", each of which CONTAINS the title.
    await expect(page.getByText(DOC_TITLE, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // ★★★ THE PREMISE, ASSERTED RATHER THAN ASSUMED. §284 only happens because
    // the load PROCEEDS — `isWorkspaceEmpty` refuses a totally empty read, so
    // the entity tables must genuinely have come back populated. If the anchor
    // task silently failed to seed or decode, the post-corruption workspace is
    // empty, the load is REFUSED, and this file would be exercising the refusal
    // path while reading as a pass. Prove the task is live before corrupting.
    await page.getByRole("button", { name: "Open Points", exact: true }).first().click();
    await expect(
      page.getByText(ANCHOR_TASK, { exact: true }).first(),
      "the anchor task must load, or this test silently changes which path it exercises",
    ).toBeVisible({ timeout: 30_000 });

    // ── 2. Corrupt the blob behind the app's back ───────────────────────────
    // ★★★ UNMOUNT THE APP FIRST. A LIVE APP WILL UNDO THIS, and both failure
    // shapes were measured on this file before the wait moved here:
    //   - corrupt too EARLY (inside the save's DELETE→re-insert window) and the
    //     write lands on nothing; the verification reads null and looks like a
    //     failed corruption.
    //   - corrupt while the app is merely IDLE and the next dirty-marking save
    //     rewrites `meta` from the in-memory workspace, restoring the CLEAN
    //     blob straight over the top; the verification reads the original JSON.
    // Neither is a product defect — a running app holding a good workspace is
    // SUPPOSED to write it back. It also is not the scenario §284 describes: the
    // blob is corrupted out of band (truncation, a partial write, another
    // client) while this app is not the one saving. So navigate away, let any
    // in-flight save finish against the CLEAN workspace, and only then corrupt.
    // ★★★ AND A FIXED WAIT IS NOT ENOUGH, because navigating away is itself a
    // SAVE TRIGGER: `scheduleDebouncedSave` registers a flush-on-hide
    // (`visibilitychange`/`pagehide`) so a pending save is not lost when the tab
    // goes away. So `about:blank` FLUSHES rather than silencing, and a corruption
    // written during that in-flight write is overwritten by it — which surfaces
    // as "the corruption did not land" while showing the ORIGINAL clean JSON.
    // Measured on this file's sixth run, where it masqueraded as a mutant kill.
    // Poll until the row stops changing, then corrupt.
    await page.goto("about:blank");
    await waitForBlobStable();
    await corruptDocumentsBlob();
    const corrupted = await readDocumentsBlob();
    expect(corrupted, "the corruption itself must have landed, or the rest proves nothing").toBe("{not json");

    // ── 3. Open the app again. The load proceeds (tasks came back), the
    //       documents slice does not. ────────────────────────────────────────
    await page.goto("/");
    await waitForShell(page);

    // The banner is the user-visible half of the fix. Its headline is
    // deliberately NOT "document data" — the decode cause covers eleven slices.
    await expect(
      page.getByText(/could not be opened/i).first(),
      "an undecodable slice must raise the incomplete-load banner",
    ).toBeVisible({ timeout: 30_000 });

    // ── 4. THE LOAD-BEARING ASSERTION. Dirty the workspace and give the
    //       trailing debounce ample time to fire. Before this slice, THIS is
    //       where the blob was destroyed: the save ran DELETE FROM meta and
    //       re-inserted only the rows it had, and an absent `documents` writes
    //       no row. The assertion is on the DATABASE, not the UI. ────────────
    // ★★★ THE EDIT MUST REALLY DIRTY `meta`, OR THIS STEP IS VACUOUS. An earlier
    // version pressed a key, which changes no workspace state — so "the row is
    // unchanged" would have held even with the guard removed, and the step would
    // have passed for the wrong reason. The negative control below is what
    // caught that. Creating a document mutates `ws.documents`, which is a `meta`
    // slice, so `dirtyWorkspaceTables` marks `meta` and the save that follows is
    // exactly the destructive DELETE-then-re-insert §284 is about.
    await openDocuments(page);
    await page.getByRole("button", { name: "New document", exact: true }).first().click();
    await page.waitForTimeout(4_000); // >> SAVE_DEBOUNCE_MS (500)

    const afterEdit = await readDocumentsBlob();
    expect(
      afterEdit,
      "the save must be WITHHELD while the load is incomplete — the row must still hold the corrupt bytes, " +
        "not be deleted and not be replaced by an empty set",
    ).toBe("{not json");

    // ── 5. NEGATIVE CONTROL — without this, step 4 proves nothing. Show that a
    //       save CAN reach this row in this exact setup, so "unchanged" above
    //       means "withheld" rather than "nothing ever saves here". ──────────
    // ★★★ TWO CONTROLS SHARE THIS NAME AND `.first()` IS THE WRONG ONE ON ITS
    // OWN. The banner's trigger opens a confirm dialog whose commit button
    // carries the SAME label (`documentsTruncatedSaveAnyway` is both), so
    // clicking once only opens the dialog — the save never happens, and the
    // assertion below reads as "the escape does not work" when the test simply
    // never confirmed. This is the repo's documented duplicate-name trap, in the
    // silent direction. Click the trigger, then commit INSIDE the dialog.
    await page.getByRole("button", { name: "Save anyway", exact: true }).first().click();
    const confirmDialog = page.getByRole("dialog", { name: "Save anyway?" });
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.getByRole("button", { name: "Save anyway", exact: true }).click();
    await page.waitForTimeout(6_000);

    const afterSaveAnyway = await readDocumentsBlob();
    expect(
      afterSaveAnyway,
      "Save anyway must be the thing that commits the loss — the row must no longer hold the corrupt bytes",
    ).not.toBe("{not json");
  });
});
