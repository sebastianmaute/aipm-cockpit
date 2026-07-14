"use client";
import { useEffect, useState } from "react";

/**
 * MSAL popup redirect target (`redirectUri = ${origin}/msal-redirect`).
 *
 * MSAL v5 completes a popup sign-in via a BroadcastChannel bridge, NOT by the
 * opener polling the popup URL: the popup must read the auth response from its
 * own URL and broadcast it to the opener, which is waiting on that channel.
 * `broadcastResponseToMainFrame` (the dedicated `@azure/msal-browser/redirect-bridge`
 * export) does exactly that, then closes the popup.
 *
 * This lives on its OWN route so the full app (task-manager/workspace) never
 * boots inside the popup — only the light root layout does — giving an instant
 * clean close with no app flash. Do NOT add application UI here, and do NOT run
 * MSAL `handleRedirectPromise` on this page (that is the redirect-flow API and
 * would consume the opener's shared interaction).
 */
export default function MsalRedirectPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@azure/msal-browser/redirect-bridge")
      .then(({ broadcastResponseToMainFrame }) => broadcastResponseToMainFrame())
      .catch(() => {
        // No payload / bad state / opener gone — surface a closable message
        // instead of hanging on a blank page.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ font: "14px system-ui, sans-serif", padding: 24 }}>
      {failed
        ? "Sign-in could not be completed. You can close this window."
        : "Signing you in…"}
    </main>
  );
}
