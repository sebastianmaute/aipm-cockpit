import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComboboxOptions } from "./combobox-shared";

function renderOptions(highlight: number) {
  render(
    <ComboboxOptions
      listId="lb"
      filtered={["alpha", "beta"]}
      highlight={highlight}
      showAddNew={false}
      addNewLabel="Add"
      onSelect={vi.fn()}
      onAddNew={vi.fn()}
    />,
  );
}

// This is the shared dropdown that global-search-box and entity-link-picker
// both copied their highlight treatment FROM. Both of them hit the dark-mode
// contrast bug, repaired it locally, and left the original carrying it — so
// the file every other consumer inherits from was the last to be fixed, and
// was the only one with no test. entity-link-picker.test.tsx already asserts
// exactly this shape; this is the same assertion applied at the source.
describe("ComboboxOptions highlighted row", () => {
  it("marks the active option without relying on a colour that dies in dark mode", () => {
    renderOptions(0);
    const active = screen.getAllByRole("option")[0].querySelector("button");
    // `text-ui-dark-blue` on a dark `--surface-muted` is ~1.0-1.2:1 — the
    // highlight was signalled by its own text disappearing, which is the worst
    // possible failure for the one thing identifying the active row.
    expect(active?.className).not.toContain("text-ui-dark-blue");
    expect(active?.className).toContain("text-foreground");
    // Weight and ring are non-colour signals, so they survive every scheme.
    expect(active?.className).toContain("font-medium");
    // The ring must be --foreground, never a brand accent: an accent is tuned
    // for one mode (ring-ui-green measures 1.7-2.1:1 on these row fills, under
    // the 3:1 that WCAG 1.4.11 asks of a non-text indicator).
    expect(active?.className).toContain("ring-foreground");
  });

  it("gives the highlighted add-new row a dark TEXT companion, not just a dark background", () => {
    // This branch set dark:bg but not dark:text, so it inherited a near-black
    // navy on a green-tinted dark surface — highlighting the row made it
    // harder to read than leaving it alone. The UNhighlighted branch already
    // carried the companion, which is exactly why the omission survived: the
    // pair reads as handled at a glance.
    render(
      <ComboboxOptions
        listId="lb"
        filtered={["alpha"]}
        highlight={1}
        showAddNew
        addNewLabel="Add new"
        onSelect={vi.fn()}
        onAddNew={vi.fn()}
      />,
    );
    const addNew = screen.getByRole("button", { name: /add new/i });
    expect(addNew.className).toContain("dark:text-ui-light-grey");
  });

  it("leaves the non-highlighted rows unstyled apart from hover", () => {
    renderOptions(0);
    const inactive = screen.getAllByRole("option")[1].querySelector("button");
    expect(inactive?.className).toContain("hover:bg-surface-muted");
    expect(inactive?.className).not.toContain("font-medium");
    expect(inactive?.className).not.toContain("ring-foreground");
  });
});
