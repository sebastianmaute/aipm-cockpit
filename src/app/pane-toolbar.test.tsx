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
  test("is a search input named by ariaLabel with a flex-1 default width", () => {
    render(<PaneSearchInput value="" onChange={() => {}} ariaLabel="Search changes" />);
    const input = screen.getByRole("searchbox", { name: "Search changes" });
    expect(input).toHaveAttribute("placeholder", "Search changes");
    expect(input.className).toContain("flex-1");
    expect(input.className).toContain("min-w-[12rem]");
  });

  test("emits the raw value on change and honours minW/placeholder overrides", async () => {
    const onChange = vi.fn();
    render(
      <PaneSearchInput value="" onChange={onChange} ariaLabel="Find" placeholder="Type…" minW="min-w-[10rem]" />,
    );
    const input = screen.getByRole("searchbox", { name: "Find" });
    expect(input).toHaveAttribute("placeholder", "Type…");
    expect(input.className).toContain("min-w-[10rem]");
    await userEvent.type(input, "ab");
    expect(onChange).toHaveBeenLastCalledWith("b");
  });
});

describe("AddButton", () => {
  test("is a dark-blue filled button that fires onClick", async () => {
    const onClick = vi.fn();
    render(<AddButton onClick={onClick}>+ Add change</AddButton>);
    const btn = screen.getByRole("button", { name: "+ Add change" });
    expect(btn.className).toContain("bg-AIPM-dark-blue");
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
