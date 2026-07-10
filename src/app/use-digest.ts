// Render-scope glue for the weekly status digest: cadence check (mount +
// visibility), manual generate, optional AI narrative, and the three delivery
// dispatches (card = returned state, Graph email, desktop notification). Reads
// live scope each render → NON-memoized handlers. Coverage-excluded UI glue.
import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Lang } from "./i18n";
import type { DashboardModel } from "./dashboard";
import type { RaidItem } from "./types";
import { buildDigest, type DigestModel } from "./digest/digest-model";
import { loadDigestState, advanceDigestState, isDigestDue } from "./digest/digest-state";
import { buildDigestEmailHtml, buildDigestEmailSubject } from "./digest/digest-email";
import { runDigestNarrative, parseDigestNarrative } from "./digest/digest-narrative";
import type { DigestConfig } from "./digest/digest-config";

export interface UseDigestDeps {
  projectId: string;
  isPopout: boolean;
  lang: Lang;
  now: () => string;
  today: string;
  getModel: () => DashboardModel;
  getRaid: () => readonly RaidItem[];
  config: DigestConfig;
  aiKey: string | null;
  aiModel: string;
  m365Configured: boolean;
  acquireToken: (scopes: readonly string[], opts?: { interactive?: boolean }) => Promise<string | null>;
  sendDigestMail: (token: string, subject: string, html: string) => Promise<void>;
  fireNotification: (title: string, body: string) => void;
  showToast: (msg: string, kind: "error" | "info") => void;
  runNarrative?: typeof runDigestNarrative;
}

export interface UseDigestApi {
  digest: DigestModel | null;
  generateNow: () => Promise<void>;
  emailDigest: () => Promise<void>;
  busy: boolean;
}

export function useDigest(deps: UseDigestDeps): UseDigestApi {
  const [digest, setDigest] = useState<DigestModel | null>(null);
  const [busy, setBusy] = useState(false);
  const autoHandled = useRef(false);

  const generate = useCallback(
    async (notify: boolean): Promise<DigestModel | null> => {
      if (deps.isPopout) return null;
      setBusy(true);
      try {
        const model = deps.getModel();
        const prior = loadDigestState(deps.projectId);
        const now = deps.now();
        let d = buildDigest(
          { model, raid: deps.getRaid(), prior: prior ? { rag: prior.priorRag, overdue: prior.priorMetrics.overdue, openRaid: prior.priorMetrics.openRaid } : null },
          deps.today,
          now,
        );
        if (deps.aiKey) {
          try {
            const runner = deps.runNarrative ?? runDigestNarrative;
            const text = await runner(d, { apiKey: deps.aiKey, model: deps.aiModel, lang: deps.lang });
            const narrative = parseDigestNarrative(text);
            if (narrative) d = { ...d, narrative };
          } catch {
            /* AI fail-soft: deterministic digest stands */
          }
        }
        setDigest(d);
        advanceDigestState(deps.projectId, {
          now,
          cadenceDays: deps.config.cadenceDays,
          rag: d.rag,
          metrics: { overdue: d.overdue.count, openRaid: d.openRaid.count },
        });
        if (notify) {
          const body = `${t(deps.lang, "digestOverdue")}: ${d.overdue.count} · ${t(deps.lang, "digestOpenRaid")}: ${d.openRaid.count}`;
          deps.fireNotification(t(deps.lang, "digestNotifyTitle"), body);
        }
        return d;
      } finally {
        setBusy(false);
      }
    },
    [deps],
  );

  useEffect(() => {
    if (deps.isPopout || !deps.config.enabled || autoHandled.current) return;
    autoHandled.current = true;
    const state = loadDigestState(deps.projectId);
    const due = state ? isDigestDue(state, deps.now()) : true;
    // Defer off the effect's synchronous phase: generate() sets state, and a
    // synchronous setState inside an effect is banned (cascading-render rule).
    if (due) void Promise.resolve().then(() => generate(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.projectId, deps.config.enabled]);

  const generateNow = useCallback(async () => {
    await generate(false);
  }, [generate]);

  const emailDigest = useCallback(async () => {
    if (deps.isPopout || !deps.m365Configured) return;
    const d = digest ?? (await generate(false));
    if (!d) return;
    try {
      const token = await deps.acquireToken(["Mail.Send"], { interactive: true });
      if (!token) return;
      await deps.sendDigestMail(token, buildDigestEmailSubject(d, deps.lang), buildDigestEmailHtml(d, deps.lang));
    } catch {
      deps.showToast(t(deps.lang, "digestEmailFailed"), "error");
    }
  }, [deps, digest, generate]);

  return { digest, generateNow, emailDigest, busy };
}
