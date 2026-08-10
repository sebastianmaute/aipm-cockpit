// Unit tests for the open-followups gate's parsing layer.
//
// Same discipline as `doc-claims-lib.test.mjs`: every defect the sibling gate
// shipped was a regex defect, and both were found by running it against the
// real docs rather than by reading it. Each `regression:` test names what it
// pins.
import { describe, expect, it } from "vitest";
import {
  classify,
  fencedLines,
  isClosed,
  parseEntries,
  reproCommandsIn,
  symbolsIn,
} from "./followup-claims-lib.mjs";

const REGISTER_SAMPLE = [
  "# Open follow-ups — central register",
  "",
  "intro prose that belongs to no entry",
  "",
  "## 1. A live problem — open",
  "body of one, naming `resolveEntitySave` and `src/app/types.ts`",
  "",
  "### What is actually true",
  "a sub-heading does NOT end the entry",
  "",
  "## 2. ~~A fixed problem~~ — CLOSED post-0.212.0",
  "body of two",
  "",
  "## Decided — do not re-litigate",
  "this section is not an entry and its prose is not entry 2's body",
  "",
  "## 3. Another live one — open",
  "```bash",
  "grep -c 'foo' src/app/bar.ts",
  "```",
].join("\n");

describe("parseEntries", () => {
  const entries = parseEntries(REGISTER_SAMPLE);

  it("finds only numbered level-2 headings", () => {
    expect(entries.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it("regression: a `###` sub-heading does not end an entry", () => {
    expect(entries[0].body.join("\n")).toContain("a sub-heading does NOT end the entry");
  });

  it("regression: a non-numbered `##` section ends the entry and is not one", () => {
    // The register carries three of these. Folding their prose into the entry
    // above would attribute unrelated claims to that entry.
    expect(entries[1].body.join("\n")).not.toContain("this section is not an entry");
    expect(entries.map((e) => e.n)).not.toContain(NaN);
  });

  it("records the heading's line number for reporting", () => {
    expect(entries[0].startLine).toBe(5);
  });
});

describe("isClosed", () => {
  it("reads CLOSED and strikethrough from the heading", () => {
    expect(isClosed("A fixed problem — CLOSED post-0.212.0")).toBe(true);
    expect(isClosed("~~A fixed problem~~ — done")).toBe(true);
  });

  it("does not read the word 'closed' inside an ordinary sentence", () => {
    expect(isClosed("The popover is never closed on Escape — open")).toBe(false);
  });
});

describe("symbolsIn", () => {
  it("extracts backticked mixed-case identifiers", () => {
    expect(symbolsIn("naming `resolveEntitySave` and `x`")).toEqual(["resolveEntitySave"]);
  });

  it("regression: ignores a path — that is the citation check's job", () => {
    expect(symbolsIn("see `src/app/types.ts` for the shape")).toEqual([]);
  });
});

describe("fencedLines / reproCommandsIn", () => {
  it("returns fenced content, without the fence delimiters", () => {
    expect(fencedLines(REGISTER_SAMPLE)).toEqual(["grep -c 'foo' src/app/bar.ts"]);
  });

  it("regression: reuses the hardened fence parser, so a blockquoted fence works", () => {
    // `stripFencedBlocks` handles blockquoted, tilde and nested fences. Writing
    // a second fence parser here is how the two would drift.
    const doc = "## 9. x — open\n> ```bash\n> grep -c foo src/a.ts\n> ```";
    expect(fencedLines(doc).length).toBeGreaterThan(0);
  });

  it("keeps only allowlisted commands", () => {
    const cmds = reproCommandsIn(
      "## 9. x\n```bash\ngrep -c foo src/a.ts\nrm -rf /\nnpm run test:run\n```",
    );
    expect(cmds).toEqual(["grep -c foo src/a.ts", "npm run test:run"]);
  });

  it("★★★ never returns a command with shell metacharacters", () => {
    // These are executed. A pipe, a redirect or a `;` would be passed to a
    // shell that this harness deliberately never spawns — and a piped command
    // would report the PIPE's exit status, which is the failure mode AGENTS.md
    // records at three stars.
    const cmds = reproCommandsIn("## 9. x\n```bash\ngrep -c foo src/a.ts | wc -l\n```");
    expect(cmds).toEqual([]);
  });
});

describe("classify", () => {
  const env = {
    knownSymbols: new Set(["resolveEntitySave"]),
    resolve: (p) => (p === "src/app/types.ts" ? [p] : []),
    lineCounts: new Map([["src/app/types.ts", 900]]),
  };

  it("CLEAN when every symbol resolves and every path exists", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `resolveEntitySave` in `src/app/types.ts`");
    expect(classify(entry, env).verdict).toBe("CLEAN");
  });

  it("SYMBOL_MISSING names the symbol that vanished", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `migrateTaskStatus` today");
    const r = classify(entry, env);
    expect(r.verdict).toBe("SYMBOL_MISSING");
    expect(r.problems[0].detail).toBe("migrateTaskStatus");
  });

  it("PATH_MISSING when a named file has left the tree", () => {
    const [entry] = parseEntries("## 1. x — open\nlives in `src/app/deleted.ts`");
    expect(classify(entry, env).verdict).toBe("PATH_MISSING");
  });

  it("CITE_BROKEN when a cite is past end of file", () => {
    const [entry] = parseEntries("## 1. x — open\nsee `src/app/types.ts:5000`");
    expect(classify(entry, env).verdict).toBe("CITE_BROKEN");
  });

  it("NO_MACHINE_CLAIM when the entry asserts nothing checkable", () => {
    // Not a failure. A large share of the register is a11y and CSS-geometry
    // work that no static check can judge; saying so routes it to a probe
    // instead of pretending it passed.
    const [entry] = parseEntries("## 1. x — open\nthe spacing feels wrong on dark schemes");
    expect(classify(entry, env).verdict).toBe("NO_MACHINE_CLAIM");
  });

  it("★★ CLEAN is not a pass — it means nothing static could disprove it", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `resolveEntitySave`");
    expect(classify(entry, env).needsProbe).toBe(true);
  });
});
