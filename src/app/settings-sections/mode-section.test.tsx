import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeSection } from "./mode-section";
import { defaultSettings } from "../settings-types";
import { ALL_MODULE_IDS } from "../feature-modules";

function setup(features = [...ALL_MODULE_IDS]) {
  const onCommit = vi.fn();
  render(
    <ModeSection lang="en-US" settings={{ ...defaultSettings, features }} onCommitFeatures={onCommit} />,
  );
  return { onCommit };
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
    const save = screen.getByRole("button", { name: "Save & reload" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Simple" })); // draft -> []
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledWith([]);
  });

  it("toggling one module off from Advanced yields Modular and commits the remaining set", () => {
    const { onCommit } = setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("checkbox", { name: "RAID" })); // uncheck RAID
    fireEvent.click(screen.getByRole("button", { name: "Save & reload" }));
    const committed = onCommit.mock.calls[0][0] as string[];
    expect(committed).not.toContain("raid");
    expect(committed.length).toBe(ALL_MODULE_IDS.length - 1);
  });

  it("Discard resets the draft to saved (Save disabled again)", () => {
    setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("button", { name: "Simple" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "Save & reload" })).toBeDisabled();
  });
});
