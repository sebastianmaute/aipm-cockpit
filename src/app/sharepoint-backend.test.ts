import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSharePointFileUrl } from "./sharepoint-backend";

describe("parseSharePointFileUrl", () => {
  it("parses a standard SharePoint Sites URL", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/lop/workspace.json",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/lop/workspace.json",
    });
  });

  it("decodes %20 escapes in itemPath", () => {
    const result = parseSharePointFileUrl(
      "https://contoso.sharepoint.com/sites/A/Shared%20Documents/Project%20X/file.json",
    );
    expect(result?.itemPath).toBe("Shared Documents/Project X/file.json");
  });

  it("strips query string", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/file.json?web=1",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/file.json",
    });
  });

  it("strips fragment", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/file.json#frag",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/file.json",
    });
  });

  it("rejects http:// URLs", () => {
    expect(
      parseSharePointFileUrl(
        "http://contoso.sharepoint.com/sites/A/Shared%20Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects non-sharepoint.com hostnames", () => {
    expect(
      parseSharePointFileUrl("https://example.com/sites/A/Documents/file.json"),
    ).toBeNull();
  });

  it("rejects OneDrive for Business URLs (*-my.sharepoint.com)", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso-my.sharepoint.com/personal/user/Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects URLs without /sites/ segment", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/teams/Alpha/Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseSharePointFileUrl("not a url")).toBeNull();
    expect(parseSharePointFileUrl("")).toBeNull();
  });

  it("rejects trailing-slash (folder, not file)", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/A/Shared%20Documents/folder/",
      ),
    ).toBeNull();
  });

  it("rejects URLs with empty itemPath", () => {
    expect(
      parseSharePointFileUrl("https://contoso.sharepoint.com/sites/A"),
    ).toBeNull();
  });

  it("rejects bare my.sharepoint.com OneDrive hostname", () => {
    expect(
      parseSharePointFileUrl(
        "https://my.sharepoint.com/personal/user_contoso_com/Documents/file.json",
      ),
    ).toBeNull();
  });
});

import { SharePointBackend } from "./sharepoint-backend";
import type { Workspace } from "./storage";

const FAKE_LOCATION = {
  hostname: "contoso.sharepoint.com",
  sitePath: "/sites/Alpha",
  itemPath: "Shared Documents/lop/workspace.json",
} as const;

const EMPTY_WORKSPACE: Workspace = {
  tasks: [],
  raid: [],
  absences: [],
  shifts: [],
  resources: [],
  roles: [],
  disciplines: [],
  grades: [],
  plan: {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    granularity: "month",
    currency: "EUR",
  },
} as unknown as Workspace;

describe("SharePointBackend", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let acquireToken: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    acquireToken = vi.fn().mockResolvedValue("fake-token");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function makeJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("isReady returns false when acquireToken returns null", async () => {
    acquireToken.mockResolvedValue(null);
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    expect(await be.isReady()).toBe(false);
  });

  it("isReady returns true when acquireToken returns a token", async () => {
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    expect(await be.isReady()).toBe(true);
  });

  it("load constructs correct Graph URL", async () => {
    fetchSpy.mockResolvedValue(makeJsonResponse(EMPTY_WORKSPACE));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await be.load();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Alpha:/drive/root:/Shared Documents/lop/workspace.json:/content",
    );
  });

  it("load 200 returns parsed Workspace for sp-json", async () => {
    fetchSpy.mockResolvedValue(makeJsonResponse(EMPTY_WORKSPACE));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
  });

  it("load 404 returns default empty Workspace", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 404 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
    expect(ws.raid).toEqual([]);
  });

  it("load 401 throws StorageNotReadyError with reauthenticate hint", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 401 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/sign-in expired/i);
  });

  it("load 403 throws StorageNotReadyError with permission hint", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 403 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/permission denied/i);
  });

  it("load 500 throws with friendly hint", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 500 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/sharepoint returned 500/i);
  });

  it("acquireToken null throws with sign-in hint", async () => {
    acquireToken.mockResolvedValue(null);
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/sign in to microsoft/i);
  });

  it("save constructs correct PUT URL and body for sp-json", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 201 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await be.save(EMPTY_WORKSPACE);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Alpha:/drive/root:/Shared Documents/lop/workspace.json:/content",
    );
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).body).toBe(JSON.stringify(EMPTY_WORKSPACE));
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer fake-token");
  });

  it("save constructs correct Content-Type for sp-csv", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 200 }));
    const be = new SharePointBackend(
      { kind: "sp-csv", ...FAKE_LOCATION },
      acquireToken,
    );
    await be.save(EMPTY_WORKSPACE);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("text/csv;charset=utf-8");
  });

  it("describe returns 'filename on sitePath'", async () => {
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    expect(await be.describe()).toBe("workspace.json on /sites/Alpha");
  });
});
