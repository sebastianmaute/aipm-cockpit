// @vitest-environment node
// The tooltip ratchet's CLI paths (§109): pass, growth, --update (tightening
// only), the scan floor and an unreadable baseline. Sources are injected; the
// baseline is a real temp file, since reading and rewriting it is the CLI's job.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSources, run } from "./check-tooltips.mjs";

const UNTITLED = `<button aria-label="Close"><XIcon /></button>`;
const TITLED = `<button aria-label="Close" title="Close"><XIcon /></button>`;
const tsx = (...els) => `export const X = () => (<div>${els.join("")}</div>);\n`;

let dir;
let baselinePath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tooltips-check-"));
  baselinePath = join(dir, "baseline.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function cli(argv, sources, baseline) {
  if (baseline !== undefined) writeFileSync(baselinePath, typeof baseline === "string" ? baseline : JSON.stringify(baseline));
  const out = [];
  const err = [];
  const code = run(argv, {
    files: Object.keys(sources),
    read: (f) => sources[f],
    baselinePath,
    minScanned: 1,
    log: (l) => out.push(l),
    error: (l) => err.push(l),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("check-tooltips run()", () => {
  it("passes when every file is within its allowance", () => {
    const r = cli([], { "a.tsx": tsx(UNTITLED, TITLED), "b.tsx": tsx(TITLED) }, { "a.tsx": 1 });
    expect(r.code).toBe(0);
    expect(r.out).toContain("3 button-family elements scanned, 1 icon-only without a title, in 1 files");
    expect(r.err).toBe("");
  });

  it("exits 1 and names the file when a file grows, and when a new file has any", () => {
    const r = cli([], { "a.tsx": tsx(UNTITLED, UNTITLED), "new.tsx": tsx(UNTITLED) }, { "a.tsx": 1 });
    expect(r.code).toBe(1);
    expect(r.err).toContain("GREW a.tsx: 2 icon-only control(s) without a title, baseline allows 1");
    expect(r.err).toContain("GREW new.tsx: 1");
  });

  it("--list prints every untitled site with its line", () => {
    const r = cli(["--list"], { "a.tsx": tsx(UNTITLED) }, { "a.tsx": 1 });
    expect(r.out).toContain("a.tsx:1\tbutton\tnamed=true");
  });

  it("--update tightens the baseline to today's counts and drops files at zero", () => {
    const r = cli(["--update"], { "b.tsx": tsx(UNTITLED), "a.tsx": tsx(TITLED) }, { "a.tsx": 2, "b.tsx": 3 });
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(baselinePath, "utf8"))).toEqual({ "b.tsx": 1 });
  });

  it("--update is refused while any file grew, and leaves the baseline alone", () => {
    const before = JSON.stringify({ "a.tsx": 0 });
    const r = cli(["--update"], { "a.tsx": tsx(UNTITLED) }, before);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--update refused");
    expect(readFileSync(baselinePath, "utf8")).toBe(before);
  });

  it("without --update, a shrunken file passes and says the baseline can be tightened", () => {
    const r = cli([], { "a.tsx": tsx(TITLED) }, { "a.tsx": 2 });
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 file(s) below the baseline; tighten it with --update");
    expect(JSON.parse(readFileSync(baselinePath, "utf8"))).toEqual({ "a.tsx": 2 });
  });

  it("exits 2 when the scan reads fewer elements than the floor", () => {
    const err = [];
    const code = run([], { files: ["a.tsx"], read: () => tsx(UNTITLED), baselinePath, minScanned: 2, log: () => {}, error: (l) => err.push(l) });
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("scanned only 1 button-family elements (floor 2); could not scan");
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "{oops"],
    ["an array", "[]"],
    ["null", "null"],
  ])("exits 2 when the baseline is %s", (_label, content) => {
    const r = cli([], { "a.tsx": tsx(TITLED) }, content);
    expect(r.code).toBe(2);
    expect(r.err).toContain("cannot read");
  });
});

describe("listSources", () => {
  it("walks recursively, keeps .tsx, drops .test.tsx and other files, and uses forward slashes", () => {
    mkdirSync(join(dir, "app", "sub"), { recursive: true });
    for (const f of ["app/a.tsx", "app/a.test.tsx", "app/b.ts", "app/sub/c.tsx"]) writeFileSync(join(dir, f), "");
    const root = join(dir, "app");
    expect(listSources(root)).toEqual([`${root}/a.tsx`, `${root}/sub/c.tsx`].map((p) => p.replace(/\\/g, "/")));
  });
});
