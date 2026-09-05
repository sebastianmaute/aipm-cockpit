// src/app/modal-header.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModalHeader } from "./modal-header";
import { ResetSizeIcon } from "./task-manager-ui";
import { VoiceCommandProvider } from "./voice-command-context";
import { t } from "./i18n";
import type { ReactNode } from "react";

// VoiceCommandButton depends on browser speech APIs — mock the module so it
// renders nothing and avoids setup noise.
vi.mock("./voice-button", () => ({
  VoiceCommandButton: () => null,
}));

/** ModalHeader calls useVoiceCommand(); wrap with a null-value provider so the
 *  hook returns null (no voice button) and avoids a missing-context error. */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <VoiceCommandProvider value={null}>{children}</VoiceCommandProvider>
  );
}

function setup(
  over: Partial<React.ComponentProps<typeof ModalHeader>> = {},
) {
  const onClose = vi.fn();
  const props = {
    lang: "en-US" as const,
    title: "Test Modal",
    onClose,
    ...over,
  };
  render(<ModalHeader {...props} />, { wrapper });
  return { onClose };
}

describe("ModalHeader", () => {
  it("renders the provided title", () => {
    setup({ title: "My Dialog" });
    expect(screen.getByText("My Dialog")).toBeTruthy();
  });

  it("close button carries the alertModalClose aria-label and fires onClose", () => {
    const { onClose } = setup();
    const closeLabel = t("en-US", "alertModalClose");
    const btn = screen.getByRole("button", { name: closeLabel });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closeLabel overrides the close button's name and title, leaving the default untouched", () => {
    // Two modals can be open at once (this dialog's own header plus the task
    // form's beneath it), and every ModalHeader hardcoded the same close name.
    // Screen readers scope by aria-modal; SPEECH INPUT does not.
    const qualified = `${t("en-US", "alertModalClose")} – Time tracking`;
    setup({ closeLabel: qualified });
    const btn = screen.getByRole("button", { name: qualified });
    expect(btn.getAttribute("title")).toBe(qualified);
    // The default must be BYTE-IDENTICAL for every existing call site, so the
    // bare name must NOT resolve any more once an override was passed.
    expect(screen.queryByRole("button", { name: t("en-US", "alertModalClose") })).toBeNull();
  });

  it("falls back to alertModalClose for both name and title when closeLabel is omitted", () => {
    // The pin for "every existing call site is unchanged": the title attribute
    // is asserted too, because the prop feeds both.
    setup();
    const btn = screen.getByRole("button", { name: t("en-US", "alertModalClose") });
    expect(btn.getAttribute("title")).toBe(t("en-US", "alertModalClose"));
  });

  it("hideClose=true removes the close button", () => {
    setup({ hideClose: true });
    expect(
      screen.queryByRole("button", { name: t("en-US", "alertModalClose") }),
    ).toBeNull();
  });

  it("reset-size button uses the same inward-arrows glyph as the main-window reset buttons", () => {
    setup({ onResetLayout: () => {} });
    const resetLabel = t("en-US", "modalResetSize");
    const button = screen.getByRole("button", { name: resetLabel });
    const headerSvg = button.querySelector("svg");
    expect(headerSvg).toBeTruthy();

    const { container: refContainer } = render(<ResetSizeIcon />);
    const refSvg = refContainer.querySelector("svg");
    expect(refSvg).toBeTruthy();

    expect(headerSvg?.innerHTML).toBe(refSvg?.innerHTML);
  });

  it("dragHandleProps adds cursor-move class to the header element", () => {
    const dragHandleProps = {
      onPointerDown: vi.fn() as (e: React.PointerEvent<HTMLElement>) => void,
      onPointerMove: vi.fn() as (e: React.PointerEvent<HTMLElement>) => void,
      onPointerUp: vi.fn() as (e: React.PointerEvent<HTMLElement>) => void,
    };
    setup({ dragHandleProps });
    // The <header> element receives the drag props; the cursor-move class signals it.
    const header = screen.getByRole("banner");
    expect(header.className).toContain("cursor-move");
  });
});
