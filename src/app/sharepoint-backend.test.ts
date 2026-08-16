import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import { parseSharePointFileUrl, parseSharePointSiteUrl } from "./sharepoint-backend";

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

describe("parseSharePointSiteUrl", () => {
  it("accepts a site URL (no file)", () => {
    expect(parseSharePointSiteUrl("https://c.sharepoint.com/sites/proj")).toEqual({
      hostname: "c.sharepoint.com",
      sitePath: "/sites/proj",
    });
  });
  it("accepts a trailing slash and a library subpath (keeps site only)", () => {
    expect(parseSharePointSiteUrl("https://c.sharepoint.com/sites/proj/Shared%20Documents/")).toEqual({
      hostname: "c.sharepoint.com",
      sitePath: "/sites/proj",
    });
  });
  it("rejects OneDrive and non-sharepoint hosts", () => {
    expect(parseSharePointSiteUrl("https://c-my.sharepoint.com/personal/x")).toBeNull();
    expect(parseSharePointSiteUrl("https://example.com/sites/proj")).toBeNull();
  });
});

import { SharePointBackend } from "./sharepoint-backend";
import type { Workspace } from "./storage";

const FAKE_LOCATION = {
  hostname: "contoso.sharepoint.com",
  sitePath: "/sites/Alpha",
  itemPath: "Shared Documents/lop/workspace.json",
} as const;

// The Graph content URL the backend builds for FAKE_LOCATION. The space in
// "Shared Documents" is percent-encoded once it goes through fetch/Request.
const CONTENT_URL =
  "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Alpha:/drive/root:/Shared%20Documents/lop/workspace.json:/content";
// Bare colons in the path break msw's path-param matcher, so match by RegExp.
const CONTENT_RE = /graph\.microsoft\.com\/v1\.0\/sites\/.+\/content$/;

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
};

describe("SharePointBackend", () => {
  let acquireToken: Mock;

  beforeEach(() => {
    acquireToken = vi.fn().mockResolvedValue("fake-token");
  });

  it("isReady returns false when acquireToken returns null", async () => {
    acquireToken.mockResolvedValue(null);
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    expect(await be.isReady()).toBe(false);
  });

  it("isReady returns true when acquireToken returns a token", async () => {
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    expect(await be.isReady()).toBe(true);
  });

  it("isReady returns false when acquireToken rejects", async () => {
    acquireToken.mockRejectedValue(new Error("MSAL network error"));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    expect(await be.isReady()).toBe(false);
  });

  it("load constructs the correct Graph URL", async () => {
    const requests: Request[] = [];
    server.use(http.get(CONTENT_RE, ({ request }) => {
      requests.push(request);
      return HttpResponse.json(EMPTY_WORKSPACE);
    }));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(CONTENT_URL);
  });

  it("load 200 returns parsed Workspace for sp-json", async () => {
    server.use(http.get(CONTENT_RE, () => HttpResponse.json(EMPTY_WORKSPACE)));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
  });

  it("load 404 returns default empty Workspace", async () => {
    server.use(http.get(CONTENT_RE, () => new HttpResponse("", { status: 404 })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
    expect(ws.raid).toEqual([]);
  });

  // ★★ THE 404 SHORT-CIRCUIT USED TO SKIP THE IMPORT-FLAG RESET, so a load of
  // a file that had since been DELETED re-published the PREVIOUS load's
  // `unterminatedQuote: true` and warned about an unclosed quotation mark in a
  // file that no longer exists. The first assertion is the positive observable
  // — without it the test passes against a backend that never sets the flag at
  // all, which is the vacuous shape this is guarding against.
  it("load 404 clears the import flags a previous CSV load set", async () => {
    server.use(
      http.get(CONTENT_RE, () =>
        HttpResponse.text('# TASKS\r\nid,taskName,blockers\r\n1,T1,"never closed'),
      ),
    );
    const be = new SharePointBackend({ kind: "sp-csv", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(be.lastImportUnterminatedQuote).toBe(true);

    server.use(http.get(CONTENT_RE, () => new HttpResponse("", { status: 404 })));
    await be.load();
    expect(be.lastImportUnterminatedQuote).toBe(false);
    expect(be.lastImportDroppedRows).toBe(0);
  });

  it("load 401 throws StorageNotReadyError with reauthenticate hint", async () => {
    server.use(http.get(CONTENT_RE, () => new HttpResponse("", { status: 401 })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await expect(be.load()).rejects.toThrow(/sign-in expired/i);
  });

  it("load 403 throws StorageNotReadyError with permission hint", async () => {
    server.use(http.get(CONTENT_RE, () => new HttpResponse("", { status: 403 })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await expect(be.load()).rejects.toThrow(/permission denied/i);
  });

  it("load 500 throws with friendly hint", async () => {
    server.use(http.get(CONTENT_RE, () => new HttpResponse("", { status: 500 })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await expect(be.load()).rejects.toThrow(/sharepoint returned 500/i);
  });

  it("acquireToken null throws with sign-in hint", async () => {
    acquireToken.mockResolvedValue(null);
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await expect(be.load()).rejects.toThrow(/sign in to microsoft/i);
  });

  it("save constructs correct PUT URL and body for sp-json", async () => {
    let captured: Request | undefined;
    let body = "";
    server.use(http.put(CONTENT_RE, async ({ request }) => {
      captured = request;
      body = await request.clone().text();
      return new HttpResponse("", { status: 201 });
    }));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await be.save(EMPTY_WORKSPACE);
    expect(captured?.url).toBe(CONTENT_URL);
    expect(captured?.method).toBe("PUT");
    expect(body).toBe(JSON.stringify(EMPTY_WORKSPACE));
    expect(captured?.headers.get("Content-Type")).toBe("application/json");
    expect(captured?.headers.get("Authorization")).toBe("Bearer fake-token");
  });

  it("save constructs correct Content-Type for sp-csv", async () => {
    let captured: Request | undefined;
    server.use(http.put(CONTENT_RE, ({ request }) => {
      captured = request;
      return new HttpResponse("", { status: 200 });
    }));
    const be = new SharePointBackend({ kind: "sp-csv", ...FAKE_LOCATION }, acquireToken);
    await be.save(EMPTY_WORKSPACE);
    expect(captured?.headers.get("Content-Type")).toBe("text/csv;charset=utf-8");
  });

  it("describe returns 'filename on sitePath'", async () => {
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    expect(await be.describe()).toBe("workspace.json on /sites/Alpha");
  });

  it("requests the consolidated Files.ReadWrite.All scope on isReady", async () => {
    const acquire = vi.fn(async () => "tok");
    const be = new SharePointBackend({ kind: "sp-json", hostname: "c.sharepoint.com", sitePath: "/sites/p", itemPath: "f.json" }, acquire);
    await be.isReady();
    expect(acquire).toHaveBeenCalledWith(["Files.ReadWrite.All"]);
  });
});
