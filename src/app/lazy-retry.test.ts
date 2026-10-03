import { describe, expect, it, vi } from "vitest";
import { lazyRetryOnReject } from "./lazy-retry";

describe("lazyRetryOnReject", () => {
  it("retries after a rejected load instead of caching the rejection", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce("module");
    const get = lazyRetryOnReject(load);

    await expect(get()).rejects.toThrow("chunk failed");
    await expect(get()).resolves.toBe("module");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful load cached", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("module");
    const get = lazyRetryOnReject(load);

    await get();
    await get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const get = lazyRetryOnReject(load);

    const a = get();
    const b = get();
    resolve("module");
    await expect(Promise.all([a, b])).resolves.toEqual(["module", "module"]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
