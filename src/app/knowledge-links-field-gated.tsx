"use client";

import { type Lang, t } from "./i18n";
import type { DocumentLink } from "./document-link";
import { KnowledgeLinksField } from "./knowledge-links-field";
import { useMsAuth } from "./use-ms-auth";
import { useSettings } from "./use-settings";
import { useActivityLogger } from "./activity-log-context";

export interface KnowledgeLinksFieldGatedProps {
  value: DocumentLink[];
  onChange: (next: DocumentLink[]) => void;
  lang: Lang;
}

/** KnowledgeLinksField wrapped with the M365+SharePoint integration gate.
 *  When the integration is off, shows a hint instead of the picker field.
 *  Centralizes auth + settings wiring so entity editors stay thin. */
export function KnowledgeLinksFieldGated({ value, onChange, lang }: KnowledgeLinksFieldGatedProps) {
  const { settings } = useSettings();
  const m365 = settings.integrations?.m365;
  const m365Enabled = m365?.enabled ?? false;
  const spEnabled = m365Enabled && (m365?.sharepoint ?? false);
  const auth = useMsAuth(m365Enabled);
  const logActivity = useActivityLogger();
  const onLog = logActivity
    ? (action: "added" | "removed", name: string) =>
        logActivity(action === "added" ? "doc.linkAdded" : "doc.linkRemoved", name)
    : undefined;

  if (!spEnabled) {
    return <p className="text-xs text-muted-foreground">{t(lang, "documentsNeedsSharePoint")}</p>;
  }
  return (
    <KnowledgeLinksField value={value} onChange={onChange} lang={lang} acquireToken={auth.acquireToken} onLog={onLog} />
  );
}
