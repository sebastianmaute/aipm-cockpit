// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  attachAuthFlowNavigation,
  INITIAL_AUTH_FLOW,
  onDidNavigate,
  onLoadFailed,
  type NavigationEventTarget,
  type WillNavigationDetails,
} from "./auth-flow-tracker";

const APP_ORIGIN = "http://127.0.0.1:17300";
const IDENTITY = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const FEDERATED_IDP = "https://adfs.contoso.example/adfs/ls";

interface Details extends WillNavigationDetails {
  /** Stands in for `isAppOpenerFrame(details.initiator, …)` in main.ts. */
  readonly fromOpener: boolean;
}

/** A sign-in popup: created as `about:blank` by the app, so it may enter the flow. */
function popup(opts: { failInstall?: string; openExternal?: () => Promise<void> } = {}) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const target: NavigationEventTarget<Details> = {
    on(event: string, listener: (...args: never[]) => void) {
      if (event === opts.failInstall) throw new Error("boom");
      listeners.set(event, listener as (...args: unknown[]) => void);
    },
  };
  const openExternal = vi.fn<(url: string) => Promise<void>>(opts.openExternal ?? (() => Promise.resolve()));
  const log = vi.fn<(line: string) => void>();
  const state = attachAuthFlowNavigation<Details>(target, {
    appOrigin: APP_ORIGIN,
    contextFor: (details, inAuthFlow) => ({ createdAsBlankPopup: true, initiatorIsAppOpener: details.fromOpener, inAuthFlow }),
    openExternal,
    log,
  });
  const fire = (event: string, ...args: unknown[]): void => listeners.get(event)?.(...args);
  const will = (event: "will-navigate" | "will-redirect", url: string, fromOpener = false, isMainFrame = true) => {
    const preventDefault = vi.fn();
    fire(event, { url, isMainFrame, fromOpener, preventDefault });
    return preventDefault;
  };
  const fail = (event: "did-fail-load" | "did-fail-provisional-load", url: string, isMainFrame = true): void =>
    fire(event, {}, -3, "ERR_ABORTED", url, isMainFrame);
  return { state, fire, will, fail, openExternal, log, listeners };
}

describe("attachAuthFlowNavigation — entering the flow", () => {
  it("stages the flag on an opener-initiated identity-host hop and commits it only on did-navigate", () => {
    const p = popup();
    const prevented = p.will("will-navigate", IDENTITY, true);
    expect(prevented).not.toHaveBeenCalled();
    expect(p.state()).toEqual({ committed: false, staged: true });
    p.fire("did-navigate");
    expect(p.state()).toEqual({ committed: true, staged: undefined });
  });

  it("lets a committed flow continue to a federated IdP in the popup", () => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true);
    p.fire("did-navigate");
    const prevented = p.will("will-navigate", FEDERATED_IDP);
    expect(prevented).not.toHaveBeenCalled();
    expect(p.openExternal).not.toHaveBeenCalled();
  });
});

describe("attachAuthFlowNavigation — M-C: the flag commits only when the navigation lands", () => {
  it("a failed entry hop leaves the flow closed, so the next foreign page goes to the system browser", () => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true);
    p.fail("did-fail-load", IDENTITY);
    expect(p.state()).toEqual({ committed: false, staged: undefined });
    const prevented = p.will("will-navigate", FEDERATED_IDP);
    expect(prevented).toHaveBeenCalledOnce();
    expect(p.openExternal).toHaveBeenCalledWith(new URL(FEDERATED_IDP).href);
  });

  it("a denied redirect (non-https inside the flow) cancels the entry hop without opening the flow", () => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true);
    const prevented = p.will("will-redirect", "http://adfs.contoso.example/");
    expect(prevented).toHaveBeenCalledOnce();
    expect(p.log).toHaveBeenCalledWith("will-redirect: denied http://adfs.contoso.example");
    p.fail("did-fail-provisional-load", IDENTITY); // Chromium's report of the cancelled navigation
    expect(p.state().committed).toBe(false);
  });
});

describe("attachAuthFlowNavigation — m1: a redirect continues the navigation it belongs to", () => {
  it("a direct 30x to a federated IdP before any did-navigate stays in the popup", () => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true); // staged true, committed still false
    const prevented = p.will("will-redirect", FEDERATED_IDP);
    expect(prevented).not.toHaveBeenCalled();
    expect(p.openExternal).not.toHaveBeenCalled();
    p.fire("did-navigate");
    expect(p.state().committed).toBe(true);
  });
});

describe("attachAuthFlowNavigation — will-navigate judges on the committed flag only", () => {
  it("a new navigation does not inherit a staged value from the one it supersedes", () => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true); // staged true
    const prevented = p.will("will-navigate", FEDERATED_IDP); // new, not opener-initiated
    expect(prevented).toHaveBeenCalledOnce();
    expect(p.openExternal).toHaveBeenCalledOnce();
  });
});

describe("attachAuthFlowNavigation — m2: a cancelled navigation drops its staged value", () => {
  it("did-fail-provisional-load discards it, so a later unrelated did-navigate commits nothing", () => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true);
    p.fail("did-fail-provisional-load", IDENTITY);
    p.fire("did-navigate"); // e.g. a programmatic loadURL, which no will-* event saw
    expect(p.state()).toEqual({ committed: false, staged: undefined });
  });
});

describe("attachAuthFlowNavigation — n2: a failed return to the app ends the flow", () => {
  it.each(["did-fail-load", "did-fail-provisional-load"] as const)("%s at the app origin commits false", (event) => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true);
    p.fire("did-navigate");
    p.fail(event, `${APP_ORIGIN}/?code=abc`);
    expect(p.state()).toEqual({ committed: false, staged: undefined });
  });

  it("a failed load elsewhere keeps the committed flow", () => {
    const p = popup();
    p.will("will-navigate", IDENTITY, true);
    p.fire("did-navigate");
    p.fail("did-fail-load", FEDERATED_IDP);
    expect(p.state().committed).toBe(true);
  });
});

describe("attachAuthFlowNavigation — subframes and plumbing", () => {
  it("ignores subframe navigations and subframe load failures", () => {
    const p = popup();
    const prevented = p.will("will-navigate", "https://elsewhere.example/", false, false);
    expect(prevented).not.toHaveBeenCalled();
    expect(p.openExternal).not.toHaveBeenCalled();
    p.will("will-navigate", IDENTITY, true);
    p.fire("did-navigate");
    p.fail("did-fail-load", APP_ORIGIN, false);
    expect(p.state().committed).toBe(true);
  });

  it("registers all five events", () => {
    expect([...popup().listeners.keys()].sort()).toEqual(
      ["did-fail-load", "did-fail-provisional-load", "did-navigate", "will-navigate", "will-redirect"],
    );
  });

  it("logs a failed listener install and keeps installing the rest", () => {
    const p = popup({ failInstall: "will-redirect" });
    expect(p.log).toHaveBeenCalledWith("will-redirect handler install: Error: boom");
    expect(p.listeners.has("did-fail-provisional-load")).toBe(true);
  });

  it("logs a rejected openExternal", async () => {
    const p = popup({ openExternal: () => Promise.reject(new Error("no handler")) });
    p.will("will-navigate", "https://elsewhere.example/");
    await vi.waitFor(() => expect(p.log).toHaveBeenCalledWith("will-navigate: Error: no handler"));
  });
});

describe("reducers", () => {
  it("onDidNavigate with nothing staged returns the same state", () => {
    const s = { committed: true, staged: undefined };
    expect(onDidNavigate(s)).toBe(s);
  });

  it("onLoadFailed treats an unparsable URL as not a return to the app", () => {
    expect(onLoadFailed({ committed: true, staged: false }, "", APP_ORIGIN)).toEqual({ committed: true, staged: undefined });
  });

  it("starts closed", () => {
    expect(INITIAL_AUTH_FLOW).toEqual({ committed: false, staged: undefined });
  });
});
