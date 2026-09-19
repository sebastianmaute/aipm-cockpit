// §548 — the load hold, end to end. The seeded project's IndexedDB open is held until the test releases
// it, so the first load is visibly pending: the skeleton shows and the app does not, then the loaded
// project appears. The shim holds only the WORKSPACE database ("aipm-cockpit"); settings secrets and
// file handles live in their own databases and hydrate normally.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openView } from "./seed";

const MASTER = JSON.parse(readFileSync(join(process.cwd(), "sample-workspace-small.json"), "utf8")) as {
  tasks: Array<{ taskName: string; status: string }>;
};
const OPEN_TASK = MASTER.tasks.find((x) => x.status !== "Done" && x.status !== "Cancelled");

test("§548 — a delayed project load shows the skeleton, then the loaded app", async ({ page }) => {
  expect(OPEN_TASK, "the sample workspace has an open task").toBeDefined();
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (window as unknown as { __releaseAipmLoad: () => void }).__releaseAipmLoad = () => release();
    const onsuccess = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess");
    const realOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function open(this: IDBFactory, name: string, version?: number): IDBOpenDBRequest {
      const req = version === undefined ? realOpen.call(this, name) : realOpen.call(this, name, version);
      if (name === "aipm-cockpit" && onsuccess?.set) {
        Object.defineProperty(req, "onsuccess", {
          configurable: true,
          set(fn: ((this: IDBRequest, ev: Event) => unknown) | null) {
            onsuccess.set!.call(req, fn === null ? null : (ev: Event) => { void gate.then(() => fn.call(req, ev)); });
          },
        });
      }
      return req;
    };
  });

  await page.goto("/");
  // §548 F1 item 8 — prove the CLIENT hold, not the SSR/pre-hydration skeleton: both render the exact
  // same "Loading…" markup, so asserting the skeleton alone would also pass if hydration silently never
  // ran at all. `window.__aipmDiag` is set by a module-level side effect in diagnostics.ts (an existing
  // devtools hook, not added for this test) the instant the client bundle evaluates — well before
  // `loadPending` itself settles, since it does not depend on the gated IndexedDB open above. Waiting
  // for it first, THEN asserting the skeleton is still up, pins that the skeleton persists past
  // hydration because the client's own `loadPending` is holding it, not merely because the client never
  // took over.
  await page.waitForFunction(
    () => typeof (window as unknown as { __aipmDiag?: unknown }).__aipmDiag === "function",
    { timeout: 90_000 }, // the first navigation pays a dev compile
  );
  const skeleton = page.getByRole("status").filter({ hasText: "Loading…" });
  await expect(skeleton).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("navigation")).toHaveCount(0); // no app chrome, so no control to edit with

  await page.evaluate(() => (window as unknown as { __releaseAipmLoad: () => void }).__releaseAipmLoad());
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
  await openView(page, "Open Points");
  await expect(page.getByText(OPEN_TASK!.taskName, { exact: true }).first()).toBeAttached();
});
