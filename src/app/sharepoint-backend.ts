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
  type StorageBackend,
  type Workspace,
} from "./workspace";
import type { ImportSectionKey } from "./csv-codecs-sections";

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

function graphUrlFor(loc: SpFileLocation): string {
  return `${GRAPH}/sites/${loc.hostname}:${loc.sitePath}:/drive/root:/${loc.itemPath}:/content`;
}

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
  private location: SpFileLocation;
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

  async load(): Promise<Workspace> {
    // ★★ ONE accumulator, and every diagnostic field written on every exit.
    // load() has six exits — the 404 empty short-circuit, three HTTP error
    // throws, the CSV return and the JSON return — and an exit that left a
    // field unwritten would keep a STALE value from the PREVIOUS load, worse
    // than zero because it would raise a data-loss warning about a file that
    // is fine.
    //
    // ★★★ TWO MECHANISMS, NOT ONE, AND THE `finally` IS NOT THE GENERAL ONE.
    // It publishes `lastLoadTruncation` only. The two import flags are reset
    // HERE instead, BEFORE the first exit can be taken, because that is the
    // one placement the 404 short-circuit cannot skip: they used to sit below
    // it, so a CSV load that hit an unterminated quote, followed by a load of
    // a file that had since been DELETED, re-published the stale `true` and
    // told the user a file that no longer exists has an unclosed quotation
    // mark. Anything added here that can return or throw must leave both
    // mechanisms intact — a new early return is the exact shape that broke it.
    const diag: ImportDiag = { droppedRows: 0 };
    this.lastImportDroppedRows = 0;
    this.lastImportDroppedBySection = undefined;
    this.lastImportUnterminatedQuote = false;
    this.lastImportMalformedQuotes = 0;
    try {
      const token = await this.getToken();
      const res = await fetch(graphUrlFor(this.location), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return emptyWorkspace();
      if (res.status === 401) {
        throw new StorageNotReadyError(
          "Sign-in expired. Re-authenticate from Settings.",
        );
      }
      if (res.status === 403) {
        throw new StorageNotReadyError(
          "Permission denied. The signed-in user lacks read access to this file.",
        );
      }
      if (!res.ok) {
        throw new Error(`SharePoint returned ${res.status}. Try again later.`);
      }
      if (this.kind === "sp-csv") {
        const csv = await res.text();
        const ws = csvToWorkspace(csv, diag);
        this.lastImportDroppedRows = diag.droppedRows;
        this.lastImportDroppedBySection = diag.droppedBySection;
        this.lastImportUnterminatedQuote = diag.unterminatedQuote ?? false;
        this.lastImportMalformedQuotes = diag.malformedQuotes ?? 0;
        return ws;
      }
      // Validate + migrate like every other JSON backend (was a raw cast that
      // risked a downstream TypeError on a malformed-but-valid-JSON file).
      return jsonToWorkspace(await res.text(), { strict: true, diag });
    } finally {
      this.lastLoadTruncation = {
        entries: diag.truncatedEntries ?? 0,
        blocks: diag.truncatedBlocks ?? 0,
      };
    }
  }

  async save(workspace: Workspace): Promise<void> {
    const token = await this.getToken();
    const body =
      this.kind === "sp-csv"
        ? workspaceToCsv(workspace)
        : JSON.stringify(workspace);
    const contentType =
      this.kind === "sp-csv" ? "text/csv;charset=utf-8" : "application/json";
    const res = await fetch(graphUrlFor(this.location), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body,
    });
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

  const decoded = segments.map((s) => decodeURIComponent(s));
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
