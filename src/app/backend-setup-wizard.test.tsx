// src/app/backend-setup-wizard.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackendSetupWizard } from "./backend-setup-wizard";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";

// ---------------------------------------------------------------------------
// Mocks — stub out heavy section components so this test focuses on wizard
// shell behaviour (step navigation, footer buttons, close).
// ---------------------------------------------------------------------------

vi.mock("./settings-sections/integrations-section", () => ({
  IntegrationsSection: ({ hidePortfolioSwitch }: { hidePortfolioSwitch?: boolean }) => (
    <div data-testid="integrations-section">
      Integrations
      <span data-testid="portfolio-switch-hidden">{String(!!hidePortfolioSwitch)}</span>
    </div>
  ),
}));

vi.mock("./settings-sections/ai-section", () => ({
  AiSection: () => <div data-testid="ai-section">AI</div>,
}));

vi.mock("./jira-settings", () => ({
  JiraSettingsSection: () => <div data-testid="jira-section">Jira</div>,
}));

vi.mock("./modal", () => ({
  Modal: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
  }) => (open ? <div data-testid="modal">{children}</div> : null),
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
      <button type="button" onClick={onClose}>
        {t("en-US", "alertModalClose")}
      </button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(overrides: Partial<React.ComponentProps<typeof BackendSetupWizard>> = {}) {
  const onChangeSettings = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <BackendSetupWizard
      lang="en-US"
      open
      settings={defaultSettings}
      onChangeSettings={onChangeSettings}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onChangeSettings, onClose };
}

const nextBtn = () => screen.getByRole("button", { name: t("en-US", "wizardNext") });
const backBtn = () => screen.getByRole("button", { name: t("en-US", "wizardBack") });
const finishBtn = () => screen.getByRole("button", { name: t("en-US", "setupWizardFinish") });
const skipBtn = () => screen.queryByRole("button", { name: t("en-US", "setupWizardSkip") });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BackendSetupWizard", () => {
  it("renders nothing when open is false", () => {
    setup({ open: false });
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  it("shows step 1 (Storage) on open", () => {
    setup();
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
    // Step indicator should mark step 1
    expect(screen.getByText(/1\. /)).toBeInTheDocument();
  });

  it("shows the portfolio-mode switch by default (hidePortfolioSwitch not passed)", () => {
    setup();
    expect(screen.getByTestId("portfolio-switch-hidden")).toHaveTextContent("false");
  });

  it("hides the portfolio-mode switch when hidePortfolioSwitch is passed", () => {
    setup({ hidePortfolioSwitch: true });
    expect(screen.getByTestId("portfolio-switch-hidden")).toHaveTextContent("true");
  });

  it("Back is disabled on the first step", () => {
    setup();
    expect(backBtn()).toBeDisabled();
  });

  it("Skip is not shown on step 1 (not skippable)", () => {
    setup();
    expect(skipBtn()).toBeNull();
  });

  it("Next advances to step 2 (AI)", () => {
    setup();
    fireEvent.click(nextBtn());
    expect(screen.getByTestId("ai-section")).toBeInTheDocument();
  });

  it("Back returns from step 2 to step 1", () => {
    setup();
    fireEvent.click(nextBtn()); // → step 2
    expect(screen.getByTestId("ai-section")).toBeInTheDocument();
    fireEvent.click(backBtn()); // → step 1
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
  });

  it("Skip on an integration step (step 2) advances without requiring input", () => {
    setup();
    fireEvent.click(nextBtn()); // → step 2 (AI)
    expect(skipBtn()).not.toBeNull();
    fireEvent.click(skipBtn()!);
    expect(screen.getByTestId("jira-section")).toBeInTheDocument();
  });

  it("advances through all 4 steps correctly (Timelog rides the Storage step)", () => {
    setup();
    // step 1 → Storage
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
    fireEvent.click(nextBtn()); // → step 2 AI
    expect(screen.getByTestId("ai-section")).toBeInTheDocument();
    fireEvent.click(nextBtn()); // → step 3 Jira
    expect(screen.getByTestId("jira-section")).toBeInTheDocument();
    fireEvent.click(nextBtn()); // → step 4 Review
    // Review renders the summary list
    expect(screen.getByText(t("en-US", "setupWizardReviewIntro"))).toBeInTheDocument();
  });

  it("Review step shows Finish (not Next)", () => {
    setup();
    // advance to last step
    for (let i = 0; i < 3; i++) fireEvent.click(nextBtn());
    expect(screen.queryByRole("button", { name: t("en-US", "wizardNext") })).toBeNull();
    expect(finishBtn()).toBeInTheDocument();
  });

  it("Review step: Skip is not shown (not skippable)", () => {
    setup();
    for (let i = 0; i < 3; i++) fireEvent.click(nextBtn());
    expect(skipBtn()).toBeNull();
  });

  it("Finish on the review step calls onClose", () => {
    const { onClose } = setup();
    for (let i = 0; i < 3; i++) fireEvent.click(nextBtn());
    fireEvent.click(finishBtn());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closing via ModalHeader also calls onClose", () => {
    const { onClose } = setup();
    const closeBtns = screen.getAllByRole("button", {
      name: t("en-US", "alertModalClose"),
    });
    fireEvent.click(closeBtns[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a freshly mounted wizard starts on step 1 (production gates the mount on wizardOpen → remounts each open)", () => {
    // Both real call sites render `{wizardOpen && <BackendSetupWizard .../>}`, so
    // closing UNMOUNTS the wizard and reopening MOUNTS a fresh instance at step 0.
    function Harness({ mounted }: { mounted: boolean }) {
      return mounted ? (
        <BackendSetupWizard
          lang="en-US"
          open
          settings={defaultSettings}
          onChangeSettings={vi.fn()}
          onClose={vi.fn()}
        />
      ) : null;
    }
    const { rerender } = render(<Harness mounted />);
    fireEvent.click(nextBtn()); // → step 2 (AI)
    expect(screen.getByTestId("ai-section")).toBeInTheDocument();
    rerender(<Harness mounted={false} />); // close → unmount
    rerender(<Harness mounted />); // reopen → fresh mount
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
  });

  it("Review step shows configured / not-configured labels", () => {
    const settingsWithAi = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-ant-test" },
    };
    setup({ settings: settingsWithAi });
    for (let i = 0; i < 3; i++) fireEvent.click(nextBtn());
    expect(screen.getAllByText(t("en-US", "setupWizardConfigured")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("en-US", "setupWizardNotConfigured")).length).toBeGreaterThan(0);
  });
});
