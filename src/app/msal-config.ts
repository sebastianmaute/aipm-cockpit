// Config resolver for the MSAL browser bundle.
// Env vars (NEXT_PUBLIC_MSAL_*) win when set at build time; Settings
// (Integrations panel inputs) are the fallback. Returns null if no clientId
// is available from either source — the Sign-in button surfaces this state
// to the user.

export interface MsalConfig {
  clientId: string;
  tenantId: string;
}

export function getMsalConfig(
  settingsClientId?: string,
  settingsTenantId?: string,
): MsalConfig | null {
  const envClient = process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  const envTenant = process.env.NEXT_PUBLIC_MSAL_TENANT_ID;
  const clientId = (envClient && envClient !== "" ? envClient : settingsClientId) ?? "";
  const tenantId = (envTenant && envTenant !== "" ? envTenant : settingsTenantId) ?? "common";
  if (!clientId) return null;
  return { clientId, tenantId };
}
