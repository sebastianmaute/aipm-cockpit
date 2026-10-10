import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SavedViewsMenu } from "./saved-views-menu";
import { t } from "./i18n";
import { buttonClassFor } from "../test/button-variant";

function renderMenu() {
  render(<SavedViewsMenu lang="en-US" views={[]} onApplyView={vi.fn()} onSaveView={vi.fn()} onDeleteView={vi.fn()} />);
}

// §690 — the menu's three text buttons are the secondary Button at xs, the
// height of the xs name field beside them.
describe("SavedViewsMenu buttons", () => {
  it("draws Save, the save confirm and Cancel as the secondary Button", () => {
    renderMenu();
    const expected = buttonClassFor({ variant: "secondary", size: "xs" });
    const save = screen.getByRole("button", { name: t("en-US", "savedViewsSave") });
    expect(save.className).toBe(expected);
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: t("en-US", "savedViewsSave") }).className).toBe(expected);
    expect(screen.getByRole("button", { name: t("en-US", "savedViewsCancel") }).className).toBe(expected);
  });
});
