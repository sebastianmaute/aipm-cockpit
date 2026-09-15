// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decideNavigation,
  decideWindowOpen,
  isAppOpenerFrame,
  originOnly,
  type FrameIdentity,
  type LatchedOpenerFrame,
} from "./window-open-policy";

const APP_ORIGIN = "http://127.0.0.1:17300";

describe("decideWindowOpen", () => {
  it("allows a same-origin popout URL with a query string", () => {
    // The shape openPopoutWindow (src/app/broadcast-sync.ts) actually opens:
    // `${pathname}?popout=${tab}` resolved against the app origin.
    expect(decideWindowOpen(`${APP_ORIGIN}/?popout=raid`, APP_ORIGIN)).toBe("allow-in-app");
  });

  it("allows the empty string", () => {
    // The PDF export tab (export.ts exportPdf) and the document-download PDF
    // tab both call `window.open("", "_blank")`.
    expect(decideWindowOpen("", APP_ORIGIN)).toBe("allow-in-app");
  });

  it("allows the literal about:blank", () => {
    expect(decideWindowOpen("about:blank", APP_ORIGIN)).toBe("allow-in-app");
  });

  it("allows an uppercase-scheme same-origin URL", () => {
    // The URL parser lower-cases the scheme; this pins that the comparison
    // does not accidentally depend on case.
    expect(decideWindowOpen(`HTTP://127.0.0.1:17300/foo`, APP_ORIGIN)).toBe("allow-in-app");
  });

  it("allows a trailing-dot host that normalizes to the same origin", () => {
    // `127.0.0.1.` and `127.0.0.1` are the same IPv4 literal per the URL
    // standard; the origin comparison inherits that normalization for free.
    expect(decideWindowOpen("http://127.0.0.1.:17300/", APP_ORIGIN)).toBe("allow-in-app");
  });

  it("does NOT allow a look-alike host that merely starts with the app origin string", () => {
    // `http://127.0.0.1:17300.evil.com` is not even a parseable URL (the
    // colon opens a port field, and "17300.evil.com" is not a valid port),
    // so `new URL()` throws and this denies -- but the point of the fixture
    // is what a `startsWith(appOrigin)` policy would have done: matched.
    expect(decideWindowOpen("http://127.0.0.1:17300.evil.com", APP_ORIGIN)).toBe("deny");
  });

  it("treats a userinfo trick as an external http(s) URL, not same-origin", () => {
    // `http://127.0.0.1:17300@evil.com/` DOES start with the app origin
    // string (the origin sits before the "@", read as a throwaway username),
    // so this is the case that actually discriminates origin-compare from
    // `startsWith`: the real origin is http://evil.com, which must route to
    // the system browser -- never render in-app.
    expect(decideWindowOpen("http://127.0.0.1:17300@evil.com/", APP_ORIGIN)).toBe("open-external");
  });

  it("opens another http(s) origin in the system browser", () => {
    expect(decideWindowOpen("https://gitlab.example.com/example-group/public-collab", APP_ORIGIN)).toBe(
      "open-external",
    );
  });

  it("opens mailto: in the system browser", () => {
    // use-bulk-operations.ts / use-chat-dispatcher.ts's inquiry mailto links.
    expect(
      decideWindowOpen("mailto:someone@example.com?subject=hi&body=there", APP_ORIGIN),
    ).toBe("open-external");
  });

  it("denies file:", () => {
    expect(decideWindowOpen("file:///C:/secrets.txt", APP_ORIGIN)).toBe("deny");
  });

  it("denies javascript:", () => {
    expect(decideWindowOpen("javascript:alert(1)", APP_ORIGIN)).toBe("deny");
  });

  it("denies an unrecognised custom scheme", () => {
    expect(decideWindowOpen("myapp://do-something", APP_ORIGIN)).toBe("deny");
  });

  it("denies an unparsable string that is not the empty-string special case", () => {
    expect(decideWindowOpen("not a url", APP_ORIGIN)).toBe("deny");
  });

  // ★ Coverage gaps review-3-report.md M-2 called out. All probed against
  // Node's real URL parser before being pinned here.
  it("treats a different hostname on the app's own port as external, not same-origin", () => {
    expect(decideWindowOpen("http://localhost:17300", APP_ORIGIN)).toBe("open-external");
  });

  it("treats the IPv6 loopback as external -- it is a different origin than the IPv4 one", () => {
    expect(decideWindowOpen("http://[::1]:17300", APP_ORIGIN)).toBe("open-external");
  });

  it("treats https on the same host:port as external -- scheme is part of the origin", () => {
    expect(decideWindowOpen("https://127.0.0.1:17300", APP_ORIGIN)).toBe("open-external");
  });

  it("treats the http default port (80) as external, not a match for :17300", () => {
    expect(decideWindowOpen("http://127.0.0.1:80", APP_ORIGIN)).toBe("open-external");
  });

  it("allows a same-origin blob: URL -- its origin unwraps to the inner URL's origin", () => {
    expect(decideWindowOpen("blob:http://127.0.0.1:17300/x", APP_ORIGIN)).toBe("allow-in-app");
  });

  it("denies a cross-origin blob: URL", () => {
    expect(decideWindowOpen("blob:https://evil.com/x", APP_ORIGIN)).toBe("deny");
  });

  it("denies data:", () => {
    expect(decideWindowOpen("data:text/html,<script>alert(1)</script>", APP_ORIGIN)).toBe("deny");
  });

  it("denies the Windows ms-settings: handler scheme", () => {
    expect(decideWindowOpen("ms-settings:privacy", APP_ORIGIN)).toBe("deny");
  });

  it("denies the Windows search-ms: handler scheme", () => {
    expect(decideWindowOpen("search-ms:query=foo", APP_ORIGIN)).toBe("deny");
  });

  it("denies vbscript:", () => {
    expect(decideWindowOpen("vbscript:msgbox(1)", APP_ORIGIN)).toBe("deny");
  });

  it("denies a UNC path -- it is not a parseable URL", () => {
    expect(decideWindowOpen("\\\\server\\share", APP_ORIGIN)).toBe("deny");
  });

  it("allows a backslash-userinfo look-alike -- backslash is a path separator for special schemes", () => {
    // `http://127.0.0.1:17300\@evil.com/`: for a "special" scheme like http,
    // the URL standard treats `\` exactly like `/`, so this is NOT userinfo
    // followed by host `evil.com` -- it is the app's own origin with path
    // `/@evil.com/`. Genuinely same-origin; verified against Node's parser
    // (origin `http://127.0.0.1:17300`, pathname `/@evil.com/`) before being
    // pinned here.
    expect(decideWindowOpen("http://127.0.0.1:17300\\@evil.com/", APP_ORIGIN)).toBe("allow-in-app");
  });
});

describe("originOnly", () => {
  it("returns just scheme+host+port, dropping path/query -- the OAuth-code guard", () => {
    expect(
      originOnly("https://login.microsoftonline.com/tenant/oauth2/authorize?code=SECRET&state=abc"),
    ).toBe("https://login.microsoftonline.com");
  });

  it("returns a fixed marker for an unparsable string, never the raw input", () => {
    expect(originOnly("not a url")).toBe("<unparsable>");
  });
});

describe("isAppOpenerFrame", () => {
  const APP_URL = `${APP_ORIGIN}/`;
  const latched: LatchedOpenerFrame = { processId: 7, frameToken: "tok-opener" };
  const opener = (overrides: Partial<FrameIdentity> = {}): FrameIdentity => ({
    detached: false,
    processId: 7,
    frameToken: "tok-opener",
    url: APP_URL,
    ...overrides,
  });

  it("true: matching process+token, not detached, at the app origin", () => {
    expect(isAppOpenerFrame(opener(), latched, APP_ORIGIN)).toBe(true);
  });

  it("false: no initiator (null or undefined)", () => {
    expect(isAppOpenerFrame(null, latched, APP_ORIGIN)).toBe(false);
    expect(isAppOpenerFrame(undefined, latched, APP_ORIGIN)).toBe(false);
  });

  it("false: no latched opener (facts never recorded -- e.g. the main window)", () => {
    expect(isAppOpenerFrame(opener(), null, APP_ORIGIN)).toBe(false);
  });

  it("false: detached, even with matching process+token and app-origin url", () => {
    // ★ Kills a mutant that drops the `!detached` check.
    expect(isAppOpenerFrame(opener({ detached: true }), latched, APP_ORIGIN)).toBe(false);
  });

  it("false: same frameToken but a different process", () => {
    expect(isAppOpenerFrame(opener({ processId: 8 }), latched, APP_ORIGIN)).toBe(false);
  });

  it("false: same process but a different frameToken", () => {
    // ★ Kills a mutant that compares processId only.
    expect(isAppOpenerFrame(opener({ frameToken: "tok-someone-else" }), latched, APP_ORIGIN)).toBe(
      false,
    );
  });

  it("false: about:blank's own frame -- empty url, even with matching process+token", () => {
    // ★ Kills a mutant that drops the origin check. This is the exact shape
    // a click INSIDE an about:blank popup/tab reports for its own frame:
    // matching identity is impossible there (a different process+token), but
    // this row isolates the origin check alone in case process+token ever
    // coincidentally matched (e.g. a same-process navigation).
    expect(isAppOpenerFrame(opener({ url: "" }), latched, APP_ORIGIN)).toBe(false);
  });

  it("false: a real URL, but on a different origin than the app", () => {
    expect(isAppOpenerFrame(opener({ url: "https://evil.example/" }), latched, APP_ORIGIN)).toBe(
      false,
    );
  });

  it("false: an unparsable url", () => {
    expect(isAppOpenerFrame(opener({ url: "not a url" }), latched, APP_ORIGIN)).toBe(false);
  });
});

describe("decideNavigation", () => {
  // ★ Explicit per-field construction, never a two-arg "child()" shorthand --
  // round 1's `child()`/`main()` helpers collapsed the entry question to one
  // boolean, which is exactly the shape N-I1 found too wide. Every test below
  // states all three fields so a reader never has to guess a default.
  type Ctx = { createdAsBlankPopup: boolean; initiatorIsAppOpener: boolean; inAuthFlow: boolean };
  const ctx = (overrides: Partial<Ctx> = {}): Ctx => ({
    createdAsBlankPopup: false,
    initiatorIsAppOpener: false,
    inAuthFlow: false,
    ...overrides,
  });
  // The one combination that can ever ENTER the flow: a window whose first
  // URL was about:blank, navigated by its own opener's script.
  const eligiblePopup = (overrides: Partial<Ctx> = {}): Ctx =>
    ctx({ createdAsBlankPopup: true, initiatorIsAppOpener: true, ...overrides });

  it.each(["login.microsoftonline.com", "login.microsoft.com", "login.live.com"])(
    "an opener-initiated about:blank popup entering %s starts auth flow and is allowed in-app",
    (host) => {
      const result = decideNavigation(`https://${host}/tenant/authorize`, APP_ORIGIN, eligiblePopup());
      expect(result).toEqual({ decision: "allow-in-app", authFlow: true });
    },
  );

  it("an uppercase-scheme/host URL still matches -- WHATWG URL lower-cases hostname on parse", () => {
    // ★ N-2: this does NOT kill a mutant that removes the `.toLowerCase()`
    // call on `parsed.hostname` -- the URL parser has already lower-cased it
    // by the time this function sees it, so that call is defense in depth
    // against a non-standard parser, not something this suite can pin.
    // Kept because it is free and the failure mode of relying on it being
    // unnecessary is worse than the failure mode of one redundant call.
    const result = decideNavigation(
      "https://LOGIN.MICROSOFTONLINE.com/tenant/authorize",
      APP_ORIGIN,
      eligiblePopup(),
    );
    expect(result).toEqual({ decision: "allow-in-app", authFlow: true });
  });

  // ★★★ N-I1 -- the three combinations the fix-2 brief requires, each one
  // pinning a different half of the entry gate.
  it("a same-origin popout (?popout=) + a stored identity-host link click is NOT flow entry", () => {
    // The popout's own first URL is the app's path, never blank, so
    // createdAsBlankPopup is false regardless of who initiated the click.
    const result = decideNavigation(
      "https://login.microsoftonline.com/tenant/authorize",
      APP_ORIGIN,
      ctx({ createdAsBlankPopup: false, initiatorIsAppOpener: false }),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("a PDF/export tab (about:blank) + a user-gesture link click is NOT flow entry", () => {
    // The tab WAS created blank (export.ts / document-download.ts both do
    // `window.open("", "_blank")`), but a click on a rendered link inside it
    // is initiated by the tab's OWN document, not its opener.
    const result = decideNavigation(
      "https://login.microsoftonline.com/tenant/authorize",
      APP_ORIGIN,
      ctx({ createdAsBlankPopup: true, initiatorIsAppOpener: false }),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("MSAL's own about:blank popup, navigated by its opener's script, IS flow entry", () => {
    const result = decideNavigation(
      "https://login.microsoftonline.com/tenant/authorize",
      APP_ORIGIN,
      eligiblePopup(),
    );
    expect(result).toEqual({ decision: "allow-in-app", authFlow: true });
  });

  it("opener-initiated but never created blank is NOT flow entry either -- both must hold", () => {
    // No real code path does this today (nothing script-navigates a
    // `?popout=` window), but the entry gate is an AND of two independent
    // facts and each half needs its own witness -- this is the one that
    // kills a mutant dropping `createdAsBlankPopup` from the entry check.
    const result = decideNavigation(
      "https://login.microsoftonline.com/tenant/authorize",
      APP_ORIGIN,
      ctx({ createdAsBlankPopup: false, initiatorIsAppOpener: true }),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("a look-alike host is NOT an identity host -- not a real Microsoft hostname", () => {
    const result = decideNavigation(
      "https://not-login.microsoftonline.com.evil.com/x",
      APP_ORIGIN,
      eligiblePopup(),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  // ★ M-B: a SUFFIX match, not just a different-TLD look-alike. Both of
  // these genuinely END with "login.microsoftonline.com" as a substring, so
  // an `endsWith(...)` mutant (which the round-1 `.evil.com` row could not
  // kill -- that one fails an endsWith check too) would wrongly pass them.
  it.each(["evil-login.microsoftonline.com", "xlogin.microsoftonline.com", "sso.login.microsoftonline.com"])(
    "a suffix look-alike %s is NOT an identity host",
    (host) => {
      const result = decideNavigation(`https://${host}/x`, APP_ORIGIN, eligiblePopup());
      expect(result).toEqual({ decision: "open-external", authFlow: false });
    },
  );

  it("http (no https) to an identity host is NOT flow entry, even from an eligible popup", () => {
    const result = decideNavigation("http://login.microsoftonline.com/x", APP_ORIGIN, eligiblePopup());
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("an explicit non-default port on an identity host is NOT flow entry", () => {
    const result = decideNavigation(
      "https://login.microsoftonline.com:8443/x",
      APP_ORIGIN,
      eligiblePopup(),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("a federated IdP is allowed in-app ONLY once the flow is already active", () => {
    // Not in flow yet, and not a fresh identity-host entry either: an
    // arbitrary https host from an eligible popup is just external.
    expect(decideNavigation("https://adfs.example.com/adfs/ls/", APP_ORIGIN, eligiblePopup())).toEqual({
      decision: "open-external",
      authFlow: false,
    });
    // In flow: the same host is allowed in-app, because the flow may hop
    // through exactly this kind of company-federated IdP. Continuation does
    // NOT re-check createdAsBlankPopup/initiatorIsAppOpener -- a server
    // redirect has no script initiator to re-verify.
    expect(
      decideNavigation("https://adfs.example.com/adfs/ls/", APP_ORIGIN, ctx({ inAuthFlow: true })),
    ).toEqual({ decision: "allow-in-app", authFlow: true });
  });

  it("denies a non-https hop while in auth flow, without ending the flow", () => {
    const result = decideNavigation(
      "http://adfs.example.com/adfs/ls/",
      APP_ORIGIN,
      ctx({ inAuthFlow: true }),
    );
    expect(result).toEqual({ decision: "deny", authFlow: true });
  });

  it("denies mailto: while in auth flow, without ending the flow", () => {
    const result = decideNavigation("mailto:a@b.com", APP_ORIGIN, ctx({ inAuthFlow: true }));
    expect(result).toEqual({ decision: "deny", authFlow: true });
  });

  it("denies about:blank while in auth flow, without ending the flow", () => {
    // Unlike decideWindowOpen (a fresh window OPEN), about:blank as a
    // NAVIGATION target mid-flow has no legitimate reason and is refused
    // like any other non-https hop.
    const result = decideNavigation("about:blank", APP_ORIGIN, ctx({ inAuthFlow: true }));
    expect(result).toEqual({ decision: "deny", authFlow: true });
  });

  it("returning to the app origin ends the flow", () => {
    const result = decideNavigation(`${APP_ORIGIN}/msal-redirect`, APP_ORIGIN, ctx({ inAuthFlow: true }));
    expect(result).toEqual({ decision: "allow-in-app", authFlow: false });
  });

  it("the MAIN window never enters auth flow -- an identity host there is just external", () => {
    // The main window's webContents never gets a `windowFacts` entry (it is
    // built via `new BrowserWindow` + `loadFile`/`loadURL`, never
    // `window.open`), so main.ts always feeds it createdAsBlankPopup:false,
    // initiatorIsAppOpener:false -- the plain `ctx()` default.
    const result = decideNavigation(
      "https://login.microsoftonline.com/tenant/authorize",
      APP_ORIGIN,
      ctx(),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("N-3: a stale inAuthFlow:true on a window that could never have entered still continues -- a wiring invariant, not a policy check", () => {
    // decideNavigation trusts `ctx.inAuthFlow` as given; it is main.ts's job
    // (never this function's) to guarantee that flag can only become true
    // through a real entry. Documented here so the assumption is visible.
    const result = decideNavigation(
      "https://adfs.example.com/adfs/ls/",
      APP_ORIGIN,
      ctx({ inAuthFlow: true }),
    );
    expect(result).toEqual({ decision: "allow-in-app", authFlow: true });
  });

  it("an ordinary window outside auth flow follows the ordinary external-site policy", () => {
    expect(decideNavigation("https://example.com", APP_ORIGIN, ctx())).toEqual({
      decision: "open-external",
      authFlow: false,
    });
    expect(decideNavigation("mailto:a@b.com", APP_ORIGIN, ctx())).toEqual({
      decision: "open-external",
      authFlow: false,
    });
  });

  it("denies an unparsable URL and preserves whatever flow state it had", () => {
    expect(decideNavigation("not a url", APP_ORIGIN, ctx({ inAuthFlow: true }))).toEqual({
      decision: "deny",
      authFlow: true,
    });
    expect(decideNavigation("not a url", APP_ORIGIN, ctx({ inAuthFlow: false }))).toEqual({
      decision: "deny",
      authFlow: false,
    });
  });

  it("denies file: and javascript: regardless of flow state", () => {
    expect(decideNavigation("file:///C:/x", APP_ORIGIN, ctx())).toEqual({
      decision: "deny",
      authFlow: false,
    });
    // Not https, so even mid-flow this does not get the federated-IdP pass.
    expect(decideNavigation("javascript:alert(1)", APP_ORIGIN, ctx({ inAuthFlow: true }))).toEqual({
      decision: "deny",
      authFlow: true,
    });
  });
});
