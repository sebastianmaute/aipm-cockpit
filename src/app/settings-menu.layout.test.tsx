import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsMenu, defaultSettings } from "./settings-menu";

const asyncNoop = async () => {};

describe("SettingsMenu layout control", () => {
  it("calls onChange with the chosen layout", () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu
        settings={{ ...defaultSettings, layout: "modern" }}
        onChange={onChange}
        storageDescription={null}
        storageReady
        onPickStorageFile={asyncNoop}
        onOpenStorageFile={asyncNoop}
        onGrantStorageWrite={asyncNoop}
        onRequestStorageSwitch={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Classic" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ layout: "classic" }));
  });
});
