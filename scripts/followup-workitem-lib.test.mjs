// Unit tests for the open-followups Work item contract.
//
// Same discipline as its siblings: the real-register case is the one that has
// historically found defects, and it asserts a POSITIVE count beside the empty
// violation list — "0 violations" alone passes a scan that read nothing.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  compareWithGitLab,
  GITLAB_PROBLEM_HELP,
  issueSection,
  parseWorkItem,
  workItemLines,
  workItemViolations,
} from "./followup-workitem-lib.mjs";
import { parseEntries, isClosed } from "./followup-claims-lib.mjs";

const entry = (n, title, ...body) => ({ n, title, startLine: 1, body });
const open = (n, ...body) => entry(n, `entry ${n} — open`, ...body);
const codes = (entries) => workItemViolations(entries).map((v) => v.code);
const register = () =>
  readFileSync(path.join(process.cwd(), "docs/open-followups.md"), "utf8");

describe("parseWorkItem", () => {
  it("reads an issue iid", () => {
    expect(parseWorkItem("**Work item:** #123")).toEqual({ kind: "issue", iid: 123 });
  });

  it("reads the decision-record form", () => {
    expect(parseWorkItem("**Work item:** none — decision record")).toEqual({ kind: "decision" });
  });

  it("tolerates trailing whitespace only", () => {
    expect(parseWorkItem("**Work item:** #7  ")).toEqual({ kind: "issue", iid: 7 });
    expect(parseWorkItem("**Work item:** #7.")).toBeNull();
    expect(parseWorkItem("**Work item:** none - decision record")).toBeNull();
    expect(parseWorkItem("**Work item:** #7, #8")).toBeNull();
  });

  it("rejects #0, a leading zero and an iid past ten digits", () => {
    expect(parseWorkItem("**Work item:** #0")).toBeNull();
    expect(parseWorkItem("**Work item:** #012")).toBeNull();
    expect(parseWorkItem("**Work item:** #12345678901")).toBeNull();
  });

  it("accepts one to ten digits", () => {
    expect(parseWorkItem("**Work item:** #1")).toEqual({ kind: "issue", iid: 1 });
    expect(parseWorkItem("**Work item:** #1234567890")).toEqual({ kind: "issue", iid: 1234567890 });
  });
});

describe("issueSection", () => {
  it("reads a §NNN: prefix", () => {
    expect(issueSection("§1: x")).toBe(1);
    expect(issueSection("§531: x")).toBe(531);
  });

  it("rejects §0, a leading zero and a number past ten digits", () => {
    expect(issueSection("§0: x")).toBeNull();
    expect(issueSection("§012: x")).toBeNull();
    expect(issueSection("§12345678901: x")).toBeNull();
  });
});

describe("workItemLines", () => {
  it("does not count a prose mention mid-line", () => {
    expect(workItemLines(open(1, "", "every entry needs a **Work item:** #5 line"))).toEqual([]);
  });

  it("does not count a line inside a fenced block", () => {
    const e = open(1, "", "```md", "**Work item:** #5", "```", "");
    expect(workItemLines(e)).toEqual([]);
  });
});

describe("workItemViolations", () => {
  it("accepts a conforming issue line", () => {
    expect(codes([open(1, "", "**Work item:** #10", "")])).toEqual([]);
  });

  it("accepts a conforming decision record", () => {
    expect(codes([open(1, "", "**Work item:** none — decision record", "")])).toEqual([]);
  });

  it("accepts a closed entry with no line", () => {
    expect(codes([entry(1, "~~done~~ CLOSED", "", "prose")])).toEqual([]);
  });

  it("reports MISSING on an open entry with no line", () => {
    expect(codes([open(1, "", "prose")])).toEqual(["MISSING"]);
  });

  it("reports MISSING when the only mention is fenced", () => {
    expect(codes([open(1, "", "```", "**Work item:** #5", "```")])).toEqual(["MISSING"]);
  });

  it("reports MISSING when the only line is indented or blockquoted", () => {
    expect(codes([open(1, "", "  **Work item:** #4", "")])).toEqual(["MISSING"]);
    expect(codes([open(1, "", "> **Work item:** #4", "")])).toEqual(["MISSING"]);
  });

  it("reports DUPLICATE_LINE on an open entry with two lines", () => {
    expect(codes([open(1, "**Work item:** #10", "**Work item:** #11")])).toEqual([
      "DUPLICATE_LINE",
    ]);
  });

  it("reports DUPLICATE_LINE on a closed entry too", () => {
    expect(codes([entry(1, "x CLOSED", "**Work item:** #10", "**Work item:** #11")])).toContain(
      "DUPLICATE_LINE",
    );
  });

  it("reports MALFORMED on an open entry whose line does not parse", () => {
    expect(codes([open(1, "**Work item:** see GitLab")])).toEqual(["MALFORMED"]);
  });

  it("reports ON_CLOSED when a closed entry carries a line", () => {
    expect(codes([entry(1, "x CLOSED", "**Work item:** #10")])).toEqual(["ON_CLOSED"]);
  });

  it("reports ISSUE_REUSED on every entry claiming the same issue, naming the others", () => {
    const v = workItemViolations([
      open(3, "**Work item:** #42"),
      open(9, "**Work item:** #42"),
      open(4, "**Work item:** #43"),
    ]);
    expect(v.map((x) => [x.n, x.code])).toEqual([
      [3, "ISSUE_REUSED"],
      [9, "ISSUE_REUSED"],
    ]);
    expect(v[0].detail).toMatch(/§9/);
    expect(v[1].detail).toMatch(/§3/);
  });

  it("does not count a closed entry toward ISSUE_REUSED", () => {
    expect(
      codes([open(1, "**Work item:** #42"), entry(2, "x CLOSED", "**Work item:** #42")]),
    ).toEqual(["ON_CLOSED"]);
  });

  // ★★★ AGAINST THE REAL REGISTER, with a positive observable beside the absence.
  it("passes the real register, and actually read its issue lines", () => {
    const entries = parseEntries(register());
    expect(workItemViolations(entries)).toEqual([]);
    const withIssue = entries
      .filter((e) => !isClosed(e.title))
      .filter((e) => workItemLines(e).some((l) => parseWorkItem(l)?.kind === "issue"));
    expect(withIssue.length).toBeGreaterThan(200);
  });
});

describe("compareWithGitLab", () => {
  const linked = (n, iid) => open(n, "", `**Work item:** #${iid}`, "");
  const decision = (n) => open(n, "", "**Work item:** none — decision record", "");
  const issue = (iid, n, labels = ["source::register"]) => ({ iid, title: `§${n}: entry ${n}`, labels });
  const found = (entries, issues) => compareWithGitLab(entries, issues).problems.map((p) => p.code);

  it("reports nothing when every link and every issue agree", () => {
    expect(found([linked(1, 10), linked(2, 20)], [issue(10, 1), issue(20, 2)])).toEqual([]);
  });

  it("ISSUE_NOT_OPEN when the linked issue is not among the open issues", () => {
    const { problems } = compareWithGitLab([linked(1, 10)], []);
    expect(problems).toEqual([{ code: "ISSUE_NOT_OPEN", detail: "§1 → #10, which is not an open issue" }]);
  });

  it("ISSUE_SECTION_MISMATCH when the linked issue is titled for another entry", () => {
    expect(found([linked(1, 10)], [issue(10, 7)])).toEqual(["ISSUE_SECTION_MISMATCH", "ISSUE_WITHOUT_ENTRY"]);
  });

  it("ISSUE_WITHOUT_ENTRY when an issue names a closed entry", () => {
    expect(found([entry(4, "x CLOSED", "")], [issue(40, 4)])).toEqual(["ISSUE_WITHOUT_ENTRY"]);
  });

  it("ISSUE_UNLINKED when the entry is a decision record", () => {
    expect(found([decision(3)], [issue(30, 3)])).toEqual(["ISSUE_UNLINKED"]);
  });

  it("ISSUE_UNLINKED when the entry links a different issue", () => {
    expect(found([linked(3, 31)], [issue(31, 3), issue(30, 3)])).toEqual(
      expect.arrayContaining(["ISSUE_UNLINKED", "SECTION_ON_TWO_ISSUES"]),
    );
  });

  it("does NOT also report ISSUE_UNLINKED for an issue already reported as a mismatch", () => {
    // §5 → #20 but #20 is titled §6; §6 is a decision record. One wrong link, one line.
    expect(found([linked(5, 20), decision(6)], [issue(20, 6)])).toEqual(["ISSUE_SECTION_MISMATCH"]);
  });

  it("SECTION_ON_TWO_ISSUES when two open issues share a §number", () => {
    expect(found([linked(2, 20)], [issue(20, 2), issue(21, 2)])).toEqual(["ISSUE_UNLINKED", "SECTION_ON_TWO_ISSUES"]);
  });

  it("ISSUE_UNTITLED for a register-labelled issue with no §NNN: prefix", () => {
    expect(found([], [{ iid: 9, title: "stray", labels: ["source::register"] }])).toEqual(["ISSUE_UNTITLED"]);
  });

  it("ISSUE_UNLABELLED for a §NNN: issue without the label", () => {
    expect(found([linked(1, 10)], [issue(10, 1, ["bug"])])).toEqual(["ISSUE_UNLABELLED"]);
  });

  it("ignores an open issue with neither the prefix nor the label", () => {
    expect(found([linked(1, 10)], [issue(10, 1), { iid: 99, title: "unrelated", labels: ["bug"] }])).toEqual([]);
  });

  it("skips entries whose Work item line is missing or malformed — the blocking gate's job", () => {
    expect(found([open(1, "prose"), open(2, "**Work item:** see GitLab")], [issue(10, 1), issue(20, 2)])).toEqual([]);
  });

  it("counts open entries, links, decision records and issues", () => {
    const { counts } = compareWithGitLab(
      [linked(1, 10), decision(2), entry(3, "x CLOSED", "")],
      [issue(10, 1), { iid: 99, title: "unrelated", labels: [] }],
    );
    expect(counts).toEqual({ openEntries: 2, linked: 1, decisionRecords: 1, openIssues: 2 });
  });

  it("has help for every code it can emit", () => {
    expect(Object.keys(GITLAB_PROBLEM_HELP).sort()).toEqual(
      [
        "ISSUE_NOT_OPEN",
        "ISSUE_SECTION_MISMATCH",
        "ISSUE_UNLABELLED",
        "ISSUE_UNLINKED",
        "ISSUE_UNTITLED",
        "ISSUE_WITHOUT_ENTRY",
        "SECTION_ON_TWO_ISSUES",
      ].sort(),
    );
  });
});

// ★★★ THE ENTRY POINT'S EXIT CODES, PINNED — copied from the Status gate's test,
// including the floor case that a zero-only guard misses.
describe("check-followup-workitems.mjs exit codes", () => {
  const GATE = path.join(process.cwd(), "scripts", "check-followup-workitems.mjs");

  const runAgainst = (registerText) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "followup-workitems-"));
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "open-followups.md"), registerText, "utf8");
    return spawnSync(process.execPath, [GATE], { cwd: dir, encoding: "utf8", shell: false });
  };

  const conforming = (n) => `## ${n}. entry ${n} — open

**Work item:** #${n}

`;

  const manyConforming = (count) => {
    let out = `# register

`;
    for (let i = 1; i <= count; i++) out += conforming(i);
    return out;
  };

  it("exits 2 when the register is missing entirely", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "followup-workitems-"));
    const r = spawnSync(process.execPath, [GATE], { cwd: dir, encoding: "utf8", shell: false });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/CANNOT SCAN/);
  });

  it("exits 2 when only a handful parse — the floor, not just zero", () => {
    const r = runAgainst(`${conforming(1)}## 2) not a heading the parser knows

body
`);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/floor is 50/);
  });

  it("exits 1 on drift once enough entries parse", () => {
    const r = runAgainst(`${manyConforming(60)}## 61. an entry with no Work item line — open

body
`);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/MISSING/);
  });

  it("exits 0 when every parsed entry conforms", () => {
    const r = runAgainst(manyConforming(60));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/All open entries carry exactly one conforming Work item line/);
  });
});
