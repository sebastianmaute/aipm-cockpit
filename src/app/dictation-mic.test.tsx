import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, render, screen } from "@testing-library/react";
import { useDictationMic } from "./dictation-mic";
import { getActiveDictationTarget, setActiveDictationTarget } from "./dictation-target";
import { t } from "./i18n";

// `listening` is mutable so both states of the mic button are reachable — the
// non-colour marker has to be asserted in BOTH, and a fixed `false` would make
// the ON half untestable.
const ptt = vi.hoisted(() => ({ listening: false }));
vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: () => ({ listening: ptt.listening, transcribing: false, supported: true, buttonHandlers: {}, toggle: () => {}, press: vi.fn(), release: vi.fn() }),
}));

beforeEach(() => {
  ptt.listening = false;
  setActiveDictationTarget(null);
});

function Mic({ padding }: { padding?: string }) {
  const { mic } = useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn(), padding });
  return <>{mic}</>;
}

describe("useDictationMic", () => {
  it("registers/clears the active target on focus/blur", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    result.current.registration.onBlur();
    expect(getActiveDictationTarget()).toBeNull();
  });
  it("exposes a mic element when supported", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    expect(result.current.mic).not.toBeNull();
  });

  it("clears the active target on unmount", () => {
    const { result, unmount } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    unmount();
    expect(getActiveDictationTarget()).toBeNull();
  });

  it("keeps the active target across re-renders (stable identity)", () => {
    const { result, rerender } = renderHook(
      (props: { label: string }) => useDictationMic({ lang: "en-US", label: props.label, onAppendFinal: vi.fn() }),
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
    // Rendered while off too, so the button keeps ONE width across a press.
    expect(marker()?.getAttribute("class") ?? "").toContain("invisible");

    ptt.listening = true;
    rerender(<Mic />);
    expect(btn()).toHaveAttribute("aria-pressed", "true");
    expect(marker()?.getAttribute("data-pressed-marker")).toBe("on");
    expect(marker()?.getAttribute("class") ?? "").not.toContain("invisible");
  });

  // ★★ The mic KEEPS its green while gaining a conformant border. The default
  //    accent is dark-blue, so without `accent="green"` the migration silently
  //    recolours the app's "recording" signal to chrome blue — a change nobody
  //    asked for and no contrast test would ever object to. That is what this
  //    pins: not a ratio, but the identity.
  // ★ classList, not a className substring: `bg-ui-green/10` is a substring of
  //   `hover:bg-ui-green/10`, so a substring match could not tell the pressed
  //   fill from a hover-only one.
  it("keeps the green accent rather than the primitive's dark-blue default", () => {
    ptt.listening = true;
    render(<Mic />);
    const btn = screen.getByRole("button", {
      name: `${t("en-US", "dictationHold")} – Notes`,
    });
    expect(btn.classList.contains("border-[var(--control-state-border-green)]")).toBe(true);
    expect(btn.classList.contains("bg-ui-green/10")).toBe(true);
    expect(btn.classList.contains("bg-ui-dark-blue/10")).toBe(false);
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
