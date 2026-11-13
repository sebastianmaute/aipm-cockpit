// The outbound-destination registry stays complete: every external service the app's own server or the
// desktop shell contacts is registered (so the compliance tables list it) or listed as making no outbound call.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n, t } from "./i18n";
import { NO_OUTBOUND_CALLERS, OUTBOUND_DESTINATIONS } from "./outbound-destinations";

const ROOT = join(__dirname, "..", "..");
const API_ROOT = "src/app/api";
const SKIP_DIRS = new Set(["node_modules", "__fixtures__", ".next"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
/** What makes a server file a network caller: the platform fetch, node:https, or the Turso pipeline. */
const API_CALL = /\bfetch\(|\bhttpsRequest\(|\brunTursoPipeline\(|\bcreateClient\(|\bnet\.request/;
/** What makes a desktop file a candidate: fetch, Electron's net, the updater, or an absolute URL literal. */
const DESKTOP_CALL = /\bfetch\(|\bnet\.request|\bautoUpdater\b|https?:\/\//;

const posix = (p: string): string => p.split(sep).join("/");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (SOURCE_FILE.test(entry) && !TEST_FILE.test(entry)) {
      out.push(posix(relative(ROOT, full)));
    }
  }
}

/** Comments are dropped so a URL or call only mentioned in prose does not count. Crude on purpose: a "//"
 *  inside a string or URL is kept by the lookbehind, which suffices for the patterns scanned. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function filesMatching(root: string, pattern: RegExp): string[] {
  const files: string[] = [];
  walk(join(ROOT, root), files);
  return files.filter((f) => pattern.test(withoutComments(readFileSync(join(ROOT, f), "utf8"))));
}

/** A caller covers a path when it is that file or the directory above it. */
const covers = (caller: string, path: string): boolean => caller === path || path.startsWith(`${caller}/`);
const callers = (): string[] => OUTBOUND_DESTINATIONS.map((d) => d.caller);
const noOutbound = (): string[] => NO_OUTBOUND_CALLERS.map((n) => n.caller);

describe("outbound destinations registry", () => {
  it("every src/app/api directory except _shared is a caller or listed as making no outbound call", () => {
    const dirs = readdirSync(join(ROOT, API_ROOT), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "_shared")
      .map((e) => `${API_ROOT}/${e.name}`);
    expect(dirs.length).toBeGreaterThan(0);
    const known = [...callers(), ...noOutbound()];
    expect(dirs.filter((dir) => !known.some((k) => covers(dir, k) || covers(k, dir)))).toEqual([]);
  });

  it("every api file that calls out is under a registered caller", () => {
    const callingFiles = filesMatching(API_ROOT, API_CALL).filter((f) => !f.startsWith(`${API_ROOT}/_shared/`));
    expect(callingFiles.length).toBeGreaterThan(3); // the scan found the known callers
    expect(callingFiles.filter((f) => !callers().some((c) => covers(c, f)) && !noOutbound().some((n) => covers(n, f)))).toEqual([]);
  });

  it("every desktop/src non-test file containing fetch(, net.request, autoUpdater or an http(s):// literal is a caller or listed with a reason", () => {
    const candidates = filesMatching("desktop/src", DESKTOP_CALL);
    expect(candidates).toContain("desktop/src/updater.ts"); // a name read through the scan is still found
    const known = new Set([...callers(), ...noOutbound()]);
    expect(candidates.filter((f) => !known.has(f))).toEqual([]);
  });

  it("every caller path exists", () => {
    const paths = [...callers(), ...noOutbound()];
    expect(paths.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
    expect(paths.filter((p) => !/^(src\/app\/api\/[^/]+(\/[^/]+\.ts)?|desktop\/src\/.+)$/.test(p))).toEqual([]);
  });

  it("ids are unique", () => {
    const ids = OUTBOUND_DESTINATIONS.map((d) => d.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.every((id) => /^[a-z][a-z0-9-]*$/.test(id))).toBe(true);
  });

  it("every no-outbound entry states a reason and no path is both a caller and listed as no-outbound", () => {
    expect(NO_OUTBOUND_CALLERS.filter((n) => n.reason.trim() === "")).toEqual([]);
    expect(noOutbound().filter((n) => callers().includes(n))).toEqual([]);
  });

  describe("texts", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });
    it("each sentKey and whenKey has an English and a German text, with no promise word", () => {
      const keys = OUTBOUND_DESTINATIONS.flatMap((d) => [d.sentKey, d.whenKey]);
      for (const key of keys) {
        const en = t("en-US", key);
        const de = t("de", key);
        expect(en.trim(), key).not.toBe("");
        expect(de.trim(), key).not.toBe("");
        expect(de, key).not.toBe(en);
        expect(en, key).not.toMatch(/\b(secure|compliant|EU-hosted|never)\b/i);
        expect(de, key).not.toMatch(/\b(sicher|konform|EU-gehostet|niemals)\b/i);
      }
    });
  });
});
