// src/app/settings-sections/dictation-section.test.tsx
import "fake-indexeddb/auto";
import React, { useState } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictationSection } from "./dictation-section";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import * as secrets from "../secrets";
import { type SealedSecret, sealDevice } from "../secrets";
import { loadSealed, readDeviceSecret, saveSealed } from "../secrets-store";

afterEach(async () => {
  // Let any un-awaited seal from a test land before the store is wiped (see ai-section.test).
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
  vi.restoreAllMocks();
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

// §609 — emptying the field removes the seal on the CHANGE, so it cancels a seal still in flight.
// (It used to be a blur clear gated on a "stored" flag that stayed false until the seal landed.)
describe("DictationSection — STT key seal vs a clear (§609)", () => {
  function renderStt() {
    function Harness() {
      const [s, setS] = useState<Settings>({ ...defaultSettings, dictation: { engine: "stt", hotkey: "F4" } });
      return <DictationSection lang="en-US" settings={s} onChange={setS} />;
    }
    render(<Harness />);
    return screen.getByLabelText(t("en-US", "dictationSttKey"), { selector: "input" });
  }

  it("a key blurred with a value is sealed and stored (control)", async () => {
    const input = renderStt();
    fireEvent.change(input, { target: { value: "stt-key" } });
    fireEvent.blur(input);
    await waitFor(async () => expect(await readDeviceSecret("sttApiKey")).toBe("stt-key"));
  });

  it("emptying the key while its seal is in flight wins: nothing is stored when the seal lands", async () => {
    const sealed = await sealDevice("sttApiKey", "stt-key"); // real ciphertext, before the spy
    let releaseSeal: (s: SealedSecret) => void = () => {};
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(
      new Promise<SealedSecret>((r) => {
        releaseSeal = r;
      }),
    );
    const input = renderStt();
    fireEvent.change(input, { target: { value: "stt-key" } });
    fireEvent.blur(input); // seal starts, held open
    expect(secrets.sealDevice).toHaveBeenCalledWith("sttApiKey", "stt-key");
    fireEvent.change(input, { target: { value: "" } }); // emptied → removeSealed
    fireEvent.blur(input);

    await act(async () => {
      releaseSeal(sealed);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(loadSealed("sttApiKey")).toBeNull();
  });

  // A field that renders blank while a key is stored (e.g. another tab saved it after this one
  // rendered) must not lose that key to a focus-and-leave: only an EDIT to blank removes it.
  it("blurring a field that was already blank keeps a stored key", async () => {
    saveSealed(await sealDevice("sttApiKey", "other-tab-key"));
    const input = renderStt(); // settings hold no key, so the field is blank
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(await readDeviceSecret("sttApiKey")).toBe("other-tab-key");
  });
});
