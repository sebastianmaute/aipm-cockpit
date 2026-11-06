// @vitest-environment node
// The release:verify CLI against a throwaway release directory.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./verify-release-assets.mjs", import.meta.url));
const VERSION = "1.14.0";
const TAG = `v${VERSION}`;
const EXE = `aipm-cockpit-${VERSION}-setup.exe`;
const SBOM = `aipm-cockpit-${VERSION}-sbom.cdx.json`;

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sbom = (version) => JSON.stringify({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: { component: { name: "AI PM Cockpit", version, licenses: [{ expression: "EUPL-1.2" }] } },
  components: [{ type: "library", name: "react", version: "19.3.1" }],
});

/** A release directory with all four files, correct unless `over` replaces one (null leaves it out). */
function releaseDir(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-"));
  dirs.push(dir);
  const bytes = Buffer.from("exe-bytes");
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const files = {
    [EXE]: bytes,
    [`${EXE}.blockmap`]: "map",
    "latest.yml": [
      `version: ${VERSION}`, "files:", `  - url: ${EXE}`, `    sha512: ${sha512}`, `    size: ${bytes.length}`,
      `path: ${EXE}`, `sha512: ${sha512}`, "releaseDate: '2026-11-02T10:00:00.000Z'", "",
    ].join("\n"),
    [SBOM]: sbom(VERSION),
    ...over,
  };
  for (const [name, content] of Object.entries(files)) if (content !== null) writeFileSync(join(dir, name), content);
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [CLI, dir, TAG], { encoding: "utf8" });

describe("verify-release-assets.mjs", () => {
  it("passes the four correct files (exit 0) and names all four", () => {
    const r = run(releaseDir());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`${EXE}, ${EXE}.blockmap, latest.yml, ${SBOM}`);
  });

  it("names a missing SBOM (exit 1)", () => {
    const r = run(releaseDir({ [SBOM]: null }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`[release:verify] missing ${SBOM}`);
  });

  it("names an SBOM whose root version is not the tag's (exit 1)", () => {
    const r = run(releaseDir({ [SBOM]: sbom("1.13.2") }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`[release:verify] ${SBOM} describes version 1.13.2, expected ${VERSION}`);
  });

  it("names an SBOM that does not parse (exit 1)", () => {
    const r = run(releaseDir({ [SBOM]: "{not json" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`[release:verify] cannot read ${SBOM}: `);
  });

  it("still names a fifth, unexpected file (exit 1)", () => {
    const r = run(releaseDir({ "THIRD-PARTY-NOTICES.txt": "x" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[release:verify] unexpected THIRD-PARTY-NOTICES.txt");
  });
});
