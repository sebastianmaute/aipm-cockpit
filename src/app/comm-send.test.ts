import { describe, it, expect, vi, beforeEach } from "vitest";

const createDraft = vi.hoisted(() => vi.fn());
vi.mock("./graph-mail", async (orig) => ({ ...(await orig()), createDraft }));
import { sendCommTemplate, type CommSendDeps, type CommSendRequest } from "./comm-send";

const req: CommSendRequest = { to: "a@b.com", subject: "S", html: "<p>h</p>", plain: "h" };

function deps(over: Partial<CommSendDeps> = {}): CommSendDeps {
  return {
    mode: "mailto",
    m365Available: true,
    acquireToken: vi.fn(async () => "tok"),
    openDraft: vi.fn(),
    openPreview: vi.fn(),
    sendMailto: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
}

beforeEach(() => { createDraft.mockReset(); createDraft.mockResolvedValue("https://outlook/d/1"); });

describe("sendCommTemplate", () => {
  it("mailto mode → sendMailto", async () => {
    const d = deps({ mode: "mailto" });
    await sendCommTemplate(req, d);
    expect(d.sendMailto).toHaveBeenCalledWith("a@b.com", "S", "h");
  });
  it("no M365 → mailto regardless of mode", async () => {
    const d = deps({ mode: "outlook-draft", m365Available: false });
    await sendCommTemplate(req, d);
    expect(d.sendMailto).toHaveBeenCalled();
  });
  it("in-app-preview → openPreview", async () => {
    const d = deps({ mode: "in-app-preview" });
    await sendCommTemplate(req, d);
    expect(d.openPreview).toHaveBeenCalledWith(req);
  });
  it("outlook-draft happy path → createDraft + openDraft", async () => {
    const d = deps({ mode: "outlook-draft" });
    await sendCommTemplate(req, d);
    expect(createDraft).toHaveBeenCalled();
    expect(d.openDraft).toHaveBeenCalledWith("https://outlook/d/1");
  });
  it("outlook-draft with no token → falls to openPreview", async () => {
    const d = deps({ mode: "outlook-draft", acquireToken: vi.fn(async () => null) });
    await sendCommTemplate(req, d);
    expect(d.openPreview).toHaveBeenCalledWith(req);
    expect(d.openDraft).not.toHaveBeenCalled();
  });
  it("outlook-draft API error → onError + openPreview", async () => {
    createDraft.mockRejectedValue(new Error("boom"));
    const d = deps({ mode: "outlook-draft" });
    await sendCommTemplate(req, d);
    expect(d.onError).toHaveBeenCalledWith("draft");
    expect(d.openPreview).toHaveBeenCalledWith(req);
  });
});
