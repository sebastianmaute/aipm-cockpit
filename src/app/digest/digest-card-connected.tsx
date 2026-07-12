"use client";
// Connects the presentational DigestCard to live app state: instantiates
// useDigest with the real primitives (MS auth token, Graph sendMail, desktop
// notification, toast) and the current settings/dashboard model. Mounted in the
// Dashboard headline zone. A `.tsx` glue component (coverage-excluded like the
// other UI glue) — the tested surface is useDigest + DigestCard.
import { useSettings } from "../use-settings";
import { useMsAuth } from "../use-ms-auth";
import { useToastContext } from "../toast-context";
import { sendMail, buildGraphMessage } from "../graph-mail";
import { t, type Lang } from "../i18n";
import { aiKeyIfEnabled } from "../settings-types";
import { useDigest } from "../use-digest";
import { DigestCard } from "../dashboard-sections/digest-card";
import { DEFAULT_DIGEST_CONFIG } from "./digest-config";
import type { DashboardModel } from "../dashboard";
import type { RaidItem } from "../types";
import type { DensityClasses } from "../dashboard-density";

interface DigestCardConnectedProps {
  lang: Lang;
  dc: DensityClasses;
  model: DashboardModel;
  raid: readonly RaidItem[];
  projectId: string;
  isPopout: boolean;
}

export function DigestCardConnected({
  lang,
  dc,
  model,
  raid,
  projectId,
  isPopout,
}: DigestCardConnectedProps) {
  const { settings } = useSettings();
  const m365Enabled = settings.integrations?.m365?.enabled ?? false;
  const msAuth = useMsAuth(m365Enabled && !isPopout);
  const toast = useToastContext();
  const aiKey = aiKeyIfEnabled(settings.ai); // "" when the master switch is off / no key

  const api = useDigest({
    projectId,
    isPopout,
    lang,
    now: () => new Date().toISOString(),
    getModel: () => model,
    getRaid: () => raid,
    config: settings.digest ?? DEFAULT_DIGEST_CONFIG,
    aiKey: aiKey ? aiKey : null,
    aiModel: settings.ai.model,
    m365Configured: m365Enabled,
    acquireToken: (scopes, opts) => msAuth.acquireToken(scopes, opts),
    sendDigestMail: async (token, subject, html) => {
      const to = msAuth.account?.username ?? "";
      if (!to) {
        toast("error", t(lang, "digestEmailFailed")); // no signed-in account → no recipient
        return;
      }
      await sendMail(token, buildGraphMessage(to, subject, html));
    },
    fireNotification: (title, body) => {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(title, { body, tag: "aipm-cockpit-digest" });
        } catch {
          /* notification construction can throw on some platforms — non-fatal */
        }
      }
    },
    showToast: (msg, kind) => toast(kind, msg),
  });

  return (
    <DigestCard
      lang={lang}
      digest={api.digest}
      dc={dc}
      m365Configured={m365Enabled}
      busy={api.busy}
      onGenerate={() => void api.generateNow()}
      onEmail={() => void api.emailDigest()}
    />
  );
}
