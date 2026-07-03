import { describe, it, expect, beforeEach } from "vitest";
import { logDiag, readDiagLog, clearDiagLog, buildDiagnosticBundle } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("diagnostics ring", () => {
  it("appends newest-first with timestamp + level + code", () => {
    logDiag("warn", "storage.saveFailed", { kind: "turso" });
    logDiag("error", "uncaught", { message: "boom" });
    const log = readDiagLog();
    expect(log).toHaveLength(2);
    expect(log[0].code).toBe("uncaught");
    expect(log[0].level).toBe("error");
    expect(log[0].at).toMatch(/^\d{4}-/);
  });

  it("caps the ring at 200", () => {
    for (let i = 0; i < 250; i++) logDiag("info", `e${i}`);
    const log = readDiagLog();
    expect(log).toHaveLength(200);
    expect(log[0].code).toBe("e249");
  });

  it("redacts secret fields before storing", () => {
    logDiag("info", "x", { apiKey: "sk-ant-leak" });
    expect(JSON.stringify(readDiagLog())).not.toContain("sk-ant-leak");
    expect(readDiagLog()[0].fields!.apiKey).toBe("[redacted]");
  });

  it("never throws on malformed storage", () => {
    window.localStorage.setItem("lop-app:diag-log", "{not json");
    expect(readDiagLog()).toEqual([]);
  });

  it("bundle carries version + events and no secrets", () => {
    logDiag("info", "x", { authToken: "leak-me" });
    const bundle = JSON.parse(buildDiagnosticBundle());
    expect(bundle.version).toBeTruthy();
    expect(bundle.events).toHaveLength(1);
    expect(JSON.stringify(bundle)).not.toContain("leak-me");
  });

  it("clearDiagLog empties the ring", () => {
    logDiag("info", "x");
    clearDiagLog();
    expect(readDiagLog()).toEqual([]);
  });

  it("evicts oldest info first, preserving warn/error under noise", () => {
    logDiag("warn", "dataloss.refused", { path: "save" });
    for (let i = 0; i < 250; i++) logDiag("info", `noise${i}`);
    const log = readDiagLog();
    expect(log).toHaveLength(200);
    expect(log.some((e) => e.code === "dataloss.refused")).toBe(true);
  });
});
