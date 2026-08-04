// Pins the LAST hop of the snapshot-capture gate: task-manager passing the
// storage hook's `workspaceLoaded` into `useSnapshots` as `workspaceReady`.
//
// ★★★ WHY A WHOLE FILE FOR ONE PROP. The gate exists because snapshot
// auto-capture races the workspace load and wins, writing a row with null KPIs
// that PERMANENTLY claims its cadence bucket — `hasCurrent` then sees the
// poisoned row and no retry ever follows. Both ends of the seam are pinned
// elsewhere (`use-storage-backend.test.tsx` proves the flag is published only
// once a load is applied; `use-snapshots.test.tsx` proves the hook defers while
// it is false), and BOTH keep passing if this hop is changed to
// `workspaceReady: true`. That single edit reinstates the original data-loss bug
// with a fully green suite, which is exactly the class of gap a per-unit test
// plan cannot see.
//
// ★ The assertion is on the SEQUENCE, not a final value: capture starts false
// and must become true. A snapshot of the end state alone would pass with a
// hardcoded `true`, and a snapshot of the first render alone would pass with a
// hardcoded `false`. Only the transition distinguishes a real wire from either.
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

// Keep the heavy child out of the mount — this suite only cares about the hook
// args, and WorkspaceSection is the expensive part of a TaskManager render.
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

describe("task-manager → useSnapshots capture gate", () => {
  it("threads workspaceLoaded through as workspaceReady, false until the load lands", async () => {
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });

    // Every render before the workspace was applied must have gated capture off.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe(false);

    // ...and the flag must actually arrive, or capture would be dead forever
    // rather than merely deferred.
    await waitFor(() => expect(seen).toContain(true), { timeout: 40000 });

    // The prop is a real boolean, not an object/undefined leaking through a
    // renamed field (which would be falsy on the first check and never flip).
    expect(seen.every((v) => typeof v === "boolean")).toBe(true);
  }, 45000);
});
