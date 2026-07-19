import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildGraphMessage, createDraft, sendMail, GraphMailError, MAIL_READWRITE_SCOPE, MAIL_SEND_SCOPE } from "./graph-mail";

describe("buildGraphMessage", () => {
  it("builds an HTML Graph message", () => {
    expect(buildGraphMessage("a@b.com", "Hi", "<p>x</p>")).toEqual({
      subject: "Hi",
      body: { contentType: "HTML", content: "<p>x</p>" },
      toRecipients: [{ emailAddress: { address: "a@b.com" } }],
    });
  });

  it("builds one recipient from a single string (back-compat)", () => {
    expect(buildGraphMessage("a@x.com", "S", "<p>b</p>").toRecipients).toEqual([
      { emailAddress: { address: "a@x.com" } },
    ]);
  });

  it("builds multiple recipients from an array", () => {
    expect(buildGraphMessage(["a@x.com", "b@x.com"], "S", "<p>b</p>").toRecipients).toEqual([
      { emailAddress: { address: "a@x.com" } },
      { emailAddress: { address: "b@x.com" } },
    ]);
  });

  it("filters blank recipients out of an array", () => {
    expect(buildGraphMessage(["a@x.com", "", "  ", "b@x.com"], "S", "<p>b</p>").toRecipients).toEqual([
      { emailAddress: { address: "a@x.com" } },
      { emailAddress: { address: "b@x.com" } },
    ]);
  });
});

describe("graph mail calls", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("createDraft POSTs to /me/messages with bearer and returns webLink", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ webLink: "https://outlook/draft/1" }) });
    const link = await createDraft("tok", buildGraphMessage("a@b.com", "S", "<p>b</p>"));
    expect(link).toBe("https://outlook/draft/1");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(opts.body).body.contentType).toBe("HTML");
  });

  it("sendMail POSTs to /me/sendMail with saveToSentItems", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    await sendMail("tok", buildGraphMessage("a@b.com", "S", "<p>b</p>"));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(JSON.parse(opts.body).saveToSentItems).toBe(true);
    expect(JSON.parse(opts.body).message.toRecipients[0].emailAddress.address).toBe("a@b.com");
  });

  it("bounds the POST with an abort signal (so a hung send can't trap the caller)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    await sendMail("tok", buildGraphMessage("a@b.com", "S", "<p>b</p>"));
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws GraphMailError on non-2xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(sendMail("tok", buildGraphMessage("a@b.com", "S", "<p>b</p>"))).rejects.toBeInstanceOf(GraphMailError);
  });

  it("exposes the least-privilege scopes", () => {
    expect(MAIL_READWRITE_SCOPE).toEqual(["Mail.ReadWrite"]);
    expect(MAIL_SEND_SCOPE).toEqual(["Mail.Send"]);
  });
});
