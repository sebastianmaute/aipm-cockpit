import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";
import { DESKTOP_VERSION_REQUEST_EVENT } from "./desktop-shell";

const ELECTRON_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "aipm-cockpit/1.0.0 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36";

// Async-aware (the caller usually awaits screen.findBy*), unlike the
// synchronous withUserAgent copies elsewhere in the repo (task-manager-
// ui.test.tsx, version-info.test.tsx) — restoring the UA before an awaited
// step inside `run` finishes would un-stub it mid-test.
async function withUserAgent(userAgent: string, run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
  try {
    await run();
  } finally {
    if (original) Object.defineProperty(navigator, "userAgent", original);
    else delete (navigator as unknown as Record<string, unknown>).userAgent;
  }
}

function setLayout(layout: "modern" | "classic") {
  window.localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ layout }));
}

// Seed one registered project so the multi-project empty-state gate (shown when
// the registry has zero projects) does not replace the app chrome these tests
// assert against. The project's storageConfig points at the default browser
// backend, matching the app's default.
function seedRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

describe("TaskManager shell selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedRegistry();
  });

  it("renders the sidebar brand in modern mode (default)", async () => {
    render(<TaskManager />);
    expect(await screen.findByText("PROJECT MANAGEMENT TRACKER")).toBeTruthy();
  });

  it("renders the classic layout (no sidebar brand) in classic mode", async () => {
    setLayout("classic");
    render(<TaskManager />);
    // The classic AppHeader renders an "Add task" icon button; the workspace
    // (gantt) renders its own, so there are several — assert at least one and
    // that the modern sidebar brand is absent.
    expect((await screen.findAllByRole("button", { name: "Add task" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("PROJECT MANAGEMENT TRACKER")).toBeNull();
  });

  it("classic layout fits the viewport with a pinned footer (non-popout)", async () => {
    setLayout("classic");
    const { container } = render(<TaskManager />);
    await screen.findAllByRole("button", { name: "Add task" });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-screen");
    expect(root.className).toContain("flex");
    expect(root.className).toContain("flex-col");
  });

});

// ★★★ FIX ROUND 1 (M3): the app now has exactly ONE VersionInfoModal render
// site (task-manager.tsx's modalsBlock, via use-desktop-version-request.ts).
// modern-shell.test.tsx and settings-view.test.tsx pin their two triggers
// call the SAME `onOpenVersion` prop at the unit level; this full-stack
// suite is what proves that wiring actually reaches the one real modal.
describe("Version modal — one owner (fix round 1, M3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedRegistry();
  });

  it("clicking the sidebar version line, then a desktop Version request while it is already open, leaves exactly one dialog", async () => {
    render(<TaskManager />);
    const versionButton = await screen.findByRole("button", { name: /^Version / });
    fireEvent.click(versionButton);
    expect(screen.getAllByRole("dialog", { name: "Version" })).toHaveLength(1);

    // Help → Version from the native menu bar stays clickable while a modal
    // is open (review-2-report.md M3's reproduction). With one root-owned
    // modal this can only re-open the SAME instance, never stack a second.
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_VERSION_REQUEST_EVENT, {
          cancelable: true,
          detail: { logPath: "C:\\logs\\launch.log", open: true },
        }),
      );
    });
    expect(screen.getAllByRole("dialog", { name: "Version" })).toHaveLength(1);
  });

  it("a log path primed by a desktop request (open: false) shows when the modal is later opened from the sidebar, under an Electron UA", async () => {
    await withUserAgent(ELECTRON_UA, async () => {
      render(<TaskManager />);
      const versionButton = await screen.findByRole("button", { name: /^Version / });

      // The priming ping main.ts sends on did-finish-load, BEFORE any menu
      // click — must not open the modal, only remember the path.
      act(() => {
        window.dispatchEvent(
          new CustomEvent(DESKTOP_VERSION_REQUEST_EVENT, {
            cancelable: true,
            detail: { logPath: "C:\\logs\\launch.log", open: false },
          }),
        );
      });
      expect(screen.queryByRole("dialog", { name: "Version" })).toBeNull();

      fireEvent.click(versionButton);
      expect(await screen.findByText("C:\\logs\\launch.log")).toBeInTheDocument();
    });
  });
});
