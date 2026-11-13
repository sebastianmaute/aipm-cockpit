// The compliance pack's generated blocks (`docs/compliance/{en,de}/*.md`) must be exactly what the code
// renders today. With COMPLIANCE_WRITE=1 (`npm run compliance:generate`) the test rewrites the block
// bodies instead of asserting; prose outside the markers is never touched.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n } from "../i18n";
import { renderPackBlocks, type PackLang } from "./pack-blocks";
import { CITED_GAPS } from "../../../scripts/compliance/pack-config.mjs";
import { PACK_FILES, PACK_LANGS, parseBlocks, replaceBlocks } from "../../../scripts/compliance/pack-lib.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PACK_DIR = join(ROOT, "docs", "compliance");
const REGISTER = join(ROOT, "docs", "open-followups.md");
const WRITE = process.env.COMPLIANCE_WRITE === "1";

const withoutTrailingNewlines = (s: string): string => s.replace(/(\r?\n)+$/, "");

describe("compliance pack blocks", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  for (const lang of PACK_LANGS as readonly PackLang[]) {
    for (const file of PACK_FILES) {
      it(`${lang}/${file}: every block is what the code renders`, () => {
        const path = join(PACK_DIR, lang, file);
        const src = readFileSync(path, "utf8");
        const rendered = renderPackBlocks(lang, readFileSync(REGISTER, "utf8"), CITED_GAPS);
        const { blocks, errors } = parseBlocks(src);
        expect(errors).toEqual([]);
        if (WRITE) {
          const next = replaceBlocks(src, rendered);
          if (next !== src) writeFileSync(path, next, "utf8");
          return;
        }
        for (const b of blocks) {
          expect(b.body, `${lang}/${file}: block ${b.name} is stale; run npm run compliance:generate`).toBe(
            withoutTrailingNewlines(rendered[b.name]),
          );
        }
      });
    }
  }
});
