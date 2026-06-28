"use client";

// One-time "Security & responsibility disclaimer" shown the FIRST time any
// integration/AI enable checkbox is ticked (AI, Jira, M365, Turso, Timelog).
// A per-device `settings.integrationDisclaimerSeen` flag gates it; once
// acknowledged it never shows again.
//
// Exposed as a context so the five enable checkboxes (spread across several
// section components, reused by both Settings and the setup wizard) can fire
// it without prop-threading. The default context value is a NO-OP, so a section
// rendered outside a provider (e.g. an isolated unit test) safely does nothing.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Modal } from "./modal";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";

type DisclaimerCtx = { notifyEnable: () => void };

const Ctx = createContext<DisclaimerCtx>({ notifyEnable: () => {} });

/** Call `notifyEnable()` when an integration/AI enable checkbox is turned ON. */
export function useIntegrationDisclaimer(): DisclaimerCtx {
  return useContext(Ctx);
}

const TIP_KEYS = [
  "disclaimerTipReview",
  "disclaimerTipSpecific",
  "disclaimerTipBulk",
  "disclaimerTipReadOnly",
  "disclaimerTipRotate",
  "disclaimerTipShare",
] as const;

/** Render a tip, bolding the lead clause before the first en/em dash. */
function Tip({ text }: { text: string }) {
  const m = / [—–] /.exec(text);
  if (!m) return <>{text}</>;
  const lead = text.slice(0, m.index);
  const rest = text.slice(m.index);
  return (
    <>
      <strong className="font-medium text-foreground">{lead}</strong>
      {rest}
    </>
  );
}

function DisclaimerModal({ lang, open, onAck }: { lang: Lang; open: boolean; onAck: () => void }) {
  return (
    <Modal open={open} onClose={onAck} ariaLabel={t(lang, "disclaimerTitle")} align="center" zIndex={70}>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface text-foreground shadow-[var(--shadow-card)]">
        <div className="min-h-0 flex-1 overflow-auto p-5 pr-3">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <span aria-hidden="true">⚠</span>
            {t(lang, "disclaimerTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t(lang, "disclaimerIntro")}</p>
          <p className="mt-3 text-sm text-muted-foreground">{t(lang, "disclaimerResponsibility")}</p>
          <p className="mt-4 text-sm font-medium text-foreground">{t(lang, "disclaimerTipsHeading")}</p>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            {TIP_KEYS.map((k) => (
              <li key={k}>
                <Tip text={t(lang, k)} />
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end border-t border-line p-3">
          <button
            type="button"
            onClick={onAck}
            className={`rounded-md border border-line bg-AIPM-green px-4 py-1.5 text-xs font-medium text-foreground ${INTERACTIVE}`}
          >
            {t(lang, "disclaimerAck")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface ProviderProps {
  lang: Lang;
  /** Whether the disclaimer has already been acknowledged on this device. */
  seen: boolean;
  /** Persist acknowledgement (sets settings.integrationDisclaimerSeen = true). */
  onAcknowledge: () => void;
  /** Pop-outs are read-only — never prompt there. */
  isPopout?: boolean;
  children: ReactNode;
}

export function IntegrationDisclaimerProvider({
  lang,
  seen,
  onAcknowledge,
  isPopout = false,
  children,
}: ProviderProps) {
  const [open, setOpen] = useState(false);
  const notifyEnable = useCallback(() => {
    if (!seen && !isPopout) setOpen(true);
  }, [seen, isPopout]);
  const ack = () => {
    setOpen(false);
    onAcknowledge();
  };
  const ctx = useMemo(() => ({ notifyEnable }), [notifyEnable]);
  return (
    <Ctx.Provider value={ctx}>
      {children}
      <DisclaimerModal lang={lang} open={open} onAck={ack} />
    </Ctx.Provider>
  );
}
