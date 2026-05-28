import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loginPopupMock = vi.fn();
const logoutPopupMock = vi.fn();
const acquireTokenSilentMock = vi.fn();
const getAllAccountsMock = vi.fn();
const initializeMock = vi.fn();

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: vi.fn().mockImplementation(() => ({
    initialize: initializeMock,
    getAllAccounts: getAllAccountsMock,
    loginPopup: loginPopupMock,
    logoutPopup: logoutPopupMock,
    acquireTokenSilent: acquireTokenSilentMock,
  })),
}));

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
    getAllAccountsMock.mockReset();
    initializeMock.mockReset();
    initializeMock.mockResolvedValue(undefined);
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

  it("exposes cached account on init", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
  });

  it("signIn calls loginPopup with User.Read scope", async () => {
    loginPopupMock.mockResolvedValue({ account: FAKE_ACCOUNT });
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.signIn(); });
    expect(loginPopupMock).toHaveBeenCalledWith({ scopes: ["User.Read"] });
    expect(result.current.account).toEqual(FAKE_ACCOUNT);
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
});
