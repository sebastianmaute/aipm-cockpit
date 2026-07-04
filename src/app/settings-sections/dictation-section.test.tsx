// src/app/settings-sections/dictation-section.test.tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DictationSection } from "./dictation-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

function setup(overrides = {}) {
  const onChange = vi.fn();
  const settings = { ...defaultSettings, ...overrides };
  render(<DictationSection lang="en-US" settings={settings} onChange={onChange} />);
  return { onChange, settings };
}

describe("DictationSection — hotkey capture", () => {
  it("captures a keyboard combo when armed", () => {
    const { onChange } = setup();
    const captureBtn = screen.getByRole("button", { name: t("en-US", "dictationHotkey") });
    fireEvent.click(captureBtn); // arm
    fireEvent.keyDown(captureBtn, { key: "F5" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dictation: expect.objectContaining({ hotkey: "F5" }) }),
    );
  });

  it("captures a mouse Back side-button (button=3) as Mouse4 when armed", () => {
    const { onChange } = setup();
    const captureBtn = screen.getByRole("button", { name: t("en-US", "dictationHotkey") });
    fireEvent.click(captureBtn); // arm
    fireEvent.mouseDown(captureBtn, { button: 3 });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dictation: expect.objectContaining({ hotkey: "Mouse4" }) }),
    );
  });

  it("captures a mouse Forward side-button (button=4) as Mouse5 when armed", () => {
    const { onChange } = setup();
    const captureBtn = screen.getByRole("button", { name: t("en-US", "dictationHotkey") });
    fireEvent.click(captureBtn);
    fireEvent.mouseDown(captureBtn, { button: 4 });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dictation: expect.objectContaining({ hotkey: "Mouse5" }) }),
    );
  });

  it("★ SAFETY: a mousedown while NOT armed does not preventDefault (normal Back nav survives)", () => {
    setup();
    const captureBtn = screen.getByRole("button", { name: t("en-US", "dictationHotkey") });
    const evt = new MouseEvent("mousedown", { button: 3, bubbles: true, cancelable: true });
    const pd = vi.spyOn(evt, "preventDefault");
    captureBtn.dispatchEvent(evt);
    expect(pd).not.toHaveBeenCalled();
  });

  it("does not capture (and disarms) a non-capturable button (left click) while armed", () => {
    const { onChange } = setup();
    const captureBtn = screen.getByRole("button", { name: t("en-US", "dictationHotkey") });
    fireEvent.click(captureBtn); // arm
    onChange.mockClear();
    fireEvent.mouseDown(captureBtn, { button: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resets to F4", () => {
    const { onChange } = setup({ dictation: { engine: "web-speech" as const, hotkey: "Mouse4" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "dictationHotkeyReset") }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dictation: expect.objectContaining({ hotkey: "F4" }) }),
    );
  });
});
