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
