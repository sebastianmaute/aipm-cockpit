import { describe, expect, it, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { KpiGradientBar, ReportCard, Section, SortResizeTh, TableFilter, Tile } from "./report-table";
import { t } from "./i18n";

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

  // The complement of calendar-series-list's "renders no column-resize grip":
  // that test proves a grip is ABSENT by looking for `.cursor-col-resize`, which
  // is only meaningful if a grip actually carries that class. Without this, both
  // assertions could pass while the selector matched nothing anywhere.
  it("renders a resize grip carrying cursor-col-resize when onResize is passed", () => {
    render(
      <table><thead><tr>
        <SortResizeTh label="Due" sortCol="dueDate" sortKey="dueDate" sortDir="asc" onSort={() => {}} onResize={() => {}} />
      </tr></thead></table>,
    );
    expect(screen.getByRole("columnheader").querySelectorAll(".cursor-col-resize")).toHaveLength(1);
  });

  // Sort state used to reach assistive tech ONLY as a bare "↑"/"↓" glued into
  // the button's accessible name — a glyph, not a state. axe has no rule for a
  // missing aria-sort, so the gate stayed silent even on the scanned views.
  // change-panel and raid-panel-rows already do this on their raw <th>s; these
  // pin it for the shared component every other table composes.
  describe("aria-sort", () => {
    function renderTh(sortKey: string, sortDir: "asc" | "desc" | "off") {
      render(
        <table><thead><tr>
          <SortResizeTh label="Due" sortCol="dueDate" sortKey={sortKey} sortDir={sortDir} onSort={() => {}} onResize={() => {}} />
        </tr></thead></table>,
      );
      return screen.getByRole("columnheader");
    }

    it("is 'ascending' on the active column sorted ascending", () => {
      expect(renderTh("dueDate", "asc")).toHaveAttribute("aria-sort", "ascending");
    });

    it("is 'descending' on the active column sorted descending", () => {
      expect(renderTh("dueDate", "desc")).toHaveAttribute("aria-sort", "descending");
    });

    it("is 'none' on a column that is not the active one", () => {
      expect(renderTh("title", "asc")).toHaveAttribute("aria-sort", "none");
    });

    // "off" is a real member of SortDir (the asc→desc→off cycle), and it means
    // UNSORTED even though sortKey still names this column. Reading only
    // sortKey would announce a sort that is not applied.
    it("is 'none' when this column is named but the direction is off", () => {
      expect(renderTh("dueDate", "off")).toHaveAttribute("aria-sort", "none");
    });
  });

  // With aria-sort carrying the state, the glyph in the name is a second,
  // redundant announcement in a different vocabulary. It stays VISIBLE (and
  // therefore in textContent, which is what the existing glyph assertions here
  // and in calendar-series-list.test.tsx read) but leaves the accessible name.
  it("keeps the sort arrow visible but out of the button's accessible name", () => {
    render(
      <table><thead><tr>
        <SortResizeTh label="Due" sortCol="dueDate" sortKey="dueDate" sortDir="asc" onSort={() => {}} onResize={() => {}} />
      </tr></thead></table>,
    );
    // A string `name` is an EXACT match, so this fails if the arrow is still
    // part of the computed name.
    const btn = screen.getByRole("button", { name: "Due" });
    expect(btn.textContent).toContain("↑");
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

  // ★★ Several of these render on ONE view (Reports has more than one, and it
  // is axe-scanned), so a bare "Clear" on each gives N controls the same
  // accessible name — WCAG 2.4.6. The axe gate CANNOT catch this: a name exists,
  // so it passes. The name is therefore qualified with the field's own
  // placeholder, and this test is the only thing guarding that.
  //
  // Queried by exact name rather than /clear/i: the regex used by the tests
  // above matches both buttons and would pass even if the qualification were
  // reverted, which is exactly the failure mode being guarded.
  it("gives sibling filters DISTINCT accessible names", () => {
    render(
      <>
        <TableFilter lang="en-US" value="a" onChange={() => {}} placeholderKey="reportsFilterGroup" />
        <TableFilter lang="en-US" value="b" onChange={() => {}} placeholderKey="reportsFilterLabel" />
      </>,
    );
    const names = screen
      .getAllByRole("button", { name: /clear/i })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain(t("en-US", "reportsFilterGroup"));
    expect(names[1]).toContain(t("en-US", "reportsFilterLabel"));
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

describe("Tile sub slot", () => {
  it("renders the sub line after the value when given", () => {
    const { container } = render(<Tile label="Total" value={10} sub="2 cancelled" />);
    const sub = container.querySelector("[data-tile-sub]");
    expect(sub).not.toBeNull();
    expect(sub?.textContent).toBe("2 cancelled");
    // The name says "after the value", so assert the ORDER — otherwise
    // rendering the qualifier ABOVE the headline number also passes, and a
    // qualifier that precedes what it qualifies reads as a second metric.
    const value = screen.getByText("10");
    expect(
      value.compareDocumentPosition(sub as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no sub line when omitted", () => {
    const { container } = render(<Tile label="Total" value={10} />);
    // Structural, not textual: this fixture never passes the string "cancelled",
    // so asserting its absence could not fail whatever `Tile` did.
    expect(container.querySelector("[data-tile-sub]")).toBeNull();
  });
});
