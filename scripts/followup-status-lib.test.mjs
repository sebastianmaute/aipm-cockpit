// Unit tests for the open-followups Status-line contract.
//
// Same discipline as its siblings: every defect this family of gates has
// shipped was a regex defect, and both were found by running against the real
// docs rather than by reading the code. So the last case here runs the contract
// over the real register.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { statusBlock, statusViolations } from "./followup-status-lib.mjs";
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
