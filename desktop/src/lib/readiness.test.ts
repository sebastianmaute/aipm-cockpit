// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { waitForReady } from "./readiness";

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("waitForReady", () => {
  it("returns ready as soon as the probe succeeds", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValue(true);
    const r = await waitForReady({ probe, timeoutMs: 30000, intervalMs: 250, ...clock });
    expect(r).toEqual({ ready: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("keeps polling until the probe turns true", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const r = await waitForReady({ probe, timeoutMs: 30000, intervalMs: 250, ...clock });
    expect(r).toEqual({ ready: true });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("gives up at the hard timeout and says so", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValue(false);
    const r = await waitForReady({ probe, timeoutMs: 1000, intervalMs: 250, ...clock });
    expect(r).toEqual({ ready: false, reason: "timeout" });
  });

  it("does not poll forever when the probe always throws", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await waitForReady({ probe, timeoutMs: 1000, intervalMs: 250, ...clock });
    // A refused connection is the NORMAL state while the server boots, so it
    // must be treated as "not yet", not as a fatal error — but it must still
    // hit the timeout rather than spinning.
    expect(r).toEqual({ ready: false, reason: "timeout" });
    expect(probe.mock.calls.length).toBeGreaterThan(1);
  });

  it("bounds its own polling — a zero interval cannot spin without end", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValue(false);
    const r = await waitForReady({ probe, timeoutMs: 100, intervalMs: 0, ...clock });
    expect(r.ready).toBe(false);
  });
});
