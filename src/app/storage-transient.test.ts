import { describe, it, expect } from "vitest";
import { isBusyDbError, isRetryableLearningLoadError, isStorageUnreachable, isTursoServerBlip } from "./storage-transient";
import { TursoHttpError, TursoStepError } from "./turso-pipeline";
import { StorageNotReadyError } from "./workspace";

describe("storage-transient", () => {
  it("retries a learning load only on connectivity, a server blip or a busy database", () => {
    expect(isRetryableLearningLoadError(new StorageNotReadyError("storage-unreachable"))).toBe(true);
    expect(isRetryableLearningLoadError(new TursoHttpError(503))).toBe(true);
    expect(isRetryableLearningLoadError(new TursoHttpError(429))).toBe(true);
    expect(isRetryableLearningLoadError(new Error("SQLITE_BUSY: database is locked"))).toBe(true);
  });
  it("treats a rejected token, a client error, a SQL error and anything else as permanent", () => {
    expect(isRetryableLearningLoadError(new StorageNotReadyError("turso-token-rejected"))).toBe(false);
    expect(isRetryableLearningLoadError(new StorageNotReadyError("turso-env-token-rejected"))).toBe(false);
    expect(isRetryableLearningLoadError(new TursoHttpError(400))).toBe(false);
    expect(isRetryableLearningLoadError(new TursoStepError(0, "no such table"))).toBe(false);
    expect(isRetryableLearningLoadError(new Error("action_learning: the select result is missing"))).toBe(false);
    expect(isRetryableLearningLoadError("x")).toBe(false);
  });
  it("exposes the building blocks the scheduled-job runner composes", () => {
    expect(isStorageUnreachable(new StorageNotReadyError("storage-unreachable"))).toBe(true);
    expect(isStorageUnreachable(new StorageNotReadyError("turso-token-rejected"))).toBe(false);
    expect(isTursoServerBlip(new TursoHttpError(500))).toBe(true);
    expect(isTursoServerBlip(new TursoHttpError(404))).toBe(false);
    expect(isBusyDbError(new Error("database table is locked"))).toBe(true);
    expect(isBusyDbError(new Error("other"))).toBe(false);
  });
});
