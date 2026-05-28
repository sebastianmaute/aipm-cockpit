// src/app/sharepoint-backend.ts
//
// SharePoint storage backend — implements StorageBackend interface via
// Microsoft Graph. Token acquisition is delegated to the caller (M1's
// useMsAuth().acquireToken).

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
  if (hostLocal.endsWith("-my")) return null;

  if (parsed.pathname.endsWith("/")) return null;
  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  if (segments.length < 3) return null;
  if (segments[0] !== "sites") return null;

  const decoded = segments.map((s) => decodeURIComponent(s));
  const sitePath = `/${decoded[0]}/${decoded[1]}`;
  const itemSegs = decoded.slice(2);
  if (itemSegs.length === 0) return null;
  const itemPath = itemSegs.join("/");

  return {
    hostname: parsed.hostname,
    sitePath,
    itemPath,
  };
}
