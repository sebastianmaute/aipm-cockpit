import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeSection } from "./mode-section";
import { defaultSettings } from "../settings-types";
import { loadI18n, t, type Lang } from "../i18n";

beforeAll(async () => {
  await loadI18n("de");
});

function setup(
  settingsPatch: Partial<typeof defaultSettings> = {},
  lang: Lang = "en-US",
  hasCurrentProject = true,
) {
  const onOpenProjectFunctions = vi.fn();
  const onChange = vi.fn();
  render(
    <ModeSection
      lang={lang}
      settings={{ ...defaultSettings, ...settingsPatch }}
      hasCurrentProject={hasCurrentProject}
      onOpenProjectFunctions={onOpenProjectFunctions}
      onChange={onChange}
    />,
  );
  return { onOpenProjectFunctions, onChange };
}

describe("ModeSection pointer (§706)", () => {
  it("explains that functions are chosen per project and offers the open button, without expert mode", () => {
    setup();
    expect(screen.getByText("Functions are chosen per project.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open this project's functions" })).toBeEnabled();
  });

  it("the open button calls onOpenProjectFunctions", () => {
    const { onOpenProjectFunctions } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open this project's functions" }));
    expect(onOpenProjectFunctions).toHaveBeenCalledTimes(1);
  });

  it("the open button is disabled, with a described hint, when there is no current project", () => {
    const { onOpenProjectFunctions } = setup({}, "en-US", false);
    const button = screen.getByRole("button", { name: "Open this project's functions" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(t("en-US", "settingsFunctionsNoProject"));
    fireEvent.click(button);
    expect(onOpenProjectFunctions).not.toHaveBeenCalled();
  });

  it("no longer renders the presets, the module checkboxes or Save/Discard", () => {
    setup();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    expect(screen.queryByTestId("mode-badge")).toBeNull();
  });

  it("translates the pointer under German", () => {
    setup({}, "de");
    expect(screen.getByRole("button", { name: t("de", "settingsFunctionsOpen") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open this project's functions" })).toBeNull();
  });
});

describe("ModeSection version-history retention (expert only)", () => {
  it("is absent without expert mode", () => {
    setup();
    expect(screen.queryByRole("spinbutton", { name: "Version history: keep" })).toBeNull();
  });

  it("renders the stepper with min/step bounds in expert mode", () => {
    setup({ expertMode: true });
    const stepper = screen.getByRole("spinbutton", { name: "Version history: keep" });
    expect(stepper).toHaveAttribute("min", "50");
    expect(stepper).toHaveAttribute("step", "10");
    expect(stepper).toHaveAttribute("max", "1000");
  });

  it("snaps the retention value to the nearest 10 and patches versionHistoryRetention", () => {
    const { onChange } = setup({ expertMode: true });
    const stepper = screen.getByRole("spinbutton", { name: "Version history: keep" });
    fireEvent.change(stepper, { target: { value: "63" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ versionHistoryRetention: 60 }),
    );
  });

  it("clamps an over-max retention value to 1000", () => {
    const { onChange } = setup({ expertMode: true });
    const stepper = screen.getByRole("spinbutton", { name: "Version history: keep" });
    fireEvent.change(stepper, { target: { value: "9999" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ versionHistoryRetention: 1000 }),
    );
  });
});
