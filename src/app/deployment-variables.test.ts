// The deployment-variable registry stays complete: every AIPM_ name the shipped source reads is either
// registered (so the compliance tables list it) or excluded with a reason.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DISABLED_INTEGRATIONS_ENV, INTEGRATION_IDS } from "./integration-switches";
import { loadI18n, t } from "./i18n";
import { DEPLOYMENT_VARIABLES, DEPLOYMENT_VARIABLE_EXCLUSIONS } from "./deployment-variables";
import { stripComments } from "../test/source-scan";

const ROOT = join(__dirname, "..", "..");
const SCAN_ROOTS = ["src", "desktop/src"];
const SKIP_DIRS = new Set(["node_modules", "__fixtures__", ".next"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry) && rel !== "src/test") walk(full, out);
    } else if (SOURCE_FILE.test(entry) && !TEST_FILE.test(entry)) {
      out.push(full);
    }
  }
}

/** Every AIPM_ token in code: quoted ("AIPM_X"), dotted (process.env.AIPM_X) or computed. Comments are
 *  dropped (`stripComments`) so a name only mentioned in prose does not count as read. This file's
 *  subject, the registry, is left out, since it names every registered variable itself. */
function literalsByFile(): Map<string, string[]> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(ROOT, root), files);
  const found = new Map<string, string[]>();
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel === "src/app/deployment-variables.ts") continue;
    for (const m of stripComments(readFileSync(file, "utf8")).matchAll(/\bAIPM_[A-Z0-9_]+\b/g)) {
      found.set(m[0], [...(found.get(m[0]) ?? []), rel]);
    }
  }
  return found;
}

const registered = (): Set<string> =>
  new Set([
    ...DEPLOYMENT_VARIABLES.flatMap((v) => [v.name, ...v.aliases]),
    ...DEPLOYMENT_VARIABLE_EXCLUSIONS.map((e) => e.name),
  ]);

describe("deployment variables registry", () => {
  const found = literalsByFile();

  it("every AIPM_ literal in non-test source is registered or excluded", () => {
    expect(found.has(DISABLED_INTEGRATIONS_ENV)).toBe(true); // a name read through a constant is still found
    const known = registered();
    expect([...found.keys()].filter((name) => !known.has(name))).toEqual([]);
  });

  it("every registered name or alias appears in some non-test source", () => {
    const names = [...DEPLOYMENT_VARIABLES.flatMap((v) => [v.name, ...v.aliases]), ...DEPLOYMENT_VARIABLE_EXCLUSIONS.map((e) => e.name)];
    expect(names.filter((name) => !found.has(name))).toEqual([]);
  });

  it("names and aliases are unique", () => {
    const all = [...DEPLOYMENT_VARIABLES.flatMap((v) => [v.name, ...v.aliases]), ...DEPLOYMENT_VARIABLE_EXCLUSIONS.map((e) => e.name)];
    expect(all.filter((n, i) => all.indexOf(n) !== i)).toEqual([]);
  });

  it("every exclusion states a reason", () => {
    expect(DEPLOYMENT_VARIABLE_EXCLUSIONS.filter((e) => e.reason.trim() === "")).toEqual([]);
  });

  it("AIPM_DISABLED_INTEGRATIONS values are INTEGRATION_IDS", () => {
    const entry = DEPLOYMENT_VARIABLES.find((v) => v.name === DISABLED_INTEGRATIONS_ENV);
    expect(entry?.values).toBe(INTEGRATION_IDS);
  });

  describe("effect texts", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });
    it("each effectKey has an English and a German text", () => {
      for (const v of DEPLOYMENT_VARIABLES) {
        const en = t("en-US", v.effectKey);
        const de = t("de", v.effectKey);
        expect(en.trim(), v.name).not.toBe("");
        expect(de.trim(), v.name).not.toBe("");
        expect(de, v.name).not.toBe(en);
      }
    });
  });
});
