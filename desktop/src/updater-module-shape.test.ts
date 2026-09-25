// @vitest-environment node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");

// Partial regression guard for fix round 2, Critical 1. See electron-updater-loader.ts's doc comment
// for the full story: a dynamic `import("electron-updater")` exposes `autoUpdater` on `.default`, not
// as a named export, under plain Node/Electron.
//
// ★★★ THIS FILE CANNOT PIN THE "NOT NAMED" HALF OF THAT CLAIM, AND AN EARLIER VERSION OF IT TRIED TO.
// Measured here, not assumed: under vitest's OWN module loader (Vite's CJS interop for an external
// dependency), `"autoUpdater" in (await import("electron-updater"))` is `true` -- vitest's interop
// evidently copies every enumerable key off the fully-EXECUTED CommonJS `exports` object (where the
// dynamic `Object.defineProperty` getter genuinely IS an enumerable own property once the module has
// run), where plain Node's/Electron's native ESM-CJS interop instead relies on cjs-module-lexer's
// STATIC source scan (which cannot see a property defined via `Object.defineProperty` at runtime) and
// so never treats it as named. Reproduced with a throwaway probe printing `Object.keys(mod)` under
// this same `@vitest-environment node` context: `autoUpdater` was IN the list, matching neither the
// plain-`node --input-type=module` measurement in electron-updater-loader.ts's doc comment nor the
// production runtime (Electron's own Node integration, which behaves like plain Node here) this app
// actually ships on. A test asserting "not named" would therefore pass or fail depending on which
// loader is asking, which is not a fact about electron-updater -- it is a fact about vitest, and
// pinning it here would be actively misleading. This is exactly why `pickAutoUpdater` tries the named
// export FIRST rather than assuming either shape (electron-updater-loader.test.ts covers both
// branches with plain mocks, so it is correct under either interop). The genuine end-to-end proof that
// PRODUCTION Electron actually resolves and wires up the real `autoUpdater` lives outside vitest
// entirely: see task-6-report.md's fix-round-2 section for the packaged-app launch + log evidence.
//
// ★★ CHECKED VIA `in` / getOwnPropertyDescriptor, NEVER BY READING THE VALUE, for the half this file
// CAN still assert. `autoUpdater` is a dynamic getter
// (`Object.defineProperty(exports, "autoUpdater", { get: () => ... })` in electron-updater's
// out/main.js) that lazily INSTANTIATES a platform updater (`doLoadAutoUpdater()`) the first time it
// is read -- on win32 that is `new NsisUpdater()`, which reaches for real Electron APIs this
// plain-Node vitest process does not have. Reading the property would either throw or silently
// construct a half-working object outside Electron; asking only whether it EXISTS is safe under any
// interop, and importing the module alone pulls in no Electron API either (verified by running it
// under plain `node`, not Electron, before writing this test).
describe("electron-updater's export shape under a dynamic import", () => {
  it("exposes autoUpdater on .default, under every module interop this repo's tooling uses", async () => {
    const mod = (await import("electron-updater")) as { default?: unknown };
    const def = mod.default;
    expect(def !== null && typeof def === "object").toBe(true);
    expect(Object.getOwnPropertyDescriptor(def as object, "autoUpdater")).toBeDefined();
    expect("autoUpdater" in (def as object)).toBe(true);
  });

  // Fix round 3, C1(d).2: the assertion above runs INSIDE vitest's own module loader, which the test
  // above it already found disagrees with plain Node/Electron on the "named export" half. This pins
  // the FULL claim -- both halves -- in a genuinely separate, freshly-spawned `node` process that
  // never goes through Vite/vitest's module graph at all, so it is the one test in this repo that can
  // catch electron-updater ever promoting `autoUpdater` to a real named export (at which point
  // `pickAutoUpdater` would still work via its named-first branch, but this test would fail and say
  // so, which is the point -- a silent shape change should not go unnoticed just because the fallback
  // happens to cover it).
  it("pins the shape in a plain, freshly-spawned Node process -- no vitest loader involved", () => {
    // `in`, never a value read: reading `autoUpdater` invokes electron-updater's own lazy
    // doLoadAutoUpdater() getter (see the doc comment above), which this bare `node` process -- not
    // Electron -- cannot satisfy.
    const script =
      "const m = await import('electron-updater');" +
      "console.log(JSON.stringify(['autoUpdater' in m, 'autoUpdater' in (m.default ?? {})]));";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: desktopDir,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual([false, true]);
  });
});
