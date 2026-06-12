import { test as base, expect, type Page } from "@playwright/test";

// Seeds an IndexedDB-backed project into the registry BEFORE any app code runs,
// so the app boots straight into the main UI instead of the empty-state. A
// file-backed project would require the File System Access save-picker, which
// headless Chromium can't satisfy — so we also stub the FSA pickers in-memory
// for any flow that reaches them.
//
// Runs in the browser context (serialized by addInitScript) — must not close
// over anything from the Node test scope.
function seedInit(): void {
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

// Test fixture: every test gets a context pre-seeded with the project above.
// (The fixture-provide callback is named `run` rather than Playwright's usual
// `use` so eslint-plugin-react-hooks doesn't mistake it for the React `use` hook.)
export const test = base.extend({
  context: async ({ context }, run) => {
    await context.addInitScript(seedInit);
    await run(context);
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

/**
 * Click a primary nav control by its trimmed accessible label (aria-label or
 * text). Uses an in-page match because the modern sidebar renders icon-rail
 * buttons whose role/name don't line up cleanly with getByRole. Throws if the
 * control is missing, so a nav rename fails the test loudly.
 */
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
