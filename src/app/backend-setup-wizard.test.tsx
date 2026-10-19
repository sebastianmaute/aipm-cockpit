// src/app/backend-setup-wizard.test.tsx
import { markUnsealedPassphraseSecret } from "./turso-token-marker";
import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { BackendSetupWizard } from "./backend-setup-wizard";
import { defaultSettings } from "./settings-types";
import { BACKEND_SETUP_STEPS } from "./backend-setup-steps";
import { t } from "./i18n";
import { savePortfolioMode } from "./portfolio-mode";

// ---------------------------------------------------------------------------
// Mocks — stub out heavy section components so this test focuses on wizard
// shell behaviour (step navigation, footer buttons, close).
// ---------------------------------------------------------------------------

// Resolves true: the switch went ahead (and would reload). False is the durability gate refusing.
const commitPortfolioModeSwitch = vi.hoisted(() => vi.fn(async (): Promise<boolean> => true));
const hasUnsealedPassphraseToken = vi.hoisted(() => vi.fn<(token: string | undefined) => boolean>(() => false));
// A plain function stands in for the subscribed reader: the tests set its answer per case.
// §749 — the Claude key's render-time reader reads the REAL marker, which the tests set (`markUnsealedPassphraseSecret`).
vi.mock("./turso-token-seals", async () => {
  const marker = await import("./turso-token-marker");
  return {
    useHasUnsealedPassphraseToken: hasUnsealedPassphraseToken,
    useHasUnsealedPassphraseSecret: (id: Parameters<typeof marker.hasUnsealedPassphraseSecret>[0], value: string | undefined) =>
      marker.hasUnsealedPassphraseSecret(id, value),
  };
});
vi.mock("./settings-sections/integrations-section", () => ({
  commitPortfolioModeSwitch,
  IntegrationsSection: ({ hidePortfolioSwitch, pendingPortfolioMode, onPendingPortfolioModeChange, onTursoDraftsDirtyChange }: {
    hidePortfolioSwitch?: boolean;
    pendingPortfolioMode?: string;
    onPendingPortfolioModeChange?: (m: "file" | "turso") => void;
    onTursoDraftsDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div data-testid="integrations-section">
      Integrations
      <span data-testid="portfolio-switch-hidden">{String(!!hidePortfolioSwitch)}</span>
      <span data-testid="pending-portfolio">{String(pendingPortfolioMode)}</span>
      <button type="button" onClick={() => onPendingPortfolioModeChange?.("turso")}>pick turso</button>
      <button type="button" onClick={() => onPendingPortfolioModeChange?.("file")}>pick file</button>
      <button type="button" onClick={() => onTursoDraftsDirtyChange?.(true)}>type a draft</button>
    </div>
  ),
}));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./confirm-dialog", async (importActual) => ({
  ...(await importActual<typeof import("./confirm-dialog")>()),
  useConfirm: () => confirm,
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
/** Next through every step to the last (review) one — derived, so a new step does not break the tests. */
const toReview = () => { for (let i = 0; i < BACKEND_SETUP_STEPS.length - 1; i++) fireEvent.click(nextBtn()); };
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

  it("opens at initialStep when one is given", () => {
    setup({ initialStep: 1 });
    expect(screen.getByTestId("ai-section")).toBeInTheDocument();
    expect(screen.queryByTestId("integrations-section")).toBeNull();
  });

  it("clamps an out-of-range initialStep to the last step", () => {
    setup({ initialStep: 99 });
    expect(finishBtn()).toBeInTheDocument();
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
    toReview();
    expect(screen.queryByRole("button", { name: t("en-US", "wizardNext") })).toBeNull();
    expect(finishBtn()).toBeInTheDocument();
  });

  it("Review step: Skip is not shown (not skippable)", () => {
    setup();
    toReview();
    expect(skipBtn()).toBeNull();
  });

  it("Finish on the review step calls onClose", () => {
    const { onClose } = setup();
    toReview();
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
    toReview();
    expect(screen.getAllByText(t("en-US", "setupWizardConfigured")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("en-US", "setupWizardNotConfigured")).length).toBeGreaterThan(0);
  });
});

describe("BackendSetupWizard — a portfolio switch picked on the storage step (§715 D2)", () => {
  beforeEach(() => {
    commitPortfolioModeSwitch.mockClear();
    hasUnsealedPassphraseToken.mockReset();
    hasUnsealedPassphraseToken.mockReturnValue(false);
    localStorage.clear();
  });

  const tursoReady = {
    ...defaultSettings,
    integrations: {
      ...defaultSettings.integrations,
      turso: { databaseUrl: "libsql://demo-fictional.turso.io", authToken: "token-fictional" },
    },
  } as typeof defaultSettings;

  it("is applied on Finish, not dropped", async () => {
    const { onClose } = setup({ settings: tursoReady });
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).toHaveBeenCalledTimes(1);
    expect(commitPortfolioModeSwitch).toHaveBeenCalledWith(tursoReady, "turso");
    expect(onClose).not.toHaveBeenCalled(); // the switch reloads the app
  });

  // The storage step's "this reloads the app" note unmounts with the step, so the review step says it
  // again before Finish reloads.
  it("warns on the review step that Finish reloads onto the picked portfolio", () => {
    setup({ settings: tursoReady });
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "portfolioModeSwitchNote"));
  });

  // Without a saved Turso URL and token Finish goes back instead of switching, so promising a reload
  // would be false — the review step says what is missing instead.
  it("says the Turso connection is missing instead of promising a reload it will not do", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    expect(screen.queryByText(t("en-US", "portfolioModeSwitchNote"))).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "setupWizardTursoNeedsConfig"));
  });

  it("shows no reload warning when no switch is pending", () => {
    setup({ settings: tursoReady });
    toReview();
    expect(screen.queryByText(t("en-US", "portfolioModeSwitchNote"))).toBeNull();
  });

  // The section's own button refuses a Turso switch without a working config; Finish must not be the
  // way around that guard into a dead portfolio. It goes back to the storage step instead.
  it("refuses a Turso switch without a Turso config, returning to the storage step", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
    expect(nextBtn()).toHaveFocus(); // keyboard users are not dropped to <body> by the bounce
  });

  // §715 — a token typed again in passphrase mode off Turso storage is not sealed yet; the reload a
  // switch does would restore the old record and lose it. Finish goes back to the storage step,
  // whose own switch seals it under the passphrase, and the review step says so.
  it("refuses a switch that would lose a token no passphrase seal covers yet", async () => {
    hasUnsealedPassphraseToken.mockImplementation((token) => token === "token-fictional");
    const { onClose } = setup({ settings: tursoReady });
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    expect(screen.queryByText(t("en-US", "portfolioModeSwitchNote"))).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("en-US", "setupWizardTursoTokenNeedsPassphrase", t("en-US", "portfolioModeSwitchConfirm")),
    );
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
  });

  // §749 — the Claude key, typed under its passphrase lock on the AI step and not saved under it, is lost the
  // same way. Finish goes back to the AI step, whose section shows the passphrase fields that save it.
  // KILLED BY: dropping `aiKeyWouldBeLost` from `switchBlocked` (Finish commits).
  it("refuses a switch that would lose a Claude key no passphrase seal covers yet, and goes to the AI step", async () => {
    const withKey = { ...tursoReady, ai: { ...tursoReady.ai, apiKey: "sk-ant-api03-fictional00000000" } } as typeof defaultSettings;
    markUnsealedPassphraseSecret("anthropicApiKey", withKey.ai.apiKey);
    setup({ settings: withKey });
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("en-US", "setupWizardAiKeyNeedsPassphrase", t("en-US", "secretPassphraseSave")),
    );
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).not.toHaveBeenCalled();
    expect(screen.getByTestId("ai-section")).toBeInTheDocument();
  });

  // The reload loses the token whichever way the portfolio goes, so the review step refuses a switch
  // back to File too, and says why, instead of bouncing with no word.
  // MU31 — the refusal counts only a switch to Turso → goes red (no alert; Finish commits).
  it("refuses a switch back to File that would lose an unsealed token, and says why", async () => {
    savePortfolioMode("turso");
    hasUnsealedPassphraseToken.mockImplementation((token) => token === "token-fictional");
    setup({ settings: tursoReady });
    fireEvent.click(screen.getByRole("button", { name: "pick file" }));
    toReview();
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("en-US", "setupWizardTursoTokenNeedsPassphrase", t("en-US", "portfolioModeSwitchConfirm")),
    );
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).not.toHaveBeenCalled();
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
  });

  it("commits once when Finish is clicked again while the switch is under way", async () => {
    let release: () => void = () => {};
    commitPortfolioModeSwitch.mockImplementationOnce(() => new Promise<boolean>((r) => { release = () => r(true); }));
    setup({ settings: tursoReady });
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    await act(async () => { fireEvent.click(finishBtn()); });
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });

  // §715 — the shared durability gate refuses when the token's seal failed or timed out; Finish must
  // not sit there as if it had switched, and must stay usable once the token is saved.
  // MU25 — ignore the commit's answer → goes red (no bounce; a second Finish does nothing).
  it("goes back to the storage step when the switch is refused, and can finish again", async () => {
    commitPortfolioModeSwitch.mockResolvedValueOnce(false);
    const { onClose } = setup({ settings: tursoReady });
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    toReview();
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    toReview();
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).toHaveBeenCalledTimes(2);
  });

  it("keeps the choice while the user moves between steps", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "pick turso" }));
    fireEvent.click(nextBtn());
    fireEvent.click(backBtn());
    expect(screen.getByTestId("pending-portfolio")).toHaveTextContent("turso");
  });

  it("just closes on Finish when nothing was switched", async () => {
    const { onClose } = setup();
    toReview();
    await act(async () => { fireEvent.click(finishBtn()); });
    expect(commitPortfolioModeSwitch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// On Turso storage the step's URL/token are drafts until Apply, and the section discards them when it
// unmounts — which Next does. Leaving with unapplied drafts asks first, so nothing vanishes silently
// (and a Finish that switches portfolio never lands on credentials the user meant to replace).
describe("BackendSetupWizard — unapplied Turso drafts on the storage step (§715 D2)", () => {
  beforeEach(() => { confirm.mockClear(); });

  it("asks before Next discards them, and stays when the user keeps them", async () => {
    confirm.mockResolvedValueOnce(false);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "type a draft" }));
    await act(async () => { fireEvent.click(nextBtn()); });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      // It says how to keep them, naming the dialog's own Cancel and the step's Apply.
      message: t("en-US", "setupWizardTursoDraftsDiscard", t("en-US", "cancel"), t("en-US", "integrationsTursoApply")),
      confirmLabel: t("en-US", "setupWizardTursoDraftsDiscardConfirm"),
    }));
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
  });

  it("moves on when the user discards them", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "type a draft" }));
    await act(async () => { fireEvent.click(nextBtn()); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("integrations-section")).toBeNull();
  });

  it("asks before closing the wizard discards them too, and stays open when the user keeps them", async () => {
    confirm.mockResolvedValueOnce(false);
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "type a draft" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: t("en-US", "alertModalClose") })); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes once the user discards them", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "type a draft" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: t("en-US", "alertModalClose") })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes without asking when there is nothing unapplied", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "alertModalClose") }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not ask when there is nothing unapplied", async () => {
    setup();
    await act(async () => { fireEvent.click(nextBtn()); });
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("integrations-section")).toBeNull();
  });
});
