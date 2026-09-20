import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings-types";
import type { Lang } from "./i18n";
import type { StorageConfig } from "./storage";
import { useStorageBackend } from "./use-storage-backend";
import { TestProviders } from "./test-providers";

// ── Storage mock — same shape as use-storage-backend.test.tsx's module mock ───
vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  emptyWorkspace: vi.fn(() => ({
    tasks: [], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [],
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
  })),
  StorageNotReadyError: class StorageNotReadyError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  StorageNotImplementedError: class StorageNotImplementedError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  openFileForBackend: vi.fn(),
  loadFromHandleForBackend: vi.fn((backend: { load: () => Promise<unknown> }) => backend.load()),
  pickFileForBackend: vi.fn(),
  pickFileHandleForBackend: vi.fn(),
  pickOpenFileAny: vi.fn(),
  formatFromFileName: vi.fn(() => "json"),
  requestWriteAccessForBackend: vi.fn(),
  setBackendFileHandle: vi.fn(() => null),
  getBackendFileHandle: vi.fn(() => null),
}));
import { createBackend } from "./storage";

// project-file-handles mock — the load effect's suppress branch reads it.
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./broadcast-sync", () => ({
  useBroadcastSync: vi.fn(),
}));

vi.mock("./diagnostics", () => ({
  logDiag: vi.fn(),
}));

// ── Fixtures — local equivalents of use-storage-backend.test.tsx's helpers;
// that file exports nothing, so these are rebuilt here rather than imported. ──
const showToast = vi.fn();
const showToastAction = vi.fn();
const onRevealSavingPaused = vi.fn();
const setStorageConfig = vi.fn();

const fileConfig: StorageConfig = { kind: "browser" };
const tursoConfig: StorageConfig = { kind: "turso" };

/** Mirrors `mockBackend` in use-storage-backend.test.tsx — a fresh instance per
 *  call so `createBackend` can be told to return two DISTINCT objects. */
function makeBackendStub(kind: StorageConfig["kind"]) {
  return {
    kind,
    load: vi.fn().mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] }),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

function makeArgs(config: StorageConfig): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig: config } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast,
    showToastAction,
    onRevealSavingPaused,
    setStorageConfig,
  };
}

describe("useStorageBackend — backend-ref precondition (§588/§589)", () => {
  it("mints a new backend instance when storageConfig changes", () => {
    const first = makeBackendStub("browser");
    const second = makeBackendStub("turso");
    vi.mocked(createBackend).mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { result, rerender } = renderHook<ReturnType<typeof useStorageBackend>, { config: StorageConfig }>(
      (props) => useStorageBackend(makeArgs(props.config)),
      {
        wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
        initialProps: { config: fileConfig },
      },
    );
    const before = result.current;
    rerender({ config: tursoConfig });

    expect(createBackend).toHaveBeenCalledTimes(2);
    expect(result.current).not.toBe(before);
  });
});
