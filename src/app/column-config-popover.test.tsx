import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnConfigPopover } from "./column-config-popover";
import { t } from "./i18n";

const COLS = [
  { key: "email", labelKey: "stakeholderFieldEmail" as const },
  { key: "title", labelKey: "stakeholderFieldTitle" as const },
];

it("opens the dialog and lists a checkbox per column (checked = visible)", () => {
  render(<ColumnConfigPopover lang="en-US" cols={COLS} hidden={new Set(["email"])} onToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
  const email = screen.getByLabelText(t("en-US", "stakeholderFieldEmail")) as HTMLInputElement;
  const title = screen.getByLabelText(t("en-US", "stakeholderFieldTitle")) as HTMLInputElement;
  expect(email.checked).toBe(false); // hidden
  expect(title.checked).toBe(true);
});

it("fires onToggle(key) when a checkbox is clicked", () => {
  const onToggle = vi.fn();
  render(<ColumnConfigPopover lang="en-US" cols={COLS} hidden={new Set()} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
  fireEvent.click(screen.getByLabelText(t("en-US", "stakeholderFieldEmail")));
  expect(onToggle).toHaveBeenCalledWith("email");
});
