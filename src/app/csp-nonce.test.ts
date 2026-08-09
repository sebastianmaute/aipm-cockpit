import { describe, it, expect, afterEach, vi } from "vitest";
import { readCspNonce } from "./csp-nonce";

function addScript(nonce: string): HTMLScriptElement {
  const el = document.createElement("script");
  // Set the IDL property, not just the attribute: a real browser EMPTIES the
  // content attribute on insertion (nonce hiding) and keeps the value only on
  // the IDL property. Setting both here mirrors the browser as closely as jsdom
  // allows — see the caveat in the module's own docstring.
  el.setAttribute("nonce", nonce);
  el.nonce = nonce;
  document.head.appendChild(el);
  return el;
}

afterEach(() => {
  // Unstub FIRST: the SSR test stubs `document` to `undefined`, and that stub
  // is still live when afterEach runs for that test — querying `document.head`
  // before restoring the real global throws instead of cleaning up.
  vi.unstubAllGlobals();
  document.head.querySelectorAll("script[nonce]").forEach((el) => el.remove());
});

describe("readCspNonce", () => {
  it("returns the nonce of a nonced script", () => {
    addScript("abc123");
    expect(readCspNonce()).toBe("abc123");
  });

  it("returns undefined when no script carries a nonce", () => {
    expect(readCspNonce()).toBeUndefined();
  });

  it("returns undefined — not an empty string — for an empty nonce", () => {
    addScript("");
    expect(readCspNonce()).toBeUndefined();
  });

  it("returns undefined under SSR, where there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(readCspNonce()).toBeUndefined();
  });
});
