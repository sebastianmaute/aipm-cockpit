import { describe, it, expect, beforeEach } from "vitest";
import { registerDiagnosticsGlobalHandlers } from "./diagnostics-boot";
import { readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("registerDiagnosticsGlobalHandlers", () => {
  it("logs an uncaught error event on window 'error'", () => {
    registerDiagnosticsGlobalHandlers();
    window.dispatchEvent(new ErrorEvent("error", { message: "kaboom", filename: "x.ts" }));
    const log = readDiagLog();
    expect(log.some((e) => e.code === "uncaught" && e.level === "error")).toBe(true);
  });

  it("is idempotent (registering twice does not double-log)", () => {
    registerDiagnosticsGlobalHandlers();
    registerDiagnosticsGlobalHandlers();
    window.dispatchEvent(new ErrorEvent("error", { message: "once" }));
    expect(readDiagLog().filter((e) => e.code === "uncaught")).toHaveLength(1);
  });
});
