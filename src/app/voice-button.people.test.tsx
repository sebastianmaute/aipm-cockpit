// AI people protection (owner decision 2026-10-31): browser voice commands are OFF while the open project protects
// its people. The browser's built-in speech recognition can send the audio to the browser vendor, the same reason
// dictation is off (spec P9). This file renders the button under the REAL privacy provider; the button's own
// mechanics are pinned in `voice-button.test.tsx`.
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { t } from "./i18n";
import { setDisabledIntegrations } from "./integration-switches";
import { useVoiceRecognition, VoiceCommandButton } from "./voice-button";
import { emptyWorkspace, type Workspace } from "./workspace";

const voiceEnv = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock("./voice", () => ({
  isVoiceSupported: () => true,
  startRecognition: vi.fn(() => voiceEnv.stop),
  parseCommand: (text: string) => ({ kind: "unknown", text }),
}));
import { startRecognition } from "./voice";

const allowed = (): Workspace => ({ ...emptyWorkspace(), settingsOverrides: withPeopleAllowed(undefined, true) });
const protectedWs = (): Workspace => ({ ...emptyWorkspace(), settingsOverrides: undefined });

const REASON = t("en-US", "voiceCommandUnavailablePeopleProtected");

function Source({ ws, children }: { ws: Workspace; children: ReactNode }) {
  useAiPrivacySource("p1", () => ws, () => 0);
  return <>{children}</>;
}

const tree = (ws: Workspace, children: ReactNode) => (
  <AiPrivacyProvider>
    <Source ws={ws}>{children}</Source>
  </AiPrivacyProvider>
);

function renderButton(start: Workspace, onError = vi.fn()) {
  const node = <VoiceCommandButton lang="en-US" onCommand={() => undefined} onError={onError} />;
  const view = render(tree(start, node));
  return { ...view, flip: (next: Workspace) => act(() => view.rerender(tree(next, node))) };
}

afterEach(() => {
  vi.mocked(startRecognition).mockClear();
  voiceEnv.stop.mockClear();
  setDisabledIntegrations([]);
});

describe("voice commands under people protection", () => {
  it("positive control: with people allowed the button is offered and starts recognition", () => {
    renderButton(allowed());
    fireEvent.click(screen.getByRole("button", { name: "Voice command" }));
    expect(startRecognition).toHaveBeenCalledTimes(1);
  });

  it("with protection on the button is absent, and a marker names the state with the reason as its description", () => {
    renderButton(protectedWs());
    expect(screen.queryByRole("button", { name: /voice command/i })).toBeNull();
    const marker = screen.getByRole("img", { name: t("en-US", "voiceCommandOff") });
    expect(marker).toHaveAccessibleDescription(REASON);
    expect(marker).toHaveAttribute("title", REASON);
    expect(startRecognition).not.toHaveBeenCalled();
  });

  it("is off outside the privacy provider (fail closed)", () => {
    render(<VoiceCommandButton lang="en-US" onCommand={() => undefined} onError={() => undefined} />);
    expect(screen.queryByRole("button", { name: /voice command/i })).toBeNull();
    expect(screen.getByRole("img", { name: t("en-US", "voiceCommandOff") })).toBeTruthy();
  });

  it("is off when the deployment locks protection on, even for a project that allows people", () => {
    setDisabledIntegrations(["ai-people"]);
    renderButton(allowed());
    expect(screen.queryByRole("button", { name: /voice command/i })).toBeNull();
  });

  it("the start handler refuses to construct a recogniser when called directly under protection", () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecognition("en-US", onError), {
      wrapper: ({ children }) => tree(protectedWs(), children),
    });
    act(() => result.current.toggle(() => undefined));
    expect(startRecognition).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
    expect(onError).toHaveBeenCalledWith(REASON);
  });

  it("the same handler starts recognition with people allowed (positive control for the direct call)", () => {
    const { result } = renderHook(() => useVoiceRecognition("en-US", vi.fn()), {
      wrapper: ({ children }) => tree(allowed(), children),
    });
    act(() => result.current.toggle(() => undefined));
    expect(startRecognition).toHaveBeenCalledTimes(1);
  });

  it("protection switched on while listening stops the recogniser and removes the button", () => {
    const { flip } = renderButton(allowed());
    fireEvent.click(screen.getByRole("button", { name: "Voice command" }));
    expect(voiceEnv.stop).not.toHaveBeenCalled();
    flip(protectedWs());
    expect(voiceEnv.stop).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /voice command/i })).toBeNull();
  });
});
