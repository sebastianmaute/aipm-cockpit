import { describe, it, expect, vi } from "vitest";
import { writeHandle, StorageNotReadyError, createBackend } from "./storage";
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

describe("createBackend — turso tenant branch", () => {
  it("createBackend returns a turso backend when kind=turso", () => {
    const b = createBackend({ kind: "turso" }, {
      tursoConfig: { httpUrl: "https://x.turso.io", authToken: "t" },
      tursoProjectId: "p1",
    });
    expect(b.kind).toBe("turso");
  });

  it("createBackend still returns a turso backend with no projectId (single-tenant path)", () => {
    const b = createBackend({ kind: "turso" }, {
      tursoConfig: { httpUrl: "https://x.turso.io", authToken: "t" },
    });
    expect(b.kind).toBe("turso");
  });
});
