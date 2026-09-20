// §548 — Settings → Turso URL / token edits must never rebuild the storage backend by accident.
// The load hold replaces the WHOLE main-window tree with a skeleton while `loadPending` is true, and a
// rebuilt backend is pending by construction. So any commit on Turso storage unmounts this section.
// ★ COMPOSED, not mocked at the seam: the harness runs the REAL `useStorageBackend` and swaps the
//   section for a skeleton on `loadPending`, which is exactly the shape of task-manager's render hold.
//   Only the storage factory (`createBackend`) and MSAL are mocked.
// ★★ THE MODEL (`tursoIsLive` in `integrations-section.tsx`): on Turso storage the URL and token are
//   pure drafts and ONLY the explicit Apply button commits them; on any other kind each keystroke
//   commits (the backend memo ignores the Turso fields there). Named mutations, each red here:
//   MA1 — commit on blur (`onBlur={applyTursoDrafts}` on the URL input): A1 goes red.
//   MA2a — Apply commits without sealing the token: A2 goes red (the device secret is never written).
//   MA2b — drop Apply's `disabled={!tursoDraftsDirty}`: A2 goes red (Apply enabled while clean).
//   MA3 — the probe reads the COMMITTED settings instead of the drafts: A3 goes red.
//   MA4 — render Apply for every storage kind (drop the `tursoIsLive &&` gate): A4 goes red.
//   MF1 — feed the Turso URL/token into the backend memo for EVERY storage kind again: A4 goes red
//         (its keystroke commits rebuild the backend and show the skeleton).
import "fake-indexeddb/auto";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  defaultIntegrations,
  defaultSettings,
  defaultTursoIntegrations,
  type Settings,
} from "../settings-types";
import type { StorageConfig } from "../storage";
import { t, type Lang } from "../i18n";
import { readDeviceSecret } from "../secrets-store";

// ★ ONE `acquireToken` for every render, as the real `useCallback(..., [])` gives: it is a backend-memo
//   dep, so a fresh function per render would rebuild the backend on every render and never settle.
const msAuth = vi.hoisted(() => ({
  account: null, ready: true, signIn: async () => {}, signOut: async () => {}, acquireToken: async () => null,
}));
vi.mock("../use-ms-auth", () => ({ useMsAuth: () => msAuth }));
vi.mock("../storage", async (importActual) => ({
  ...(await importActual<typeof import("../storage")>()),
  createBackend: vi.fn(),
}));
vi.mock("../broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
vi.mock("../diagnostics", () => ({ logDiag: vi.fn() }));
vi.mock("../turso-pipeline", async (importActual) => ({
  ...(await importActual<typeof import("../turso-pipeline")>()),
  testTursoConnection: vi.fn(),
}));

import * as storageMod from "../storage";
import { TestProviders } from "../test-providers";
import { useStorageBackend } from "../use-storage-backend";
import { IntegrationsSection } from "./integrations-section";
import { testTursoConnection } from "../turso-pipeline";
import { getTursoConfig } from "../turso-config";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;
const STORED = { tasks: [], raid: [], absences: [], shifts: [] };
const URL_A = "libsql://a.turso.io";

function fakeBackend() {
  return {
    kind: "browser",
    load: vi.fn().mockResolvedValue(STORED),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

function settingsFor(storageConfig: StorageConfig): Settings {
  return {
    ...defaultSettings,
    storageConfig,
    integrations: {
      ...defaultIntegrations,
      turso: { ...defaultTursoIntegrations, enabled: true, databaseUrl: URL_A, authToken: "tok" },
    },
  };
}

let latest: Settings | null = null;
let commits = 0;

function Harness({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);
  useEffect(() => { latest = settings; }, [settings]);
  const { loadPending } = useStorageBackend({
    settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: () => {},
    showToastAction: () => {},
    onRevealSavingPaused: () => {},
    setStorageConfig: () => {},
  });
  // The render hold's shape: the skeleton REPLACES the tree, so the section unmounts.
  if (loadPending) return <div data-testid="hold-skeleton" />;
  return (
    <IntegrationsSection
      lang="en-US"
      settings={settings}
      onChange={(s) => { commits += 1; setSettings(s); }}
    />
  );
}

async function mount(storageConfig: StorageConfig) {
  render(<TestProviders><Harness initial={settingsFor(storageConfig)} /></TestProviders>);
  // Wait out the boot load (the hold is up until it settles).
  await screen.findByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"));
}

const urlField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"));
const tokenField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder"));
const applyButton = () => screen.getByRole("button", { name: t("en-US", "integrationsTursoApplyLabel") });
const queryApply = () => screen.queryByRole("button", { name: t("en-US", "integrationsTursoApplyLabel") });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  latest = null;
  commits = 0;
  createBackendMock.mockImplementation(() => fakeBackend());
});
afterEach(async () => {
  // Let an un-awaited device-seal finish before the next test clears storage.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
});

describe("§548 A1 — on TURSO storage nothing but Apply commits the credentials", () => {
  it("typing, Tab, clicking elsewhere and Escape commit nothing, rebuild nothing and keep the fields", async () => {
    const user = userEvent.setup();
    await mount({ kind: "turso" });
    const builds = createBackendMock.mock.calls.length;
    const url = urlField();
    const token = tokenField();

    await user.click(url);
    await user.type(url, "xy");
    expect(url).toHaveFocus();
    await user.tab();
    await user.click(document.body);
    await user.click(token);
    await user.type(token, "12");
    await user.keyboard("{Escape}");
    await user.tab();
    await user.click(document.body);

    expect(commits).toBe(0);
    expect(latest?.integrations?.turso?.databaseUrl).toBe(URL_A);
    expect(latest?.integrations?.turso?.authToken).toBe("tok");
    expect(createBackendMock.mock.calls.length).toBe(builds);
    expect(screen.queryByTestId("hold-skeleton")).toBeNull();
    // The SAME elements, still holding the drafts: nothing remounted.
    expect(urlField()).toBe(url);
    expect(tokenField()).toBe(token);
    expect(url).toHaveValue(`${URL_A}xy`);
    expect(token).toHaveValue("tok12");
    await user.click(url);
    expect(url).toHaveFocus();
    // The unapplied change is visible as an ENABLED Apply.
    expect(applyButton()).toBeEnabled();
  });
});

describe("§548 A2 — Apply commits both drafts once, seals the token and rebuilds once", () => {
  it("is named 'Apply Turso connection' and shows 'Apply'", async () => {
    await mount({ kind: "turso" });
    const button = screen.getByRole("button", { name: "Apply Turso connection" });
    expect(button).toHaveTextContent(/^Apply$/);
  });

  it("disabled while clean; one commit, one seal, one rebuild; disabled again after", async () => {
    const user = userEvent.setup();
    await mount({ kind: "turso" });
    const builds = createBackendMock.mock.calls.length;
    expect(applyButton()).toBeDisabled();

    await user.type(urlField(), "xy");
    await user.type(tokenField(), "12");
    expect(applyButton()).toBeEnabled();
    await user.click(applyButton());

    expect(commits).toBe(1);
    expect(latest?.integrations?.turso?.databaseUrl).toBe(`${URL_A}xy`);
    expect(latest?.integrations?.turso?.authToken).toBe("tok12");
    expect(createBackendMock.mock.calls.length).toBe(builds + 1);
    await waitFor(async () => expect(await readDeviceSecret("tursoAuthToken")).toBe("tok12"));
    // After the hold's remount the fields show the applied values and Apply is clean again.
    await waitFor(() => expect(urlField()).toHaveValue(`${URL_A}xy`));
    expect(tokenField()).toHaveValue("tok12");
    expect(applyButton()).toBeDisabled();
  });
});

describe("§548 A3 — Test connection probes the drafts without committing (Turso storage)", () => {
  it("probes the draft, shows the verdict, and neither commits nor remounts", async () => {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockResolvedValueOnce(undefined);
    await mount({ kind: "turso" });
    const builds = createBackendMock.mock.calls.length;
    const input = urlField();

    await user.click(input);
    await user.type(input, "xy");
    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));

    expect(testTursoConnection).toHaveBeenCalledTimes(1);
    expect(testTursoConnection).toHaveBeenCalledWith(getTursoConfig(`${URL_A}xy`, "tok"));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestOk"))).toBeInTheDocument();
    expect(urlField()).toBe(input); // the SAME element: no remount
    expect(createBackendMock.mock.calls.length).toBe(builds);
    expect(commits).toBe(0);
    expect(latest?.integrations?.turso?.databaseUrl).toBe(URL_A); // still a draft
  });
});

describe("§548 A4 — on NON-Turso storage each keystroke commits, with no rebuild and no Apply", () => {
  it("commits the URL and token per keystroke, seals the token, never shows the hold", async () => {
    const user = userEvent.setup();
    await mount({ kind: "browser" });
    const builds = createBackendMock.mock.calls.length;
    expect(queryApply()).toBeNull();

    const url = urlField();
    await user.type(url, "x");
    expect(latest?.integrations?.turso?.databaseUrl).toBe(`${URL_A}x`); // committed on the keystroke
    await user.type(url, "y");
    expect(latest?.integrations?.turso?.databaseUrl).toBe(`${URL_A}xy`);
    expect(url).toHaveFocus();

    const token = tokenField();
    await user.type(token, "12");
    expect(latest?.integrations?.turso?.authToken).toBe("tok12");
    expect(commits).toBe(4); // one per keystroke
    await waitFor(async () => expect(await readDeviceSecret("tursoAuthToken")).toBe("tok12"));

    expect(createBackendMock.mock.calls.length).toBe(builds);
    expect(screen.queryByTestId("hold-skeleton")).toBeNull();
    expect(urlField()).toBe(url); // the SAME element: never unmounted
    expect(tokenField()).toBe(token);
    expect(queryApply()).toBeNull();
  });
});
