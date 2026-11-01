import { describe, it, expect, vi, beforeEach } from "vitest";
// AI people protection, Task 5: this file tests the feature, not the protection (`ai-people-gates.test.tsx`).
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { renderHook, render, screen, fireEvent, act } from "@testing-library/react";
import { ToastProvider } from "./toast-context";
import { useDictationMic } from "./dictation-mic";
import { getActiveDictationTarget, setActiveDictationTarget } from "./dictation-target";
import { t } from "./i18n";

// `listening` is mutable so both states of the mic button are reachable — the
// non-colour marker has to be asserted in BOTH, and a fixed `false` would make
// the ON half untestable.
// ★★★ `buttonHandlers` CARRIES REAL SPIES, NOT `{}`. It was an empty object in
// every test that renders a mic, which made the ONE line wiring push-to-talk
// into the button (`pressHandlers={ptt.buttonHandlers}`) invisible to the whole
// unit suite: deleting it typechecks (the prop is optional), and dictation dies
// on every surface with nothing red — `onToggle` is a deliberate no-op, so
// there is no click fallback to mask the loss. A primitive-level test cannot
// reach this; only wiring real handlers through the CONSUMER can.
const ptt = vi.hoisted(() => ({
  listening: false,
  unavailable: false,
  unavailableReason: null as string | null,
  buttonHandlers: { onPointerDown: vi.fn(), onKeyDown: vi.fn() },
  onError: null as ((err: string) => void) | null,
}));
vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: (args: { onError: (err: string) => void }) => (ptt.onError = args.onError, { listening: ptt.listening, transcribing: false, supported: true, unavailable: ptt.unavailable, unavailableReason: ptt.unavailableReason, buttonHandlers: ptt.buttonHandlers, toggle: () => {}, press: vi.fn(), release: vi.fn() }),
}));

beforeEach(() => {
  ptt.listening = false;
  ptt.unavailable = false;
  ptt.unavailableReason = null;
  ptt.buttonHandlers.onPointerDown.mockClear();
  ptt.buttonHandlers.onKeyDown.mockClear();
  setActiveDictationTarget(null);
});

function Mic({ padding }: { padding?: string }) {
  const { mic } = useDictationMic({ lang: "en-US", aiConsented: true, label: "Notes", onAppendFinal: vi.fn(), padding });
  return <>{mic}</>;
}

describe("useDictationMic — speech-to-text without the AI consent (AI-01)", () => {
  it("disables the mic and gives the reason as its accessible description", () => {
    ptt.unavailable = true;
    ptt.unavailableReason = "needs-ai-consent";
    render(<Mic />);
    const btn = screen.getByRole("button", { name: `${t("en-US", "dictationHold")} – Notes` });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(t("en-US", "dictationUnavailableNeedsAiConsent"));
  });
  it("speech-to-text not fully set up: disabled, with that reason as its description", () => {
    ptt.unavailable = true;
    ptt.unavailableReason = "speech-service-not-set-up";
    render(<Mic />);
    const btn = screen.getByRole("button", { name: `${t("en-US", "dictationHold")} – Notes` });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(t("en-US", "dictationUnavailableSttNotSetUp"));
  });
  it.each([
    ["ai-deployment-off", "aiDeploymentOff"],
    ["ai-deployment-invalid", "aiDeploymentInvalid"],
  ] as const)("deployment reason %s: disabled, described with %s", (code, key) => {
    ptt.unavailable = true;
    ptt.unavailableReason = code;
    render(<Mic />);
    const btn = screen.getByRole("button", { name: `${t("en-US", "dictationHold")} – Notes` });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(t("en-US", key));
  });
  it("an available mic is enabled and carries no such description (control)", () => {
    render(<Mic />);
    const btn = screen.getByRole("button", { name: `${t("en-US", "dictationHold")} – Notes` });
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-describedby");
  });
});

// A recording discarded because the organisation switched AI off (or its setting is invalid, or could not be
// confirmed) says that, never "switch AI on in Settings" or a generic transcription failure.
describe("useDictationMic — the deployment's AI setting after a recording", () => {
  it.each([
    ["ai-deployment-off", "aiDeploymentOff"],
    ["ai-deployment-invalid", "aiDeploymentInvalid"],
    ["ai-deployment-unconfirmed", "aiDeploymentUnconfirmed"],
    ["needs-ai-consent", "dictationUnavailableNeedsAiConsent"],
    ["people-forced", "dictationUnavailablePeopleProtected"],
    ["stt-500", "dictationTranscribeFailed"],
  ] as const)("%s shows %s", (code, key) => {
    const showToast = vi.fn();
    render(<ToastProvider value={{ showToast, showToastAction: vi.fn() }}><Mic /></ToastProvider>);
    act(() => ptt.onError?.(code));
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", key));
  });
});

describe("useDictationMic", () => {
  it("registers/clears the active target on focus/blur", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", aiConsented: true, label: "Notes", onAppendFinal: vi.fn() }));
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    result.current.registration.onBlur();
    expect(getActiveDictationTarget()).toBeNull();
  });
  it("exposes a mic element when supported", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", aiConsented: true, label: "Notes", onAppendFinal: vi.fn() }));
    expect(result.current.mic).not.toBeNull();
  });

  it("clears the active target on unmount", () => {
    const { result, unmount } = renderHook(() => useDictationMic({ lang: "en-US", aiConsented: true, label: "Notes", onAppendFinal: vi.fn() }));
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    unmount();
    expect(getActiveDictationTarget()).toBeNull();
  });

  it("keeps the active target across re-renders (stable identity)", () => {
    const { result, rerender } = renderHook(
      (props: { label: string }) => useDictationMic({ lang: "en-US", aiConsented: true, label: props.label, onAppendFinal: vi.fn() }),
      { initialProps: { label: "Notes" } },
    );
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    rerender({ label: "Notes" }); // same label → same target → cleanup must NOT null it
    expect(getActiveDictationTarget()?.label).toBe("Notes");
  });

  // ★★ WCAG 1.4.1. The listening cue was the icon colour alone
  //    (`--ui-green-strong` vs `--muted-foreground`), which clears 3:1 in ONE
  //    of the seven scheme combos (harbor-light, 3.08) and measures 1.20-2.72
  //    in the other six. The "Listening" text is NOT a fallback: this hook
  //    returns `mic` and `status` as SEPARATE nodes, so a consumer is free to
  //    put them anywhere — or, like note-log-panel, to drop `status` entirely.
  //    The marker makes the button self-sufficient however it is arranged.
  it("marks the listening state with a non-colour glyph, present when idle too", () => {
    const { container, rerender } = render(<Mic />);
    const marker = () => container.querySelector("[data-pressed-marker]") as SVGElement | null;
    const btn = () =>
      screen.getByRole("button", { name: `${t("en-US", "dictationHold")} – Notes` });

    expect(btn()).toHaveAttribute("aria-pressed", "false");
    expect(marker()?.getAttribute("data-pressed-marker")).toBe("off");
    // ★★★ THIS CONTROL IS THE ORIGINAL MOTIVATION FOR THE COLLAPSE: the dictate
    //     button is meant to EXPAND to hold its checkmark when toggled on and
    //     collapse again when off. So `w-0` here pins the INTENDED behaviour —
    //     do NOT "restore" this to `invisible`. The glyph is still RENDERED in
    //     both states (the assertion above), which is the WCAG 1.4.1 cue and is
    //     the part that must never regress. A consumer that genuinely needs the
    //     old constant width passes `reserveMarkerSpace`; this one must not.
    expect(marker()?.getAttribute("class") ?? "").toContain("w-0");
    expect(marker()?.getAttribute("class") ?? "").not.toContain("invisible");

    ptt.listening = true;
    rerender(<Mic />);
    expect(btn()).toHaveAttribute("aria-pressed", "true");
    expect(marker()?.getAttribute("data-pressed-marker")).toBe("on");
    expect(marker()?.getAttribute("class") ?? "").toContain("w-3.5");
    expect(marker()?.getAttribute("class") ?? "").not.toContain("invisible");
  });

  // ★★ The default accent is dark-blue, so without `accent="green"` the
  //    migration silently recolours the app's "recording" signal to chrome blue
  //    — a change nobody asked for and no contrast test would ever object to.
  // ★★ SCOPE, because the name used to claim more than the body: this asserts
  //    the pressed BORDER token and the pressed FILL, and nothing else. It does
  //    NOT pin the glyph colour, which `PRESSED.green` sets to
  //    `text-ui-dark-blue` / `dark:text-ui-light-grey` — the mic icon is
  //    `currentColor`, so the listening glyph is no longer green at all.
  // ★ classList, not a className substring: `bg-ui-green/10` is a substring of
  //   `hover:bg-ui-green/10`, so a substring match could not tell the pressed
  //   fill from a hover-only one.
  it("takes the green pressed border and fill, not the primitive's dark-blue default", () => {
    ptt.listening = true;
    render(<Mic />);
    const btn = screen.getByRole("button", {
      name: `${t("en-US", "dictationHold")} – Notes`,
    });
    expect(btn.classList.contains("border-[var(--control-state-border-green)]")).toBe(true);
    expect(btn.classList.contains("bg-ui-green/10")).toBe(true);
    expect(btn.classList.contains("bg-ui-dark-blue/10")).toBe(false);
  });

  // ★★★ THE ONLY THING THAT KILLS "delete `pressHandlers={ptt.buttonHandlers}`".
  //    Push-to-talk is the mic's ENTIRE interaction: hold to record. With the
  //    prop gone the button binds no pointer or key handler at all, and since
  //    `onToggle` is a deliberate no-op there is nothing left to fire — a dead
  //    control, typechecking, with every other assertion in this file still
  //    green (they all read classes, names and the marker).
  it("wires the push-to-talk handlers onto the mic button", () => {
    render(<Mic />);
    const btn = screen.getByRole("button", { name: `${t("en-US", "dictationHold")} – Notes` });
    fireEvent.pointerDown(btn);
    expect(ptt.buttonHandlers.onPointerDown).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(btn, { key: " " });
    expect(ptt.buttonHandlers.onKeyDown).toHaveBeenCalledTimes(1);
  });

  // ★ The accessible name is unchanged by the migration and stays row-unique
  //   (`Hold to dictate – <field>`); several panels query the mic by it.
  it("keeps the row-unique accessible name and the caller's padding", () => {
    const { rerender } = render(<Mic />);
    const name = `${t("en-US", "dictationHold")} – Notes`;
    let btn = screen.getByRole("button", { name });
    expect(btn).toHaveAccessibleName(name);
    expect(btn.className).toContain("px-2! py-1!");

    // ★★ A caller-supplied padding must WIN over the primitive's own chip
    //    padding, and class-attribute order decides nothing in CSS — hence the
    //    trailing `!`. jsdom has no cascade, so this pins the plumbing only.
    rerender(<Mic padding="px-4! py-2!" />);
    btn = screen.getByRole("button", { name });
    expect(btn.className).toContain("px-4! py-2!");
    expect(btn.className).not.toContain("px-2! py-1!");
  });
});
