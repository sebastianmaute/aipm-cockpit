// @vitest-environment node
import { describe, expect, it } from "vitest";

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
});
