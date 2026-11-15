// Runs scripts/check-compliance-pack.mjs against a scratch copy of the pack and the briefs, so a deleted loop or
// call in the script fails here rather than staying green. It covers the injections listed below (each was
// proven by deleting the script line that catches it); it does not claim to cover every line of the script.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "compliance-gate-"));
// The pack library imports a Markdown parser (micromark), so the copied scripts must resolve the repo's packages.
// A junction on Windows, a directory symlink elsewhere; `afterAll` unlinks it before the recursive delete, so the
// cleanup can never walk into the real node_modules.
const scratchModules = join(scratch, "node_modules");
symlinkSync(join(ROOT, "node_modules"), scratchModules, process.platform === "win32" ? "junction" : "dir");

function freshCopy() {
  rmSync(join(scratch, "docs"), { recursive: true, force: true });
  cpSync(join(ROOT, "docs", "compliance"), join(scratch, "docs", "compliance"), { recursive: true });
  cpSync(join(ROOT, "docs", "briefs"), join(scratch, "docs", "briefs"), { recursive: true });
  cpSync(join(ROOT, "docs", "open-followups.md"), join(scratch, "docs", "open-followups.md"));
  // The scripts too, so a test can edit the config (CITED_GAPS) the script reads.
  rmSync(join(scratch, "scripts"), { recursive: true, force: true });
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  for (const n of readdirSync(join(ROOT, "scripts"))) {
    if (n.endsWith(".mjs") && !n.endsWith(".test.mjs")) cpSync(join(ROOT, "scripts", n), join(scratch, "scripts", n));
  }
  cpSync(join(ROOT, "scripts", "compliance"), join(scratch, "scripts", "compliance"), {
    recursive: true,
    filter: (src) => !src.endsWith(".test.mjs"),
  });
  mkdirSync(join(scratch, "src", "app"), { recursive: true });
  cpSync(join(ROOT, "src", "app", "version.ts"), join(scratch, "src", "app", "version.ts"));
}

function run() {
  return spawnSync(process.execPath, [join(scratch, "scripts", "check-compliance-pack.mjs")], { cwd: scratch, encoding: "utf8" });
}

const append = (rel, text) => {
  const p = join(scratch, rel);
  writeFileSync(p, readFileSync(p, "utf8") + text);
};

describe("check-compliance-pack.mjs, run against a scratch copy", () => {
  beforeEach(freshCopy);
  afterAll(() => {
    try {
      unlinkSync(scratchModules);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("exits 0 on a clean copy", () => {
    const r = run();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  const closed = () => {
    const reg = readFileSync(join(ROOT, "docs", "open-followups.md"), "utf8");
    const nums = [...reg.matchAll(/^## (\d{3,})\..*CLOSED/gm)].map((m) => Number(m[1])).filter((n) => n >= 400);
    return nums[0] ?? 0;
  };

  const injections = {
    "a German claim in the briefs README": () => append("docs/briefs/README.md", "\nDie Lösung ist souverän.\n"),
    "a claim in the German briefs page": () => append("docs/briefs/de/ceo.md", "\nDas ist DSGVO-konform.\n"),
    "a claim in the English pack README": () => append("docs/compliance/en/README.md", "\nIt is GDPR-compliant.\n"),
    "a claim in the German pack README": () => append("docs/compliance/de/README.md", "\nDas ist DSGVO-konform.\n"),
    "an unknown evidence id": () => {
      append("docs/briefs/en/ceo.md", "\nSee E99999.\n");
      append("docs/briefs/de/ceo.md", "\nSiehe E99999.\n");
    },
    "a closed register number in a brief": () => append("docs/briefs/en/cio.md", `\nSee §${closed()}.\n`),
    "a bad key in figures.json": () => {
      const p = join(scratch, "docs/briefs/figures.json");
      const f = JSON.parse(readFileSync(p, "utf8"));
      f.surprise = 1;
      writeFileSync(p, JSON.stringify(f));
    },
    "invalid figures.json": () => writeFileSync(join(scratch, "docs/briefs/figures.json"), "{"),
    "an unlinked briefs page": () => {
      const p = join(scratch, "docs/briefs/README.md");
      writeFileSync(p, readFileSync(p, "utf8").replace("](de/pm.md)", "]()"));
    },
    "an unknown block in a brief page": () =>
      append("docs/briefs/en/pm.md", "\n<!-- PACK:nope:BEGIN -->\n<!-- PACK:nope:END -->\n"),
    "a heading only one language has": () => append("docs/briefs/de/coo.md", "\n## Extra\n"),
    "a deleted brief page": () => rmSync(join(scratch, "docs/briefs/en/dpo.md")),
    "a known block in the wrong brief file": () => {
      const block = "\n<!-- PACK:open-gaps:BEGIN -->\n<!-- PACK:open-gaps:END -->\n";
      append("docs/briefs/en/pm.md", block);
      append("docs/briefs/de/pm.md", block);
    },
    "a closed register number in the briefs README": () => append("docs/briefs/README.md", `\nSee §${closed()}.\n`),
    "a brief page deleted in both languages": () => {
      rmSync(join(scratch, "docs/briefs/en/dpo.md"));
      rmSync(join(scratch, "docs/briefs/de/dpo.md"));
    },
    "an extra brief page in both languages": () => {
      writeFileSync(join(scratch, "docs/briefs/en/extra.md"), "# Extra\n");
      writeFileSync(join(scratch, "docs/briefs/de/extra.md"), "# Extra\n");
    },
    "a claim in the root pack README": () => append("docs/compliance/README.md", "\nIt is GDPR-compliant.\n"),
    "a closed register number in the root pack README": () => append("docs/compliance/README.md", `\nSee §${closed()}.\n`),
    "a broken link in the root pack README": () => {
      const p = join(scratch, "docs/compliance/README.md");
      writeFileSync(p, readFileSync(p, "utf8").replace("](de/README.md)", "]()"));
    },
    "a heading only one pack language has": () => append("docs/compliance/de/tom-sheet.md", "\n## Extra\n"),
    "a closed gap in CITED_GAPS": () => {
      const p = join(scratch, "scripts/compliance/pack-config.mjs");
      writeFileSync(p, readFileSync(p, "utf8").replace("export const CITED_GAPS = [", `export const CITED_GAPS = [${closed()}, `));
    },
    "a table row id on a brief page that is no evidence row": () => {
      append("docs/briefs/en/coo.md", "\n| E99999 | x |\n");
      append("docs/briefs/de/coo.md", "\n| E99999 | x |\n");
    },
    "an unknown pack block": () => append("docs/compliance/de/dpia-input.md", "\n<!-- PACK:nope:BEGIN -->\n<!-- PACK:nope:END -->\n"),
  };

  for (const [name, inject] of Object.entries(injections)) {
    it(`exits 1 on ${name}`, () => {
      inject();
      const r = run();
      expect(r.status, r.stderr).toBe(1);
    });
  }

  it("exits 2 when the briefs README is missing", () => {
    rmSync(join(scratch, "docs/briefs/README.md"));
    expect(run().status).toBe(2);
  });
});
