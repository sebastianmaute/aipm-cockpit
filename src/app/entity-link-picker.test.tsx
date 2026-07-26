import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";

const entry = (id: number, code: string, label: string): LinkPickerEntry => ({ id, code, label });

function renderPicker(overrides: Partial<React.ComponentProps<typeof EntityLinkPicker>> = {}) {
  const props = {
    selected: [] as readonly LinkPickerEntry[],
    options: [] as readonly LinkPickerEntry[],
    query: "",
    onQueryChange: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    searchLabel: "Link items",
    placeholder: "Search…",
    removeLabel: "Unlink",
    ...overrides,
  };
  return { ...render(<EntityLinkPicker {...props} />), props };
}

describe("EntityLinkPicker", () => {
  it("gives every chip's remove button a row-unique accessible name", () => {
    // The reason the code is appended rather than reused verbatim: N chips
    // sharing one "Unlink" name is a WCAG 2.4.6 failure that no axe run on a
    // single-chip fixture would ever catch (the collision needs two rows to
    // exist). This was the live state of the RAID caused-by picker.
    renderPicker({
      selected: [entry(3, "Risk#3", "Vendor delay"), entry(7, "Issue#7", "Budget freeze")],
    });
    const removes = screen.getAllByRole("button", { name: /unlink/i });
    expect(removes).toHaveLength(2);
    const names = removes.map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names).toContain("Unlink Risk#3");
    expect(names).toContain("Unlink Issue#7");
  });

  it("names the search box for assistive tech rather than relying on the placeholder", () => {
    // A placeholder is not an accessible name — an input carrying only one
    // reads as unlabeled to the axe gate and to a screen reader alike.
    renderPicker();
    const input = screen.getByRole("textbox", { name: "Link items" });
    expect(input).toHaveAttribute("placeholder", "Search…");
  });

  it("removes the entity the clicked chip belongs to", () => {
    const onRemove = vi.fn();
    renderPicker({ selected: [entry(3, "Risk#3", "A"), entry(7, "Issue#7", "B")], onRemove });
    fireEvent.click(screen.getByRole("button", { name: "Unlink Issue#7" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(7);
  });

  it("shows the dropdown only once the query is non-blank", () => {
    const options = [entry(9, "Risk#9", "Scope creep")];
    const { rerender, props } = renderPicker({ options });
    expect(screen.queryByRole("button", { name: /scope creep/i })).not.toBeInTheDocument();

    // Whitespace is not a query — trimming here is what stops a stray space
    // from dumping the whole option list over the form.
    rerender(<EntityLinkPicker {...props} options={options} query="   " />);
    expect(screen.queryByRole("button", { name: /scope creep/i })).not.toBeInTheDocument();

    rerender(<EntityLinkPicker {...props} options={options} query="scope" />);
    expect(screen.getByRole("button", { name: /scope creep/i })).toBeInTheDocument();
  });

  it("adds the option that was clicked, and does not clear the query itself", () => {
    // Clearing is the caller's call: the RAID cause picker rejects some picks
    // (self-reference, cycle) and deliberately keeps the query on that path.
    const onAdd = vi.fn();
    const onQueryChange = vi.fn();
    renderPicker({ options: [entry(9, "Risk#9", "Scope creep")], query: "scope", onAdd, onQueryChange });
    fireEvent.click(screen.getByRole("button", { name: /scope creep/i }));
    expect(onAdd).toHaveBeenCalledWith(9);
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("makes a chip navigable only when there is somewhere to navigate to", () => {
    const onOpen = vi.fn();
    const { unmount } = renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")], onOpen });
    fireEvent.click(screen.getByRole("button", { name: /risk#3 vendor delay/i }));
    expect(onOpen).toHaveBeenCalledWith(3);
    unmount();

    // Without onOpen the chip body is inert text — not a button that looks
    // clickable and does nothing.
    renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")] });
    expect(screen.queryByRole("button", { name: /vendor delay/i })).not.toBeInTheDocument();
    expect(screen.getByText("Vendor delay")).toBeInTheDocument();
  });

  it("keeps the jump glyph out of the chip's accessible name", () => {
    // Label-bleed guard: the ↩ is decoration next to text that already names
    // the target, so it must not end up announced as part of the name.
    renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")], onOpen: vi.fn() });
    const chip = screen.getByRole("button", { name: /vendor delay/i });
    expect(chip.textContent).toContain("↩");
    expect(chip).toHaveAccessibleName("Risk#3 Vendor delay");
  });

  it("renders a placeholder dash when nothing is linked yet", () => {
    renderPicker();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
