// §715 D2 — the discard-drafts confirm stacked over the setup wizard, with the REAL wizard, storage
// section and ConfirmProvider under StrictMode. The wizard's own suite mocks all three; this is the
// one place the dialog's Escape scoping and focus return are pinned against the real Modal stack.
import "fake-indexeddb/auto";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackendSetupWizard } from "./backend-setup-wizard";
import { ConfirmProvider } from "./confirm-dialog";
import { t } from "./i18n";
import { defaultIntegrations, defaultSettings, defaultTursoIntegrations, type Settings } from "./settings-types";

vi.mock("./turso-pipeline", async (importActual) => ({
  ...(await importActual<typeof import("./turso-pipeline")>()),
  testTursoConnection: vi.fn(),
}));

afterEach(async () => {
  // The token field's device seal is un-awaited; let it land before the next test's storage.
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
});

const STORED_URL = "libsql://stored-fictional.turso.io";
const onTursoStorage: Settings = {
  ...defaultSettings,
  storageConfig: { kind: "turso" },
  integrations: {
    ...defaultIntegrations,
    turso: { ...defaultTursoIntegrations, enabled: true, databaseUrl: STORED_URL, authToken: "token-fictional" },
  },
};

function Host({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(onTursoStorage);
  return (
    <StrictMode>
      <ConfirmProvider lang="en-US">
        <BackendSetupWizard lang="en-US" open settings={settings} onChangeSettings={setSettings} onClose={onClose} />
      </ConfirmProvider>
    </StrictMode>
  );
}

const urlField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")) as HTMLInputElement;
const nextBtn = () => screen.getByRole("button", { name: t("en-US", "wizardNext") });
const confirmDialog = () => screen.queryByRole("dialog", { name: t("en-US", "confirmTitle") });

describe("the discard-drafts confirm over the real setup wizard (§715 D2)", () => {
  it("Escape closes only the confirm: the wizard, the step and the draft stay, and focus returns", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await user.type(urlField(), "x");
    await user.click(nextBtn());
    await waitFor(() => expect(confirmDialog()).not.toBeNull());
    // The message tells the user which button keeps the drafts; that button must exist by that name.
    const dialog = within(confirmDialog()!);
    const cancelName = t("en-US", "cancel");
    expect(dialog.getByRole("button", { name: cancelName })).toBeInTheDocument();
    expect(confirmDialog()).toHaveTextContent(cancelName);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(confirmDialog()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(urlField().value).toBe(`${STORED_URL}x`);
    await waitFor(() => expect(nextBtn()).toHaveFocus());
  });

  it("Discard moves on, and the step comes back with the stored URL and no further question", async () => {
    const user = userEvent.setup();
    render(<Host onClose={vi.fn()} />);
    await user.type(urlField(), "x");
    await user.click(nextBtn());
    await waitFor(() => expect(confirmDialog()).not.toBeNull());
    await user.click(screen.getByRole("button", { name: t("en-US", "setupWizardTursoDraftsDiscardConfirm") }));
    await waitFor(() => expect(screen.queryByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"))).toBeNull());
    await user.click(screen.getByRole("button", { name: t("en-US", "wizardBack") }));
    expect(urlField().value).toBe(STORED_URL);
    await act(async () => { await user.click(nextBtn()); });
    expect(confirmDialog()).toBeNull();
  });
});
