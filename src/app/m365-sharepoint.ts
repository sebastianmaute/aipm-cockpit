import type { AcquireToken } from "./use-sharepoint-browser";
import { PICKER_SCOPES } from "./use-sharepoint-browser";

interface M365Integration {
  enabled?: boolean;
  sharepoint?: boolean;
}
interface IntegrationsShape {
  m365?: M365Integration;
}

/** True when M365 is enabled AND its SharePoint sub-feature is enabled. Mirrors
 *  the gate in document-links-field-gated.tsx — the Documents "Add document"
 *  button only shows when SharePoint document picking actually works. Uses a
 *  minimal structural shape so callers can pass a settings `IntegrationsSettings`
 *  (which is structurally assignable) without coupling to its full field set. */
export function isSharePointEnabled(integrations: IntegrationsShape | undefined): boolean {
  const m365 = integrations?.m365;
  return (m365?.enabled ?? false) && (m365?.sharepoint ?? false);
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Graph "encode sharing URL" rule: u! + url-safe base64 of the share URL
 *  (trailing "=" trimmed, "/" -> "_", "+" -> "-"). Lets us fetch any share/web
 *  URL via /shares without resolving drive/item ids first. */
export function encodeSharingUrl(shareUrl: string): string {
  const b64 =
    typeof btoa === "function" ? btoa(shareUrl) : Buffer.from(shareUrl).toString("base64");
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

/** Fetch a SharePoint file's bytes via Graph from its share URL (what the
 *  picker yields as DocumentLink.url). Reuses the picker's delegated scopes so
 *  no extra consent is needed. Throws Error("no-token") when consent is denied
 *  and Error(<status>) on a non-OK response — errors carry status only, never
 *  the token or body. The caller turns the bytes into a chat-attachments block. */
export async function fetchSharePointFileContent(
  shareUrl: string,
  name: string,
  acquireToken: AcquireToken,
): Promise<{ name: string; mime: string; bytes: ArrayBuffer }> {
  const token = await acquireToken([...PICKER_SCOPES], { interactive: true });
  if (!token) throw new Error("no-token");
  const res = await fetch(
    `${GRAPH_BASE}/shares/${encodeSharingUrl(shareUrl)}/driveItem/content`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(String(res.status));
  const mime =
    res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
  const bytes = await res.arrayBuffer();
  return { name, mime, bytes };
}
