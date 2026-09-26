import { describe, expect, it } from "vitest";
import { StorageNotReadyError } from "./workspace";
import { projectErrorKey } from "./use-storage-backend";

describe("projectErrorKey", () => {
  it("names the browser, not Settings, when file access is unsupported", () => {
    expect(projectErrorKey(new StorageNotReadyError("file-system-access-unsupported"))).toBe("storageFsaUnsupported");
  });
  it("keeps the permission-gesture key", () => {
    expect(projectErrorKey(new StorageNotReadyError("local-file-permission-needed"))).toBe("storagePermissionGestureNeeded");
  });
  it("falls back to storageNotReady for any other hint", () => {
    expect(projectErrorKey(new StorageNotReadyError("something-else"))).toBe("storageNotReady");
  });
  it("returns null for a non-storage error", () => {
    expect(projectErrorKey(new Error("x"))).toBeNull();
  });
});
