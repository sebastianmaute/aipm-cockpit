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
      if (name === "aipm-cockpit") {
        // §548 F1 round 1 (review I-1) — this `open("aipm-cockpit")` call is issued ONLY by the client
        // load effect (`use-storage-backend.ts`'s load effect, via `BrowserBackend`), which runs after
        // hydration and after `hydrated` has settled — unlike `window.__aipmDiag` (a module-level side
        // effect in diagnostics.ts that fires at bundle EVALUATION, before `hydrateRoot` commits). No
        // production code reads this flag; it exists only for this init script's own gate below.
        (window as unknown as { __aipmLoadStarted?: boolean }).__aipmLoadStarted = true;
        if (onsuccess?.set) {
          Object.defineProperty(req, "onsuccess", {
            configurable: true,
            set(fn: ((this: IDBRequest, ev: Event) => unknown) | null) {
              onsuccess.set!.call(req, fn === null ? null : (ev: Event) => { void gate.then(() => fn.call(req, ev)); });
            },
          });
        }
      }
      return req;
    };
  });

  await page.goto("/");
  // §548 F1 item 8 (review round 1, I-1) — prove the CLIENT hold, not the SSR/pre-hydration skeleton:
  // both render the exact same "Loading…" markup, so asserting the skeleton alone would also pass if
  // hydration silently never ran at all. `window.__aipmLoadStarted` (set above, inside the patched
  // `IDBFactory.prototype.open`) is set only when the CLIENT load effect actually issues the
  // "aipm-cockpit" open — which happens after hydration commits and after settings hydration — so
  // waiting for it first, THEN asserting the skeleton is still up, pins that the skeleton persists
  // because the client's own `loadPending` is holding it open, not merely because the client never took
  // over. (An earlier version of this wait used `window.__aipmDiag`, which is set at client BUNDLE
  // EVALUATION — before `hydrateRoot` commits — so it did not actually prove hydration.)
  await page.waitForFunction(
    () => (window as unknown as { __aipmLoadStarted?: boolean }).__aipmLoadStarted === true,
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
