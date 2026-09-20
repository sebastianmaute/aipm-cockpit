// §548 — the shared stale-scope guard both calendar and AI writers use.
import { describe, it, expect, vi, beforeEach } from "vitest";

const logDiag = vi.hoisted(() => vi.fn());
vi.mock("./diagnostics", () => ({ logDiag }));

import { isScopeStale, dropStaleScopeWrite } from "./scope-epoch";

describe("isScopeStale", () => {
  beforeEach(() => { logDiag.mockClear(); });

  it("is false while the reader still returns the captured epoch", () => {
    expect(isScopeStale(() => 3, 3)).toBe(false);
  });

  it("is true once the reader returns a different epoch", () => {
    expect(isScopeStale(() => 4, 3)).toBe(true);
  });

  it("opts OUT — never stale — when the caller passed no reader or never captured a start", () => {
    expect(isScopeStale(undefined, 3)).toBe(false);
    expect(isScopeStale(() => 4, undefined)).toBe(false);
  });
});

describe("dropStaleScopeWrite", () => {
  beforeEach(() => { logDiag.mockClear(); });

  it("returns false and logs NOTHING when the scope is unchanged", () => {
    expect(dropStaleScopeWrite(() => 3, 3, "aWriter")).toBe(false);
    expect(logDiag).not.toHaveBeenCalled();
  });

  it("returns true and logs ONE storage.staleScopeWriteDropped naming the writer", () => {
    expect(dropStaleScopeWrite(() => 4, 3, "aWriter", { entityType: "raid" })).toBe(true);
    expect(logDiag).toHaveBeenCalledTimes(1);
    expect(logDiag).toHaveBeenCalledWith("warn", "storage.staleScopeWriteDropped", { writer: "aWriter", entityType: "raid" });
  });

  it("logs nothing for an opted-out caller", () => {
    expect(dropStaleScopeWrite(undefined, undefined, "aWriter")).toBe(false);
    expect(logDiag).not.toHaveBeenCalled();
  });
});
