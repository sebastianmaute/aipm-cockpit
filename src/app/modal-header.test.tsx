// src/app/modal-header.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalHeader } from "./modal-header";
import { Modal } from "./modal";
import { HELP_ENTRIES } from "./help-content";
import { ResetSizeIcon } from "./task-manager-ui";
import { VoiceCommandProvider } from "./voice-command-context";
import { loadI18n, t } from "./i18n";
import type { ReactNode } from "react";

// VoiceCommandButton depends on browser speech APIs — mock the module to avoid
// setup noise.
//
// ★★ IT RENDERS AN OBSERVABLE STAND-IN, NOT `null`. A `() => null` mock makes
// every assertion about WHETHER the mic rendered vacuous — the `hideVoiceCommand`
// test below would pass with the gate deleted. The stand-in carries only a
// testid: this file pins ModalHeader's GATING, and the real button's accessible
// name (the thing that actually collides) is pinned against the REAL component
// in `task-time-tracking-button.test.tsx`.
vi.mock("./voice-button", () => ({
  VoiceCommandButton: () => <button type="button" data-testid="voice-command-button" />,
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

  it("renders the mic when a provider is in scope, but not in a hideVoiceCommand header", () => {
    // THE STACKED-HEADER COLLISION, and the reason this prop exists.
    // `VoiceCommandButton` names itself with the fixed, unqualified
    // `voiceCommand` string and takes no override, so two headers open at once
    // put two identically-named controls in one document — the same WCAG 2.4.6
    // / speech-input defect `closeLabel` closes for the ✕, which speech input
    // resolves arbitrarily because it does not scope by `aria-modal`. axe has
    // no rule that flags two controls sharing a name, so this is the detector.
    //
    // Both headers are rendered TOGETHER under one live provider: the outer
    // one is the anti-vacuity control. Asserting only the absence would pass
    // against a broken provider, a broken mock, or a header that rendered
    // nothing at all.
    function liveWrapper({ children }: { children: ReactNode }) {
      return (
        <VoiceCommandProvider value={{ onCommand: vi.fn(), onError: vi.fn() }}>
          {children}
        </VoiceCommandProvider>
      );
    }
    render(
      <>
        <ModalHeader lang="en-US" title="Task form" onClose={vi.fn()} />
        <ModalHeader lang="en-US" title="Time tracking" onClose={vi.fn()} hideVoiceCommand />
      </>,
      { wrapper: liveWrapper },
    );
    const [outer, nested] = screen.getAllByRole("banner");
    expect(within(outer).getByTestId("voice-command-button")).toBeTruthy();
    expect(within(nested).queryByTestId("voice-command-button")).toBeNull();
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

describe("ModalHeader help icon", () => {
  it("renders no help icon when no helpConceptId is passed", () => {
    render(<ModalHeader lang="en-US" title="Edit risk" onClose={() => {}} />, { wrapper });
    expect(screen.queryByRole("button", { name: /^Help/ })).toBeNull();
    // ★ ANTI-VACUITY: the negative above passes on a header that rendered
    // nothing at all. This asserts the header DID render, so the absence is
    // a real absence.
    expect(screen.getByRole("button", { name: t("en-US", "alertModalClose") })).toBeInTheDocument();
  });

  it("renders a help icon named after the modal when helpConceptId is passed", () => {
    render(
      <ModalHeader
        lang="en-US"
        title="Edit risk"
        onClose={() => {}}
        helpConceptId="concept-raid"
        helpTitle="Edit risk"
      />,
      { wrapper },
    );
    expect(screen.getByRole("button", { name: "Help – Edit risk" })).toBeInTheDocument();
  });

  it("hideHelp removes the icon even though helpConceptId is set", () => {
    render(
      <ModalHeader
        lang="en-US"
        title="Edit risk"
        onClose={() => {}}
        helpConceptId="concept-raid"
        helpTitle="Edit risk"
        hideHelp
      />,
      { wrapper },
    );
    expect(screen.queryByRole("button", { name: /^Help/ })).toBeNull();
    // ★ ANTI-VACUITY, as in the no-helpConceptId case above: assert the header
    // itself rendered, or a broken render would satisfy the negative.
    expect(screen.getByRole("button", { name: t("en-US", "alertModalClose") })).toBeInTheDocument();
  });

  it("shows the entry's own body when the icon is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ModalHeader
        lang="en-US"
        title="Edit risk"
        onClose={() => {}}
        helpConceptId="concept-raid"
        helpTitle="Edit risk"
      />,
      { wrapper },
    );
    await user.click(screen.getByRole("button", { name: "Help – Edit risk" }));
    const entry = HELP_ENTRIES.find((e) => e.id === "concept-raid")!;
    expect(screen.getByText(t("en-US", entry.titleKey))).toBeInTheDocument();
  });

  it("gives two stacked headers distinct help-icon names", () => {
    render(
      <>
        <ModalHeader
          lang="en-US"
          title="Edit risk"
          onClose={() => {}}
          helpConceptId="concept-raid"
          helpTitle="Edit risk"
        />
        <ModalHeader
          lang="en-US"
          title="Edit change"
          onClose={() => {}}
          helpConceptId="concept-change"
          helpTitle="Edit change"
        />
      </>,
      { wrapper },
    );
    // ★ COLLISION SEED: two headers with genuinely DIFFERENT titles. A
    // single-header fixture satisfies a distinctness check trivially and is
    // vacuous. Both names are asserted individually, so a bare "Help" on
    // either one turns this red.
    expect(screen.getByRole("button", { name: "Help – Edit risk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help – Edit change" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
  });

  it("closes the popover on Escape without closing the modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    // ★★ RENDERED INSIDE THE REAL `Modal`, ON PURPOSE. `ModalHeader` owns no
    // Escape handler of its own — `modal.tsx` does — so a bare header makes
    // the `onClose` half VACUOUSLY true: nothing would have called it either
    // way. Stacking the two layers is the only way this assertion can observe
    // the distinction the shared dismissal stack exists to make.
    render(
      <Modal open onClose={onClose} ariaLabel="Edit risk dialog">
        <ModalHeader
          lang="en-US"
          title="Edit risk"
          onClose={onClose}
          helpConceptId="concept-raid"
          helpTitle="Edit risk"
        />
      </Modal>,
      { wrapper },
    );
    const entry = HELP_ENTRIES.find((e) => e.id === "concept-raid")!;
    const popoverName = t("en-US", entry.titleKey);
    // ★ Scoped by NAME, not a bare `getByRole("dialog")` — the enclosing
    // `Modal` is a dialog too, so an unscoped query is ambiguous here.
    await user.click(screen.getByRole("button", { name: "Help – Edit risk" }));
    expect(screen.getByRole("dialog", { name: popoverName })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: popoverName })).toBeNull();
    // The modal's own close must NOT have fired -- that is the whole point of
    // registering the popover as its own dismissal layer.
    expect(onClose).not.toHaveBeenCalled();
    // ★ And the modal is still open, so "Escape closed everything" cannot
    // masquerade as a pass.
    expect(screen.getByRole("dialog", { name: "Edit risk dialog" })).toBeInTheDocument();
    // ★★ THE FALSIFIER for the negative above. A second Escape, with the
    // popover gone and the modal topmost, MUST reach `Modal` — so a fixture
    // in which `onClose` could never fire at all (a broken render, a modal
    // that never registered) turns this red instead of silently certifying
    // the `not.toHaveBeenCalled()` one line up.
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names the help icon in German", async () => {
    // ★ The DE dictionary is LAZY — without this the assertion would read the
    // EN string and pass for the wrong reason.
    await loadI18n("de");
    render(
      <ModalHeader
        lang="de"
        title="Risiko bearbeiten"
        onClose={() => {}}
        helpConceptId="concept-raid"
        helpTitle="Risiko bearbeiten"
      />,
      { wrapper },
    );
    expect(screen.getByRole("button", { name: "Hilfe – Risiko bearbeiten" })).toBeInTheDocument();
  });
});
