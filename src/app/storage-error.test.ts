import { describe, expect, it } from "vitest";
import { StorageNotReadyError } from "./storage";
import { classifyStorageError, isTursoLockTimeout, tursoErrorKind } from "./storage-error";

describe("tursoErrorKind", () => {
  it("maps the unreachable hint", () => {
    expect(tursoErrorKind(new StorageNotReadyError("storage-unreachable"))).toBe("unreachable");
  });

  it("maps the rejected-auth-token message", () => {
    expect(
      tursoErrorKind(new StorageNotReadyError("Turso auth token rejected. Check the token in Settings.")),
    ).toBe("auth");
  });

  it("maps a non-OK Turso HTTP response to unreachable", () => {
    expect(tursoErrorKind(new Error("Turso returned 503. Try again later."))).toBe("unreachable");
  });

  it("ignores local-file permission hints (not a Turso failure)", () => {
    expect(tursoErrorKind(new StorageNotReadyError("local-file-permission-needed"))).toBeNull();
  });

  it("ignores unrelated errors", () => {
    expect(tursoErrorKind(new Error("boom"))).toBeNull();
    expect(tursoErrorKind(null)).toBeNull();
    expect(tursoErrorKind("nope")).toBeNull();
  });

  it("does not classify a cross-tab lock timeout (transient — toast, not the connectivity banner)", async () => {
    const { TursoLockTimeoutError } = await import("./turso-backend");
    expect(tursoErrorKind(new TursoLockTimeoutError())).toBeNull();
  });
});

describe("classifyStorageError", () => {
  it("keeps recognized Turso kinds", () => {
    expect(classifyStorageError(new StorageNotReadyError("storage-unreachable"))).toBe("unreachable");
    expect(
      classifyStorageError(new StorageNotReadyError("Turso auth token rejected. Check the token in Settings.")),
    ).toBe("auth");
  });

  it("classifies any other failure as generic (so local-backend failures still banner)", () => {
    expect(classifyStorageError(new Error("disk full"))).toBe("generic");
    expect(classifyStorageError(new StorageNotReadyError("local-file-permission-needed"))).toBe("generic");
    expect(classifyStorageError(null)).toBe("generic");
  });
});

describe("isTursoLockTimeout", () => {
  it("detects the cross-tab lock timeout (so the toast can localize it)", async () => {
    const { TursoLockTimeoutError } = await import("./turso-backend");
    expect(isTursoLockTimeout(new TursoLockTimeoutError())).toBe(true);
  });

  it("ignores other errors and non-errors", () => {
    expect(isTursoLockTimeout(new Error("boom"))).toBe(false);
    expect(isTursoLockTimeout(new StorageNotReadyError("storage-unreachable"))).toBe(false);
    expect(isTursoLockTimeout(null)).toBe(false);
  });
});
