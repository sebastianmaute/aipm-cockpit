import { describe, it, expect, beforeEach, vi } from "vitest";
import { reportSilentFailure, reportCapabilityGap } from "./guard-feedback";
import { readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("guard-feedback", () => {
  it("reportSilentFailure logs an error event + shows an error toast", () => {
    const showToast = vi.fn();
    reportSilentFailure(showToast, "en-US", "test.failed", new Error("boom"), "guardClipboardCopyFailed");
    const log = readDiagLog();
    expect(log[0].level).toBe("error");
    expect(log[0].code).toBe("test.failed");
    expect(log[0].fields!.message).toBe("boom");
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("reportCapabilityGap logs a warn event + shows an info toast", () => {
    const showToast = vi.fn();
    reportCapabilityGap(showToast, "en-US", "test.gap", "guardTrendsNotConfigured");
    const log = readDiagLog();
    expect(log[0].level).toBe("warn");
    expect(log[0].code).toBe("test.gap");
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("captures a non-Error rejection reason as a string", () => {
    const showToast = vi.fn();
    reportSilentFailure(showToast, "en-US", "test.failed", "plain string", "guardClipboardCopyFailed");
    expect(readDiagLog()[0].fields!.message).toBe("plain string");
  });
});
