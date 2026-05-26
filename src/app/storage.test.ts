import { describe, it, expect, vi } from "vitest";
import { writeHandle, StorageNotReadyError } from "./storage";
import type { FsHandle } from "./storage";

function makeHandle(writable: {
  write: () => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}): FsHandle {
  return {
    createWritable: vi.fn().mockResolvedValue(writable),
  } as unknown as FsHandle;
}

describe("writeHandle", () => {
  it("writes then closes on the happy path", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    await writeHandle(makeHandle({ write, close }), "content");
    expect(write).toHaveBeenCalledWith("content");
    expect(close).toHaveBeenCalled();
  });

  it("aborts the temp and throws local-file-write-blocked when write rejects", async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    const writable = {
      write: vi.fn().mockRejectedValue(new DOMException("blocked", "AbortError")),
      close: vi.fn().mockResolvedValue(undefined),
      abort,
    };
    await expect(writeHandle(makeHandle(writable), "x")).rejects.toMatchObject({
      hint: "local-file-write-blocked",
    });
    expect(abort).toHaveBeenCalled();
    expect(writable.close).not.toHaveBeenCalled();
  });

  it("throws local-file-write-blocked when close rejects (no abort method present)", async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new DOMException("blocked", "AbortError")),
    };
    const err = await writeHandle(makeHandle(writable), "x").catch((e) => e);
    expect(err).toBeInstanceOf(StorageNotReadyError);
    expect((err as StorageNotReadyError).hint).toBe("local-file-write-blocked");
  });
});
