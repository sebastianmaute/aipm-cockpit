"use client";

// open-followups §510 — the internal activity-log download, under Settings → Storage in expert mode.
// ★★ Expert mode keeps this out of a project manager's way; it is NOT access control (the app has no
// roles, §508). What bounds the file is the storage credential — see activity-audit.ts.

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { Button } from "../button";
import { useConfirm } from "../confirm-dialog";
import type { ActivityAuditDownloader } from "../activity-audit-download";

interface ActivityAuditSectionProps {
  lang: Lang;
  audit: ActivityAuditDownloader;
}

export function ActivityAuditSection({ lang, audit }: ActivityAuditSectionProps) {
  const confirm = useConfirm();
  const [outcome, setOutcome] = useState<"done" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const scopeText = t(lang, audit.scope === "portfolio" ? "activityAuditScopePortfolio" : "activityAuditScopeCurrent");

  const askThenDownload = async () => {
    const ok = await confirm({
      title: t(lang, "activityAuditConfirmTitle"),
      message: `${t(lang, "activityAuditConfirmBody")} ${scopeText}`,
      // Distinct from the trigger's label, which stays on screen behind the dialog.
      confirmLabel: t(lang, "activityAuditConfirmAction"),
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome((await audit.download()) ? "done" : "failed");
    } catch {
      // A failed portfolio read: nothing was downloaded, and the control says so.
      setOutcome("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="activity-audit-title" className="mt-6">
      <h4 id="activity-audit-title" className="mb-2 text-sm font-semibold text-foreground">
        {t(lang, "activityAuditTitle")}
      </h4>
      <p className="mb-1 text-xs text-muted-foreground">{t(lang, "activityAuditIntro")}</p>
      <p className="mb-3 text-xs text-muted-foreground">{scopeText}</p>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => { void askThenDownload(); }}>
        {t(lang, "activityAuditDownload")}
      </Button>
      <p role="status" className="mt-2 text-xs">
        {outcome === "done" ? t(lang, "activityAuditDone") : outcome === "failed" ? t(lang, "activityAuditFailed") : ""}
      </p>
    </section>
  );
}
