// Unit tests for the open-followups Status-line contract.
//
// Same discipline as its siblings: every defect this family of gates has
// shipped was a regex defect, and both were found by running against the real
// docs rather than by reading the code. So the last case here runs the contract
// over the real register.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  statusBlock,
  statusViolations,
  closedDate,
  isGatedClosed,
  closedStatusViolations,
  entryViolations,
  CLOSED_CUTOFF,
} from "./followup-status-lib.mjs";
import { parseEntries, isClosed } from "./followup-claims-lib.mjs";

const entry = (...body) => ({ n: 1, title: "t", startLine: 1, body });
const register = () =>
  readFileSync(path.join(process.cwd(), "docs/open-followups.md"), "utf8");

describe("statusBlock", () => {
  it("returns null when there is no Status line", () => {
    expect(statusBlock(entry("", "some prose", ""))).toBeNull();
  });

  // ★★ Status lines WRAP. A single-line regex reads only the first physical
  // line and would miss a date or a command on the second, failing a
  // conformant entry -- the expensive direction for a blocking gate.
  it("runs to the next blank line, not the next newline", () => {
    const b = statusBlock(entry("", "**Status:** open — filed", "2026-08-28.", "", "prose"));
    expect(b).toBe("**Status:** open — filed\n2026-08-28.");
  });
});

describe("statusViolations", () => {
  it("reports MISSING when there is no Status line", () => {
    expect(statusViolations(entry("", "prose"))).toEqual(["MISSING"]);
  });

  it("accepts a line with a date and a backticked command", () => {
    expect(
      statusViolations(entry("", "**Status:** open — 2026-08-28, `grep -n foo src`.")),
    ).toEqual([]);
  });

  it("accepts the explicit never-verified escape", () => {
    expect(
      statusViolations(entry("", "**Status:** open — 2026-08-28, never machine-verified.")),
    ).toEqual([]);
  });

  // ★★★ THE MEASURED CASE. A backticked FILENAME is not a verification, and a
  // rule accepting any backticked span admitted 10 entries that named none --
  // certifying the exact silence this contract exists to end.
  it("does not accept a backticked filename as a verification", () => {
    expect(
      statusViolations(entry("", "**Status:** open — 2026-08-28, see `documents-list.tsx`.")),
    ).toContain("NO_VERIFICATION");
  });

  it("rejects a Status line claiming closure — the heading owns that", () => {
    expect(
      statusViolations(entry("", "**Status:** CLOSED 2026-08-28, `grep -n foo src`.")),
    ).toContain("SAYS_CLOSED");
  });

  it("rejects a line with no date", () => {
    expect(statusViolations(entry("", "**Status:** open — `grep -n foo src`."))).toContain(
      "NO_DATE",
    );
  });

  it("rejects a line naming no verification at all", () => {
    expect(statusViolations(entry("", "**Status:** open — 2026-08-28."))).toContain(
      "NO_VERIFICATION",
    );
  });

  // ★★★ AGAINST THE REAL REGISTER, which is where every defect in this gate
  // family has actually been found.
  it("passes every open entry in the real register", () => {
    const entries = parseEntries(register()).filter((e) => !isClosed(e.title));
    expect(entries.length).toBeGreaterThan(0); // vacuity guard
    const bad = entries
      .map((e) => ({ n: e.n, v: statusViolations(e) }))
      .filter((x) => x.v.length > 0);
    expect(bad).toEqual([]);
  });

  // ★★ A CLOSED entry is out of scope by construction, and this pins that the
  // gate's own filter is what excludes it -- not luck about how closed entries
  // happen to be written.
  it("is not applied to closed entries", () => {
    const closed = parseEntries(register()).filter((e) => isClosed(e.title));
    expect(closed.length).toBeGreaterThan(0);
  });
});

// §429: entries CLOSED on or after the cutoff are gated; earlier closures are not.
// POSITIVE CONTROLS FIRST -- the predicate must be able to pass before a failure means anything.
describe("closed-entry gate (§429)", () => {
  const titled = (title, ...body) => ({ n: 1, title, startLine: 1, body });
  const REAL = "A thing that was fixed — CLOSED ";
  const goodStatus = "**Status:** CLOSED 2026-10-05 — fixed; `npx vitest run foo.test.ts`.";

  it("control: the cutoff is the day after the batch that introduced the rule", () => {
    expect(CLOSED_CUTOFF).toBe("2026-10-04");
  });

  it("control: closed after the cutoff with a real command is clean", () => {
    const e = titled(REAL + "2026-10-05", "", goodStatus);
    expect(isGatedClosed(e.title)).toBe(true);
    expect(entryViolations(e)).toEqual([]);
  });

  it("control: an open entry still follows the open contract (never-verified escape works)", () => {
    const ok = titled("open thing — open", "", "**Status:** open — 2026-10-05, never machine-verified.");
    expect(entryViolations(ok)).toEqual([]);
    const bad = titled("open thing — open", "", "**Status:** CLOSED 2026-10-05, `grep -n x y`.");
    expect(entryViolations(bad)).toEqual(["SAYS_CLOSED"]);
  });

  it("flags a closure whose Status names only a backticked filename", () => {
    const e = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — see `documents-list.tsx`.");
    expect(entryViolations(e)).toEqual(["NO_VERIFICATION"]);
  });

  it("does not accept the never-machine-verified escape on a closure", () => {
    const e = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — never machine-verified.");
    expect(closedStatusViolations(e)).toEqual(["NO_VERIFICATION"]);
  });

  it("inverts SAYS_CLOSED: a closure whose Status does not open with CLOSED is flagged", () => {
    const e = titled(REAL + "2026-10-05", "", "**Status:** open — 2026-10-05, `grep -n x y`.");
    expect(closedStatusViolations(e)).toEqual(["NOT_SAYS_CLOSED"]);
  });

  it("flags a closure with no Status line and one with no date", () => {
    expect(entryViolations(titled(REAL + "2026-10-05", "", "prose"))).toEqual(["MISSING"]);
    const nd = titled(REAL + "2026-10-05", "", "**Status:** CLOSED — `grep -n x y`.");
    expect(closedStatusViolations(nd)).toEqual(["NO_DATE"]);
  });

  it("does not gate a closure dated before the cutoff, even with nothing in its Status", () => {
    const e = titled(REAL + "2026-10-03", "", "**Status:** CLOSED 2026-10-03 — done.");
    expect(isGatedClosed(e.title)).toBe(false);
  });

  it("gates a closure dated exactly on the cutoff (inclusive)", () => {
    expect(isGatedClosed(REAL + "2026-10-04")).toBe(true);
    expect(isGatedClosed(REAL + "2026-10-03")).toBe(false);
  });

  it("reads the real heading form and ignores a lowercase 'closed' or a dateless closure", () => {
    expect(closedDate("5. x — CLOSED 2026-10-09")).toBe("2026-10-09");
    expect(closedDate("5. x — closed 2026-10-09")).toBeNull();
    expect(isGatedClosed("5. x — CLOSED")).toBe(false);
    expect(isGatedClosed("5. ~~x~~")).toBe(false);
  });

  // Owner ruling 2026-10-03: a decision closure may carry an owner-decision marker instead of a
  // command, but only with the date directly after the phrase.
  it("control: a closure carrying `owner decision <date>` and no command is clean", () => {
    const d = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — by owner decision 2026-10-05: not built.");
    expect(entryViolations(d)).toEqual([]);
    const r = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — accepted by owner ruling 2026-10-04.");
    expect(entryViolations(r)).toEqual([]);
  });

  it("control: a closure citing a command and no marker stays clean", () => {
    expect(entryViolations(titled(REAL + "2026-10-05", "", goodStatus))).toEqual([]);
  });

  it("flags the owner phrase when no date follows it (the house 'by owner ruling:' form)", () => {
    const e = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — accepted by owner ruling: not worth it.");
    expect(entryViolations(e)).toEqual(["NO_VERIFICATION"]);
  });

  it("flags a bare 'owner' and a closure with neither marker nor command", () => {
    const bare = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — decided by the owner 2026-10-05.");
    expect(entryViolations(bare)).toEqual(["NO_VERIFICATION"]);
    const none = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — done.");
    expect(entryViolations(none)).toEqual(["NO_VERIFICATION"]);
  });

  it("does not let the marker excuse an open entry", () => {
    const e = titled("open thing — open", "", "**Status:** open — owner decision 2026-10-05.");
    expect(entryViolations(e)).toEqual(["NO_VERIFICATION"]);
  });

  // The marker must OPEN the closure's reason (after "CLOSED <date> — ") and carry a real date.
  const withReason = (reason) =>
    entryViolations(titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 — " + reason));

  it("control: the lead-ins and the colon form of the marker pass", () => {
    expect(withReason("owner decision 2026-10-04: not built.")).toEqual([]);
    expect(withReason("Owner ruling: 2026-10-04 — not built.")).toEqual([]);
    expect(withReason("by owner ruling: 2026-10-04 not built.")).toEqual([]);
    expect(withReason("accepted by owner decision 2026-10-04.")).toEqual([]);
    const en = titled(REAL + "2026-10-05", "", "**Status:** CLOSED 2026-10-05 – owner decision 2026-10-04: x.");
    expect(entryViolations(en)).toEqual([]);
  });

  it("flags the marker when it is not the lead of the closure's reason", () => {
    expect(withReason("awaiting owner decision 2026-10-09")).toEqual(["NO_VERIFICATION"]);
    expect(withReason("not an owner decision 2026-10-04 at all")).toEqual(["NO_VERIFICATION"]);
    expect(withReason("co-owner decision 2026-10-04")).toEqual(["NO_VERIFICATION"]);
    expect(withReason("done; later an owner decision 2026-10-04")).toEqual(["NO_VERIFICATION"]);
  });

  it("flags an impossible calendar date and a marker with no date", () => {
    expect(withReason("owner decision 2026-13-45: x.")).toEqual(["NO_VERIFICATION"]);
    expect(withReason("owner decision 2026-02-30: x.")).toEqual(["NO_VERIFICATION"]);
    expect(withReason("owner decision: not built.")).toEqual(["NO_VERIFICATION"]);
    expect(withReason("owner decision 2026-02-28: x.")).toEqual([]);
  });

  it("every gated closure in the real register conforms", () => {
    const gated = parseEntries(register()).filter((e) => isGatedClosed(e.title));
    expect(gated.filter((e) => entryViolations(e).length > 0).map((e) => e.n)).toEqual([]);
  });
});

// ★★★ THE ENTRY POINT'S EXIT CODES, PINNED. The design doc claimed exit 2 was
// "pinned by a unit test" while nothing spawned the script at all — a false
// coverage claim reads as protection and stops the audit, which is worse than an
// admitted gap. A cold review caught it; these make the claim true.
//
// ★★ The FLOOR case is the one that matters, and it is the one that was missing.
// An earlier cut tripped exit 2 only at ZERO entries, so a parser that
// recognised one heading shape and dropped the rest reported "1 open entries
// scanned — all conforming" at exit 0, green, inside a BLOCKING job. Measured
// against a fixture, then fixed to match `check-followup-claims.mjs`'s
// long-standing floor of 50 rather than inventing a second number.
//
// ★ Newlines here are REAL, inside template literals, not `\n` escapes. Three
// separate patches in this file's history were mangled by escape handling before
// this was written down.
describe("check-followup-status.mjs exit codes", () => {
  const GATE = path.join(process.cwd(), "scripts", "check-followup-status.mjs");

  const runAgainst = (registerText) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "followup-status-"));
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "open-followups.md"), registerText, "utf8");
    return spawnSync(process.execPath, [GATE], { cwd: dir, encoding: "utf8", shell: false });
  };

  const conforming = (n) => `## ${n}. entry ${n} — open

**Status:** open — a thing. 2026-08-28, never machine-verified.

`;

  const manyConforming = (count) => {
    let out = `# register

`;
    for (let i = 1; i <= count; i++) out += conforming(i);
    return out;
  };

  it("exits 2 when the register is missing entirely", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "followup-status-"));
    const r = spawnSync(process.execPath, [GATE], { cwd: dir, encoding: "utf8", shell: false });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/CANNOT SCAN/);
  });

  it("exits 2 when no entry parses at all", () => {
    const r = runAgainst(`# register

no headings here
`);
    expect(r.status).toBe(2);
  });

  it("exits 2 when only a handful parse — the floor, not just zero", () => {
    const r = runAgainst(`${conforming(1)}## 2) not a heading the parser knows

body
`);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/floor is 50/);
  });

  it("exits 1 on drift once enough entries parse", () => {
    const r = runAgainst(`${manyConforming(60)}## 61. an entry with no Status line — open

body
`);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/MISSING/);
  });

  it("exits 1 when an entry closed after the cutoff names no command, 0 when it does", () => {
    const closed = (status) => `## 61. a closure — CLOSED 2026-10-05

${status}

`;
    const bad = runAgainst(manyConforming(60) + closed("**Status:** CLOSED 2026-10-05 — done."));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/§61/);
    const good = runAgainst(
      manyConforming(60) + closed("**Status:** CLOSED 2026-10-05 — done: `npx vitest run x`."),
    );
    expect(good.status).toBe(0);
    expect(good.stdout).toMatch(/1 closed on or after/);
  });

  it("exits 0 when an old closure names nothing — history stays ungated", () => {
    const r = runAgainst(
      manyConforming(60) +
        `## 61. old closure — CLOSED 2026-09-13

**Status:** CLOSED 2026-09-13 — done.

`,
    );
    expect(r.status).toBe(0);
  });

  it("exits 0 when every parsed entry conforms", () => {
    const r = runAgainst(manyConforming(60));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/All open entries carry a conforming Status line/);
  });
});
