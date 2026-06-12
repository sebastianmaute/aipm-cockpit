import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

// Real sample workspace (14 tasks, RAID, budgets, milestones, …) — gives the
// a11y/nav specs realistic data so colour-coded states (RAG amber/red, budget
// over/under, completed-task greens, etc.) actually render and get scanned.
const SAMPLE_WORKSPACE = JSON.parse(
  readFileSync(join(process.cwd(), "sample-workspace.json"), "utf8"),
) as Record<string, unknown>;

// Registry + File System Access stub. Runs in the browser before app code on
// every navigation. A `kind:"browser"` project loads from IndexedDB (no
// save-picker, which headless Chromium can't satisfy); the FSA pickers are
// stubbed in-memory for any flow that still reaches them.
function seedRegistryAndFsa(): void {
  localStorage.setItem(
    "lop-app:projects",
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

// Writes the sample workspace into IndexedDB in the exact shape BrowserBackend
// reads (see browser-backend.ts / idb.ts). Runs in the browser via evaluate so
// it completes BEFORE the app loads (addInitScript can't block on async IDB).
function seedIndexedDb(ws: Record<string, unknown>): Promise<void> {
  const ENTITY = ["tasks", "raid", "absences", "shifts", "resources", "roles", "disciplines", "grades", "budgets"];
  const KV: Record<string, string> = {
    plan: "resource-plan", fxRates: "fx-rates", status: "project-status",
    milestones: "milestones", changes: "changes", stakeholders: "stakeholders", project: "project",
  };
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("lop-app", 6);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      for (const s of ENTITY) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(db.objectStoreNames, "readwrite");
      for (const field of ENTITY)
        for (const rec of (ws[field] as unknown[]) ?? []) tx.objectStore(field).put(rec);
      const kv = tx.objectStore("kv");
      for (const [field, key] of Object.entries(KV)) if (ws[field] != null) kv.put(ws[field], key);
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
    await page.evaluate(seedIndexedDb, SAMPLE_WORKSPACE);
    await run(page);
  },
});

export { expect };

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

/**
 * Navigate to the app and wait until the sidebar shell is interactive. The
 * timeout is generous because the FIRST navigation against the dev `webServer`
 * pays a one-time Turbopack compile (well over the default action timeout);
 * subsequent in-app navigations are fast.
 */
export async function gotoApp(page: Page): Promise<void> {
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
  await page.waitForTimeout(300);
}
