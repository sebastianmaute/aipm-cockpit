import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceCommandButton } from "./voice-button";
import { t } from "./i18n";

// The real module reads `window.SpeechRecognition`, which jsdom does not
// provide — unmocked, the button renders permanently unsupported and the
// listening state is unreachable, so every assertion below would be vacuous.
// `supported` is mutable so the third state (unsupported) is reachable too.
const voiceEnv = vi.hoisted(() => ({ supported: true }));
vi.mock("./voice", () => ({
  isVoiceSupported: () => voiceEnv.supported,
  startRecognition: vi.fn(() => () => {}),
  parseCommand: (text: string) => ({ kind: "unknown", text }),
}));

afterEach(() => {
  voiceEnv.supported = true;
});

const baseProps = {
  lang: "en-US" as const,
  onCommand: () => {},
  onError: () => {},
};

describe("VoiceCommandButton", () => {
  // ★★ The listening tint measured 1.21-1.42:1 against the idle background in
  //    all seven scheme combos — it is not a cue at all (WCAG 1.4.1), and
  //    `animate-pulse` was carrying the entire state signal. Motion is not a
  //    substitute: it is suppressed under prefers-reduced-motion and says
  //    nothing in a still frame.
  it("signals listening with a non-colour marker, rendered in BOTH states", () => {
    const { container } = render(<VoiceCommandButton {...baseProps} />);
    const btn = screen.getByRole("button", { name: "Voice command" });
    const marker = () => container.querySelector("[data-pressed-marker]") as SVGElement;

    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(marker()?.getAttribute("data-pressed-marker")).toBe("off");

    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Voice command" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(marker()?.getAttribute("data-pressed-marker")).toBe("on");
  });

  // WCAG 4.1.2 — the name is PINNED to the ENABLED action and must never flip
  // with state ("Voice command, pressed", never "Listening, pressed"). It must
  // also not absorb the tooltip, which states the state in words and reaches
  // AT as the accessible DESCRIPTION instead. The label is icon-only on
  // screen, so it rides an `sr-only` child rather than an `aria-label`.
  it("keeps the accessible name exactly 'Voice command' in both states", () => {
    render(<VoiceCommandButton {...baseProps} />);
    const btn = screen.getByRole("button", { name: "Voice command" });
    expect(btn).toHaveAccessibleName("Voice command");

    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Voice command" })).toHaveAccessibleName(
      "Voice command",
    );
  });

  // ★ All three tooltip states, pinned byte-for-byte. The unsupported one is
  //   the one worth a test: the primitive's on/off suffix ends "click to turn
  //   on", an instruction a disabled control cannot honour, and it must stay
  //   suppressed here.
  it("states the condition in the tooltip in all three states", () => {
    const lang = "en-US" as const;
    const { unmount } = render(<VoiceCommandButton {...baseProps} />);
    const idle = screen.getByRole("button", { name: "Voice command" });
    expect(idle).toHaveAttribute(
      "title",
      `${t(lang, "voiceCommandTip")} · ${t(lang, "toggleStateOff")}`,
    );

    fireEvent.click(idle);
    expect(screen.getByRole("button", { name: "Voice command" })).toHaveAttribute(
      "title",
      `${t(lang, "voiceListening")} · ${t(lang, "toggleStateOn")}`,
    );
    unmount();

    voiceEnv.supported = false;
    render(<VoiceCommandButton {...baseProps} />);
    const unsupported = screen.getByRole("button", { name: "Voice command" });
    expect(unsupported).toBeDisabled();
    expect(unsupported).toHaveAttribute("title", t(lang, "voiceUnsupported"));
  });
});
