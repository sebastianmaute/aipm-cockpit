// @vitest-environment node
import { describe, expect, it } from "vitest";
import { judgeLiveRun } from "./live-run-lib.mjs";

describe("judgeLiveRun", () => {
  it("passes a run in which every test ran", () => {
    expect(judgeLiveRun({ expected: 9, unexpected: 0, flaky: 0, skipped: 0 })).toMatchObject({ ok: true, ran: 9 });
  });

  it("counts failed and flaky tests as having run (a failure fails the run on its own)", () => {
    expect(judgeLiveRun({ expected: 0, unexpected: 2, flaky: 1, skipped: 0 })).toMatchObject({ ok: true, ran: 3 });
  });

  it("fails a run in which any test skipped, however many ran", () => {
    const v = judgeLiveRun({ expected: 12, unexpected: 0, flaky: 0, skipped: 1 });
    expect(v).toMatchObject({ ok: false, skipped: 1 });
    expect(v.message).toMatch(/1 test\(s\) skipped/);
  });

  it("fails a run in which nothing ran", () => {
    expect(judgeLiveRun({ expected: 0, unexpected: 0, flaky: 0, skipped: 0 })).toMatchObject({ ok: false, message: "no test ran" });
  });

  it("fails a report with no usable stats rather than calling it a pass", () => {
    expect(judgeLiveRun(undefined).ok).toBe(false);
    expect(judgeLiveRun({}).ok).toBe(false);
    expect(judgeLiveRun({ expected: -3, skipped: Number.NaN }).ok).toBe(false);
  });
});
