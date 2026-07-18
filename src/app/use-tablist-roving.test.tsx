import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTablistRoving } from "./use-tablist-roving";

function Strip({ onSelect }: { onSelect: (v: string) => void }) {
  const roving = useTablistRoving();
  const tabs = ["a", "b", "c"];
  return (
    <div role="tablist" onKeyDown={roving}>
      {tabs.map((tviewsched, i) => (
        <button
          key={tviewsched}
          role="tab"
          tabIndex={i === 0 ? 0 : -1}
          aria-selected={i === 0}
          onClick={() => onSelect(tviewsched)}
        >
          {tviewsched}
        </button>
      ))}
    </div>
  );
}

describe("useTablistRoving", () => {
  it("ArrowRight moves focus to and activates the next tab, wrapping at the end", () => {
    const onSelect = vi.fn();
    render(<Strip onSelect={onSelect} />);
    const [a, b, c] = screen.getAllByRole("tab");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(b);
    expect(onSelect).toHaveBeenLastCalledWith("b");
    fireEvent.keyDown(b, { key: "ArrowRight" });
    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(document.activeElement).toBe(a); // wrapped
  });

  it("ArrowLeft wraps to the last tab", () => {
    const onSelect = vi.fn();
    render(<Strip onSelect={onSelect} />);
    const [a, , c] = screen.getAllByRole("tab");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(c);
  });

  it("Home / End jump to first / last", () => {
    render(<Strip onSelect={() => {}} />);
    const [a, b, c] = screen.getAllByRole("tab");
    b.focus();
    fireEvent.keyDown(b, { key: "End" });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c, { key: "Home" });
    expect(document.activeElement).toBe(a);
  });

  it("ignores non-navigation keys and focus that isn't on a tab", () => {
    const onSelect = vi.fn();
    render(<Strip onSelect={onSelect} />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
