import { beforeAll, describe, expect, it } from "vitest";
import { AI_DATA_PATHS } from "../ai-disclosure";
import { loadI18n, t } from "../i18n";
import { CSP_CONNECT_HOSTS, CSP_FRAME_HOSTS } from "../../proxy";
import { DEPLOYMENT_VARIABLES } from "../deployment-variables";
import { OUTBOUND_DESTINATIONS } from "../outbound-destinations";
import { BLOCK_NAMES } from "../../../scripts/compliance/pack-lib.mjs";
import { PEOPLE_PATH_EXCLUDED_IDS, gapTitle, renderPackBlocks, type PackLang } from "./pack-blocks";

const REGISTER = [
  "# Register",
  "",
  "## 12. A gap with a | pipe in `code`",
  "",
  "body",
  "",
  "## 7. Another open gap",
  "",
  "## 3. ~~Done thing~~ — CLOSED 2026-01-01",
].join("\n");
const CITED = [7, 12];

const rows = (block: string): string[] => block.split("\n");
const columns = (line: string): number => line.replace(/\\\|/g, "").split("|").length;

describe("pack-blocks", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("every PEOPLE_PATH_EXCLUDED_IDS id exists in AI_DATA_PATHS", () => {
    const ids = new Set(AI_DATA_PATHS.map((r) => r.id));
    const excluded = Object.keys(PEOPLE_PATH_EXCLUDED_IDS);
    expect(excluded.length).toBeGreaterThan(0);
    for (const id of excluded) expect(ids.has(id), id).toBe(true);
  });

  it("every hidden or off row is in the people table", () => {
    const people = rows(renderPackBlocks("en", REGISTER, CITED)["ai-paths-people"]).slice(2);
    const hiddenOrOff = AI_DATA_PATHS.filter((r) => r.whenProtected !== "redacted");
    expect(hiddenOrOff.length).toBeGreaterThan(0);
    for (const r of hiddenOrOff) {
      expect(Object.keys(PEOPLE_PATH_EXCLUDED_IDS)).not.toContain(r.id);
      expect(people.some((line) => line.startsWith(`| ${t("en-US", r.labelKey)} |`)), r.id).toBe(true);
    }
  });

  it("both languages render the same block names and row counts", () => {
    const en = renderPackBlocks("en", REGISTER, CITED);
    const de = renderPackBlocks("de", REGISTER, CITED);
    expect(Object.keys(en)).toEqual([...BLOCK_NAMES]);
    expect(Object.keys(de)).toEqual([...BLOCK_NAMES]);
    for (const name of BLOCK_NAMES) expect(rows(de[name]).length).toBe(rows(en[name]).length);
    for (const name of BLOCK_NAMES.filter((n: string) => n !== "open-gaps")) expect(de[name]).not.toBe(en[name]);
  });

  it("an interactive row shows the interactive consent text and a background row the background one", () => {
    const en = rows(renderPackBlocks("en", REGISTER, CITED)["ai-paths"]);
    const interactive = AI_DATA_PATHS.findIndex((r) => r.level === "interactive");
    const background = AI_DATA_PATHS.findIndex((r) => r.level === "background");
    expect(en[2 + interactive]).toContain(t("en-US", "compliancePackConsentInteractive"));
    expect(en[2 + interactive]).not.toContain(t("en-US", "compliancePackConsentBackground"));
    expect(en[2 + background]).toContain(t("en-US", "compliancePackConsentBackground"));
    expect(en[2 + background]).toContain(t("en-US", AI_DATA_PATHS[background].labelKey));
  });

  it("a deployment-switches row shows its subsystem, alias and values cells", () => {
    const en = rows(renderPackBlocks("en", REGISTER, CITED)["deployment-switches"]);
    const at = DEPLOYMENT_VARIABLES.findIndex((v) => v.values !== undefined);
    const v = DEPLOYMENT_VARIABLES[at];
    const cells = en[2 + at].split(" | ");
    expect(cells[0]).toBe("| " + v.name);
    expect(cells[1]).toBe("-");
    expect(cells[2]).toBe("Server");
    expect(cells[3]).toBe((v.values ?? []).join(", "));
    const desktop = DEPLOYMENT_VARIABLES.findIndex((d) => d.subsystem === "desktop");
    expect(en[2 + desktop].split(" | ")[2]).toBe("Desktop app");
  });

  it("ai-paths has one row per AI_DATA_PATHS row", () => {
    const en = renderPackBlocks("en", REGISTER, CITED);
    expect(rows(en["ai-paths"]).length).toBe(AI_DATA_PATHS.length + 2);
    expect(rows(en["ai-paths-people"]).length).toBe(AI_DATA_PATHS.length - Object.keys(PEOPLE_PATH_EXCLUDED_IDS).length + 2);
  });

  it("each block has a header, a separator and one row per source item", () => {
    const en = renderPackBlocks("en", REGISTER, CITED);
    expect(rows(en["browser-hosts"]).length).toBe(2 + CSP_CONNECT_HOSTS.length + CSP_FRAME_HOSTS.length);
    expect(rows(en["server-destinations"]).length).toBe(2 + OUTBOUND_DESTINATIONS.length);
    expect(rows(en["deployment-switches"]).length).toBe(2 + DEPLOYMENT_VARIABLES.length);
    expect(rows(en["open-gaps"]).length).toBe(2 + CITED.length);
  });

  it("browser-hosts shows the condition of api.anthropic.com", () => {
    for (const lang of ["en", "de"] as PackLang[]) {
      const line = rows(renderPackBlocks(lang, REGISTER, CITED)["browser-hosts"]).find((l) => l.includes("api.anthropic.com"));
      expect(line).toBeDefined();
      expect(line).toMatch(/Anthropic/);
      expect(line).toContain(t(lang === "en" ? "en-US" : "de", "compliancePackCondAiDirect"));
      expect(line).not.toMatch(/Always allowed|Immer erlaubt/);
    }
  });

  it("server-destinations renders the operator as a translated label", () => {
    const en = renderPackBlocks("en", REGISTER, CITED)["server-destinations"];
    const de = renderPackBlocks("de", REGISTER, CITED)["server-destinations"];
    expect(en).toContain("European Central Bank");
    expect(de).toContain("Europäische Zentralbank");
    expect(en).not.toMatch(/\| (customer|user-chosen|ecb|github) \|/);
  });

  it("open-gaps renders each cited number with its register title", () => {
    const gaps = renderPackBlocks("en", REGISTER, CITED)["open-gaps"];
    expect(gaps).toContain("§7");
    expect(gaps).toContain("Another open gap");
    expect(gaps).toContain("§12");
    expect(gaps).toContain("A gap with a \\| pipe in `code`");
    expect(gaps).not.toContain("Done thing");
  });

  it("open-gaps drops a trailing open-status suffix from a title, and nothing else", () => {
    const register = [
      "## 1. Plain title",
      "## 2. Signing is off — OPEN",
      "## 3. A limiter — OPEN (decision owed)",
      "## 4. Fork PRs — open",
      "## 5. Open questions — the OPEN half stays",
    ].join("\n");
    const rowsOf = rows(renderPackBlocks("en", register, [1, 2, 3, 4, 5])["open-gaps"]).slice(2);
    expect(rowsOf).toEqual([
      "| §1 | Plain title |",
      "| §2 | Signing is off |",
      "| §3 | A limiter |",
      "| §4 | Fork PRs |",
      "| §5 | Open questions — the OPEN half stays |",
    ]);
    expect(gapTitle("Signing is off — OPEN (tied to the publishing decision)")).toBe("Signing is off");
  });

  it("the anthropic condition names all three requirements", () => {
    const text = t("en-US", "compliancePackCondAiDirect");
    expect(text).toMatch(/directly to Anthropic/);
    expect(text).toMatch(/restrict AI to its organisation/);
    expect(text).toMatch(/AI integration is not switched off/);
  });

  it("open-gaps throws on a cited number whose heading is closed or struck", () => {
    expect(() => renderPackBlocks("en", REGISTER, [3])).toThrow(/closed/);
    expect(() => renderPackBlocks("en", "## 4. Struck ~~thing~~", [4])).toThrow(/closed/);
  });

  it("open-gaps throws on a cited number the register does not have", () => {
    expect(() => renderPackBlocks("en", REGISTER, [99])).toThrow(/99/);
  });

  it("rendering twice gives identical text, LF only, no trailing whitespace, equal column counts", () => {
    for (const lang of ["en", "de"] as PackLang[]) {
      const a = renderPackBlocks(lang, REGISTER, CITED);
      expect(renderPackBlocks(lang, REGISTER, CITED)).toEqual(a);
      for (const body of Object.values(a)) {
        expect(body).not.toContain("\r");
        const header = columns(rows(body)[0]);
        for (const line of rows(body)) {
          expect(line).toMatch(/^\|.*\|$/);
          expect(line).not.toMatch(/\s$/);
          expect(columns(line)).toBe(header);
        }
      }
    }
  });
});
