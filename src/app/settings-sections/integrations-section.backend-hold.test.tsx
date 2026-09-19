// §548 — Settings → Turso URL / token edits must not rebuild the storage backend per keystroke.
// The load hold replaces the WHOLE main-window tree with a skeleton while `loadPending` is true, and a
// rebuilt backend is pending by construction. So a per-keystroke rebuild unmounted this section — and
// the field being typed into — after the first character.
// ★ COMPOSED, not mocked at the seam: the harness runs the REAL `useStorageBackend` and swaps the
//   section for a skeleton on `loadPending`, which is exactly the shape of task-manager's render hold.
//   Only the storage factory (`createBackend`) and MSAL are mocked. Two halves, each with its own
//   named mutation:
//   MF1 — feed the Turso URL/token into the backend memo for EVERY storage kind again: the
//         non-Turso-kind test goes red (its blur-commit rebuilds the backend and shows the skeleton).
//   MF2 — commit the field to settings on CHANGE instead of on blur: the Turso-kind tests go red
//         (the first keystroke rebuilds the backend and unmounts the input).
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

import * as storageMod from "../storage";
import { TestProviders } from "../test-providers";
import { useStorageBackend } from "../use-storage-backend";
import { IntegrationsSection } from "./integrations-section";

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
  return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
}

async function mount(storageConfig: StorageConfig) {
  render(<TestProviders><Harness initial={settingsFor(storageConfig)} /></TestProviders>);
  // Wait out the boot load (the hold is up until it settles).
  await screen.findByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"));
}

const urlField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"));
const tokenField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder"));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  latest = null;
  createBackendMock.mockImplementation(() => fakeBackend());
});
afterEach(async () => {
  // Let an un-awaited device-seal finish before the next test clears storage.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
});

describe("§548 — Turso fields on TURSO storage: typing keeps the field; blur commits", () => {
  it("URL: two keystrokes keep the input mounted, focused and holding the text; blur commits once", async () => {
    const user = userEvent.setup();
    await mount({ kind: "turso" });
    const builds = createBackendMock.mock.calls.length;
    const input = urlField();

    await user.click(input);
    await user.type(input, "xy");

    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue(`${URL_A}xy`);
    expect(createBackendMock.mock.calls.length).toBe(builds); // no rebuild per keystroke
    expect(latest?.integrations?.turso?.databaseUrl).toBe(URL_A); // not committed yet

    await user.tab(); // blur commits
    expect(latest?.integrations?.turso?.databaseUrl).toBe(`${URL_A}xy`);
    expect(createBackendMock.mock.calls.length).toBe(builds + 1); // ONE rebuild, for the commit
    // The committed value survives the hold's remount.
    await waitFor(() => expect(urlField()).toHaveValue(`${URL_A}xy`));
  });

  it("token: two keystrokes keep the input mounted, focused and holding the text; blur commits and device-seals", async () => {
    const user = userEvent.setup();
    await mount({ kind: "turso" });
    const builds = createBackendMock.mock.calls.length;
    const input = tokenField();

    await user.click(input);
    await user.type(input, "12");

    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("tok12");
    expect(createBackendMock.mock.calls.length).toBe(builds);
    expect(latest?.integrations?.turso?.authToken).toBe("tok");

    await user.tab();
    expect(latest?.integrations?.turso?.authToken).toBe("tok12");
    expect(createBackendMock.mock.calls.length).toBe(builds + 1);
    await waitFor(async () => expect(await readDeviceSecret("tursoAuthToken")).toBe("tok12"));
  });
});

describe("§548 — Turso fields on NON-Turso storage never touch the backend", () => {
  it("typing and committing the URL and token rebuilds nothing and never shows the hold", async () => {
    const user = userEvent.setup();
    await mount({ kind: "browser" });
    const builds = createBackendMock.mock.calls.length;

    const url = urlField();
    await user.click(url);
    await user.type(url, "xy");
    expect(url).toHaveFocus();
    await user.click(tokenField()); // blur commits the URL
    expect(latest?.integrations?.turso?.databaseUrl).toBe(`${URL_A}xy`); // control: it committed

    const token = tokenField();
    await user.type(token, "12");
    expect(token).toHaveFocus();
    await user.tab(); // blur commits the token
    expect(latest?.integrations?.turso?.authToken).toBe("tok12"); // control: it committed

    expect(createBackendMock.mock.calls.length).toBe(builds);
    expect(screen.queryByTestId("hold-skeleton")).toBeNull();
    expect(url).toBeInTheDocument(); // the SAME element: never unmounted
    expect(token).toBeInTheDocument();
  });
});
