import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeSection } from "./mode-section";
import { defaultSettings } from "../settings-types";
import { ALL_MODULE_IDS, type FeatureModuleId } from "../feature-modules";

function setup(features = [...ALL_MODULE_IDS], settingsPatch: Partial<typeof defaultSettings> = {}) {
  const onCommit = vi.fn();
  const onChange = vi.fn();
  render(
    <ModeSection
      lang="en-US"
      settings={{ ...defaultSettings, features, ...settingsPatch }}
      onCommitFeatures={onCommit}
      onChange={onChange}
    />,
  );
  return { onCommit, onChange };
}

describe("ModeSection", () => {
  it("shows Advanced when all modules are on", () => {
    setup([...ALL_MODULE_IDS]);
    // The badge span carries data-testid="mode-badge"; the "Advanced" preset button also
    // renders "Advanced", so we query the badge specifically.
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Advanced");
  });

  it("Save is disabled until the draft differs, then commits the draft", () => {
    const { onCommit } = setup([...ALL_MODULE_IDS]);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply Simple preset" })); // draft -> []
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledWith([]);
  });

  it("toggling one module off from Advanced yields Modular and commits the remaining set", () => {
    const { onCommit } = setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("checkbox", { name: "RAID" })); // uncheck RAID
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const committed = onCommit.mock.calls[0][0] as string[];
    expect(committed).not.toContain("raid");
    expect(committed.length).toBe(ALL_MODULE_IDS.length - 1);
    expect(committed).toEqual(ALL_MODULE_IDS.filter((id) => id !== "raid"));
  });

  it("Discard resets the draft to saved (Save disabled again)", () => {
    setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("button", { name: "Apply Simple preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("badge shows Modular when one module is unchecked", () => {
    setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("checkbox", { name: "RAID" }));
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Modular");
  });

  it("renders the version-history retention stepper with min/step bounds", () => {
    setup();
    const stepper = screen.getByRole("spinbutton", { name: "Version history: keep" });
    expect(stepper).toHaveAttribute("min", "50");
    expect(stepper).toHaveAttribute("step", "10");
    expect(stepper).toHaveAttribute("max", "1000");
  });

  it("snaps the retention value to the nearest 10 and patches versionHistoryRetention", () => {
    const { onChange } = setup();
    const stepper = screen.getByRole("spinbutton", { name: "Version history: keep" });
    fireEvent.change(stepper, { target: { value: "63" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ versionHistoryRetention: 60 }),
    );
  });

  it("clamps an over-max retention value to 1000", () => {
    const { onChange } = setup();
    const stepper = screen.getByRole("spinbutton", { name: "Version history: keep" });
    fireEvent.change(stepper, { target: { value: "9999" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ versionHistoryRetention: 1000 }),
    );
  });

  it("re-seeds the draft from the new feature set when remounted on a project switch", () => {
    // settings-view supplies a `key` derived from the active feature set, so a
    // project switch remounts ModeSection and re-seeds its draft. Simulate that
    // here: render with one set, then re-render with a new set AND a new key.
    const projA: FeatureModuleId[] = ["raid"];
    const projB: FeatureModuleId[] = ["budget"];
    const props = { lang: "en-US" as const, onCommitFeatures: vi.fn(), onChange: vi.fn() };
    const { rerender } = render(
      <ModeSection
        key={projA.join("|")}
        settings={{ ...defaultSettings, features: projA }}
        {...props}
      />,
    );
    // Project A: RAID checked, Budget not.
    expect(screen.getByRole("checkbox", { name: "RAID" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Budget" })).not.toBeChecked();

    rerender(
      <ModeSection
        key={projB.join("|")}
        settings={{ ...defaultSettings, features: projB }}
        {...props}
      />,
    );
    // Project B's draft reflects the NEW set (Budget on, RAID off) — not stale.
    expect(screen.getByRole("checkbox", { name: "Budget" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "RAID" })).not.toBeChecked();
    // Save is disabled because the re-seeded draft matches the new saved set.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
