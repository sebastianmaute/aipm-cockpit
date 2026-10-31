"use client";

// The AI data disclosure, asked where AI is switched on (Settings → AI) and nowhere else.
// Built on the shared Modal: Escape, the Tab trap and focus restore are its job.
// ★ What each path sends is NOT written here: the rows come from `AI_DATA_PATHS` (ai-disclosure.ts),
//   filtered by `level`, so the dialog and docs/security.md read one table.
// ★ Where it goes (the data lead-in and the key bullet) follows the deployment's AI route through
//   `aiDestinationKey`: direct to Anthropic, or through this app's server and the organisation's gateway.

import { useId, useState } from "react";
import { Button, PRIMARY_MATCHING_BORDER } from "./button";
import { Checkbox } from "./form-controls";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { type AiPolicy } from "./ai-policy";
import { aiDataPathsFor, aiDestinationKey, aiKeyRestrictionConsentKey, aiProtectedTextKey, type AiConsentLevel } from "./ai-disclosure";

export interface AiConsentDialogProps {
  lang: Lang;
  /** Which switch the consent is for; it picks the rows of AI_DATA_PATHS (ai-disclosure.ts) the dialog lists. */
  level: AiConsentLevel;
  policy: AiPolicy;
  onAccept: () => void;
  onCancel: () => void;
}

/** ★ The organisation policy block (bullet 6, the link and the checkbox) comes from
 *  `resolveAiPolicy`: the owner fills all three strings, and with no link there is no
 *  policy to read or accept, so the block drops out and Accept is enabled on its own. */
export function AiConsentDialog({ lang, level, policy, onAccept, onCancel }: AiConsentDialogProps) {
  const titleId = useId();
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const hasPolicy = policy.url !== null;
  const owner = policy.org ?? t(lang, "aiPolicyOwnerFallback");
  const isBackground = level === "background";
  const title = t(lang, isBackground ? "aiConsentBackgroundTitle" : "aiConsentTitle");
  const runners: string[] = isBackground
    ? [t(lang, "aiConsentBackgroundRunner1"), t(lang, "aiConsentBackgroundRunner2"), t(lang, "aiConsentBackgroundRunner3")]
    : [];
  const dataRows = aiDataPathsFor(level).map((row) => ({
    id: row.id,
    label: t(lang, row.labelKey),
    data: t(lang, row.dataKey),
    whenProtected: row.whenProtected,
    protectedText: t(lang, aiProtectedTextKey(row)),
  }));
  const keyRestrictionKey = aiKeyRestrictionConsentKey();
  const bullets: string[] = [
    t(lang, aiDestinationKey("keySecurity")),
    t(lang, aiDestinationKey("thirdParty")),
    ...(keyRestrictionKey !== null ? [t(lang, keyRestrictionKey)] : []),
    t(lang, "aiConsentBullet4"),
    t(lang, "aiConsentBullet5"),
    ...(hasPolicy ? [t(lang, "aiConsentBullet6", owner)] : []),
  ];
  return (
    <Modal open onClose={onCancel} ariaLabelledby={titleId} align="center" backdropClassName="bg-ui-dark-blue/50" zIndex={60}>
      <div
        data-modal-panel
        data-consent-level={level}
        className="relative flex max-h-[90vh] w-[560px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={title}
          titleId={titleId}
          onClose={onCancel}
          closeLabel={`${t(lang, "alertModalClose")} – ${title}`}
          hideVoiceCommand
        />
        <div className="flex flex-col gap-3 overflow-y-auto p-6 text-sm text-foreground">
          {isBackground ? <p>{t(lang, "aiConsentBackgroundIntro")}</p> : <p>{t(lang, "aiConsentNotAccepted")}</p>}
          {runners.length > 0 && (
            <ul className="space-y-2">
              {runners.map((text) => (
                <li key={text} className="flex gap-2">
                  <span aria-hidden className="mt-0.5">
                    •
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          )}
          <p data-ai-people-protection-notice>{t(lang, "aiConsentPeopleProtection")}</p>
          <p>{t(lang, aiDestinationKey(level))}</p>
          <dl className="space-y-2">
            {dataRows.map((row) => (
              <div key={row.id} data-ai-data-path={row.id}>
                <dt className="font-medium">{row.label}</dt>
                <dd>{row.data}</dd>
                <dd data-ai-protected={row.whenProtected} className="mt-1 text-muted-foreground">
                  <span className="font-medium">{t(lang, "aiProtectedWhenLabel")}</span> {row.protectedText}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="space-y-2">
            {bullets.map((text) => (
              <li key={text} className="flex gap-2">
                <span aria-hidden className="mt-0.5">
                  •
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
          {hasPolicy && (
            <>
              <p>
                <a
                  href={policy.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2 hover:decoration-2"
                >
                  {t(lang, "aiConsentPolicyLink", owner)} ↗
                </a>
              </p>
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={policyAccepted}
                  onChange={(e) => setPolicyAccepted(e.target.checked)}
                  className="mt-0.5 cursor-pointer"
                />
                <span>{t(lang, "aiConsentPolicyCheckbox", owner)}</span>
              </label>
            </>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel}>
              {t(lang, "cancel")}
            </Button>
            <Button className={PRIMARY_MATCHING_BORDER} onClick={onAccept} disabled={hasPolicy && !policyAccepted}>
              {t(lang, isBackground ? "aiConsentBackgroundAccept" : "aiConsentAccept")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
