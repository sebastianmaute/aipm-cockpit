import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaneToolbar, PaneSearchInput, AddButton } from "./pane-toolbar";

describe("PaneToolbar", () => {
  test("is a print-hidden wrapping flex row and appends className", () => {
    const { container } = render(<PaneToolbar className="custom"><span>x</span></PaneToolbar>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("flex-wrap");
    expect(el.className).toContain("print:hidden");
    expect(el.className).toContain("custom");
  });
});

describe("PaneSearchInput", () => {
  test("is a search input named by ariaLabel, with the flex width on its wrapper", () => {
    const { container } = render(
      <PaneSearchInput value="" onChange={() => {}} ariaLabel="Search changes" clearLabel="Clear – Search changes" />,
    );
    const input = screen.getByRole("searchbox", { name: "Search changes" });
    expect(input).toHaveAttribute("placeholder", "Search changes");
    expect(input.className).toContain("w-full");
    // The clear button is overlaid, so the flex sizing lives on the wrapper.
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).toContain("min-w-[12rem]");
  });

  test("emits the raw value on change and honours minW/placeholder overrides", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <PaneSearchInput
        value=""
        onChange={onChange}
        ariaLabel="Find"
        clearLabel="Clear – Find"
        placeholder="Type…"
        minW="min-w-[10rem]"
      />,
    );
    const input = screen.getByRole("searchbox", { name: "Find" });
    expect(input).toHaveAttribute("placeholder", "Type…");
    expect((container.firstChild as HTMLElement).className).toContain("min-w-[10rem]");
    await userEvent.type(input, "ab");
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  test("forwards native input props (title)", () => {
    render(
      <PaneSearchInput value="" onChange={() => {}} ariaLabel="Find" clearLabel="Clear – Find" title="Search hint" />,
    );
    expect(screen.getByRole("searchbox", { name: "Find" })).toHaveAttribute("title", "Search hint");
  });

  test("clears the value from a labelled button once non-empty", async () => {
    const onChange = vi.fn();
    render(
      <PaneSearchInput value="risk" onChange={onChange} ariaLabel="Find" clearLabel="Clear – Find" />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear – Find" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  test("renders no clear button while empty", () => {
    render(<PaneSearchInput value="" onChange={() => {}} ariaLabel="Find" clearLabel="Clear – Find" />);
    expect(screen.queryByRole("button", { name: "Clear – Find" })).toBeNull();
  });
});

describe("AddButton", () => {
  test("is a dark-blue filled button that fires onClick", async () => {
    const onClick = vi.fn();
    render(<AddButton onClick={onClick}>+ Add change</AddButton>);
    const btn = screen.getByRole("button", { name: "+ Add change" });
    expect(btn.className).toContain("bg-ui-dark-blue");
    expect(btn.className).toContain("text-white");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("forwards native button props (aria-label, title)", () => {
    render(<AddButton aria-label="Add a change" title="Add">+</AddButton>);
    const btn = screen.getByRole("button", { name: "Add a change" });
    expect(btn).toHaveAttribute("title", "Add");
    expect(btn).toHaveAttribute("type", "button");
  });
});
