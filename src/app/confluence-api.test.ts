import { describe, expect, it, vi } from "vitest";
import { fetchConfluencePage } from "./confluence-api";

const creds = { siteUrl: "https://x.atlassian.net", email: "a@b.c", apiToken: "tok" };

describe("fetchConfluencePage", () => {
  it("POSTs pageId + creds to the proxy and returns the page text", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Charter", body: { view: { value: "<p>Hi</p>" } } }), { status: 200 }),
    );
    const out = await fetchConfluencePage("https://x.atlassian.net/wiki/spaces/E/pages/42/T", creds);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/confluence/page");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.pageId).toBe("42");
    expect(out.text).toMatch(/Charter/);
    expect(out.text).toMatch(/Hi/);
    fetchMock.mockRestore();
  });
  it("throws a status-only error on a non-OK proxy response", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: 404 }), { status: 404 }));
    await expect(fetchConfluencePage("https://x.atlassian.net/wiki/spaces/E/pages/42/T", creds)).rejects.toThrow(/404/);
    fetchMock.mockRestore();
  });
  it("rejects a URL with no extractable page id before calling fetch", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    await expect(fetchConfluencePage("https://x.atlassian.net/wiki/x/AbC", creds)).rejects.toThrow(/page-id/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
