// @vitest-environment node
// release-latest-yml: the update feed and blockmap rewritten over a (signed) installer.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { latestYmlText, writeUpdateFeed } from "./release-latest-yml.mjs";
import { checkLatestYml, installerName } from "./release-publish-lib.mjs";

const CLI = fileURLToPath(new URL("./release-latest-yml.mjs", import.meta.url));
const VERSION = "1.14.0";
const EXE = installerName(VERSION);
// 70,000 bytes of a fixed pattern: several blockmap chunks, and a known digest.
const BYTES = Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 31 + (i >> 7)) & 0xff));
const SHA512 = createHash("sha512").update(BYTES).digest("base64");
const DATE = "2026-11-02T10:00:00.000Z";

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function dirWithInstaller() {
  const dir = mkdtempSync(join(tmpdir(), "latest-yml-"));
  dirs.push(dir);
  writeFileSync(join(dir, EXE), BYTES);
  return dir;
}

describe("latestYmlText", () => {
  it("writes electron-builder's layout, which checkLatestYml accepts", () => {
    const text = latestYmlText({ version: VERSION, name: EXE, sha512: SHA512, size: BYTES.length, releaseDate: DATE });
    expect(text).toBe([
      `version: ${VERSION}`, "files:", `  - url: ${EXE}`, `    sha512: ${SHA512}`, `    size: ${BYTES.length}`,
      `path: ${EXE}`, `sha512: ${SHA512}`, `releaseDate: '${DATE}'`, "",
    ].join("\n"));
    expect(checkLatestYml(text, VERSION, { name: EXE, sha512: SHA512, size: BYTES.length })).toEqual([]);
  });
});

describe("writeUpdateFeed", () => {
  it("writes latest.yml with the installer's exact sha512 and size, and a blockmap of its bytes", async () => {
    const dir = dirWithInstaller();
    const r = await writeUpdateFeed(dir, VERSION, { now: () => new Date(DATE) });
    expect(r).toEqual({ name: EXE, sha512: SHA512, size: 70_000 });
    const yml = readFileSync(join(dir, "latest.yml"), "utf8");
    expect(yml).toContain(`    sha512: ${SHA512}\n    size: 70000\n`);
    expect(yml).toContain(`releaseDate: '${DATE}'`);
    expect(checkLatestYml(yml, VERSION, r)).toEqual([]);
    // electron-builder's own blockmap: gzip JSON, version 2, one file whose chunk sizes sum to the installer.
    const map = JSON.parse(gunzipSync(readFileSync(join(dir, `${EXE}.blockmap`))).toString("utf8"));
    expect(map.version).toBe("2");
    expect(map.files).toHaveLength(1);
    expect(map.files[0].sizes.reduce((a, b) => a + b, 0)).toBe(70_000);
    expect(map.files[0].sizes.length).toBeGreaterThan(1);
  });

  it("replaces a stale feed and blockmap left by the unsigned build", async () => {
    const dir = dirWithInstaller();
    writeFileSync(join(dir, "latest.yml"), "version: 0.0.1\n");
    writeFileSync(join(dir, `${EXE}.blockmap`), "stale");
    await writeUpdateFeed(dir, VERSION, { now: () => new Date(DATE) });
    expect(readFileSync(join(dir, "latest.yml"), "utf8")).toMatch(/^version: 1\.14\.0$/m);
    expect(readFileSync(join(dir, `${EXE}.blockmap`)).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
  });

  it("throws when the installer is missing, writing nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "latest-yml-"));
    dirs.push(dir);
    await expect(writeUpdateFeed(dir, VERSION)).rejects.toThrow(EXE);
    expect(existsSync(join(dir, "latest.yml"))).toBe(false);
  });
});

describe("the CLI", () => {
  it("exits 0 and writes a feed release:verify's check accepts", () => {
    const dir = dirWithInstaller();
    const r = spawnSync(process.execPath, [CLI, dir, VERSION], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(checkLatestYml(readFileSync(join(dir, "latest.yml"), "utf8"), VERSION, { name: EXE, sha512: SHA512, size: 70_000 })).toEqual([]);
  });

  it("exits 2 on a bad version or a missing installer", () => {
    const dir = dirWithInstaller();
    expect(spawnSync(process.execPath, [CLI, dir, "v1.14.0"], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync(process.execPath, [CLI, dir, "1.15.0"], { encoding: "utf8" }).status).toBe(2);
  });
});
