// Unit tests for the source-comment symbol report's parsing layer.
//
// ★★ EVERY DEFECT THIS REPO'S DOC GATES HAVE SHIPPED WAS A PARSING DEFECT, and
// every one was found by running the parser against real input rather than by
// reading it. The same applies here: the interesting cases are the block-comment
// TERMINATOR, a name inside a `grep` invocation, and the code-vs-comment split
// that the whole report rests on.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  citationsInDiff,
  citedNamesOnLine,
  collectCodeIdentifiersFromFile,
  CONTROL_ABSENT,
  CONTROL_PRESENT,
  isCommentLine,
  REPORT_SELF_FILES,
} from "./src-symbols-lib.mjs";

function withTempFile(contents, ext, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "src-symbols-"));
  const file = path.join(dir, `fixture${ext}`);
  fs.writeFileSync(file, contents, "utf8");
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("isCommentLine", () => {
  it("accepts the three comment shapes", () => {
    expect(isCommentLine("// a line comment")).toBe(true);
    expect(isCommentLine("  /* a block opener")).toBe(true);
    expect(isCommentLine("   * a jsdoc continuation")).toBe(true);
  });

  // ★★★ THE TERMINATOR IS THE TRAP. `*` matching greedily would harvest every
  //   block-comment closing line, which is where trailing prose most often sits.
  it("rejects the block terminator, which a bare * would match", () => {
    expect(isCommentLine("   */")).toBe(false);
    expect(isCommentLine(" */")).toBe(false);
  });

  it("rejects code", () => {
    expect(isCommentLine("const x = 1;")).toBe(false);
    expect(isCommentLine("  return a * b;")).toBe(false);
  });
});

describe("citedNamesOnLine", () => {
  // ★★★ THE CASE THE REAL INCIDENT SAT IN. `requireRowAndToken` was inside a
  //   backticked `grep` command, not alone in its own span — so requiring the
  //   whole span to be one identifier would have missed it entirely.
  it("takes identifiers out of a backticked command, not just a bare span", () => {
    const line = '// reproduce: `grep -n "requireToken(\\|myInventedName(" src/app/x.ts`';
    expect(citedNamesOnLine(line)).toContain("myInventedName");
  });

  it("applies the gate's own predicate: mixed case, longer than three chars", () => {
    // SCREAMING_CASE is out of scope for the gate and therefore out of scope here
    // — a shared blind spot, deliberately, so the two cannot disagree.
    expect(citedNamesOnLine("// `SOME_CONSTANT` and `abc` and `config`")).toEqual([]);
    expect(citedNamesOnLine("// `sanitizeText`")).toEqual(["sanitizeText"]);
  });

  it("ignores prose outside backticks", () => {
    expect(citedNamesOnLine("// this mentions sanitizeText without backticks")).toEqual([]);
  });
});

describe("collectCodeIdentifiersFromFile", () => {
  // ★★★ THE PROPERTY THE WHOLE REPORT RESTS ON, and the one that separates it
  //   from `check-agents-symbols.mjs`. A first cut of this report built its
  //   universe from raw file text, which made a name surviving only in a comment
  //   "exist" — so the invented name resolved against its own docstring and the
  //   report found nothing. This test fails if that regression returns.
  it("reads code and string literals but NOT comments", () => {
    const src = [
      "// commentOnlyName is mentioned here",
      "/** and `anotherCommentName` here */",
      'const realIdentifier = "literalWordInside";',
      "export function alsoReal() { return realIdentifier; }",
    ].join("\n");
    const found = withTempFile(src, ".ts", (file) => {
      const into = new Set();
      collectCodeIdentifiersFromFile(file, into);
      return into;
    });
    expect(found.has("realIdentifier")).toBe(true);
    expect(found.has("alsoReal")).toBe(true);
    // The gate's stated objection to stripping comments was that literal/key
    // names would go missing. They do not: literals are collected explicitly.
    expect(found.has("literalWordInside")).toBe(true);
    expect(found.has("commentOnlyName")).toBe(false);
    expect(found.has("anotherCommentName")).toBe(false);
  });

  it("parses tsx", () => {
    const found = withTempFile(
      "export const El = () => <div className=\"someClass\">{valueRef}</div>;",
      ".tsx",
      (file) => {
        const into = new Set();
        collectCodeIdentifiersFromFile(file, into);
        return into;
      },
    );
    expect(found.has("valueRef")).toBe(true);
  });
});

describe("citationsInDiff", () => {
  it("reads added comment lines only", () => {
    const diff = [
      "+++ b/src/app/thing.ts",
      "@@ -1,0 +1,3 @@",
      "+// cites `addedName` here",
      "-// cites `removedName` here",
      " // cites `contextName` here",
      "+const notAComment = `templateName`;",
    ].join("\n");
    const names = citationsInDiff(diff).map((c) => c.name);
    expect(names).toContain("addedName");
    expect(names).not.toContain("removedName");
    expect(names).not.toContain("contextName");
    expect(names).not.toContain("templateName");
  });

  it("attributes a citation to the file its hunk header named", () => {
    const diff = ["+++ b/src/app/one.ts", "+// `someName`"].join("\n");
    expect(citationsInDiff(diff)[0].file).toBe("src/app/one.ts");
  });

  // The `+++` header itself starts with `+` and must never be read as content.
  it("does not treat the +++ header as an added line", () => {
    const diff = ["+++ b/src/app/`weirdName`.ts", "+// nothing cited"].join("\n");
    expect(citationsInDiff(diff)).toEqual([]);
  });
});

describe("REPORT_SELF_FILES", () => {
  // ★★★ THE REPORT CANNOT DETECT ITS OWN DAMAGE. Dropping an entry makes it find
  //   FEWER unresolved names and still exit 0, so a healthy run and a defeated
  //   one look identical from outside. This test is the detector, exactly as
  //   `agents-symbols-lib.test.mjs` is for the gate.
  it("lists every file that quotes the names the report exists to catch", () => {
    const names = [...REPORT_SELF_FILES].map((p) => path.basename(p)).sort();
    expect(names).toEqual([
      "check-src-symbols.mjs",
      "src-symbols-lib.mjs",
      "src-symbols-lib.test.mjs",
    ]);
  });

  // ★★★ THE EXCLUSION IS PROVED BY ITS MECHANISM, NOT BY A FILE COUNT. An earlier
  //   version of this test asserted that at least TWO entries quote a control
  //   name; running it refuted that — exactly ONE does today (the lib, which
  //   declares CONTROL_ABSENT as string literals), while the CLI and this test
  //   reach those names through an IMPORT and contribute nothing. The count was
  //   invented rather than measured, which is the failure this whole report
  //   exists to catch, committed inside the report's own test.
  it("excluding the lib is load-bearing: scanning it would defeat the control", () => {
    const poisoners = [...REPORT_SELF_FILES].filter((file) => {
      const into = new Set();
      try {
        collectCodeIdentifiersFromFile(file, into);
      } catch {
        return false;
      }
      return CONTROL_ABSENT.some((n) => into.has(n));
    });
    // Exact, not a floor: if a second file starts quoting a control name we want
    // to know, and if this one stops the control has lost its only real threat.
    expect(poisoners.map((p) => path.basename(p))).toEqual(["src-symbols-lib.mjs"]);
  });

  // ★★ The other two entries are DEFENSIVE, and saying so beats implying they are
  //    load-bearing. They are inert today; they are listed because a file whose
  //    job is to name the report's own probe names is one edit away from quoting
  //    one literally, and the failure would be silent.
  it("the defensive entries are inert today, and that is recorded not hidden", () => {
    const inert = [...REPORT_SELF_FILES].filter((file) => {
      const into = new Set();
      try {
        collectCodeIdentifiersFromFile(file, into);
      } catch {
        return false;
      }
      return !CONTROL_ABSENT.some((n) => into.has(n));
    });
    expect(inert.map((p) => path.basename(p)).sort()).toEqual([
      "check-src-symbols.mjs",
      "src-symbols-lib.test.mjs",
    ]);
  });
});

describe("the control names", () => {
  it("names something absent and something present", () => {
    expect(CONTROL_ABSENT.length).toBeGreaterThanOrEqual(2);
    expect(CONTROL_PRESENT.length).toBeGreaterThanOrEqual(2);
  });
});
