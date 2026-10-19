import { markUnsealedPassphraseSecret } from "./turso-token-marker";
import { trackSecretSeal } from "./turso-token-seals";
import { ToastProvider } from "./toast-context";
import { t } from "./i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { TursoProjectPicker } from "./turso-project-picker";
import { defaultSettings } from "./settings-types";
import { StorageNotReadyError } from "./storage";
import { expectRowUniqueNames } from "../test/row-unique-names";

vi.mock("./turso-portfolio", () => ({
  listProjects: vi.fn(),
}));
vi.mock("./portfolio-mode", () => ({
  commitTursoPortfolioSwitch: vi.fn(),
}));

import { listProjects } from "./turso-portfolio";
import { commitTursoPortfolioSwitch } from "./portfolio-mode";

const TURSO_SETTINGS = {
  ...defaultSettings,
  integrations: {
    ...defaultSettings.integrations,
    turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
  },
};

function setup() {
  const onClose = vi.fn();
  render(<TursoProjectPicker lang="en-US" settings={TURSO_SETTINGS} onClose={onClose} />);
  return { onClose };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("TursoProjectPicker", () => {
  it("shows each active project as a row and switches on click", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never,
      { id: "p2", meta: { name: "Gemini", code: "GEM-2" }, archived: false } as never,
    ]);
    setup();
    expect(await screen.findByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load – apollo/i }));
    await waitFor(() => expect(commitTursoPortfolioSwitch).toHaveBeenCalledWith(TURSO_SETTINGS, "p1"));
  });

  // §749 — the switch reloads: a Claude key typed under its passphrase lock and not saved under it would be lost.
  // KILLED BY: dropping the picker's `secretLostToReload` check.
  it("refuses to switch while the Claude key is held unsealed, and says how to save it (§749)", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([{ id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never]);
    const withKey = { ...TURSO_SETTINGS, ai: { ...TURSO_SETTINGS.ai, apiKey: "sk-ant-api03-fictional00000000" } };
    markUnsealedPassphraseSecret("anthropicApiKey", withKey.ai.apiKey);
    const showToast = vi.fn();
    render(
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
        <TursoProjectPicker lang="en-US" settings={withKey} onClose={vi.fn()} />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /load – apollo/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", "aiKeyNeedsPassphraseSave", t("en-US", "secretPassphraseSave"))));
    expect(commitTursoPortfolioSwitch).not.toHaveBeenCalled();
  });

  // §749 review — the gate waits for seals in flight, and the settings can change meanwhile: the switch uses the
  // LATEST settings, not the ones the click saw. KILLED BY: reading the `settings` prop instead of the ref.
  it("commits the settings as they are once the seals in flight have settled", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([{ id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never]);
    let land: () => void = () => {};
    trackSecretSeal(new Promise<void>((r) => { land = r; }), "anthropicApiKey");
    const later = { ...TURSO_SETTINGS, ai: { ...TURSO_SETTINGS.ai, model: "a-later-model" } };
    const view = render(<TursoProjectPicker lang="en-US" settings={TURSO_SETTINGS} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /load – apollo/i }));
    view.rerender(<TursoProjectPicker lang="en-US" settings={later} onClose={vi.fn()} />);
    expect(commitTursoPortfolioSwitch).not.toHaveBeenCalled(); // PRECONDITION: still waiting on the seal
    land();
    await waitFor(() => expect(commitTursoPortfolioSwitch).toHaveBeenCalledWith(later, "p1"));
  });

  it("shows an empty state when the database has no projects", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    setup();
    expect(
      await screen.findByText("No projects found in this Turso database."),
    ).toBeInTheDocument();
  });

  it("shows an error with Retry, and Retry re-fetches", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("network down"));
    setup();
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();

    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Apollo")).toBeInTheDocument();
  });

  it("calls onClose when the modal's close button is clicked", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    const { onClose } = setup();
    await screen.findByText("No projects found in this Turso database.");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ★★★ Branch review I2 (§337) — before this fix, a rejected env token
  // showed the raw internal hint verbatim ("Storage not ready:
  // turso-env-token-rejected"), which is exactly what a user with a bad
  // deployment token sees FIRST when they open this picker.
  it("shows the translated auth-env banner text, not the raw hint, when the env token is rejected", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new StorageNotReadyError("turso-env-token-rejected"));
    setup();
    // The translated sentence names the env var — a stable, distinctive
    // substring of `storageAuthEnvBanner` regardless of surrounding wording.
    expect(await screen.findByText(/NEXT_PUBLIC_TURSO_AUTH_TOKEN/)).toBeInTheDocument();
    expect(screen.queryByText(/turso-env-token-rejected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage not ready/)).not.toBeInTheDocument();
  });

  it("renders a blank project code as —", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Codeless", code: "" }, archived: false } as never,
      { id: "p2", meta: { name: "Gemini", code: "GEM-2" }, archived: false } as never,
    ]);
    setup();
    const row = (await screen.findByText("Codeless")).parentElement!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(screen.getByText("Gemini").parentElement!).getByText("GEM-2")).toBeInTheDocument();
  });
});

// §669 — two projects in one database can share a name.
describe("TursoProjectPicker row names", () => {
  it("names the Load buttons of two same-named projects apart", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Apollo", code: "APL" }, archived: false } as never,
      { id: "p2", meta: { name: "Apollo", code: "APL" }, archived: false } as never,
      { id: "p3", meta: { name: "Apollo", code: "APL-3" }, archived: false } as never,
    ]);
    setup();
    // The code is part of the name, so only the rows sharing name AND code get a number.
    expect(await screen.findByRole("button", { name: "Load – Apollo APL (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load – Apollo APL-3" })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["button"], scope: screen.getByRole("list"), requireCollisionSeed: true });
  });
});
