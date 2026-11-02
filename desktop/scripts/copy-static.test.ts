// @vitest-environment node
// desktop:copy-static against a throwaway build tree: what it copies, what it leaves out.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./copy-static.mjs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "copy-static-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function writeTree(name: string): string {
  const root = join(tmp, name);
  writeFiles(root, {
    ".next/standalone/server.js": "entry",
    ".next/static/chunks/app.css": "css",
    ".next/static/chunks/client.js": "client",
    ".next/static/chunks/client.js.map": "MAP",
    "public/app.ico": "icon",
    "public/legacy.js.map": "MAP",
    "notices/THIRD-PARTY-NOTICES.txt": "NOTICES TEXT",
  });
  return root;
}

const run = (cwd: string, args: string[] = []) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

describe("desktop:copy-static", () => {
  it("copies static and public into the standalone tree, with no source map (exit 0)", () => {
    const root = writeTree("plain");
    const r = run(root);
    expect(r.status, r.stderr).toBe(0);
    const standalone = join(root, ".next", "standalone");
    expect(readFileSync(join(standalone, ".next", "static", "chunks", "client.js"), "utf8")).toBe("client");
    expect(readFileSync(join(standalone, "public", "app.ico"), "utf8")).toBe("icon");
    expect(filesUnder(standalone).filter((f) => f.endsWith(".map"))).toEqual([]);
    // Without --notices, nothing is invented in public/.
    expect(existsSync(join(standalone, "public", "third-party-notices.txt"))).toBe(false);
  });

  it("puts --notices into the standalone public/ as third-party-notices.txt", () => {
    const root = writeTree("notices");
    const r = run(root, ["--notices", "notices/THIRD-PARTY-NOTICES.txt"]);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(root, ".next", "standalone", "public", "third-party-notices.txt"), "utf8")).toBe("NOTICES TEXT");
    // The repository's own public/ is left alone.
    expect(existsSync(join(root, "public", "third-party-notices.txt"))).toBe(false);
  });

  it("exits 1 naming a --notices file that does not exist", () => {
    const root = writeTree("no-notices");
    const r = run(root, ["--notices", "notices/missing.txt"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing\.txt/);
  });
});
