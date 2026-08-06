"use client";

import { type Lang, t } from "./i18n";
import type { KnowledgeLink } from "./document-link";
import { KnowledgeLinksField } from "./knowledge-links-field";
import { FieldGroup } from "./form-controls";
import { useMsAuth } from "./use-ms-auth";
import { useSettings } from "./use-settings";
import { useActivityLogger } from "./activity-log-context";

export interface KnowledgeLinksFieldGatedProps {
  value: KnowledgeLink[];
  onChange: (next: KnowledgeLink[]) => void;
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

/**
 * The captioned "Documents" block the entity editors render.
 *
 * ★★ `FieldGroup`, never a `<label>`: with SharePoint ON the field renders a ✕
 * remove button per link and then an Add button, and NO input at all, so a
 * `<label>` binds its caption to the FIRST ✕ — clicking "Documents" deleted a
 * link. The field has no accessible name of its own, so a bare `<div>` would
 * lose the naming too; the named group keeps it. See src/test/label-binding.ts.
 *
 * Extracted because change · raid · milestone · stakeholder each repeated this
 * caption+wrapper verbatim — measured: the duplication gate reported 165 clones with
 * the four copies present and 162 after this extraction, against 164 on HEAD (it is
 * NOT in docs/baselines/jscpd-2026-07.json, whose line numbers predate this) — and each therefore
 * carried its own copy of the landmine comment.
 */
export function DocumentLinksGroup({
  value,
  onChange,
  lang,
  className = "flex flex-col gap-1 text-sm sm:col-span-2",
}: KnowledgeLinksFieldGatedProps & { className?: string }) {
  return (
    <FieldGroup
      name={t(lang, "documents")}
      className={className}
      caption={<span className="font-medium text-foreground">{t(lang, "documents")}</span>}
    >
      <KnowledgeLinksFieldGated value={value} onChange={onChange} lang={lang} />
    </FieldGroup>
  );
}
