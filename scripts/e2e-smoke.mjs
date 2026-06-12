// Standalone Playwright smoke test for the LOP app.
//
// What it does (headless Chromium):
//   1. Seeds a `kind:"browser"` (IndexedDB-backed) project into the registry via
//      localStorage BEFORE the app boots, so the main UI loads without the File
//      System Access save-picker that headless Chromium can't satisfy.
//   2. Polyfills showSaveFilePicker/showOpenFilePicker with an in-memory stub so
//      file-backend flows don't hard-crash if reached.
//   3. Walks every sidebar/nav view and clicks each view's primary add control.
//   4. Captures console errors/warnings and uncaught page errors throughout and
//      exits non-zero if any are seen — usable as a CI smoke gate.
//
// Usage:
//   npm run dev                       # in one terminal (defaults to :3000)
//   node scripts/e2e-smoke.mjs        # or: node scripts/e2e-smoke.mjs http://localhost:3001/
//
// Requires the dev/prod server to be already running at the target URL.

import { chromium } from "playwright";

const url = process.argv[2] || process.env.E2E_URL || "http://localhost:3000/";

const browser = await chromium.launch();
const page = await browser.newPage();

const issues = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") issues.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${e.message} :: ${(e.stack || "").split("\n")[1]?.trim() || ""}`));

const step = (m) => console.log("•", m);

// Seed an IndexedDB-backed project so the app boots straight into the main UI.
await page.addInitScript(() => {
  localStorage.setItem(
    "lop-app:projects",
    JSON.stringify({
      projects: [{ id: "e2e-1", name: "E2E Project", code: "E2E-001", storageConfig: { kind: "browser" } }],
      currentProjectId: "e2e-1",
    }),
  );
  // In-memory File System Access stub (absent in headless Chromium).
  const storeRef = { content: "" };
  const handle = {
    name: "e2e-project.json",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => new File([storeRef.content], "e2e-project.json", { type: "application/json" }),
    createWritable: async () => ({
      write: async (c) => { storeRef.content = typeof c === "string" ? c : c?.data ?? ""; },
      close: async () => {},
    }),
  };
  window.showSaveFilePicker = async () => handle;
  window.showOpenFilePicker = async () => [handle];
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2500);
step("loaded: " + (await page.title()));

const onEmptyState = !!(await page.$("text=No projects yet"));
if (onEmptyState) {
  issues.push("seed failed: still on the empty-state (no project loaded)");
  step("WARNING: empty-state shown — seed did not take");
}

// Discover and visit every nav view; click each view's primary add control.
const navLabels = await page.evaluate(() =>
  [...document.querySelectorAll('aside a, aside button, nav a, nav button, [role="tab"]')]
    .map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " "))
    .filter((t) => t && t.length < 30),
);
const unique = [...new Set(navLabels)];
step("nav views found: " + unique.length);

async function gotoView(label) {
  return page.evaluate((label) => {
    const el = [...document.querySelectorAll('aside a, aside button, nav a, nav button, [role="tab"]')]
      .find((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === label);
    if (el) { el.click(); return true; }
    return false;
  }, label);
}

const visited = [];
for (const label of unique) {
  try {
    if (await gotoView(label)) {
      await page.waitForTimeout(300);
      visited.push(label);
      // Click the view's primary add control (full-page editor or inline form).
      await page.evaluate(() => {
        const add = [...document.querySelectorAll("button")].find((b) =>
          /^(\+|add|new|create)\b/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()));
        if (add) add.click();
      });
      await page.waitForTimeout(250);
    }
  } catch { /* keep going */ }
}
step("visited (" + visited.length + "): " + JSON.stringify(visited));

await page.waitForTimeout(400);
await browser.close();

const deduped = [...new Set(issues)];
console.log("\n=== ISSUES (" + deduped.length + ") ===");
console.log(deduped.join("\n") || "(none)");
process.exit(deduped.length > 0 ? 1 : 0);
