import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// ★★★ THIS FILE HAD NO RESET, and until a second test existed nothing could show it. `createBackend`
// is a module-level mock, so its call COUNT accumulated across tests — the negative test below read
// 3 where it expected 1, made up entirely of the previous test's two calls plus its own one. A
// count-based assertion in a file without a reset is measuring the whole file, not the test, and
// `test:shuffle` reorders WITHIN a file, so which number it measures is not even fixed.
// ★ `clearAllMocks` clears CALLS only; a queued `mockReturnValueOnce` survives it (see the same
// landmine in use-storage-backend.superseded-gate.test.tsx). Both tests here queue what they consume.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("useStorageBackend — backend-ref precondition (§588/§589)", () => {
  // ★★★ THE TITLE SAYS WHAT THE BODY CHECKS, AND IT USED TO PROMISE MORE. It was "mints a new
  //   backend instance when storageConfig changes" and closed on
  //   `expect(result.current).not.toBe(before)` — which reads TRUE in every state, because
  //   `useStorageBackend` returns a fresh object literal on every render. That line passed on any
  //   `rerender`, including one with the config unchanged and no backend minted, so it read as
  //   evidence while proving nothing; and neither assertion ever observed the two minted backends
  //   being distinct, or `backendRef` moving to the new one.
  // ★ What `createBackend` × 2 DOES prove is the memo's dependency on `storageConfig` identity,
  //   which is the precondition every later §588/§589 guard rests on. That is the whole claim now.
  //   The ref's own coverage lives in the picker suites — see the landmine on `backendRef` itself.
  it("rebuilds the backend memo when storageConfig changes", () => {
    const first = makeBackendStub("browser");
    const second = makeBackendStub("turso");
    vi.mocked(createBackend).mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { rerender } = renderHook<ReturnType<typeof useStorageBackend>, { config: StorageConfig }>(
      (props) => useStorageBackend(makeArgs(props.config)),
      {
        wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
        initialProps: { config: fileConfig },
      },
    );
    expect(createBackend).toHaveBeenCalledTimes(1); // ★ the baseline, so the "2" below is this rerender's doing
    rerender({ config: tursoConfig });

    expect(createBackend).toHaveBeenCalledTimes(2);
  });

  // ★ The negative half, and the reason the count above means anything: a rerender that does NOT
  //   change the config must not rebuild. Without it "2 after a rerender" is consistent with a memo
  //   that rebuilds on every render.
  it("does not rebuild the backend memo when storageConfig is unchanged", () => {
    vi.mocked(createBackend).mockReturnValue(makeBackendStub("browser"));

    const { rerender } = renderHook<ReturnType<typeof useStorageBackend>, { config: StorageConfig }>(
      (props) => useStorageBackend(makeArgs(props.config)),
      {
        wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
        initialProps: { config: fileConfig },
      },
    );
    rerender({ config: fileConfig });

    expect(createBackend).toHaveBeenCalledTimes(1);
  });
});
