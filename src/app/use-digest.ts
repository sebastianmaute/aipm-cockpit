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
import { runDigestNarrative } from "./digest/digest-narrative";
import { reportCapabilityGap, reportSilentFailure } from "./guard-feedback";
import type { DigestConfig } from "./digest/digest-config";

/** Bound the optional AI narrative call so a hung request can't leave the card's
 *  `busy` flag stuck (the deterministic digest already rendered by then). */
const AI_TIMEOUT_MS = 20_000;

export interface UseDigestDeps {
  projectId: string;
  isPopout: boolean;
  lang: Lang;
  now: () => string;
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
  /** In-flight email send. A ref, not `busy` — see emailDigest: the busy flag
   *  goes false mid-flow, so it cannot guard against a second click. */
  const sendingRef = useRef(false);
  const autoHandled = useRef(false);

  // Three INDEPENDENT flags. `advance` = reschedule the cadence, `notify` = fire
  // the desktop notification, `narrative` = spend a billed AI call. They used to
  // be one (`advance`), which made emailing reschedule the next digest just to
  // get its narrative; all-false is a DISPLAY-ONLY render for a remount.
  const generate = useCallback(
    async (opts: { notify: boolean; advance: boolean; narrative: boolean }): Promise<DigestModel | null> => {
      if (deps.isPopout) return null;
      setBusy(true);
      try {
        const prior = loadDigestState(deps.projectId);
        const now = deps.now();
        let d = buildDigest(
          { model: deps.getModel(), raid: deps.getRaid(), prior: prior ? { rag: prior.priorRag, overdue: prior.priorMetrics.overdue, openRaid: prior.priorMetrics.openRaid } : null },
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
        }
        // Its OWN flag, NOT `advance`: emailing needs the narrative but must not
        // reschedule the next digest, and a not-due remount needs neither (this
        // is a BILLED call — never let it ride along with something else).
        if (opts.narrative && deps.aiKey) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
          try {
            const runner = deps.runNarrative ?? runDigestNarrative;
            // runDigestNarrative already sanitizes + caps its return value.
            const narrative = await runner(d, { apiKey: deps.aiKey, model: deps.aiModel, lang: deps.lang }, ctrl.signal);
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
    void Promise.resolve().then(() => generate({ notify: due, advance: due, narrative: due }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.projectId, deps.config.enabled]);

  // Manual "Generate now" is a REAL generate: it advances the cadence + rebaselines
  // the deltas (this IS the current digest), but doesn't notify.
  const generateNow = useCallback(async () => {
    await generate({ notify: false, advance: true, narrative: true });
  }, [generate]);

  const emailDigest = useCallback(async () => {
    if (deps.isPopout || !deps.m365Configured) return;
    // A REF, not the busy flag: `generate()` below clears busy in its own
    // `finally`, so between that and the setBusy(true) further down the flag is
    // false and two clicks in one tick both got through — verified, it really
    // sent twice. State cannot guard a window that state itself opens.
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      // advance:FALSE — emailing is a user action, not a scheduled run, so it
      // must not reschedule the next digest.
      //
      // Regenerate when the cached digest has NO narrative but one is possible
      // (a not-due remount generates with narrative:false, and reusing that
      // silently emailed a thinner digest than the comment claimed). Gated on
      // `deps.aiKey`: with AI off a narrative can never appear, so reusing is
      // correct and re-running would bill nothing but waste a round trip.
      const needsNarrative = !!deps.aiKey && !digest?.narrative;
      const d =
        digest && !needsNarrative
          ? digest
          : await generate({ notify: false, advance: false, narrative: true });
      if (!d) return;
      // Held across the Graph roundtrip (bounded at 30s) so the card's buttons
      // also DISABLE — the ref stops the duplicate send, this is what shows the
      // user why. Released in `finally`: every exit — success, null token,
      // throw — must re-enable the button or one Graph error wedges the card.
      setBusy(true);
      // guard-feedback takes (kind, text); this hook's dep is (text, kind).
      const guardToast = (kind: "info" | "error", text: string) => deps.showToast(text, kind);
      try {
        const token = await deps.acquireToken(["Mail.Send"], { interactive: true });
        if (!token) {
          // No signed-in M365 account. The Email button renders on the Settings
          // toggle ALONE (not on being signed in), so this is fully reachable —
          // a bare return made the button a visible no-op. Every other
          // interactive acquireToken call site in the app reports a null token.
          reportCapabilityGap(guardToast, deps.lang, "digest.emailNoAccount", "digestEmailNoAccess");
          return;
        }
        await deps.sendDigestMail(token, buildDigestEmailSubject(d, deps.lang), buildDigestEmailHtml(d, deps.lang));
        // Confirm the send: without this a WORKING button was indistinguishable
        // from a broken one (mirrors use-comm-send's commSendSent).
        deps.showToast(t(deps.lang, "digestEmailSent"), "info");
      } catch (err) {
        // Log the technical detail too — this is the branch you triage from the
        // diagnostics ring, and it was the only one leaving no trace. Safe:
        // GraphMailError's message is status-only, never a response body.
        reportSilentFailure(guardToast, deps.lang, "digest.emailFailed", err, "digestEmailFailed");
      } finally {
        setBusy(false);
      }
      // generate() stays OUTSIDE the catch: it owns its own error handling, and
      // folding it in would turn one of its failures into a "digest email
      // failed" toast. Only the ref release wraps it.
    } finally {
      sendingRef.current = false;
    }
  }, [deps, digest, generate]);

  return { digest, generateNow, emailDigest, busy };
}
