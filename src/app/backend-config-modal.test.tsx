// src/app/backend-config-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackendConfigModal } from "./backend-config-modal";
import { HELP_ENTRIES, MODAL_HELP } from "./help-content";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";

// BackendConfigModal wraps Modal + ModalHeader + IntegrationsSection.
// Modal and IntegrationsSection are mocked so this test focuses on the shell.
//
// ★★ ModalHeader is deliberately NOT mocked. The help-icon tests below turn on
// which ENTRY the icon opens, and a stub proves only that a prop was threaded —
// it would stay green if the real header ignored the id and opened a hardcoded
// one, which is exactly the defect the required `helpConceptId` replaced. The
// real header costs nothing here: `useVoiceCommand` returns null with no
// provider (no mic), and its ✕ carries the same `alertModalClose` name the old
// stub gave it, so the close tests below are unaffected.
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
    // Required on the component; the storage id is what two of its three
    // consumers pass, so it is the right default for the shell tests.
    helpConceptId: MODAL_HELP.backendConfig,
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

  it("opens the entry the CONSUMER chose, not a hardcoded one", () => {
    // ★★★ THE REGRESSION THIS REPLACES. The modal used to hardcode
    // `MODAL_HELP.backendConfig` and take a `hideHelp` flag (REMOVED), because the
    // empty-state AI instance replaces the whole body with `AiSection` and the
    // Storage entry would have been wrong over it. The flag's justification —
    // "no Help entry describes the AI settings" — was false: `feature-ai`'s
    // body opens "Add an Anthropic API key in Settings → AI, …". So the id is
    // now a REQUIRED prop and the AI instance repoints instead of suppressing.
    //
    // ★ Asserted through the two entries' real TITLES, so a modal that
    // threaded the prop but ignored it (the shape a stubbed header would hide)
    // still fails. `ModalHeader` is deliberately not mocked here — see the top
    // of this file.
    const storage = HELP_ENTRIES.find((e) => e.id === MODAL_HELP.backendConfig)!;
    const ai = HELP_ENTRIES.find((e) => e.id === MODAL_HELP.aiSettings)!;
    // ★ The two entries must actually DIFFER, or every assertion below is
    // vacuous — this test would pass with the prop ignored.
    expect(MODAL_HELP.aiSettings).not.toBe(MODAL_HELP.backendConfig);

    const { unmount } = render(
      <BackendConfigModal
        lang="en-US"
        title="Configure AI"
        settings={defaultSettings}
        onChangeSettings={vi.fn()}
        onClose={vi.fn()}
        helpConceptId={MODAL_HELP.aiSettings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Help/ }));
    expect(screen.getByRole("dialog", { name: t("en-US", ai.titleKey) })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: t("en-US", storage.titleKey) })).toBeNull();
    unmount();

    setup({ title: "Configure Storage", helpConceptId: MODAL_HELP.backendConfig });
    fireEvent.click(screen.getByRole("button", { name: /^Help/ }));
    expect(screen.getByRole("dialog", { name: t("en-US", storage.titleKey) })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: t("en-US", ai.titleKey) })).toBeNull();
  });
});
