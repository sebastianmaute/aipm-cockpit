import { describe, it, expect, vi } from "vitest";
import {
  isSharePointEnabled,
  encodeSharingUrl,
  fetchSharePointFileContent,
} from "./m365-sharepoint";
import type { AcquireToken } from "./use-sharepoint-browser";

describe("isSharePointEnabled", () => {
  it("true only when m365 enabled AND sharepoint enabled", () => {
    expect(isSharePointEnabled({ m365: { enabled: true, sharepoint: true } })).toBe(true);
  });
  it("false when sharepoint off", () => {
    expect(isSharePointEnabled({ m365: { enabled: true, sharepoint: false } })).toBe(false);
  });
  it("false when m365 off", () => {
    expect(isSharePointEnabled({ m365: { enabled: false, sharepoint: true } })).toBe(false);
  });
  it("false when integrations absent", () => {
    expect(isSharePointEnabled({})).toBe(false);
    expect(isSharePointEnabled(undefined)).toBe(false);
  });
});

describe("encodeSharingUrl", () => {
  it("produces the Graph u! url-safe base64 id", () => {
    expect(encodeSharingUrl("https://x.sharepoint.com/a b?c=1")).toMatch(/^u!/);
    expect(encodeSharingUrl("https://x.sharepoint.com/a")).not.toMatch(/[+/=]/);
  });
});

describe("fetchSharePointFileContent", () => {
  it("calls the Graph shares content endpoint with the token", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(new ArrayBuffer(3), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    const acquire: AcquireToken = vi.fn().mockResolvedValue("graph-token");
    const out = await fetchSharePointFileContent(
      "https://x.sharepoint.com/sites/T/charter.pdf",
      "charter.pdf",
      acquire,
    );
    expect(acquire).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/shares/u!");
    expect(url).toContain("/driveItem/content");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer graph-token");
    expect(out).toEqual({
      name: "charter.pdf",
      mime: "application/pdf",
      bytes: expect.any(ArrayBuffer),
    });
    fetchMock.mockRestore();
  });

  it("throws when the token is null (consent denied)", async () => {
    const acquire: AcquireToken = vi.fn().mockResolvedValue(null);
    await expect(
      fetchSharePointFileContent("https://x.sharepoint.com/a", "a", acquire),
    ).rejects.toThrow();
  });

  it("throws status only on a non-OK response", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );
    const acquire: AcquireToken = vi.fn().mockResolvedValue("graph-token");
    await expect(
      fetchSharePointFileContent("https://x.sharepoint.com/a", "a", acquire),
    ).rejects.toThrow("403");
    fetchMock.mockRestore();
  });
});
