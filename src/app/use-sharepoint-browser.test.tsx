import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSharePointBrowser } from "./use-sharepoint-browser";

const acquire = vi.fn<(scopes: readonly string[], o?: { interactive?: boolean }) => Promise<string | null>>();

function mockFetchSequence(...responses: Array<{ status?: number; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  acquire.mockReset().mockResolvedValue("token-123");
  vi.unstubAllGlobals();
});

describe("useSharePointBrowser", () => {
  test("searchSites populates sites", async () => {
    mockFetchSequence({ body: { value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] } });
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.searchSites("proj"); });
    await waitFor(() => expect(result.current.sites).toHaveLength(1));
    expect(result.current.sites[0].name).toBe("Proj");
    expect(acquire).toHaveBeenCalledWith(["Files.ReadWrite.All", "Sites.Read.All"], { interactive: true });
  });

  test("401 sets the re-auth error key and does not throw", async () => {
    mockFetchSequence({ status: 401 });
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.searchSites("x"); });
    await waitFor(() => expect(result.current.error).toBe("spPickerErrorAuth"));
  });

  test("openSiteByPath lists the default library via Files.ReadWrite.All path", async () => {
    mockFetchSequence({ body: { value: [{ id: "f1", name: "Spec.docx", webUrl: "https://c.sharepoint.com/x", file: { mimeType: "application/msword" }, parentReference: { driveId: "d1" } }] } });
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.openSiteByPath("c.sharepoint.com", "/sites/proj"); });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].name).toBe("Spec.docx");
    expect(result.current.currentDriveId).toBe("d1");
    expect(result.current.breadcrumb.length).toBeGreaterThan(0);
  });

  test("searchSites 403 sets searchForbidden", async () => {
    mockFetchSequence({ status: 403 });
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.searchSites("x"); });
    await waitFor(() => expect(result.current.searchForbidden).toBe(true));
  });

  test("openDrive then openFolder navigates and tracks breadcrumb", async () => {
    mockFetchSequence(
      { body: { value: [{ id: "d1", name: "Documents" }] } },
      { body: { value: [{ id: "01", name: "Sub", folder: {}, parentReference: { driveId: "d1" } }] } },
    );
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.openSite({ id: "s1", name: "Proj", webUrl: "u" }); });
    await waitFor(() => expect(result.current.drives).toHaveLength(1));
    await act(async () => { await result.current.openDrive({ id: "d1", name: "Documents" }); });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.breadcrumb.length).toBeGreaterThan(0);
  });
});
