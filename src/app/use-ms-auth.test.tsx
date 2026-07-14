import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loginPopupMock = vi.fn();
const logoutPopupMock = vi.fn();
const acquireTokenSilentMock = vi.fn();
const acquireTokenPopupMock = vi.fn();
const getAllAccountsMock = vi.fn();
const initializeMock = vi.fn();
const handleRedirectPromiseMock = vi.fn();

vi.mock("@azure/msal-browser", () => ({
  // Regular `function` (not an arrow): the hook calls `new PublicClientApplication()`,
  // and under vitest 4 a mock used as a constructor must be function/class — an
  // arrow can't construct, so its returned object would be dropped. A constructor
  // that returns an object has that object used as the instance (JS `new` semantics).
  PublicClientApplication: vi.fn().mockImplementation(function () {
    return {
      initialize: initializeMock,
      handleRedirectPromise: handleRedirectPromiseMock,
      getAllAccounts: getAllAccountsMock,
      loginPopup: loginPopupMock,
      logoutPopup: logoutPopupMock,
      acquireTokenSilent: acquireTokenSilentMock,
      acquireTokenPopup: acquireTokenPopupMock,
    };
  }),
}));

import { PublicClientApplication } from "@azure/msal-browser";
import { __pcaPromiseForTests, __resetPcaForTests, useMsAuth } from "./use-ms-auth";

const FAKE_ACCOUNT = { username: "alex@example.com", homeAccountId: "abc" } as const;

describe("useMsAuth", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "test-client");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "common");
    __resetPcaForTests();
    loginPopupMock.mockReset();
    logoutPopupMock.mockReset();
    acquireTokenSilentMock.mockReset();
    acquireTokenPopupMock.mockReset();
    getAllAccountsMock.mockReset();
    initializeMock.mockReset();
    initializeMock.mockResolvedValue(undefined);
    handleRedirectPromiseMock.mockReset();
    handleRedirectPromiseMock.mockResolvedValue(null);
    getAllAccountsMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not initialize MSAL when enabled is false (lazy-load contract)", async () => {
    const { result } = renderHook(() => useMsAuth(false));
    expect(__pcaPromiseForTests()).toBeNull();
    expect(result.current.account).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it("initializes MSAL when enabled flips to true", async () => {
    const { result, rerender } = renderHook(({ on }) => useMsAuth(on), {
      initialProps: { on: false },
    });
    expect(__pcaPromiseForTests()).toBeNull();
    rerender({ on: true });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(__pcaPromiseForTests()).not.toBeNull();
    expect(initializeMock).toHaveBeenCalledTimes(1);
  });

  it("calls handleRedirectPromise on init to clear a stale interaction_in_progress lock", async () => {
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(handleRedirectPromiseMock).toHaveBeenCalled();
  });

  it("stays ready even if handleRedirectPromise rejects (never wedges init)", async () => {
    handleRedirectPromiseMock.mockRejectedValue(new Error("hash_error"));
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it("exposes cached account on init", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
  });

  it("builds MSAL with the dedicated /msal-redirect route as redirectUri (v5 popup bridge)", async () => {
    // MSAL v5 closes a popup via a BroadcastChannel bridge from the redirect page,
    // not by polling the popup URL. The redirect target is a light route that runs
    // broadcastResponseToMainFrame so the full app never boots in the popup.
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(PublicClientApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          redirectUri: `${window.location.origin}/msal-redirect`,
        }),
      }),
    );
  });

  it("signIn calls loginPopup with User.Read scope", async () => {
    loginPopupMock.mockResolvedValue({ account: FAKE_ACCOUNT });
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.signIn(); });
    expect(loginPopupMock).toHaveBeenCalledWith({ scopes: ["User.Read"] });
    expect(result.current.account).toEqual(FAKE_ACCOUNT);
  });

  it("does not flash {ready:true, account:null} when a non-owner probes before the owner publishes (Important #1b)", async () => {
    // Mirrors production hook order: task-manager calls useStorageBackend (an
    // internal NON-owner useMsAuth) BEFORE the owner useMsAuth(config). With no
    // env, the non-owner's probe throws (no config yet) and its rejection must
    // NOT write ready:true after the owner's real probe supersedes it.
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "");
    __resetPcaForTests();
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    const snapshots: { ready: boolean; account: unknown }[] = [];
    const { result } = renderHook(() => {
      useMsAuth(true); // non-owner, declared first (mimics useStorageBackend)
      const owner = useMsAuth(true, { clientId: "c1", tenantId: "t1" }); // owner
      snapshots.push({ ready: owner.ready, account: owner.account });
      return owner;
    });
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    // No rendered snapshot may claim "ready" while showing a null account for a
    // signed-in user — that is the flash-of-signed-out the epoch guard prevents.
    for (const s of snapshots) {
      if (s.ready) expect(s.account).not.toBeNull();
    }
  });

  it("does NOT clobber an owner's published config when a non-owner consumer renders", async () => {
    // No env — config comes only from the owner. A second consumer that passes
    // no config must not reset the module-scoped session config.
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "");
    __resetPcaForTests();
    loginPopupMock.mockResolvedValue({ account: FAKE_ACCOUNT });
    const owner = renderHook(() =>
      useMsAuth(true, { clientId: "owner-client", tenantId: "owner-tenant" }),
    );
    await waitFor(() => expect(owner.result.current.ready).toBe(true));
    // Non-owner mounts (no config arg).
    renderHook(() => useMsAuth(true));
    await owner.result.current.signIn();
    // Sign-in still succeeds → owner config survived the non-owner render.
    expect(loginPopupMock).toHaveBeenCalledWith({ scopes: ["User.Read"] });
    expect(PublicClientApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          clientId: "owner-client",
          authority: "https://login.microsoftonline.com/owner-tenant",
        }),
      }),
    );
  });

  it("rebuilds MSAL under the new tenant and drops the session when config changes while signed in (Important #1)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "");
    __resetPcaForTests();
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    const { result, rerender } = renderHook(
      ({ tenant }) => useMsAuth(true, { clientId: "c1", tenantId: tenant }),
      { initialProps: { tenant: "t1" } },
    );
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    const buildsBefore = (PublicClientApplication as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length;

    // Admin edits the tenant. New instance's cache has no account.
    getAllAccountsMock.mockReturnValue([]);
    rerender({ tenant: "t2" });

    // Re-probes under the new authority and clears the stale "signed in" account.
    await waitFor(() => expect(result.current.account).toBeNull());
    const buildsAfter = (PublicClientApplication as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length;
    expect(buildsAfter).toBeGreaterThan(buildsBefore);
    expect(PublicClientApplication).toHaveBeenLastCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          authority: "https://login.microsoftonline.com/t2",
        }),
      }),
    );
  });

  it("signs in using Settings config when no env vars are present (defect A regression)", async () => {
    // No build-time env — clientId/tenantId come only from the Settings panel.
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "");
    __resetPcaForTests();
    loginPopupMock.mockResolvedValue({ account: FAKE_ACCOUNT });
    const { result } = renderHook(() =>
      useMsAuth(true, { clientId: "settings-client", tenantId: "settings-tenant" }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.signIn();
    });
    expect(loginPopupMock).toHaveBeenCalledWith({ scopes: ["User.Read"] });
    expect(result.current.account).toEqual(FAKE_ACCOUNT);
  });

  it("rejects sign-in when neither env nor Settings config is available", async () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "");
    __resetPcaForTests();
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await expect(result.current.signIn()).rejects.toThrow("MSAL config not available");
  });

  it("signOut calls logoutPopup and clears the account", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    logoutPopupMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    await act(async () => { await result.current.signOut(); });
    expect(logoutPopupMock).toHaveBeenCalledWith({ account: FAKE_ACCOUNT });
    expect(result.current.account).toBeNull();
  });

  it("acquireToken returns null when no account", async () => {
    getAllAccountsMock.mockReturnValue([]);
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const token = await result.current.acquireToken(["Files.ReadWrite"]);
    expect(token).toBeNull();
  });

  it("acquireToken returns access token from acquireTokenSilent", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    acquireTokenSilentMock.mockResolvedValue({ accessToken: "fake-token" });
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    const token = await result.current.acquireToken(["Files.ReadWrite"]);
    expect(token).toBe("fake-token");
    expect(acquireTokenSilentMock).toHaveBeenCalledWith({
      scopes: ["Files.ReadWrite"],
      account: FAKE_ACCOUNT,
    });
  });

  it("propagates the silent error and does NOT pop up when interactive is not requested", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    acquireTokenSilentMock.mockRejectedValue(new Error("interaction_required"));
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    await expect(result.current.acquireToken(["Contacts.Read"])).rejects.toThrow(
      "interaction_required",
    );
    expect(acquireTokenPopupMock).not.toHaveBeenCalled();
  });

  it("falls back to an interactive popup when interactive is requested and silent fails", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    acquireTokenSilentMock.mockRejectedValue(new Error("consent_required"));
    acquireTokenPopupMock.mockResolvedValue({ accessToken: "popup-token" });
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    const token = await result.current.acquireToken(["Contacts.Read"], { interactive: true });
    expect(token).toBe("popup-token");
    expect(acquireTokenPopupMock).toHaveBeenCalledWith({
      scopes: ["Contacts.Read"],
      account: FAKE_ACCOUNT,
    });
  });

  it("does not pop up when silent succeeds even if interactive is allowed", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    acquireTokenSilentMock.mockResolvedValue({ accessToken: "silent-token" });
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    const token = await result.current.acquireToken(["Contacts.Read"], { interactive: true });
    expect(token).toBe("silent-token");
    expect(acquireTokenPopupMock).not.toHaveBeenCalled();
  });

  it("shares one session across all hook instances (single source of truth)", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    logoutPopupMock.mockResolvedValue(undefined);

    // Two independent consumers (mirrors settings-menu + sidebar-footer).
    const a = renderHook(() => useMsAuth(true));
    const b = renderHook(() => useMsAuth(true));

    await waitFor(() => expect(a.result.current.account).toEqual(FAKE_ACCOUNT));
    // Both instances see the same cached account from one MSAL init.
    expect(b.result.current.account).toEqual(FAKE_ACCOUNT);
    expect(initializeMock).toHaveBeenCalledTimes(1);

    // Signing out from one instance propagates to the other.
    await act(async () => {
      await b.result.current.signOut();
    });
    expect(b.result.current.account).toBeNull();
    expect(a.result.current.account).toBeNull();
  });

  it("keeps the session ready while any consumer is still enabled", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    const a = renderHook(({ on }) => useMsAuth(on), { initialProps: { on: true } });
    const b = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(a.result.current.ready).toBe(true));

    // One consumer disables; the other still holds the session open.
    a.rerender({ on: false });
    expect(b.result.current.ready).toBe(true);
    expect(b.result.current.account).toEqual(FAKE_ACCOUNT);
  });
});
