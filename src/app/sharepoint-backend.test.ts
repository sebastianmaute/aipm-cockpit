import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import { LOAD_TIMEOUT_MS } from "./fetch-with-timeout";
import { parseSharePointFileUrl, parseSharePointSiteUrl } from "./sharepoint-backend";
import { SaveConflictError } from "./storage-error";

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

  // ★★ A MALFORMED ESCAPE MUST RETURN null, NOT THROW. `decodeURIComponent` throws on these, which
  // was survivable while the only callers were click handlers and stopped being so when
  // `storage-config.tsx` began calling this during RENDER: typing "Shared%20" passes through
  // "Shared%" and crashed the whole Settings section on a keystroke.
  // Mutation: remove the try/catch around the `segments.map(decodeURIComponent)` in
  // `parseSharePointFileUrl` → every case here throws instead of returning null, so all three go red.
  it.each([
    ["a bare percent", "https://contoso.sharepoint.com/sites/A/Shared%/file.json"],
    ["a non-hex escape", "https://contoso.sharepoint.com/sites/A/Shared%zz/file.json"],
    ["a truncated UTF-8 sequence", "https://contoso.sharepoint.com/sites/A/%e0%a4/file.json"],
  ])("returns null (never throws) for %s", (_label, url) => {
    expect(() => parseSharePointFileUrl(url)).not.toThrow();
    expect(parseSharePointFileUrl(url)).toBeNull();
  });

  // ★★ THE OTHER ARM OF THAT GUARD, and it is the one a bare `catch {}` would lose: anything the
  // decode throws that is NOT a `URIError` is a real bug and must PROPAGATE, not be reported to
  // every caller as "this URL is unparseable". The guard is only narrow enough to be correct while
  // `decodeURIComponent` is the sole thing inside the `try`, and nothing stops a later edit moving
  // a statement in there — so the rethrow is what makes that edit fail loudly.
  // Mutation (the counterpart of the it.each above): swap `if (e instanceof URIError) return null;
  // throw e;` back to a bare `catch { return null; }` → this goes red while the it.each stays green.
  it("PROPAGATES a non-URIError thrown by the decode instead of reporting 'unparseable'", () => {
    const url = "https://contoso.sharepoint.com/sites/A/Shared%20Documents/file.json";
    // Control: unstubbed, this exact URL parses — so the throw below can only come from the stub,
    // and the test cannot pass because the URL was rejected before the decode was ever reached.
    expect(parseSharePointFileUrl(url)?.itemPath).toBe("Shared Documents/file.json");
    const realDecode = globalThis.decodeURIComponent;
    try {
      globalThis.decodeURIComponent = () => { throw new TypeError("not a URIError"); };
      expect(() => parseSharePointFileUrl(url)).toThrow(TypeError);
      expect(() => parseSharePointFileUrl(url)).toThrow("not a URIError");
    } finally {
      globalThis.decodeURIComponent = realDecode;
    }
    // The global really is back — a leak here would silently break every later case in this file.
    expect(parseSharePointFileUrl(url)?.itemPath).toBe("Shared Documents/file.json");
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
import { workspaceToJson } from "./workspace";

// §635: forces the documents rich-field pass to throw (the no-DOM DOMPurify
// failure), delegating to the real pass unless the flag is set. Reset after
// every test that sets it, so no other test in this file sees it on.
const richThrow = vi.hoisted(() => ({ on: false }));
vi.mock("./document-rich-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-rich-fields")>();
  return {
    ...actual,
    sanitizeDocumentRichFields: (doc: Parameters<typeof actual.sanitizeDocumentRichFields>[0]) => {
      if (richThrow.on) throw new TypeError("DOMPurify.sanitize is not a function");
      return actual.sanitizeDocumentRichFields(doc);
    },
  };
});

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
// §4 (R13) — the load is TWO requests: item metadata (eTag + pre-authenticated download URL), then the
// bytes from that URL on another host. The metadata URL is the content URL minus its `:/content` tail.
const META_RE = /graph\.microsoft\.com\/v1\.0\/sites\/[^?]*workspace\.json$/;
const META_URL_PREFIX =
  "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Alpha:/drive/root:/Shared%20Documents/lop/workspace.json";
const DOWNLOAD_URL = "https://download.example.test/dl/abc?tempauth=xyz";
/** Serves a whole load. `getResp` answers the FILE: a non-ok response fails the METADATA step (that is
 *  where 404/401/403/5xx now arrive), an ok one is the bytes served from the download URL. `etag` goes in
 *  the metadata BODY only (null omits it), never as a header. `downloadUrl: null` omits the URL. */
function serveLoad(getResp: () => Response, etag: string | null = '"e1"', downloadUrl: string | null = DOWNLOAD_URL) {
  return [
    http.get(META_RE, () => {
      const r = getResp();
      if (!r.ok) return r;
      return HttpResponse.json({
        ...(etag !== null ? { eTag: etag } : {}),
        ...(downloadUrl !== null ? { "@microsoft.graph.downloadUrl": downloadUrl } : {}),
      });
    }),
    http.get(DOWNLOAD_URL.split("?")[0], () => getResp()),
  ];
}

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

  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  // §548 — the load hold is up until a load settles, so a Graph read that never answers must FAIL the
  // load. Same bound as Turso's (LOAD_TIMEOUT_MS). A plain Error, like SharePoint's HTTP-status errors,
  // so it surfaces as the storageLoadFailed toast + the generic storage banner (plan ruling 10).
  it("load fails at LOAD_TIMEOUT_MS, and not before, when the Graph read never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    let outcome: unknown = "pending";
    const pending = be.load().then(() => "resolved", (e: unknown) => e);
    void pending.then((o) => { outcome = o; });
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("SharePoint did not respond within 10 s. Try again later.");
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
    server.use(http.get(META_RE, ({ request }) => {
      requests.push(request);
      return HttpResponse.json({ eTag: '"e1"', "@microsoft.graph.downloadUrl": DOWNLOAD_URL });
    }), http.get(DOWNLOAD_URL.split("?")[0], () => HttpResponse.json(EMPTY_WORKSPACE)));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(requests).toHaveLength(1);
    expect(decodeURIComponent(requests[0].url)).toBe(`${decodeURIComponent(META_URL_PREFIX)}?$select=eTag,@microsoft.graph.downloadUrl`);
    expect(requests[0].headers.get("Authorization")).toBe("Bearer fake-token");
  });

  it("load 200 returns parsed Workspace for sp-json", async () => {
    server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE)));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
  });

  it("load 404 returns default empty Workspace", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
    expect(ws.raid).toEqual([]);
  });

  // ★★ THE 404 SHORT-CIRCUIT USED TO SKIP THE IMPORT-FLAG RESET, so a load of
  // a file that had since been DELETED re-published the PREVIOUS load's
  // `unterminatedQuote: true` and warned about an unclosed quotation mark in a
  // file that no longer exists.
  //
  // ★★★ EACH FLAG NEEDS ITS OWN POSITIVE OBSERVABLE, and the fixture is what
  // supplies it. An earlier fixture here carried the unterminated quote ALONE,
  // so `lastImportDroppedRows` measured 0 on the DIRTY load already (measured,
  // not reasoned) — the trailing `toBe(0)` then checked a value that had never
  // left its default and could not tell "the 404 reset it" from "nothing ever
  // set it". The id-less row is what makes that half real: it is dropped by the
  // decoder, so the dirty load genuinely reports a non-zero count. Mirrors
  // `DIRTY_CSV` in `local-file-backend.test.ts`. Mutate the FIXTURE, not just
  // the code, when checking whether an absence assertion still bites.
  const DIRTY_CSV =
    '# TASKS\r\nid,taskName,blockers\r\n,No id at all,\r\n7,T7,"never closed';

  it("load 404 clears the import flags a previous CSV load set", async () => {
    server.use(...serveLoad(() => HttpResponse.text(DIRTY_CSV)));
    const be = new SharePointBackend({ kind: "sp-csv", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(be.lastImportUnterminatedQuote).toBe(true);
    expect(be.lastImportDroppedRows).toBeGreaterThan(0);

    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    await be.load();
    expect(be.lastImportUnterminatedQuote).toBe(false);
    expect(be.lastImportDroppedRows).toBe(0);
  });

  // ★★★ THE PRODUCER SIDE OF THE PER-SECTION BREAKDOWN, on the backend whose
  // early-return path is the one that can skip a reset. Every other assertion
  // about `lastImportDroppedBySection` is against a hand-built literal or a
  // stub, so nothing proved a backend publishes it at all — and the 404
  // short-circuit above is exactly the exit that historically skipped the
  // import-flag reset and re-published a previous load's diagnostics for a file
  // that no longer exists.
  it("publishes the per-section breakdown and clears it on a 404", async () => {
    server.use(...serveLoad(() => HttpResponse.text(DIRTY_CSV)));
    const be = new SharePointBackend({ kind: "sp-csv", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    // The positive observable: DIRTY_CSV's id-less row is a dropped TASK, so the
    // breakdown must name that section — without this the reset assertion below
    // could not tell "the 404 cleared it" from "nothing ever set it".
    expect(be.lastImportDroppedBySection).toEqual({ tasks: 1 });
    expect(be.lastImportDroppedRows).toBe(1);

    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    await be.load();
    // ★ Absent, not zero-filled — same rule as the codec layer.
    expect(be.lastImportDroppedBySection).toBeUndefined();
    expect(be.lastImportDroppedRows).toBe(0);
  });

  // §635: the strict sp-json load passes a diag, so a rich-field throw is
  // recorded (and saving pauses on the load paths that call `reportFor`)
  // instead of the whole load failing.
  it("records a documents rich-field throw instead of failing the load (§635)", async () => {
    server.use(...serveLoad(() => HttpResponse.json({ ...EMPTY_WORKSPACE, documents: [{ id: 1, title: "Status report", blocks: [{ type: "paragraph", html: "<p>reaches DOMPurify</p>" }], createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" }] })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    richThrow.on = true;
    try {
      const ws = await be.load();
      expect(be.lastDecodeFailures).toEqual(["documents"]);
      expect(ws.documents).toBeUndefined();
    } finally {
      richThrow.on = false;
    }
  });

  // §620 — a stored meta slice that PARSES but SANITIZES TO NOTHING (junk
  // `steeringCommittee`) used to be dropped silently on a JSON load, and the
  // next save wrote the file without it. `jsonToWorkspace` records the JSON key
  // into `diag.decodeFailedSlices`; this backend's job is only to PUBLISH what
  // `load`'s `diag` collected, exactly like `lastLoadTruncation`.
  it("publishes a slice the JSON load could not decode", async () => {
    server.use(...serveLoad(() => HttpResponse.json({ ...EMPTY_WORKSPACE, steeringCommittee: "not-an-object" })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["steeringCommittee"]);
  });

  // §630 — the CSV half: `csvToWorkspace` now records an unreadable meta slice
  // into the same accumulator (csv-codecs.meta-slices.test.ts pins the codec);
  // this pins that an `sp-csv` load publishes it.
  it("publishes a slice the CSV load could not decode", async () => {
    server.use(...serveLoad(() => HttpResponse.text("# TASKS\r\nid,taskName\r\n7,T7\r\n\r\n# INSIGHTS\r\nconfig,{not json\r\n")));
    const be = new SharePointBackend({ kind: "sp-csv", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["insights"]);
  });

  it("clears the flag on the next clean load", async () => {
    server.use(...serveLoad(() => HttpResponse.json({ ...EMPTY_WORKSPACE, steeringCommittee: "not-an-object" })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["steeringCommittee"]); // the state this test needs to exist

    server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE)));
    await be.load();
    expect(be.lastDecodeFailures).toEqual([]);
  });

  // ★★ A THROWING load after a failing one must not leave the stale value
  // standing — same `finally` publishes both `lastLoadTruncation` and
  // `lastDecodeFailures` on every exit, throwing ones included.
  it("clears decode failures too when a later load throws (500)", async () => {
    server.use(...serveLoad(() => HttpResponse.json({ ...EMPTY_WORKSPACE, steeringCommittee: "not-an-object" })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["steeringCommittee"]); // the state this test needs to exist

    server.use(...serveLoad(() => new HttpResponse("", { status: 500 })));
    await expect(be.load()).rejects.toThrow(/sharepoint returned 500/i);
    expect(be.lastDecodeFailures).toEqual([]);
  });

  it("load 401 throws StorageNotReadyError with reauthenticate hint", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 401 })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await expect(be.load()).rejects.toThrow(/sign-in expired/i);
  });

  it("load 403 throws StorageNotReadyError with permission hint", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 403 })));
    const be = new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
    await expect(be.load()).rejects.toThrow(/permission denied/i);
  });

  it("load 500 throws with friendly hint", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 500 })));
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
    be.forceNextSave();
    await be.save(EMPTY_WORKSPACE);
    expect(captured?.url).toBe(CONTENT_URL);
    expect(captured?.method).toBe("PUT");
    // §634: the same canonical serialisation as a local JSON file, schemaVersion included.
    expect(body).toBe(workspaceToJson(EMPTY_WORKSPACE));
    expect(JSON.parse(body)).toHaveProperty("schemaVersion");
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
    be.forceNextSave();
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

// §4 — SharePoint revision = the driveItem eTag. THREE states (R8): never loaded (refuse), loaded
// with an ETag (If-Match; 412 = conflict), loaded WITHOUT one (degrade: save without If-Match).
describe("SharePointBackend revision guard (§4)", () => {
  let acquireToken: Mock;
  beforeEach(() => { acquireToken = vi.fn().mockResolvedValue("fake-token"); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const make = () => new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
  const putUrls: string[] = [];
  const CREATE_ONLY = "@microsoft.graph.conflictBehavior=fail";
  const loadOk = (etag?: string) => server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE), etag ?? null));
  /** Captures each PUT's If-Match (null when absent) and answers with `respond`. */
  function capturePuts(respond: () => Response = () => HttpResponse.json({ eTag: '"new,2"' }, { status: 200 })) {
    const seen: (string | null)[] = [];
    putUrls.length = 0;
    server.use(http.put(CONTENT_RE, ({ request }) => { seen.push(request.headers.get("If-Match")); putUrls.push(request.url); return respond(); }));
    return seen;
  }

  it("starts with an unknown revision", () => {
    expect(make().revision()).toBeNull();
  });

  it("load captures the response ETag as revision()", async () => {
    loadOk('"v1,1"');
    const be = make();
    await be.load();
    expect(be.revision()).toBe('"v1,1"');
  });

  it("save sends If-Match with the loaded revision", async () => {
    loadOk('"v1,1"');
    const seen = capturePuts();
    const be = make();
    await be.load();
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual(['"v1,1"']);
  });

  it("a 412 rejects with SaveConflictError and keeps the old revision", async () => {
    loadOk('"v1,1"');
    capturePuts(() => new HttpResponse("", { status: 412 }));
    const be = make();
    await be.load();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
    expect(be.revision()).toBe('"v1,1"');
  });

  it("a 200 adopts the body's eTag, and the next save sends it", async () => {
    loadOk('"v1,1"');
    const seen = capturePuts();
    const be = make();
    await be.load();
    await be.save(EMPTY_WORKSPACE);
    expect(be.revision()).toBe('"new,2"');
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual(['"v1,1"', '"new,2"']);
  });

  it("a 201 whose body has no eTag falls back to the ETag header", async () => {
    loadOk('"v1,1"');
    capturePuts(() => HttpResponse.json({}, { status: 201, headers: { ETag: '"hdr,3"' } }));
    const be = make();
    await be.load();
    await be.save(EMPTY_WORKSPACE);
    expect(be.revision()).toBe('"hdr,3"');
  });

  // Final review m3 — the ETag header is not CORS-exposed, so a 2xx body without `eTag` left the
  // instance "loaded" with no revision, and every later save went out without `If-Match` (fail OPEN).
  it("a 2xx with no eTag in body or header reads the stored eTag, and the next save sends it", async () => {
    loadOk('"v1,1"');
    const seen = capturePuts(() => HttpResponse.json({}, { status: 200 }));
    const be = make();
    await be.load();
    server.use(http.get(META_RE, () => HttpResponse.json({ eTag: '"meta,2"' })));
    await be.save(EMPTY_WORKSPACE);
    expect(be.revision()).toBe('"meta,2"');
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual(['"v1,1"', '"meta,2"']);
  });

  it("a 2xx with no eTag anywhere, whose stored eTag cannot be read either, makes the next save refuse", async () => {
    loadOk('"v1,1"');
    const seen = capturePuts(() => HttpResponse.json({}, { status: 200 }));
    const be = make();
    await be.load();
    server.use(http.get(META_RE, () => new HttpResponse("", { status: 500 })));
    await be.save(EMPTY_WORKSPACE);
    expect(be.revision()).toBeNull();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
    expect(seen).toEqual(['"v1,1"']); // the refused save sent nothing
  });

  it("a never-loaded save refuses with SaveConflictError and sends nothing", async () => {
    const seen = capturePuts();
    await expect(make().save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
    expect(seen).toEqual([]);
  });

  it("a forced never-loaded save writes without If-Match, then adopts the response eTag", async () => {
    const seen = capturePuts();
    const be = make();
    be.forceNextSave();
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null]);
    expect(be.revision()).toBe('"new,2"');
    await be.save(EMPTY_WORKSPACE); // one-shot: now guarded by the adopted revision
    expect(seen).toEqual([null, '"new,2"']);
  });

  it("forceNextSave omits If-Match once on a loaded instance", async () => {
    loadOk('"v1,1"');
    const seen = capturePuts();
    const be = make();
    await be.load();
    be.forceNextSave();
    await be.save(EMPTY_WORKSPACE);
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null, '"new,2"']);
  });

  it("a failed forced save keeps the force for the retry", async () => {
    let calls = 0;
    const seen = capturePuts(() => (++calls === 1 ? new HttpResponse("", { status: 500 }) : HttpResponse.json({ eTag: '"ok,4"' })));
    const be = make();
    be.forceNextSave();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toThrow(/sharepoint returned 500/i);
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null, null]);
    expect(be.revision()).toBe('"ok,4"');
  });

  it("a load without an ETag degrades: revision() is null and the save omits If-Match without refusing", async () => {
    loadOk();
    const seen = capturePuts(() => new HttpResponse("", { status: 200 }));
    const be = make();
    await be.load();
    expect(be.revision()).toBeNull();
    await be.save(EMPTY_WORKSPACE);
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null, null]);
    expect(be.revision()).toBeNull();
  });

  it("a load that 404s (no file yet) is a loaded baseline that may CREATE, create-only, without If-Match", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    const seen = capturePuts();
    const be = make();
    await be.load();
    expect(be.revision()).toBeNull();
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null]);
    expect(putUrls[0]).toContain(CREATE_ONLY);
  });

  it("after a successful create the instance is 'loaded with an ETag': the next save sends If-Match and no conflictBehavior", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    const seen = capturePuts();
    const be = make();
    await be.load();
    await be.save(EMPTY_WORKSPACE);
    expect(be.revision()).toBe('"new,2"');
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null, '"new,2"']);
    expect(putUrls[1]).not.toContain("conflictBehavior");
  });

  it("a 409 on the create becomes SaveConflictError, and the state stays absent (a retry is still create-only)", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    capturePuts(() => new HttpResponse("", { status: 409 }));
    const be = make();
    await be.load();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
    expect(be.revision()).toBeNull();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
    expect(putUrls).toHaveLength(2);
    expect(putUrls.every((u) => u.includes(CREATE_ONLY))).toBe(true);
  });

  it("a 412 on the create is also a SaveConflictError", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    capturePuts(() => new HttpResponse("", { status: 412 }));
    const be = make();
    await be.load();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
  });

  it("a forced save on an absent baseline sends neither If-Match nor conflictBehavior", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    const seen = capturePuts();
    const be = make();
    await be.load();
    be.forceNextSave();
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null]);
    expect(putUrls[0]).not.toContain("conflictBehavior");
  });

  it("adoptFrom copies the absent state; adoptRevision leaves it", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    const seen = capturePuts();
    const source = make();
    await source.load();
    const live = make();
    live.adoptFrom(source);
    await live.save(EMPTY_WORKSPACE);
    expect(putUrls[0]).toContain(CREATE_ONLY);
    const other = make();
    other.adoptRevision('"r"');
    await other.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null, '"r"']);
    expect(putUrls[1]).not.toContain("conflictBehavior");
  });

  it("the ETag comes from the metadata BODY even though no response carries an ETag header", async () => {
    server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE), '"body-only,7"'));
    const be = make();
    await be.load();
    expect(be.revision()).toBe('"body-only,7"');
  });

  it("the download request carries NO Authorization header, and the metadata request does", async () => {
    const auth: Record<string, string | null> = {};
    server.use(
      http.get(META_RE, ({ request }) => {
        auth.meta = request.headers.get("Authorization");
        return HttpResponse.json({ eTag: '"e1"', "@microsoft.graph.downloadUrl": DOWNLOAD_URL });
      }),
      http.get(DOWNLOAD_URL.split("?")[0], ({ request }) => {
        auth.download = request.headers.get("Authorization");
        return HttpResponse.json(EMPTY_WORKSPACE);
      }),
    );
    await make().load();
    expect(auth).toEqual({ meta: "Bearer fake-token", download: null });
  });

  it("a missing downloadUrl fails the load and leaves the instance never-loaded", async () => {
    server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE), '"e1"', null));
    const seen = capturePuts();
    const be = make();
    await expect(be.load()).rejects.toThrow(/download/i);
    expect(be.revision()).toBeNull();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
    expect(seen).toEqual([]);
  });

  it("a failing download (non-ok) fails the load and leaves the instance never-loaded", async () => {
    server.use(
      http.get(META_RE, () => HttpResponse.json({ eTag: '"e1"', "@microsoft.graph.downloadUrl": DOWNLOAD_URL })),
      http.get(DOWNLOAD_URL.split("?")[0], () => new HttpResponse("", { status: 503 })),
    );
    const be = make();
    await expect(be.load()).rejects.toThrow(/503/);
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
  });

  it("a failed load leaves a fresh instance never-loaded (save refuses)", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 500 })));
    const seen = capturePuts();
    const be = make();
    await expect(be.load()).rejects.toThrow(/sharepoint returned 500/i);
    expect(be.revision()).toBeNull();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
    expect(seen).toEqual([]);
  });

  it("a load whose body fails to parse does not become the baseline", async () => {
    server.use(...serveLoad(() => new HttpResponse("{not json", { status: 200 }), '"bad"'));
    const be = make();
    await expect(be.load()).rejects.toThrow();
    expect(be.revision()).toBeNull();
    await expect(be.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
  });

  it("a successful load clears a pending force (the load is the new baseline)", async () => {
    loadOk('"v1,1"');
    const seen = capturePuts();
    const be = make();
    be.forceNextSave();
    await be.load();
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual(['"v1,1"']);
  });

  it("adoptRevision sets a baseline (so a never-loaded instance may save) and clears a pending force", async () => {
    const seen = capturePuts();
    const be = make();
    be.forceNextSave();
    be.adoptRevision('"adopted"');
    expect(be.revision()).toBe('"adopted"');
    await be.save(EMPTY_WORKSPACE);
    expect(seen).toEqual(['"adopted"']);
  });

  it("adoptFrom copies the loaded revision state and clears this instance's force", async () => {
    loadOk('"v1,1"');
    const seen = capturePuts();
    const source = make();
    await source.load();
    const live = make();
    live.forceNextSave();
    live.adoptFrom(source);
    expect(live.revision()).toBe('"v1,1"');
    await live.save(EMPTY_WORKSPACE);
    expect(seen).toEqual(['"v1,1"']);
  });

  it("adoptFrom a degraded (loaded, no ETag) source lets the target save without If-Match", async () => {
    loadOk();
    const seen = capturePuts(() => new HttpResponse("", { status: 200 }));
    const source = make();
    await source.load();
    const live = make();
    live.adoptFrom(source);
    await live.save(EMPTY_WORKSPACE);
    expect(seen).toEqual([null]);
  });

  it("adoptFrom a never-loaded source leaves the target refusing", async () => {
    const live = make();
    live.adoptFrom(make());
    await expect(live.save(EMPTY_WORKSPACE)).rejects.toBeInstanceOf(SaveConflictError);
  });
});

// §4 fix round 1 of Task 9 — a refusal reports the stored eTag (one metadata GET), and
// `forceNextSave(expected)` writes with `If-Match: expected` only, never blind and never create-only.
describe("SharePointBackend conditional overwrite (§4)", () => {
  let acquireToken: Mock;
  beforeEach(() => { acquireToken = vi.fn().mockResolvedValue("fake-token"); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const make = () => new SharePointBackend({ kind: "sp-json", ...FAKE_LOCATION }, acquireToken);
  const refusal = (p: Promise<unknown>) => p.then(() => null, (err: unknown) => err as SaveConflictError);
  const puts: Array<{ ifMatch: string | null; url: string }> = [];
  function capturePuts(respond: () => Response) {
    puts.length = 0;
    server.use(http.put(CONTENT_RE, ({ request }) => { puts.push({ ifMatch: request.headers.get("If-Match"), url: request.url }); return respond(); }));
  }
  /** What the item's metadata answers AFTER the load (the refusal's eTag read). */
  function storedEtag(etag: string | null, status = 200) {
    server.use(http.get(META_RE, () => (status !== 200 ? new HttpResponse("", { status }) : HttpResponse.json(etag === null ? {} : { eTag: etag }))));
  }

  it("a 412 reports the stored eTag", async () => {
    server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE), '"v1,1"'));
    capturePuts(() => new HttpResponse("", { status: 412 }));
    const be = make();
    await be.load();
    storedEtag('"peer,2"');
    const err = await refusal(be.save(EMPTY_WORKSPACE));
    expect(err).toBeInstanceOf(SaveConflictError);
    expect(err!.currentRevision).toBe('"peer,2"');
  });

  it("a create-only 409 reports the stored eTag too", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    capturePuts(() => new HttpResponse("", { status: 409 }));
    const be = make();
    await be.load();
    storedEtag('"peer,1"');
    expect((await refusal(be.save(EMPTY_WORKSPACE)))!.currentRevision).toBe('"peer,1"');
  });

  it("a failed or eTag-less metadata read reports null", async () => {
    server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE), '"v1,1"'));
    capturePuts(() => new HttpResponse("", { status: 412 }));
    const be = make();
    await be.load();
    storedEtag(null, 500);
    expect((await refusal(be.save(EMPTY_WORKSPACE)))!.currentRevision).toBeNull();
    storedEtag(null);
    const err = await refusal(be.save(EMPTY_WORKSPACE));
    expect(err).toBeInstanceOf(SaveConflictError);
    expect(err!.currentRevision).toBeNull();
  });

  it("forceNextSave(expected) sends If-Match: expected, never create-only, and adopts the written eTag", async () => {
    server.use(...serveLoad(() => new HttpResponse("", { status: 404 })));
    capturePuts(() => HttpResponse.json({ eTag: '"new,2"' }));
    const be = make();
    await be.load(); // absent: an ordinary save would be create-only
    be.forceNextSave('"peer,1"');
    await be.save(EMPTY_WORKSPACE);
    expect(puts.map((p) => p.ifMatch)).toEqual(['"peer,1"']);
    expect(puts[0].url).not.toContain("conflictBehavior");
    expect(be.revision()).toBe('"new,2"');
  });

  it("a conditional save that meets a 412 conflicts, and the one-shot is consumed", async () => {
    server.use(...serveLoad(() => HttpResponse.json(EMPTY_WORKSPACE), '"v1,1"'));
    capturePuts(() => new HttpResponse("", { status: 412 }));
    const be = make();
    await be.load();
    storedEtag('"peer,3"');
    be.forceNextSave('"peer,2"');
    expect(be.revision()).toBe('"v1,1"'); // arming does not move the instance's own revision
    expect((await refusal(be.save(EMPTY_WORKSPACE)))!.currentRevision).toBe('"peer,3"');
    await refusal(be.save(EMPTY_WORKSPACE));
    expect(puts.map((p) => p.ifMatch)).toEqual(['"peer,2"', '"v1,1"']);
  });
});

describe("SharePointBackend Graph URL encoding (§651)", () => {
  const acquireToken = vi.fn().mockResolvedValue("fake-token");

  // SharePoint allows `#` and `%` in file and folder names. The pasted URL carries them escaped;
  // the parser decodes each segment, so the backend must re-encode them when it builds the Graph URL,
  // or a `#` starts a fragment and everything after it, the create-only query included, is lost.
  const PASTED =
    "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/R%26D%20%231/100%25%20plan.json";
  const ENCODED_ITEM =
    "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Alpha:/drive/root:/Shared%20Documents/R%26D%20%231/100%25%20plan.json";

  it("re-encodes a decoded # and % in the metadata GET and the create-only PUT", async () => {
    const loc = parseSharePointFileUrl(PASTED)!;
    // Witness: the parser really hands the backend DECODED names, which is what makes encoding necessary.
    expect(loc.itemPath).toBe("Shared Documents/R&D #1/100% plan.json");

    const gets: string[] = [];
    const puts: string[] = [];
    server.use(
      http.get(/graph\.microsoft\.com\//, ({ request }) => {
        gets.push(request.url);
        return new HttpResponse("", { status: 404 });
      }),
      http.put(/graph\.microsoft\.com\//, ({ request }) => {
        puts.push(request.url);
        return HttpResponse.json({ eTag: '"new,1"' }, { status: 201 });
      }),
    );
    const be = new SharePointBackend({ kind: "sp-json", ...loc }, acquireToken);
    await be.load();
    await be.save(EMPTY_WORKSPACE);

    expect(gets).toHaveLength(1);
    const get = new URL(gets[0]);
    expect(get.hash).toBe("");
    expect(`${get.origin}${get.pathname}`).toBe(ENCODED_ITEM);
    expect(get.searchParams.get("$select")).toBe("eTag,@microsoft.graph.downloadUrl");

    expect(puts).toHaveLength(1);
    const put = new URL(puts[0]);
    expect(put.hash).toBe("");
    expect(`${put.origin}${put.pathname}`).toBe(`${ENCODED_ITEM}:/content`);
    // The create-only guard survives: it is a real query parameter, not text inside a fragment.
    expect(put.searchParams.get("@microsoft.graph.conflictBehavior")).toBe("fail");
  });
});
