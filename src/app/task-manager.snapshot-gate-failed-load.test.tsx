// The other half of the snapshot-capture gate: what happens when the load FAILS.
//
// ★★★ WHY THIS IS A SEPARATE FILE FROM `task-manager.snapshot-gate.test.tsx`.
// That file proves the wire is real — `workspaceReady` starts false and becomes
// true — and it defeats a hardcoded `true` and a hardcoded `false`. What it
// CANNOT defeat is the NEAR-MISS: `workspaceReady: storageReady`. `storageReady`
// is also `useState(false)` and also flips true on a healthy boot, so that file
// stays green while the gate is wired to the one flag `use-storage-backend.ts`
// explicitly warns against — the flag that is ALSO set on the load-ERROR and
// suppressed-load paths, where no workspace was ever applied.
//
// A failed load is the single observation where the two diverge:
//   storageReady    -> true  (the backend reports itself usable)
//   workspaceLoaded -> false (nothing was applied)
// So capture must stay gated OFF here. Wired to `storageReady` it would fire
// against the DEFAULT workspace and write a null-KPI row that permanently claims
// the cadence bucket — the original data-loss bug, reinstated.
//
// ★ It needs its own file because `vi.mock` is hoisted per module: the failing
// backend installed here would break the healthy-boot assertions next door.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";

const seen: boolean[] = [];

vi.mock("./use-snapshots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-snapshots")>()),
  useSnapshots: (args: { workspaceReady: boolean }) => {
    seen.push(args.workspaceReady);
    return {
      snapshots: [], baseline: null, latest: null, variance: [], gaps: [], busy: false,
      captureNow: async () => {}, rebaselineNow: async () => {}, setBaseline: async () => {},
      deleteSnapshot: async () => {}, deleteSnapshots: async () => {},
    };
  },
}));

// Partial mock: only `createBackend` is replaced, so every other storage export
// task-manager reaches for stays real.
vi.mock("./storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./storage")>()),
  createBackend: () => ({
    // Healthy as far as the backend itself is concerned — this is precisely what
    // makes `storageReady` flip true and the near-miss wiring look fine.
    isReady: async () => true,
    describe: async () => "failing-test-backend",
    load: async () => {
      throw new Error("load failed (test)");
    },
    save: async () => {},
  }),
}));

vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: () => <div data-testid="ws-section-mock" />,
}));

import TaskManager from "./task-manager";

beforeEach(() => {
  __resetMintStateForTests();
  seen.length = 0;
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
});

describe("task-manager → useSnapshots capture gate, failed load", () => {
  it("never opens the capture gate when no workspace was applied", async () => {
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });

    // Give the failing load, the error handling and any follow-up renders room
    // to settle — otherwise this could pass simply by observing too early.
    await waitFor(() => expect(seen.length).toBeGreaterThan(1), { timeout: 40000 });
    await new Promise((r) => setTimeout(r, 250));

    expect(seen).not.toContain(true);
    expect(seen.every((v) => v === false)).toBe(true);
  }, 45000);
});
