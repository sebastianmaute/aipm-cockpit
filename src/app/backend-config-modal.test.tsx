// src/app/backend-config-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackendConfigModal } from "./backend-config-modal";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";

// BackendConfigModal wraps Modal + ModalHeader + IntegrationsSection.
// Modal and IntegrationsSection are mocked so this test focuses on the shell.
//
// ★★ ModalHeader is deliberately NOT mocked. The help-icon tests below turn on
// whether an icon RENDERS, and a stub that decides that for itself proves only
// that a prop was threaded — it would stay green if the real header started
// rendering the icon regardless of `hideHelp`. The real header costs nothing
// here: `useVoiceCommand` returns null with no provider (no mic), and its ✕
// carries the same `alertModalClose` name the old stub gave it, so the close
// tests below are unaffected.
vi.mock("./modal", () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("./settings-sections/integrations-section", () => ({
  IntegrationsSection: ({
    onChange,
  }: {
    onChange: (s: typeof defaultSettings) => void;
  }) => (
    <button
      type="button"
      data-testid="integrations-section"
      onClick={() => onChange(defaultSettings)}
    >
      integrations
    </button>
  ),
}));

function setup(over: Partial<React.ComponentProps<typeof BackendConfigModal>> = {}) {
  const onClose = vi.fn();
  const onChangeSettings = vi.fn();
  const props = {
    lang: "en-US" as const,
    title: "Backend Configuration",
    settings: defaultSettings,
    onChangeSettings,
    onClose,
    ...over,
  };
  render(<BackendConfigModal {...props} />);
  return { onClose, onChangeSettings };
}

describe("BackendConfigModal", () => {
  it("renders the modal with the provided title", () => {
    setup({ title: "Configure Storage" });
    expect(screen.getByText("Configure Storage")).toBeTruthy();
    expect(screen.getByTestId("modal")).toBeTruthy();
  });

  it("footer Close button fires onClose", () => {
    const { onClose } = setup();
    // There are two Close controls: the ModalHeader one and the footer one.
    // The footer button has the translated label text as its visible content.
    const closeButtons = screen.getAllByText(t("en-US", "alertModalClose"));
    // Click the last one (footer button)
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("header Close button (first) also fires onClose", () => {
    const { onClose } = setup();
    // Both the ModalHeader and the footer render a Close button; the header's
    // button is the first one in the DOM.
    const closeBtns = screen.getAllByRole("button", {
      name: t("en-US", "alertModalClose"),
    });
    fireEvent.click(closeBtns[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("IntegrationsSection onChange propagates to onChangeSettings", () => {
    const { onChangeSettings } = setup();
    fireEvent.click(screen.getByTestId("integrations-section"));
    expect(onChangeSettings).toHaveBeenCalledWith(defaultSettings);
  });

  // The icon's real accessible name is `Help – <title>` with an EN DASH
  // (U+2013). `/^Help/` sidesteps the dash; modal-header.test.tsx pins the
  // full name.
  it("renders the help icon on the default (storage) body", () => {
    setup({ title: "Configure Storage" });
    expect(screen.getByRole("button", { name: /^Help/ })).toBeTruthy();
  });

  it("hideHelp suppresses the help icon", () => {
    setup({ title: "Configure AI", hideHelp: true });
    expect(screen.queryByRole("button", { name: /^Help/ })).toBeNull();
    // ★ ANTI-VACUITY: the negative above passes on a modal that rendered
    // nothing at all. These assert the header DID render, so the absence is a
    // real absence rather than a missing subtree.
    expect(screen.getByText("Configure AI")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: t("en-US", "alertModalClose") }).length,
    ).toBeGreaterThan(0);
  });
});
