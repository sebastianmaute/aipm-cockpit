// src/app/graph-mail.ts — Microsoft Graph mail send (HTML). Pure given an access
// token: no MSAL, no React. graph.microsoft.com is already CSP-allowlisted by the
// contacts/calendar integrations; SP4 only adds the Mail.* scopes.
const GRAPH = "https://graph.microsoft.com/v1.0";

// Bound every Graph POST so a stalled network (captive portal, hung TLS) can't
// leave the caller waiting forever. The send-preview modal locks dismissal
// while a send is in flight, so an unbounded fetch here would become a keyboard
// trap (WCAG 2.1.2); this guarantees the promise settles and the lock releases.
const GRAPH_POST_TIMEOUT_MS = 30_000;

export const MAIL_READWRITE_SCOPE = ["Mail.ReadWrite"] as const;
export const MAIL_SEND_SCOPE = ["Mail.Send"] as const;

export interface GraphMessage {
  subject: string;
  body: { contentType: "HTML"; content: string };
  toRecipients: { emailAddress: { address: string } }[];
}

export class GraphMailError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GraphMailError";
  }
}

export function buildGraphMessage(
  to: string | readonly string[],
  subject: string,
  htmlBody: string,
): GraphMessage {
  const addresses = (typeof to === "string" ? [to] : to)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  return {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: addresses.map((address) => ({ emailAddress: { address } })),
  };
}

async function graphPost(token: string, path: string, payload: unknown): Promise<Response> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(GRAPH_POST_TIMEOUT_MS),
  });
  if (!res.ok) throw new GraphMailError(res.status, `Graph ${path} failed (${res.status})`);
  return res;
}

/** Create an HTML draft in the user's mailbox; returns its Outlook webLink. */
export async function createDraft(token: string, msg: GraphMessage): Promise<string> {
  const res = await graphPost(token, "/me/messages", msg);
  const json = (await res.json()) as { webLink?: string };
  return json.webLink ?? "";
}

/** Send the HTML message immediately (saved to Sent Items). */
export async function sendMail(token: string, msg: GraphMessage): Promise<void> {
  await graphPost(token, "/me/sendMail", { message: msg, saveToSentItems: true });
}
