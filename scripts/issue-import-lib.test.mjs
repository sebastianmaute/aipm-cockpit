// Unit tests for the issue-import planner. Synthetic registers and a synthetic leak
// list only — never the real list.
import { describe, expect, it } from "vitest";
import {
  BODY_CAP,
  PLACEHOLDER_TITLE,
  TITLE_CAP,
  entryTitle,
  issueBody,
  leakCheckPlan,
  parseIndexAnchors,
  planImport,
  stubIssue,
} from "./issue-import-lib.mjs";
import { buildPatterns } from "./identifier-leak-lib.mjs";

const REG = [
  "# Open follow-ups",
  "",
  "<!-- INDEX:BEGIN -->",
  "| [§3](#3-three--open) | three — open | x | S | open |",
  "| [§4](#4-four--closed-2026-09-01) | four — CLOSED 2026-09-01 | x | S | closed |",
  "<!-- INDEX:END -->",
  "",
  "## 3. Three — open",
  "",
  "**Status:** open 2026-09-20 — measured once.",
  "",
  "**Work item:** #3",
  "",
  "First paragraph of three.",
  "",
  "Second paragraph.",
  "",
  "## 4. Four — CLOSED 2026-09-01",
  "",
  "**Status:** CLOSED 2026-09-01.",
  "",
].join("\n");
const OPTS = { repoUrl: "https://github.com/o/r", pointerStyle: "anchor", date: "2026-09-30" };
const gl = (iid, state, title, labels = ["source::register"]) => ({ iid, state, title, labels });

describe("parseIndexAnchors", () => {
  it("maps each index row's § to its anchor", () => {
    const m = parseIndexAnchors(REG);
    expect(m.get(3)).toBe("3-three--open");
    expect(m.get(4)).toBe("4-four--closed-2026-09-01");
    expect(m.size).toBe(2);
  });
});

describe("entryTitle", () => {
  it("drops the trailing open marker and prefixes §N", () => {
    expect(entryTitle({ n: 3, title: "Three — open" })).toBe("§3: Three");
  });
  it("caps at TITLE_CAP characters", () => {
    expect(entryTitle({ n: 3, title: "x".repeat(400) + " — open" }).length).toBe(TITLE_CAP);
  });
});

describe("issueBody", () => {
  const entry = {
    n: 3,
    title: "Three — open",
    body: ["", "**Status:** open 2026-09-20 — measured once.", "", "**Work item:** #3", "", "First paragraph of three.", "", "Second paragraph."],
  };
  it("carries the pointer, the status, the first paragraph and the footer — and not the second paragraph", () => {
    const b = issueBody(entry, { ...OPTS, n: 3, anchor: "3-three--open" });
    expect(b).toContain("https://github.com/o/r/blob/main/docs/open-followups.md#3-three--open");
    expect(b).toContain("**Status:** open 2026-09-20 — measured once.");
    expect(b).toContain("First paragraph of three.");
    expect(b).not.toContain("Second paragraph.");
    expect(b).not.toContain("**Work item:**");
    expect(b).toContain("Imported from GitLab #3 on 2026-09-30.");
  });
  it("uses the search pointer when the register cannot be linked by anchor", () => {
    const b = issueBody(entry, { ...OPTS, pointerStyle: "search", n: 3, anchor: "3-three--open" });
    expect(b).not.toContain("#3-three--open");
    expect(b).toContain("search for `## 3.`");
  });
  it("caps the body and marks the cut", () => {
    const long = { ...entry, body: ["**Status:** " + "y".repeat(BODY_CAP * 2)] };
    const b = issueBody(long, { ...OPTS, n: 3, anchor: "a" });
    expect(b.length).toBeLessThanOrEqual(BODY_CAP);
    expect(b).toContain("(cut — read the full entry in the register)");
  });
});

describe("stubIssue", () => {
  it("names the closed entry when the GitLab title carries §N, and copies no GitLab text", () => {
    const s = stubIssue(gl(40, "closed", "§12: some internal words"));
    expect(s.title).toBe("GitLab #40, closed before the migration");
    expect(s.body).toContain("§12");
    expect(s.body).not.toContain("internal words");
  });
  it("uses a fixed sentence when the title carries no §N", () => {
    const s = stubIssue(gl(41, "closed", "anything at all"));
    expect(s.body).not.toContain("anything");
  });
});

describe("planImport", () => {
  it("emits one action per number 1..max: placeholder, open, stub", () => {
    const acts = planImport([gl(3, "opened", "§3: old gitlab title"), gl(4, "closed", "§4: x")], REG, OPTS);
    expect(acts.map((a) => [a.n, a.kind])).toEqual([
      [1, "placeholder"],
      [2, "placeholder"],
      [3, "open"],
      [4, "stub"],
    ]);
    expect(acts[2].title).toBe("§3: Three");
    expect(acts[2].labels).toEqual(["source::register"]);
    expect(acts[3].labels).toEqual([]);
    expect(acts[0].title).toBe(PLACEHOLDER_TITLE);
  });
  it("throws when an open issue's § has no OPEN entry", () => {
    expect(() => planImport([gl(4, "opened", "§4: x")], REG, OPTS)).toThrow(/#4.*§4/);
  });
  it("throws when an open issue has no §N title", () => {
    expect(() => planImport([gl(3, "opened", "no section")], REG, OPTS)).toThrow(/#3/);
  });
  it("throws on a duplicate GitLab number", () => {
    expect(() => planImport([gl(3, "opened", "§3: a"), gl(3, "opened", "§3: a")], REG, OPTS)).toThrow(/twice/);
  });
});

describe("leakCheckPlan", () => {
  const patterns = buildPatterns(["@synthetic-class secretword"]);
  it("counts a hit in a title or body and names the action, never the text", () => {
    const acts = [
      { n: 1, kind: "open", title: "§1: clean", body: "clean", labels: [] },
      { n: 2, kind: "open", title: "§2: x", body: "has secretword inside", labels: [] },
    ];
    const r = leakCheckPlan(acts, patterns);
    expect(r).toEqual({ hitLines: 1, classes: { "synthetic-class": 1 }, actionsHit: [2] });
    expect(JSON.stringify(r)).not.toContain("secretword");
  });
  it("is zero on a clean plan", () => {
    expect(leakCheckPlan([{ n: 1, kind: "stub", title: "a", body: "b", labels: [] }], patterns).hitLines).toBe(0);
  });
});
