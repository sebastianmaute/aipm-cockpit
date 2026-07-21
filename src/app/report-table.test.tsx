import { describe, expect, it, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { KpiGradientBar, ReportCard, Section, SortResizeTh, TableFilter, Tile } from "./report-table";

function Harness() {
  const ref = useRef<HTMLDivElement | null>(null);
  return <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}}><p>body</p></ReportCard>;
}

describe("SortResizeTh", () => {
  it("renders a native 'Sort by' title tooltip and fires onSort with the column key", () => {
    const onSort = vi.fn();
    render(
      <table><thead><tr>
        <SortResizeTh label="Due" sortCol="dueDate" sortKey="dueDate" sortDir="asc" onSort={onSort} onResize={() => {}} title="Sort by Due" />
      </tr></thead></table>,
    );
    const btn = screen.getByRole("button", { name: /due/i });
    expect(btn).toHaveAttribute("title", "Sort by Due");
    // Active column shows the accent color + ascending arrow.
    expect(btn.className).toContain("text-[var(--table-head-accent)]");
    expect(btn.textContent).toContain("↑");
    fireEvent.click(btn);
    expect(onSort).toHaveBeenCalledWith("dueDate");
  });

  it("omits the inline width when width is undefined (colgroup-sized tables)", () => {
    render(
      <table><thead><tr>
        <SortResizeTh label="Task" sortCol="taskName" sortKey="id" sortDir="asc" onSort={() => {}} onResize={() => {}} />
      </tr></thead></table>,
    );
    const th = screen.getByRole("columnheader");
    expect(th.style.width).toBe("");
    // Not the active column (sortKey "id" ≠ sortCol "taskName") → no arrow.
    expect(th.textContent).not.toContain("↑");
    expect(th.textContent).not.toContain("↓");
  });
});

describe("ReportCard", () => {
  test("renders content inside a resizable print-root card", () => {
    const { container } = render(<Harness />);
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(container.querySelector(".print-root")).toBeTruthy();
  });

  test("opts into landscape printing via .print-landscape on the card root", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector(".print-root.print-landscape")).toBeTruthy();
  });

  test("renders a left-aligned heading when title is given, outside the print-hidden toolbar", () => {
    function H() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}} title="My Report">
          <p>body</p>
        </ReportCard>
      );
    }
    render(<H />);
    const heading = screen.getByRole("heading", { name: "My Report" });
    expect(heading).toBeInTheDocument();
    // the heading must NOT live inside the print:hidden button cluster
    expect(heading.closest('[class*="print:hidden"]')).toBeNull();
  });

  test("omits the heading when no title is given", () => {
    function H() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}}>
          <p>body</p>
        </ReportCard>
      );
    }
    render(<H />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("Section boxed variant", () => {
  test("adds the outline box classes when boxed", () => {
    const { container } = render(<Section title="T" boxed>x</Section>);
    expect((container.firstChild as HTMLElement).className).toContain("border-line");
  });
  test("has no box by default", () => {
    const { container } = render(<Section title="T">x</Section>);
    expect((container.firstChild as HTMLElement).className).not.toContain("border-line");
  });
});

describe("Tile rag slot", () => {
  test("renders the rag node when provided", () => {
    render(<Tile label="L" value="V" rag={<span>RAGBADGE</span>} />);
    expect(screen.getByText("RAGBADGE")).toBeTruthy();
  });
});

test("Tile renders a ReactNode value", () => {
  render(<Tile label="Split" value={<span data-testid="node">1 / 2 / 3</span>} />);
  expect(screen.getByTestId("node")).toHaveTextContent("1 / 2 / 3");
});

describe("Tile clickable variant", () => {
  it("renders a button with the activateLabel name and fires onActivate", () => {
    const onActivate = vi.fn();
    render(<Tile label="Overdue" value="3" onActivate={onActivate} activateLabel="Open the tasks list" />);
    const btn = screen.getByRole("button", { name: "Open the tasks list" });
    fireEvent.click(btn);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("renders a non-interactive tile without onActivate", () => {
    render(<Tile label="Complete" value="42%" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Tile shadow token opt-in", () => {
  it("button variant carries shadow-[var(--shadow-card)] class", () => {
    const { container } = render(
      <Tile label="KPI" value="7" onActivate={() => {}} activateLabel="Open view" />,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("shadow-[var(--shadow-card)]");
  });

  it("static div variant carries shadow-[var(--shadow-card)] class", () => {
    const { container } = render(<Tile label="KPI" value="7" />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("shadow-[var(--shadow-card)]");
  });
});

describe("Section boxed shadow token opt-in", () => {
  it("boxed variant carries shadow-[var(--shadow-card)] class", () => {
    const { container } = render(<Section title="T" boxed>x</Section>);
    expect((container.firstChild as HTMLElement).className).toContain("shadow-[var(--shadow-card)]");
  });
});

describe("KpiGradientBar", () => {
  it("fill child has inline width matching the percent", () => {
    const { container } = render(<KpiGradientBar percent={60} label="Complete" />);
    const fill = container.querySelector("[style]") as HTMLElement;
    expect(fill.style.width).toBe("60%");
  });

  it("clamps percent above 100 to 100%", () => {
    const { container } = render(<KpiGradientBar percent={150} label="Complete" />);
    const fill = container.querySelector("[style]") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("clamps percent below 0 to 0%", () => {
    const { container } = render(<KpiGradientBar percent={-10} label="Complete" />);
    const fill = container.querySelector("[style]") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("falls back to 0% for a non-finite percent (NaN)", () => {
    const { container } = render(<KpiGradientBar percent={NaN} label="Complete" />);
    const fill = container.querySelector("[style]") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("bar element has role=img with aria-label containing the percent", () => {
    render(<KpiGradientBar percent={60} label="Complete" />);
    const bar = screen.getByRole("img");
    expect(bar).toHaveAttribute("aria-label", "Complete: 60%");
  });

  it("fill background uses the gradient-kpi token", () => {
    const { container } = render(<KpiGradientBar percent={50} label="Complete" />);
    const fill = container.querySelector("[style]") as HTMLElement;
    expect(fill.style.background).toBe("var(--gradient-kpi)");
  });
});

describe("TableFilter", () => {
  // The field is type=search, so Chrome/Safari draw a native ✕ INSIDE it while
  // a separate styled ✕ sat beside it — two clear controls on those browsers,
  // none-but-ours on Firefox. One styled ✕ positioned inside the field is the
  // only shape that reads the same everywhere and stays keyboard-reachable.
  //
  // ★ Only the markup/padding/tab-order tests below pin THAT change. The
  // "clears the value" and "no control while empty" cases assert behaviour that
  // predates it — deliberate regression guards, not coverage of the fix.
  it("renders its clear control positioned inside the input, not beside it", () => {
    render(<TableFilter lang="en-US" value="alpha" onChange={() => {}} placeholderKey="reportsFilterGroup" />);
    const clear = screen.getByRole("button", { name: /clear/i });
    expect(clear.className).toContain("absolute");
    expect(clear.parentElement?.className).toContain("relative");
    // The input reserves room for the overlaid ✕ and suppresses the native one.
    // Assert the WHOLE arbitrary variant: matching only "search-cancel-button"
    // would still pass for `:block`, which un-suppresses the native ✕ and
    // restores the double-clear this change exists to remove.
    const input = screen.getByRole("searchbox");
    expect(input.className).toContain("pr-8");
    expect(input.className).toContain("[&::-webkit-search-cancel-button]:appearance-none");
  });

  // The ✕ is absolutely positioned, which changes where it PAINTS but not where
  // it sits in the tab sequence — it must still follow its own input, not jump
  // ahead of it or land after an unrelated control.
  it("keeps the clear ✕ immediately after its input in the tab order", async () => {
    const user = userEvent.setup();
    render(
      <>
        <TableFilter lang="en-US" value="alpha" onChange={() => {}} placeholderKey="reportsFilterGroup" />
        <button type="button">after</button>
      </>,
    );
    const input = screen.getByRole("searchbox");
    input.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: /clear/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("clears the value when the ✕ is pressed", () => {
    const onChange = vi.fn();
    render(<TableFilter lang="en-US" value="alpha" onChange={onChange} placeholderKey="reportsFilterGroup" />);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("renders no clear control while the filter is empty", () => {
    render(<TableFilter lang="en-US" value="" onChange={() => {}} placeholderKey="reportsFilterGroup" />);
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  // pr-8 reserves room for the overlaid ✕. With no ✕ rendered that padding is
  // dead space that shortens the visible placeholder, so it must be conditional.
  it("only reserves ✕ padding while the ✕ is actually rendered", () => {
    const { unmount } = render(
      <TableFilter lang="en-US" value="" onChange={() => {}} placeholderKey="reportsFilterGroup" />,
    );
    expect(screen.getByRole("searchbox").className).not.toContain("pr-8");
    unmount();
    render(<TableFilter lang="en-US" value="alpha" onChange={() => {}} placeholderKey="reportsFilterGroup" />);
    expect(screen.getByRole("searchbox").className).toContain("pr-8");
  });
});
