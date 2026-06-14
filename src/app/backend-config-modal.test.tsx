// src/app/backend-config-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackendConfigModal } from "./backend-config-modal";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";

// BackendConfigModal wraps Modal + ModalHeader + IntegrationsSection.
// Mock all three so this test focuses on the shell behaviour only.
vi.mock("./modal", () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("./modal-header", () => ({
  ModalHeader: ({
    title,
    onClose,
  }: {
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="modal-header">
      <span>{title}</span>
      <button type="button" onClick={onClose} aria-label={t("en-US", "alertModalClose")}>
        {t("en-US", "alertModalClose")}
      </button>
    </div>
  ),
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
    // Both the mocked ModalHeader and the footer render a Close button;
    // the header's button is the first one in the DOM.
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
});
