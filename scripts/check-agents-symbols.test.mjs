// Runs scripts/check-agents-symbols.mjs against a scratch tree, so deleting its refusal to pass when a gated doc
// folder holds no Markdown fails here. `gatedDocsEmptyDirs` is tested in agents-symbols-lib.test.mjs; this pins
// that the CLI acts on it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "check-agents-symbols.mjs");
let scratch;

function tree(withGermanBrief) {
  writeFileSync(join(scratch, "AGENTS.md"), "# Agents\n");
  for (const dir of ["docs/AGENTS", "docs/briefs/en", "docs/briefs/de"]) mkdirSync(join(scratch, dir), { recursive: true });
  writeFileSync(join(scratch, "docs/AGENTS/a.md"), "a\n");
  writeFileSync(join(scratch, "docs/briefs/README.md"), "briefs\n");
  writeFileSync(join(scratch, "docs/briefs/en/cio.md"), "cio\n");
  if (withGermanBrief) writeFileSync(join(scratch, "docs/briefs/de/cio.md"), "cio\n");
}

const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: scratch, encoding: "utf8" });

describe("check-agents-symbols.mjs, run against a scratch tree", () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "agents-symbols-gate-"));
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it("exits 2 and names the folder when a gated doc folder holds no Markdown", () => {
    tree(false);
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no *.md found in docs/briefs/de");
  });

  it("does not report an empty folder when every gated folder has a file", () => {
    tree(true);
    const r = run();
    // The scratch tree has no code, so the gate still refuses on its identifier floor; what matters here is that it
    // got past the folder check.
    expect(r.stderr).not.toContain("no *.md found");
    expect(r.stderr).toContain("identifiers found");
  });
});
