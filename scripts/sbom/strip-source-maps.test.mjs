// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { mapFiles } from "./bundled-packages.mjs";

const CLI = fileURLToPath(new URL("./strip-source-maps.mjs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "strip-maps-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** A `.next` as a release build leaves it: maps in both roots and in the standalone copy. */
function writeBuild(name, extra = {}) {
  const repo = join(tmp, name);
  writeFiles(repo, {
    ".next/server/app/page.js": "server",
    ".next/server/app/page.js.map": "SERVER MAP",
    ".next/static/chunks/client.js": "client",
    ".next/static/chunks/client.js.map": "CLIENT MAP",
    ".next/static/chunks/app.css": "css",
    ".next/standalone/server.js": "entry",
    ".next/standalone/.next/server/app/page.js": "server",
    ".next/standalone/.next/server/app/page.js.map": "SERVER MAP COPY",
    ".next/standalone/node_modules/next/dist/compiled/x/index.js.map": "PACKAGE MAP",
    ...extra,
  });
  return repo;
}

function runCli(cwd, args = ["--build", ".next", "--keep", "kept-maps"]) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

describe("strip-source-maps", () => {
  it("moves the build's maps to --keep, deletes the standalone copies, and leaves every other file (exit 0)", async () => {
    const repo = writeBuild("good");
    const { code, stdout, stderr } = await runCli(repo);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("moved 1 from server/, 1 from static/ to kept-maps; deleted 2 under standalone/");
    expect(await mapFiles(join(repo, ".next"))).toEqual([]);
    expect(readFileSync(join(repo, "kept-maps", "server", "app", "page.js.map"), "utf8")).toBe("SERVER MAP");
    expect(readFileSync(join(repo, "kept-maps", "static", "chunks", "client.js.map"), "utf8")).toBe("CLIENT MAP");
    for (const kept of [".next/server/app/page.js", ".next/static/chunks/client.js", ".next/static/chunks/app.css", ".next/standalone/server.js"]) {
      expect(existsSync(join(repo, ...kept.split("/"))), kept).toBe(true);
    }
  });

  it("exits 1 naming a map root that held no map, as a build without SBOM_SOURCE_MAPS=1 leaves it", async () => {
    const repo = writeBuild("no-browser-maps");
    rmSync(join(repo, ".next", "static", "chunks", "client.js.map"));
    const { code, stderr } = await runCli(repo);
    expect(code).toBe(1);
    expect(stderr).toMatch(/no source map under \.next[/\\]static — build with SBOM_SOURCE_MAPS=1/);
  });

  it("exits 2 on a missing argument", async () => {
    const { code, stderr } = await runCli(writeBuild("no-arg"), ["--build", ".next"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/usage/);
  });
});
