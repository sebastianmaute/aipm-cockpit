// src/app/sharepoint-backend.ts
//
// SharePoint storage backend — implements StorageBackend interface via
// Microsoft Graph. Token acquisition is delegated to the caller (M1's
// useMsAuth().acquireToken).

import {
  StorageNotReadyError,
  csvToWorkspace,
  emptyWorkspace,
  workspaceToCsv,
  type StorageBackend,
  type Workspace,
} from "./storage";

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
  private location: SpFileLocation;
  private acquireToken: (scopes: readonly string[]) => Promise<string | null>;

  constructor(
    config: SpStorageConfig,
    acquireToken: (scopes: readonly string[]) => Promise<string | null>,
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
      const token = await this.acquireToken(["Files.ReadWrite"]);
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
    const token = await this.acquireToken(["Files.ReadWrite"]);
    if (!token) throw new StorageNotReadyError("Sign in to Microsoft first");
    return token;
  }

  async load(): Promise<Workspace> {
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
      return csvToWorkspace(csv);
    }
    return (await res.json()) as Workspace;
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
