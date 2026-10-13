"use client";

import type { ReactNode } from "react";
import { type Lang, t } from "../i18n";
import { FieldHint } from "../field-hint";
import { INSTALL_GUIDE_URL } from "../version";
import type { TursoSetupState } from "../turso-setup-state";

const TURSO_URL = "https://turso.tech/";
const LINK_CLASS = "text-ui-dark-blue dark:text-ui-light-grey underline hover:opacity-80";

interface TursoSetupStepsProps {
  lang: Lang;
  state: TursoSetupState;
  /** The existing Database URL field(s). */
  urlStep: ReactNode;
  /** The existing auth-token field(s). */
  tokenStep: ReactNode;
  /** The existing Test connection / Apply controls. */
  testStep: ReactNode;
  /** Whether the Apply button is rendered beside Test connection (Turso storage only), so step 4
   *  names Apply only where it exists. */
  canApply: boolean;
}

/** The "done" marker: a decorative check plus text for assistive technology. */
function DoneMark({ lang }: { lang: Lang }) {
  return (
    <span className="ml-1 text-ui-green-strong">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">{t(lang, "tursoStepDone")}</span>
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {children}
    </a>
  );
}

/** Numbered checklist around the Turso URL, token and test controls. */
export function TursoSetupSteps({ lang, state, urlStep, tokenStep, testStep, canApply }: TursoSetupStepsProps) {
  const heading = "font-medium text-foreground";
  return (
    <div>
      <ol className="list-decimal space-y-3 pl-5 text-xs">
        <li>
          <span className={heading}>
            <ExternalLink href={TURSO_URL}>{t(lang, "tursoStepCreate")}</ExternalLink>
          </span>
          <FieldHint className="mt-1">{t(lang, "tursoStepCreateHint")}</FieldHint>
        </li>
        <li>
          <p className={heading}>
            <span>{t(lang, "tursoStepUrl")}</span>
            {state.urlDone && <DoneMark lang={lang} />}
          </p>
          <div className="mt-1 space-y-2">{urlStep}</div>
        </li>
        <li>
          <p className={heading}>
            <span>{t(lang, "tursoStepToken")}</span>
            {state.tokenDone && <DoneMark lang={lang} />}
          </p>
          <div className="mt-1 space-y-2">{tokenStep}</div>
        </li>
        <li>
          <p className={heading}>
            <span>{t(lang, canApply ? "tursoStepTestApply" : "tursoStepTest")}</span>
            {state.testDone && <DoneMark lang={lang} />}
          </p>
          <div className="mt-1 space-y-2">{testStep}</div>
        </li>
      </ol>
      <p className="mt-3 text-xs">
        <ExternalLink href={INSTALL_GUIDE_URL}>{t(lang, "tursoStepGuide")}</ExternalLink>
      </p>
    </div>
  );
}
