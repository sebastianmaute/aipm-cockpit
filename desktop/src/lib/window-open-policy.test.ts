// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decideNavigation, decideWindowOpen, originOnly } from "./window-open-policy";

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

describe("decideNavigation", () => {
  const child = (inAuthFlow = false): { isChildWindow: boolean; inAuthFlow: boolean } => ({
    isChildWindow: true,
    inAuthFlow,
  });
  const main = (inAuthFlow = false): { isChildWindow: boolean; inAuthFlow: boolean } => ({
    isChildWindow: false,
    inAuthFlow,
  });

  it.each(["login.microsoftonline.com", "login.microsoft.com", "login.live.com"])(
    "a child window entering %s starts auth flow and is allowed in-app",
    (host) => {
      const result = decideNavigation(`https://${host}/tenant/authorize`, APP_ORIGIN, child());
      expect(result).toEqual({ decision: "allow-in-app", authFlow: true });
    },
  );

  it("matches an identity host case-insensitively", () => {
    const result = decideNavigation(
      "https://LOGIN.MICROSOFTONLINE.com/tenant/authorize",
      APP_ORIGIN,
      child(),
    );
    expect(result).toEqual({ decision: "allow-in-app", authFlow: true });
  });

  it("a look-alike host is NOT an identity host -- not a real Microsoft hostname", () => {
    const result = decideNavigation(
      "https://not-login.microsoftonline.com.evil.com/x",
      APP_ORIGIN,
      child(),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("a federated IdP is allowed in-app ONLY once the flow is already active", () => {
    // Not in flow yet: an arbitrary https host is just external.
    expect(decideNavigation("https://adfs.example.com/adfs/ls/", APP_ORIGIN, child(false))).toEqual({
      decision: "open-external",
      authFlow: false,
    });
    // In flow: the same host is allowed in-app, because the flow may hop
    // through exactly this kind of company-federated IdP.
    expect(decideNavigation("https://adfs.example.com/adfs/ls/", APP_ORIGIN, child(true))).toEqual({
      decision: "allow-in-app",
      authFlow: true,
    });
  });

  it("denies a non-https hop while in auth flow, without ending the flow", () => {
    const result = decideNavigation("http://adfs.example.com/adfs/ls/", APP_ORIGIN, child(true));
    expect(result).toEqual({ decision: "deny", authFlow: true });
  });

  it("returning to the app origin ends the flow", () => {
    const result = decideNavigation(`${APP_ORIGIN}/msal-redirect`, APP_ORIGIN, child(true));
    expect(result).toEqual({ decision: "allow-in-app", authFlow: false });
  });

  it("the MAIN window never enters auth flow -- an identity host there is just external", () => {
    const result = decideNavigation(
      "https://login.microsoftonline.com/tenant/authorize",
      APP_ORIGIN,
      main(),
    );
    expect(result).toEqual({ decision: "open-external", authFlow: false });
  });

  it("a child window outside auth flow follows the ordinary external-site policy", () => {
    expect(decideNavigation("https://example.com", APP_ORIGIN, child())).toEqual({
      decision: "open-external",
      authFlow: false,
    });
    expect(decideNavigation("mailto:a@b.com", APP_ORIGIN, child())).toEqual({
      decision: "open-external",
      authFlow: false,
    });
  });

  it("denies an unparsable URL and preserves whatever flow state it had", () => {
    expect(decideNavigation("not a url", APP_ORIGIN, child(true))).toEqual({
      decision: "deny",
      authFlow: true,
    });
    expect(decideNavigation("not a url", APP_ORIGIN, child(false))).toEqual({
      decision: "deny",
      authFlow: false,
    });
  });

  it("denies file: and javascript: for a child window, in or out of flow", () => {
    expect(decideNavigation("file:///C:/x", APP_ORIGIN, child(false))).toEqual({
      decision: "deny",
      authFlow: false,
    });
    // Not https, so even mid-flow this does not get the federated-IdP pass.
    expect(decideNavigation("javascript:alert(1)", APP_ORIGIN, child(true))).toEqual({
      decision: "deny",
      authFlow: true,
    });
  });
});
