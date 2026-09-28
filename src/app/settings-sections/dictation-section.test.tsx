// src/app/settings-sections/dictation-section.test.tsx
import React, { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictationSection } from "./dictation-section";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import { saveSecretValue } from "../use-secrets";
import { removeSealed } from "../secrets-store";

// The key's seal is mocked so a test can make it resolve `false` (superseded, §609);
// `removeSealed` is a spy so the stored flag is observable through the blank-blur path.
vi.mock("../use-secrets", () => ({ saveSecretValue: vi.fn() }));
vi.mock("../secrets-store", async (importActual) => ({
  ...(await importActual<typeof import("../secrets-store")>()),
  removeSealed: vi.fn(),
}));

afterEach(() => {
  vi.mocked(saveSecretValue).mockReset();
  vi.mocked(removeSealed).mockReset();
});

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

// §609 — the "stored" flag is set only when the seal actually wrote. It has no visible
// indicator here; it gates the blank-blur `removeSealed`, so that is what the tests observe.
describe("DictationSection — STT key stored flag (§609)", () => {
  function renderStt() {
    function Harness() {
      const [s, setS] = useState<Settings>({ ...defaultSettings, dictation: { engine: "stt", hotkey: "F4" } });
      return <DictationSection lang="en-US" settings={s} onChange={setS} />;
    }
    render(<Harness />);
    return screen.getByLabelText(t("en-US", "dictationSttKey"), { selector: "input" });
  }

  async function saveThenBlank(input: HTMLElement) {
    fireEvent.change(input, { target: { value: "stt-key" } });
    await act(async () => {
      fireEvent.blur(input);
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
  }

  it("a stored key is removed when the field is blanked (control)", async () => {
    vi.mocked(saveSecretValue).mockResolvedValueOnce(true);
    await saveThenBlank(renderStt());
    expect(saveSecretValue).toHaveBeenCalledWith("sttApiKey", "stt-key", "device");
    expect(removeSealed).toHaveBeenCalledWith("sttApiKey");
  });

  it("a superseded save (resolves false) leaves the stored flag off", async () => {
    vi.mocked(saveSecretValue).mockResolvedValueOnce(false);
    await saveThenBlank(renderStt());
    expect(saveSecretValue).toHaveBeenCalledWith("sttApiKey", "stt-key", "device");
    expect(removeSealed).not.toHaveBeenCalled();
  });
});
