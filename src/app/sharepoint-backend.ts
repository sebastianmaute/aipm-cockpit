// src/app/sharepoint-backend.ts
//
// SharePoint storage backend — implements StorageBackend interface via
// Microsoft Graph. Token acquisition is delegated to the caller (M1's
// useMsAuth().acquireToken).

import { type ImportDiag, csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import {
  StorageNotReadyError,
  emptyWorkspace,
  jsonToWorkspace,
  workspaceToJson,
  type StorageBackend,
  type Workspace,
} from "./workspace";
import type { ImportSectionKey } from "./csv-codecs-sections";
import { SaveConflictError } from "./storage-error";
import { FetchTimeoutError, LOAD_TIMEOUT_MS, fetchTextWithTimeout, type FetchTextResult } from "./fetch-with-timeout";

export interface SpFileLocation {
  hostname: string;
  sitePath: string;
  itemPath: string;
}

/** Parse a SharePoint file URL into Graph-addressable components.
 *  Supports the standard SharePoint Sites pattern:
 *    https://<host>/sites/<site>/<library>/<path>/<file>
 *  Returns null on malformed input or unsupported URL shape
 *  (e.g. *-my.sharepoint.com OneDrive). */

const GRAPH = "https://graph.microsoft.com/v1.0";

function graphItemUrlFor(loc: SpFileLocation): string {
  return `${GRAPH}/sites/${loc.hostname}:${loc.sitePath}:/drive/root:/${loc.itemPath}`;
}

function graphUrlFor(loc: SpFileLocation): string {
  return `${graphItemUrlFor(loc)}:/content`;
}

/** §4 (R13) — the load asks the ITEM for its eTag and a pre-authenticated download URL. `GET …/content`
 *  answers with a 302 to another host, and a browser exposes neither that hop's headers nor (ETag is not
 *  CORS-safelisted) the ETag at all — so the eTag has to come from the JSON body. */
const ITEM_METADATA_QUERY = "?$select=eTag,@microsoft.graph.downloadUrl";
/** §4 — the documented create-only form: the annotation belongs in the URL, not the body. */
const CREATE_ONLY_QUERY = "?@microsoft.graph.conflictBehavior=fail";

export type SpStorageConfig =
  | ({ kind: "sp-json" } & SpFileLocation)
  | ({ kind: "sp-csv" } & SpFileLocation);

export class SharePointBackend implements StorageBackend {
  readonly kind: "sp-json" | "sp-csv";
  /** Malformed rows dropped by the most recent CSV load() (0 for JSON). */
  lastImportDroppedRows = 0;
  /** Which SECTIONS those rows came from. ★ ABSENT means "not known to have
   *  lost anything", never "verified clean". */
  lastImportDroppedBySection: Partial<Record<ImportSectionKey, number>> | undefined = undefined;
  /** Whether the most recent CSV load() hit an unterminated quote (false for JSON). */
  lastImportUnterminatedQuote = false;
  /** ★ CSV ONLY, like the field above. Malformedness, not a swallowed section. */
  lastImportMalformedQuotes = 0;
  /** What the most recent load() discarded to stay inside the document caps. */
  lastLoadTruncation: { entries: number; blocks: number } = { entries: 0, blocks: 0 };
  /** §620 — meta slices the last load decoded to NOTHING (see `jsonToWorkspace`).
   *  Read by `truncationOps.reportFor`, which pauses saving. Reset and published
   *  exactly like `lastLoadTruncation`, for the same stale-value reason. */
  lastDecodeFailures: readonly string[] = [];
  private location: SpFileLocation;
  /** §4 — THREE states, not two (controller ruling R8), and `revision()` alone cannot tell them apart:
   *  never loaded (`baselineKnown` false — save REFUSES), loaded with an ETag (`currentRevision` set —
   *  save sends `If-Match`), loaded WITHOUT one (`baselineKnown` true, `currentRevision` null — save
   *  goes without `If-Match`, i.e. today's behaviour, and does not refuse). */
  private baselineKnown = false;
  /** §4 — loaded, and the file did NOT exist (404): a fourth state. The first save creates it with
   *  `conflictBehavior=fail` (and no `If-Match`), so two windows that both saw "no file" cannot both
   *  win; a 409/412 is a `SaveConflictError`. Cleared once a write succeeds. */
  private baselineAbsent = false;
  /** §4 — the driveItem eTag this instance last loaded or wrote; null = none known. */
  private currentRevision: string | null = null;
  /** §4 — one-shot from `forceNextSave()`: the next save omits `If-Match`. Cleared only after that
   *  write SUCCEEDS (a failed forced save keeps it for the retry), and by a successful load, `adoptRevision`
   *  and `adoptFrom` — each establishes a genuine baseline a leftover force must not carry past. */
  private forceNext = false;
  /** §4 — one-shot from `forceNextSave(expected)`: the next save is a PUT with `If-Match: expected` (never
   *  create-only, never blind). Consumed by that save attempt whatever its outcome, and dropped with
   *  `forceNext` by every new baseline. */
  private expectNext: string | null = null;
  private acquireToken: (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ) => Promise<string | null>;

  constructor(
    config: SpStorageConfig,
    acquireToken: (
      scopes: readonly string[],
      options?: { interactive?: boolean },
    ) => Promise<string | null>,
  ) {
    this.kind = config.kind;
    this.location = {
      hostname: config.hostname,
      sitePath: config.sitePath,
      itemPath: config.itemPath,
    };
    this.acquireToken = acquireToken;
  }

  async isReady(): Promise<boolean> {
    try {
      const token = await this.acquireToken(["Files.ReadWrite.All"]);
      return !!token;
    } catch {
      return false;
    }
  }

  async describe(): Promise<string> {
    const filename =
      this.location.itemPath.split("/").pop() ?? this.location.itemPath;
    return `${filename} on ${this.location.sitePath}`;
  }

  private async getToken(): Promise<string> {
    // Interactive: a load/save is an explicit user action, so first-time
    // consent for Files.ReadWrite.All may surface a popup. (isReady stays silent.)
    const token = await this.acquireToken(["Files.ReadWrite.All"], { interactive: true });
    if (!token) throw new StorageNotReadyError("Sign in to Microsoft first");
    return token;
  }

  /** §4 — record a successful read as this instance's baseline (called only once the body has decoded,
   *  so a corrupt file never becomes the baseline the next save would overwrite). */
  private adoptLoaded(etag: string | null, absent = false): void {
    this.baselineKnown = true;
    this.currentRevision = etag;
    this.baselineAbsent = absent;
    this.forceNext = false;
    this.expectNext = null;
  }

  /** A bounded GET. ★★ §548 — BOUNDED, like Turso's load: the app is held behind a skeleton until this
   *  load settles, so a read that never answers must FAIL the load. A plain Error, the same shape as the
   *  status errors, so it reaches the storageLoadFailed toast and the generic storage banner — NOT
   *  Turso's "storage-unreachable" kind, whose banner text names the Turso database. */
  private async boundedGet(url: string, headers?: Record<string, string>): Promise<FetchTextResult> {
    try {
      return await fetchTextWithTimeout(url, { method: "GET", ...(headers ? { headers } : {}) }, LOAD_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof FetchTimeoutError) {
        throw new Error(`SharePoint did not respond within ${LOAD_TIMEOUT_MS / 1000} s. Try again later.`);
      }
      throw err;
    }
  }

  /** Step 1 of a load: the item's eTag and download URL. Returns null when the file does not exist. */
  private async readItemMetadata(token: string): Promise<{ etag: string | null; downloadUrl: string } | null> {
    const res = await this.boundedGet(graphItemUrlFor(this.location) + ITEM_METADATA_QUERY, { Authorization: `Bearer ${token}` });
    if (res.status === 404) return null;
    if (res.status === 401) {
      throw new StorageNotReadyError("Sign-in expired. Re-authenticate from Settings.");
    }
    if (res.status === 403) {
      throw new StorageNotReadyError("Permission denied. The signed-in user lacks read access to this file.");
    }
    if (!res.ok) {
      throw new Error(`SharePoint returned ${res.status}. Try again later.`);
    }
    let meta: unknown;
    try {
      meta = JSON.parse(res.text);
    } catch {
      throw new Error("SharePoint returned unreadable file metadata. Try again later.");
    }
    const record = (meta ?? {}) as { eTag?: unknown; "@microsoft.graph.downloadUrl"?: unknown };
    const downloadUrl = record["@microsoft.graph.downloadUrl"];
    if (typeof downloadUrl !== "string" || downloadUrl === "") {
      throw new Error("SharePoint did not provide a download URL for this file. Try again later.");
    }
    return { etag: typeof record.eTag === "string" && record.eTag !== "" ? record.eTag : null, downloadUrl };
  }

  async load(): Promise<Workspace> {
    // ★★ ONE accumulator, and every diagnostic field written on every exit.
    // load() has six exits — the 404 empty short-circuit, three HTTP error
    // throws, the CSV return and the JSON return — and an exit that left a
    // field unwritten would keep a STALE value from the PREVIOUS load, worse
    // than zero because it would raise a data-loss warning about a file that
    // is fine.
    //
    // ★★★ TWO MECHANISMS, NOT ONE, AND THE `finally` IS NOT THE GENERAL ONE.
    // It publishes `lastLoadTruncation` and (since §620) `lastDecodeFailures`
    // only. The two import flags are reset HERE instead, BEFORE the first exit
    // can be taken, because that is the one placement the 404 short-circuit
    // cannot skip: they used to sit below it, so a CSV load that hit an
    // unterminated quote, followed by a load of a file that had since been
    // DELETED, re-published the stale `true` and told the user a file that no
    // longer exists has an unclosed quotation mark. Anything added here that
    // can return or throw must leave both mechanisms intact — a new early
    // return is the exact shape that broke it.
    // ★ `lastDecodeFailures` is reset HERE too, beside the import flags, not
    // only published in the `finally` below — belt-and-braces with the same
    // placement, since a future early return added ABOVE the `finally` (the
    // 404 short-circuit is already one) must not resurrect a stale value.
    const diag: ImportDiag = { droppedRows: 0 };
    this.lastImportDroppedRows = 0;
    this.lastImportDroppedBySection = undefined;
    this.lastImportUnterminatedQuote = false;
    this.lastImportMalformedQuotes = 0;
    this.lastDecodeFailures = [];
    try {
      const token = await this.getToken();
      const meta = await this.readItemMetadata(token);
      if (meta === null) {
        // No file yet: a genuine read of "nothing there"; the first save may CREATE it (create-only).
        this.adoptLoaded(null, true);
        return emptyWorkspace();
      }
      // ★★ NO Authorization header: the download URL is pre-authenticated, on another host, and must
      //   never receive the Graph token. (Sending one would also force a CORS preflight it cannot pass.)
      const res = await this.boundedGet(meta.downloadUrl);
      if (!res.ok) {
        throw new Error(`SharePoint returned ${res.status}. Try again later.`);
      }
      if (this.kind === "sp-csv") {
        const csv = res.text;
        const ws = csvToWorkspace(csv, diag);
        this.lastImportDroppedRows = diag.droppedRows;
        this.lastImportDroppedBySection = diag.droppedBySection;
        this.lastImportUnterminatedQuote = diag.unterminatedQuote ?? false;
        this.lastImportMalformedQuotes = diag.malformedQuotes ?? 0;
        this.adoptLoaded(meta.etag);
        return ws;
      }
      // Validate + migrate like every other JSON backend (was a raw cast that
      // risked a downstream TypeError on a malformed-but-valid-JSON file).
      const ws = jsonToWorkspace(res.text, { strict: true, diag });
      this.adoptLoaded(meta.etag);
      return ws;
    } finally {
      this.lastLoadTruncation = {
        entries: diag.truncatedEntries ?? 0,
        blocks: diag.truncatedBlocks ?? 0,
      };
      this.lastDecodeFailures = diag.decodeFailedSlices ?? [];
    }
  }

  async save(workspace: Workspace): Promise<void> {
    // §4 — fail closed: an instance that never loaded has no baseline and must not win against
    // whatever another window already put there. Blind writes go through `forceNextSave()`.
    const force = this.forceNext;
    const expected = this.expectNext;
    this.expectNext = null;
    if (!force && expected === null && !this.baselineKnown) throw new SaveConflictError(this.kind);
    const token = await this.getToken();
    const body =
      this.kind === "sp-csv"
        ? workspaceToCsv(workspace)
        // §634: the same codec as a local JSON file (schemaVersion and all), so
        // a project reads and writes identically wherever the JSON lives.
        : workspaceToJson(workspace);
    const contentType =
      this.kind === "sp-csv" ? "text/csv;charset=utf-8" : "application/json";
    // A forced save is a deliberate blind write: neither `If-Match` nor create-only.
    const createOnly = !force && expected === null && this.baselineAbsent;
    const res = await fetch(graphUrlFor(this.location) + (createOnly ? CREATE_ONLY_QUERY : ""), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        // Only a loaded instance WITH an ETag is guarded; forced and degraded saves omit it.
        // §4 — a conditional Overwrite matches the version the user was shown, not this instance's own.
        ...(expected !== null ? { "If-Match": expected } : !force && this.currentRevision !== null ? { "If-Match": this.currentRevision } : {}),
      },
      body,
    });
    // 412: stale If-Match. 409: create-only lost the race (the file now exists).
    if (res.status === 412 || (createOnly && res.status === 409)) throw new SaveConflictError(this.kind, await this.storedEtag(token));
    if (res.status === 401) {
      throw new StorageNotReadyError(
        "Sign-in expired. Re-authenticate from Settings.",
      );
    }
    if (res.status === 403) {
      throw new StorageNotReadyError(
        "Permission denied. The signed-in user lacks write access to this file.",
      );
    }
    if (!res.ok) {
      throw new Error(`SharePoint returned ${res.status}. Try again later.`);
    }
    // Written: adopt the new eTag (body first, header as fallback) and consume the force.
    this.baselineKnown = true;
    this.baselineAbsent = false;
    this.currentRevision = await this.writtenEtag(res);
    if (force) this.forceNext = false;
  }

  /** §4 — the eTag storage holds right now, for a refusal to report (one metadata GET, no content).
   *  `null` when that read fails or carries none: the conflict banner then offers no Overwrite. */
  private async storedEtag(token: string): Promise<string | null> {
    try {
      const res = await this.boundedGet(graphItemUrlFor(this.location) + "?$select=eTag", { Authorization: `Bearer ${token}` });
      if (!res.ok) return null;
      const tag = (JSON.parse(res.text) as { eTag?: unknown } | null)?.eTag;
      return typeof tag === "string" && tag !== "" ? tag : null;
    } catch {
      return null;
    }
  }

  /** The driveItem eTag a successful PUT returned — the body's `eTag`, else the `ETag` header, else null. */
  private async writtenEtag(res: Response): Promise<string | null> {
    try {
      const parsed: unknown = JSON.parse(await res.text());
      const tag = (parsed as { eTag?: unknown } | null)?.eTag;
      if (typeof tag === "string" && tag !== "") return tag;
    } catch {
      // An empty or non-JSON body carries no eTag; fall through to the header.
    }
    return res.headers.get("ETag");
  }

  /** §4: the eTag this instance last loaded or wrote; null when none is known (never loaded, OR loaded
   *  from a response that carried no ETag — the two are told apart internally, not here). */
  revision(): string | null {
    return this.currentRevision;
  }

  /** §4: adopt `rev` as the baseline without a load/save; also drops a pending force. */
  adoptRevision(rev: string): void {
    this.baselineKnown = true;
    this.baselineAbsent = false;
    this.currentRevision = rev;
    this.forceNext = false;
    this.expectNext = null;
  }

  /** §4: make the next save omit `If-Match`; consumed only once that write succeeds. */
  forceNextSave(expected?: string): void {
    if (expected !== undefined) { this.forceNext = false; this.expectNext = expected; return; }
    this.forceNext = true;
    this.expectNext = null;
  }

  /** §4: copy another instance's revision state (a throwaway backend's result handed to the live one).
   *  `other` must have read or written the SAME file; this does not verify that. */
  adoptFrom(other: SharePointBackend): void {
    this.baselineKnown = other.baselineKnown;
    this.baselineAbsent = other.baselineAbsent;
    this.currentRevision = other.currentRevision;
    this.forceNext = false;
    this.expectNext = null;
  }
}

export function parseSharePointFileUrl(url: string): SpFileLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(".sharepoint.com")) return null;
  // Exclude OneDrive for Business: hostnames like contoso-my.sharepoint.com.
  const hostLocal = parsed.hostname.replace(/\.sharepoint\.com$/, "");
  if (hostLocal === "my" || hostLocal.endsWith("-my")) return null;

  if (parsed.pathname.endsWith("/")) return null;
  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  if (segments.length < 3) return null;
  if (segments[0] !== "sites") return null;

  // ★★ `decodeURIComponent` THROWS on a malformed escape ("%", "%zz", "%e0%a4"), where every other
  //   rejection here returns null — so an unparseable URL used to leave this function two different
  //   ways. That was survivable while the only callers were click handlers; it stopped being so when
  //   `storage-config.tsx` started calling this during RENDER to decide whether the draft denotes the
  //   current target, because typing "Shared%20" passes through "Shared%" and crashed the section on
  //   a keystroke. Found by a test, not by reading. The contract is now one-way: null for anything
  //   this cannot parse.
  // ★★ THE CATCH IS NARROWED TO `URIError` AND RETHROWS EVERYTHING ELSE, deliberately. A bare
  //   `catch { return null; }` is only correct for as long as `decodeURIComponent` is the sole
  //   thing inside the `try` — and nothing stops a later edit moving a statement in there, where a
  //   genuine bug would then be silently reported to every caller as "unparseable URL". Narrowing
  //   costs one line and makes that edit fail loudly instead.
  let decoded: string[];
  try {
    decoded = segments.map((s) => decodeURIComponent(s));
  } catch (e) {
    if (e instanceof URIError) return null;
    throw e;
  }
  const sitePath = `/${decoded[0]}/${decoded[1]}`;
  const itemSegs = decoded.slice(2);
  const itemPath = itemSegs.join("/");

  return {
    hostname: parsed.hostname,
    sitePath,
    itemPath,
  };
}

export interface SpSiteLocation {
  hostname: string;
  sitePath: string;
}

/** Parse a SharePoint SITE or library URL into a Graph-addressable site path.
 *  Relaxes the file-specific checks of parseSharePointFileUrl: a site URL has
 *  only `/sites/<site>` (2 segments) and may end in a slash. Extra trailing
 *  segments (library/folder) are ignored — only the site path is returned. */
export function parseSharePointSiteUrl(url: string): SpSiteLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(".sharepoint.com")) return null;
  const hostLocal = parsed.hostname.replace(/\.sharepoint\.com$/, "");
  if (hostLocal === "my" || hostLocal.endsWith("-my")) return null;

  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  if (segments.length < 2) return null;
  if (segments[0] !== "sites") return null;

  const decoded = segments.slice(0, 2).map((s) => decodeURIComponent(s));
  return { hostname: parsed.hostname, sitePath: `/${decoded[0]}/${decoded[1]}` };
}
