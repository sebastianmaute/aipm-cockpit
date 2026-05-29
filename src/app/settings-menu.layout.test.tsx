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

  it("shows the panel when controlled open=true without clicking the trigger", () => {
    render(
      <SettingsMenu
        settings={defaultSettings}
        onChange={() => {}}
        storageDescription={null}
        storageReady
        onPickStorageFile={asyncNoop}
        onOpenStorageFile={asyncNoop}
        onGrantStorageWrite={asyncNoop}
        onRequestStorageSwitch={() => {}}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Classic" })).toBeInTheDocument();
  });

  it("hides the panel when controlled open=false", () => {
    render(
      <SettingsMenu
        settings={defaultSettings}
        onChange={() => {}}
        storageDescription={null}
        storageReady
        onPickStorageFile={asyncNoop}
        onOpenStorageFile={asyncNoop}
        onGrantStorageWrite={asyncNoop}
        onRequestStorageSwitch={() => {}}
        open={false}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByRole("radio", { name: "Classic" })).not.toBeInTheDocument();
  });
});
