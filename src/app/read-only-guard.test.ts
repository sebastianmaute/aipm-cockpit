import { describe, it, expect, vi } from "vitest";
import { makeEditGuard } from "./read-only-guard";

describe("makeEditGuard", () => {
  it("calls through to the handler when not read-only", () => {
    const notify = vi.fn();
    const fn = vi.fn();
    const guarded = makeEditGuard(false, notify)(fn);
    guarded("a", 1);
    expect(fn).toHaveBeenCalledWith("a", 1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies and no-ops the handler when read-only", () => {
    const notify = vi.fn();
    const fn = vi.fn();
    const guarded = makeEditGuard(true, notify)(fn);
    guarded("a", 1);
    expect(fn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
