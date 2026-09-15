// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decideWindowOpen } from "./window-open-policy";

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
});
