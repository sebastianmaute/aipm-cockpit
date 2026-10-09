// §687 — the click-through cell look (a borderless box that outlines in dark
// blue on hover) lives in one constant, `CELL_BUTTON`, and nowhere else.
// Reads every non-test `.tsx` under src/app as text: the look is a class string,
// so a string match is the right granularity here.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CELL_BUTTON } from "./control-classes";

const APP = join(process.cwd(), "src", "app");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) out.push(p);
  }
  return out;
}

// The look's two defining tokens in one class string.
const HAND_ROLLED = /border-transparent[^"`]*hover:border-ui-dark-blue|hover:border-ui-dark-blue[^"`]*border-transparent/;

describe("click-through cell sweep (§687)", () => {
  const files = tsxFiles(APP);
  const users = files.filter((f) => readFileSync(f, "utf8").includes("CELL_BUTTON"));

  it("reads the whole app, and the constant has users (positive control)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(users.length).toBeGreaterThanOrEqual(14);
  });

  it("carries the look in CELL_BUTTON", () => {
    expect(CELL_BUTTON).toMatch(HAND_ROLLED);
  });

  it("leaves no hand-written copy of the look in any component", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (HAND_ROLLED.test(line)) hits.push(`${relative(APP, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
