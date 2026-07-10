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

/** Bound the optional AI narrative call so a hung request can't leave the card's
 *  `busy` flag stuck (the deterministic digest already rendered by then). */
const AI_TIMEOUT_MS = 20_000;

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

  // `advance` = a REAL generate (advance the cadence + notify + run AI). When
  // false the digest is DISPLAY-ONLY: render current facts on a remount without
  // touching the cadence, notifying, or spending an AI call.
  const generate = useCallback(
    async (opts: { notify: boolean; advance: boolean }): Promise<DigestModel | null> => {
      if (deps.isPopout) return null;
      setBusy(true);
      try {
        const prior = loadDigestState(deps.projectId);
        const now = deps.now();
        let d = buildDigest(
          { model: deps.getModel(), raid: deps.getRaid(), prior: prior ? { rag: prior.priorRag, overdue: prior.priorMetrics.overdue, openRaid: prior.priorMetrics.openRaid } : null },
          deps.today,
          now,
        );
        // Deterministic base renders IMMEDIATELY — the card never waits on AI.
        setDigest(d);
        if (opts.advance) {
          advanceDigestState(deps.projectId, {
            now,
            cadenceDays: deps.config.cadenceDays,
            rag: d.rag,
            metrics: { overdue: d.overdue.count, openRaid: d.openRaid.count },
          });
          if (opts.notify) {
            const body = `${t(deps.lang, "digestOverdue")}: ${d.overdue.count} · ${t(deps.lang, "digestOpenRaid")}: ${d.openRaid.count}`;
            deps.fireNotification(t(deps.lang, "digestNotifyTitle"), body);
          }
          if (deps.aiKey) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
            try {
              const runner = deps.runNarrative ?? runDigestNarrative;
              const text = await runner(d, { apiKey: deps.aiKey, model: deps.aiModel, lang: deps.lang }, ctrl.signal);
              const narrative = parseDigestNarrative(text);
              if (narrative) {
                d = { ...d, narrative };
                setDigest(d);
              }
            } catch {
              /* AI fail-soft: deterministic digest stands */
            } finally {
              clearTimeout(timer);
            }
          }
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
    // Due → full generate; not due → display-only (card still renders after a
    // remount). Deferred off the effect's sync phase (setState-in-effect banned).
    void Promise.resolve().then(() => generate({ notify: due, advance: due }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.projectId, deps.config.enabled]);

  const generateNow = useCallback(async () => {
    await generate({ notify: false, advance: true });
  }, [generate]);

  const emailDigest = useCallback(async () => {
    if (deps.isPopout || !deps.m365Configured) return;
    const d = digest ?? (await generate({ notify: false, advance: true }));
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
