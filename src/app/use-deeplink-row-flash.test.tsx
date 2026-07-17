import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import type { AppView } from "./nav-config";
import {
  DEEPLINK_FLASH_MS,
  flashOutlineClass,
  useDeepLinkRowFlash,
} from "./use-deeplink-row-flash";

function Providers({ children }: { children: ReactNode }) {
  return <WorkspaceTabProvider>{children}</WorkspaceTabProvider>;
}

/** Probe: mounts the hook for `view` and exposes flashId + request triggers. */
function Probe({ view }: { view: AppView }) {
  const { flashId, containerRef } = useDeepLinkRowFlash(view);
  const { requestOpen, clearPendingOpen } = useWorkspaceTab();
  return (
    <div>
      <span data-testid="flash">{String(flashId)}</span>
      <button onClick={() => requestOpen("changes", 5)}>go</button>
      <button onClick={() => requestOpen("changes", -1)}>go-sentinel</button>
      {/* Forces an unrelated re-render without touching any pending request. */}
      <button onClick={() => clearPendingOpen()}>clear</button>
      <div ref={containerRef}>
        <table>
          <tbody>
            <tr data-deeplink-row="5">
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

describe("useDeepLinkRowFlash", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    // Make rAF synchronous + deterministic in jsdom.
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("flashes the matching row id and scrolls it into view (centered)", () => {
    const { getByText, getByTestId } = render(
      <Providers>
        <Probe view="changes" />
      </Providers>,
    );
    expect(getByTestId("flash").textContent).toBe("null");

    fireEvent.click(getByText("go"));

    expect(getByTestId("flash").textContent).toBe("5");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
  });

  it("ignores a deep-link for a different view", () => {
    const { getByText, getByTestId } = render(
      <Providers>
        <Probe view="raid" />
      </Providers>,
    );

    fireEvent.click(getByText("go"));

    expect(getByTestId("flash").textContent).toBe("null");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("ignores a sentinel/aggregate id (< 0)", () => {
    const { getByText, getByTestId } = render(
      <Providers>
        <Probe view="changes" />
      </Providers>,
    );

    fireEvent.click(getByText("go-sentinel"));

    expect(getByTestId("flash").textContent).toBe("null");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("clears the flash after DEEPLINK_FLASH_MS", () => {
    vi.useFakeTimers();
    try {
      const { getByText, getByTestId } = render(
        <Providers>
          <Probe view="changes" />
        </Providers>,
      );

      fireEvent.click(getByText("go"));
      expect(getByTestId("flash").textContent).toBe("5");

      act(() => {
        vi.advanceTimersByTime(DEEPLINK_FLASH_MS);
      });

      expect(getByTestId("flash").textContent).toBe("null");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still scrolls and auto-clears after the panel clears pendingOpen", () => {
    // Regression: the destination panel clears pendingOpen (object→null) right
    // after the deep-link lands. The side-effect must NOT be keyed on pendingOpen
    // (that dep change would tear it down — cancelling the scroll + auto-clear
    // timer, leaving flashId stuck on the id forever).
    vi.useFakeTimers();
    try {
      const { getByText, getByTestId } = render(
        <Providers>
          <Probe view="changes" />
        </Providers>,
      );

      fireEvent.click(getByText("go"));
      expect(getByTestId("flash").textContent).toBe("5");

      // Panel consumes the request — pendingOpen flips to null. With the bug
      // (effect keyed on pendingOpen) this tears the effect down, cancelling the
      // pending rAF scroll and the auto-clear timer.
      fireEvent.click(getByText("clear"));
      expect(getByTestId("flash").textContent).toBe("5"); // flash still on

      // Flush the rAF (faked under useFakeTimers) → scroll must still fire.
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        block: "center",
        behavior: "auto",
      });

      // The auto-clear timer must survive the pendingOpen clear.
      act(() => {
        vi.advanceTimersByTime(DEEPLINK_FLASH_MS);
      });
      expect(getByTestId("flash").textContent).toBe("null");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-scrolls when the SAME id is re-requested within the flash window", () => {
    // Regression: with the effect keyed on `[flashId]` only, a second
    // requestOpen(view, 5) while flashId is already 5 calls setFlashId(5) — same
    // value → React bails the update → the effect never re-runs → no re-scroll.
    // The monotonic flashSeq dep forces the effect to re-run per fresh request.
    const { getByText } = render(
      <Providers>
        <Probe view="changes" />
      </Providers>,
    );

    fireEvent.click(getByText("go"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    // Panel consumes the request (pendingOpen → null) so the next click yields a
    // FRESH pendingOpen object carrying the same id 5, without advancing the timer.
    fireEvent.click(getByText("clear"));
    fireEvent.click(getByText("go"));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("flashOutlineClass returns outline classes only when flashed", () => {
    expect(flashOutlineClass(true)).toContain("outline-AIPM-green");
    expect(flashOutlineClass(false)).toBe("");
  });
});
