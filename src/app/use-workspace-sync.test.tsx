// §656 m2 — which revision a window compares a peer's revision message against (`adoptPeerRevision`).
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRevisionSync } from "./broadcast-sync";
import type { StorageConfig } from "./storage";
import type { StorageBackend } from "./workspace";
import { useWorkspaceSync, type WorkspaceSyncDeps } from "./use-workspace-sync";

vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn(), useRevisionSync: vi.fn() }));

type Deps = WorkspaceSyncDeps<Parameters<typeof useWorkspaceSync>[0]["slices"]>;

/** Renders the hook over `backend` and returns the handler it gave `useRevisionSync`. */
function onRevisionFor(backend: Partial<StorageBackend>) {
  const deps = {
    isPopout: false,
    storageConfig: { kind: "sp-json" } as StorageConfig,
    tursoDatabaseUrl: undefined,
    tursoProjectId: null,
    fileBinding: null,
    getScopeEpoch: () => 0,
    isLoadedValue: () => false,
    backend: backend as StorageBackend,
    slices: {},
    mirrorApply: new Proxy({}, { get: () => () => {} }),
  } as unknown as Deps;
  renderHook(() => useWorkspaceSync(deps));
  return vi.mocked(useRevisionSync).mock.calls.at(-1)![1];
}

describe("useWorkspaceSync — adopting a peer's revision (§656 m2)", () => {
  it("a window whose file loaded as absent adopts the revision a peer's create produced", () => {
    const adoptRevision = vi.fn();
    const onRevision = onRevisionFor({ revision: () => null, revisionBase: () => "sp:absent", adoptRevision });
    onRevision('"new,2"', "sp:absent");
    expect(adoptRevision).toHaveBeenCalledWith('"new,2"');
  });

  it("without a base of its own (never loaded, or degraded) it adopts nothing", () => {
    const adoptRevision = vi.fn();
    const onRevision = onRevisionFor({ revision: () => null, adoptRevision });
    onRevision('"new,2"', "sp:absent");
    expect(adoptRevision).not.toHaveBeenCalled();
  });

  it("a base that differs from the message's is not adopted", () => {
    const adoptRevision = vi.fn();
    const onRevision = onRevisionFor({ revision: () => '"v1,1"', adoptRevision });
    onRevision('"new,2"', "sp:absent");
    expect(adoptRevision).not.toHaveBeenCalled();
  });
});
