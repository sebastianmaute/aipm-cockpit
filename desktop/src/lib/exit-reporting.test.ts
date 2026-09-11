// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shouldReportServerExit } from "./exit-reporting";

describe("shouldReportServerExit", () => {
  it("stays silent when we are the ones shutting down", () => {
    // ★★★ THIS IS THE REGRESSION. Closing the app ran killServer, which on
    // Windows is `taskkill /F` and makes the child exit with code 1. The
    // first cut keyed off the exit code and the window still being alive, so
    // every normal close ended with an error dialog claiming the background
    // service had stopped unexpectedly. It had not; we stopped it.
    expect(shouldReportServerExit({ quitting: true, windowAlive: true })).toBe(false);
  });

  it("reports a genuine mid-session crash", () => {
    expect(shouldReportServerExit({ quitting: false, windowAlive: true })).toBe(true);
  });

  it("stays silent with no window to report into", () => {
    expect(shouldReportServerExit({ quitting: false, windowAlive: false })).toBe(false);
  });

  it("prefers quitting over window state when both would silence it", () => {
    expect(shouldReportServerExit({ quitting: true, windowAlive: false })).toBe(false);
  });

  it("does not consider the exit code at all", () => {
    // The signature takes no exit code on purpose: a deliberate kill and a
    // crash are indistinguishable by code (taskkill /F yields 1, and so does
    // a real failure). Intent is the only thing that separates them, so if a
    // future change wants to branch on the code, it needs a different reason
    // than "non-zero means broken".
    const asRecord = shouldReportServerExit as unknown as (c: Record<string, unknown>) => boolean;
    expect(asRecord({ quitting: true, windowAlive: true, code: 0 })).toBe(false);
    expect(asRecord({ quitting: true, windowAlive: true, code: 1 })).toBe(false);
  });
});
