import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const sendMail = vi.hoisted(() => vi.fn(async () => {}));
const createDraft = vi.hoisted(() => vi.fn(async () => "https://outlook/d/1"));
vi.mock("./graph-mail", async (orig) => ({ ...(await orig()), sendMail, createDraft }));

import { useCommSend } from "./use-comm-send";

const req = { to: "a@b.com", subject: "S", html: "<p>h</p>", plain: "h" };
function msAuth(token: string | null = "tok") {
  return { account: { username: "u" }, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => token) } as never;
}
let hrefValue = "";
beforeEach(() => {
  sendMail.mockClear(); createDraft.mockClear(); hrefValue = "";
  Object.defineProperty(window, "location", { configurable: true, value: { get href() { return hrefValue; }, set href(v: string) { hrefValue = v; } } });
});

describe("useCommSend", () => {
  it("in-app-preview send acquires Mail.Send + calls sendMail", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useCommSend({ mode: "in-app-preview", msAuth: msAuth(), lang: "en-US", showToast }));
    act(() => result.current.send(req));
    expect(result.current.previewModal.open).toBe(true);
    await act(async () => { await result.current.previewModal.onSend(); });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(result.current.previewModal.open).toBe(false);
  });
  it("preview send failure falls back to mailto", async () => {
    sendMail.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useCommSend({ mode: "in-app-preview", msAuth: msAuth(), lang: "en-US", showToast: vi.fn() }));
    act(() => result.current.send(req));
    await act(async () => { await result.current.previewModal.onSend(); });
    expect(hrefValue.startsWith("mailto:")).toBe(true);
  });
});
