import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveTemplateMenu, ApplyTemplateMenu } from "./template-menus";
import { t } from "./i18n";
import type { ProjectTemplate } from "./templates";

const tpls: ProjectTemplate[] = [
  { id: "a", name: "Alpha", features: [], fieldVisibility: {}, seed: { tasks: [] } },
  { id: "b", name: "Beta", features: [], fieldVisibility: {} },
];

describe("SaveTemplateMenu", () => {
  it("calls onSave with name + includeContent", () => {
    const onSave = vi.fn();
    render(<SaveTemplateMenu lang="en-US" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateSaveTitle") }));
    fireEvent.change(screen.getByLabelText(t("en-US", "templateSaveName")), {
      target: { value: "My Template" },
    });
    fireEvent.click(screen.getByLabelText(t("en-US", "templateIncludeContent")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateSaveAction") }));
    expect(onSave).toHaveBeenCalledWith({ name: "My Template", includeContent: true });
  });

  it("disables Save while the name is blank", () => {
    const onSave = vi.fn();
    render(<SaveTemplateMenu lang="en-US" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateSaveTitle") }));
    const save = screen.getByRole("button", { name: t("en-US", "templateSaveAction") });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(t("en-US", "templateSaveName")), {
      target: { value: "  " },
    });
    expect(save).toBeDisabled();
  });
});

describe("ApplyTemplateMenu", () => {
  it("calls onApply with the selected template id + includeSeed", () => {
    const onApply = vi.fn();
    render(<ApplyTemplateMenu lang="en-US" templates={tpls} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateApplyTitle") }));
    fireEvent.change(screen.getByLabelText(t("en-US", "templatePick")), {
      target: { value: "b" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateApplyAction") }));
    expect(onApply).toHaveBeenCalledWith("b", { includeSeed: false });
  });

  it("defaults to the first template and forwards includeSeed when checked", () => {
    const onApply = vi.fn();
    render(<ApplyTemplateMenu lang="en-US" templates={tpls} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateApplyTitle") }));
    fireEvent.click(screen.getByLabelText(t("en-US", "templateIncludeSeed")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateApplyAction") }));
    expect(onApply).toHaveBeenCalledWith("a", { includeSeed: true });
  });

  it("disables Apply when there are no templates", () => {
    const onApply = vi.fn();
    render(<ApplyTemplateMenu lang="en-US" templates={[]} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateApplyTitle") }));
    expect(
      screen.getByRole("button", { name: t("en-US", "templateApplyAction") }),
    ).toBeDisabled();
  });
});
