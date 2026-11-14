// Runs scripts/check-compliance-pack.mjs against a scratch copy of the pack and the briefs, so a deleted loop or
// call in the script (a wiring point) fails here rather than staying green.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-compliance-pack.mjs");
const scratch = mkdtempSync(join(tmpdir(), "compliance-gate-"));

function freshCopy() {
  rmSync(join(scratch, "docs"), { recursive: true, force: true });
  cpSync(join(ROOT, "docs", "compliance"), join(scratch, "docs", "compliance"), { recursive: true });
  cpSync(join(ROOT, "docs", "briefs"), join(scratch, "docs", "briefs"), { recursive: true });
  cpSync(join(ROOT, "docs", "open-followups.md"), join(scratch, "docs", "open-followups.md"));
  mkdirSync(join(scratch, "src", "app"), { recursive: true });
  cpSync(join(ROOT, "src", "app", "version.ts"), join(scratch, "src", "app", "version.ts"));
}

function run() {
  return spawnSync(process.execPath, [SCRIPT], { cwd: scratch, encoding: "utf8" });
}

const append = (rel, text) => {
  const p = join(scratch, rel);
  writeFileSync(p, readFileSync(p, "utf8") + text);
};

describe("check-compliance-pack.mjs, run against a scratch copy", () => {
  beforeEach(freshCopy);
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

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
