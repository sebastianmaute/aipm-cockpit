import { describe, it, expect, vi } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { useState } from "react";
import { useCommitOnPageHide } from "./use-commit-on-page-hide";

function Probe({ commit }: { commit: () => void }) {
  useCommitOnPageHide(commit);
  return null;
}

describe("useCommitOnPageHide", () => {
  const firePageHide = () => window.dispatchEvent(new Event("pagehide"));
  const fireHidden = () => {
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();
  };

  it("calls the commit once per pagehide", () => {
    const commit = vi.fn();
    render(<Probe commit={commit} />);
    act(() => firePageHide());
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("does not commit on a tab switch (visibilitychange → hidden)", () => {
    const commit = vi.fn();
    render(<Probe commit={commit} />);
    act(() => fireHidden());
    expect(commit).not.toHaveBeenCalled();
  });

  it("calls the LATEST commit, not the one from mount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Probe commit={first} />);
    view.rerender(<Probe commit={second} />);
    act(() => firePageHide());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unmount", () => {
    const commit = vi.fn();
    const view = render(<Probe commit={commit} />);
    view.unmount();
    act(() => firePageHide());
    expect(commit).not.toHaveBeenCalled();
  });

  it("renders the state the commit sets before the event returns (flushSync)", () => {
    // Render the live value into the DOM rather than reassigning an
    // outer-scope variable during render (banned by `react-hooks/globals` —
    // components must stay pure); read it back via `screen`, still
    // synchronously inside the `act` below.
    function Setter() {
      const [v, setV] = useState("before");
      useCommitOnPageHide(() => setV("after"));
      return <span data-testid="seen">{v}</span>;
    }
    render(<Setter />);
    // Read INSIDE the act: an unloading page runs no later task.
    let during = "";
    act(() => { firePageHide(); during = screen.getByTestId("seen").textContent ?? ""; });
    expect(during).toBe("after");
  });
});
