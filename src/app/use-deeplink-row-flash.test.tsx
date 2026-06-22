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

/** Probe: mounts the hook for `view` and exposes flashId + a requestOpen trigger. */
function Probe({ view }: { view: AppView }) {
  const { flashId, containerRef } = useDeepLinkRowFlash(view);
  const { requestOpen } = useWorkspaceTab();
  return (
    <div>
      <span data-testid="flash">{String(flashId)}</span>
      <button onClick={() => requestOpen("changes", 5)}>go</button>
      <button onClick={() => requestOpen("changes", -1)}>go-sentinel</button>
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

  it("flashOutlineClass returns outline classes only when flashed", () => {
    expect(flashOutlineClass(true)).toContain("outline-AIPM-green");
    expect(flashOutlineClass(false)).toBe("");
  });
});
