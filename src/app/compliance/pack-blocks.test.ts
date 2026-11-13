import { beforeAll, describe, expect, it } from "vitest";
import { AI_DATA_PATHS } from "../ai-disclosure";
import { loadI18n } from "../i18n";
import { CSP_CONNECT_HOSTS, CSP_FRAME_HOSTS } from "../../proxy";
import { DEPLOYMENT_VARIABLES } from "../deployment-variables";
import { OUTBOUND_DESTINATIONS } from "../outbound-destinations";
import { BLOCK_NAMES } from "../../../scripts/compliance/pack-lib.mjs";
import { PEOPLE_PATH_IDS, renderPackBlocks, type PackLang } from "./pack-blocks";

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

  it("every PEOPLE_PATH_IDS id exists in AI_DATA_PATHS", () => {
    const ids = new Set(AI_DATA_PATHS.map((r) => r.id));
    for (const id of PEOPLE_PATH_IDS) expect(ids.has(id)).toBe(true);
    expect(new Set(PEOPLE_PATH_IDS).size).toBe(PEOPLE_PATH_IDS.length);
  });

  it("every hidden or off row is in PEOPLE_PATH_IDS", () => {
    for (const r of AI_DATA_PATHS) {
      if (r.whenProtected !== "redacted") expect(PEOPLE_PATH_IDS).toContain(r.id);
    }
  });

  it("both languages render the same block names and row counts", () => {
    const en = renderPackBlocks("en", REGISTER, CITED);
    const de = renderPackBlocks("de", REGISTER, CITED);
    expect(Object.keys(en)).toEqual([...BLOCK_NAMES]);
    expect(Object.keys(de)).toEqual([...BLOCK_NAMES]);
    for (const name of BLOCK_NAMES) expect(rows(de[name]).length).toBe(rows(en[name]).length);
    expect(en["ai-paths"]).not.toBe(de["ai-paths"]);
  });

  it("ai-paths has one row per AI_DATA_PATHS row", () => {
    const en = renderPackBlocks("en", REGISTER, CITED);
    expect(rows(en["ai-paths"]).length).toBe(AI_DATA_PATHS.length + 2);
    expect(rows(en["ai-paths-people"]).length).toBe(PEOPLE_PATH_IDS.length + 2);
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
