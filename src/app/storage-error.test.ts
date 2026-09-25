import { afterEach, describe, expect, it } from "vitest";
import { StorageNotReadyError } from "./storage";
import { classifyStorageError, isTursoLockTimeout, tursoErrorKind } from "./storage-error";
import { clearEnvTokenRejected, markEnvTokenRejected } from "./turso-config";

afterEach(() => {
  clearEnvTokenRejected();
});

describe("tursoErrorKind", () => {
  it("maps the unreachable hint", () => {
    expect(tursoErrorKind(new StorageNotReadyError("storage-unreachable"))).toBe("unreachable");
  });

  it("maps the plain rejected-token hint to auth", () => {
    expect(tursoErrorKind(new StorageNotReadyError("turso-token-rejected"))).toBe("auth");
  });

  it("maps the env-token-rejected hint to auth-env", () => {
    expect(tursoErrorKind(new StorageNotReadyError("turso-env-token-rejected"))).toBe("auth-env");
  });

  // I2 (fix round 1, controller ruling) — attribution rides the HINT alone,
  // never the global `isEnvTokenRejected()` flag. A flag left set by an
  // earlier, unrelated incident must not relabel THIS rejection as "auth-env"
  // just because it happens to still be up.
  it("classifies by the hint alone, regardless of the isEnvTokenRejected() flag", () => {
    markEnvTokenRejected();
    expect(tursoErrorKind(new StorageNotReadyError("turso-token-rejected"))).toBe("auth");
    expect(tursoErrorKind(new StorageNotReadyError("turso-env-token-rejected"))).toBe("auth-env");
    clearEnvTokenRejected();
    expect(tursoErrorKind(new StorageNotReadyError("turso-token-rejected"))).toBe("auth");
    expect(tursoErrorKind(new StorageNotReadyError("turso-env-token-rejected"))).toBe("auth-env");
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
    expect(classifyStorageError(new StorageNotReadyError("turso-token-rejected"))).toBe("auth");
    expect(classifyStorageError(new StorageNotReadyError("turso-env-token-rejected"))).toBe("auth-env");
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
