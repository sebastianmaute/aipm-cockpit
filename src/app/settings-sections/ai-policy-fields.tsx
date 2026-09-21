"use client";
import { useId, type ReactNode } from "react";
import { type Lang, t } from "../i18n";
import type { AiConfig } from "../settings-types";
import { Input } from "../form-controls";
import { FieldHint } from "../field-hint";
import { FieldError } from "../field-feedback";
import { DEFAULT_AI_POLICY_ORG, MAX_AI_POLICY_FIELD, isSafePolicyUrl, resolveAiPolicy } from "../ai-policy";

/**
 * Settings → AI Assistant: who owns the AI-usage policy the consent screen names,
 * and the link it asks people to read and accept (`ai-policy.ts`).
 *
 * ★ A field whose NEXT_PUBLIC_AI_POLICY_* build value is set shows only a note, as
 *   the Turso URL field does: the deployment value wins, so an input would edit
 *   nothing. ★ An empty field is a real choice ("" = cleared), distinct from a
 *   never-set field, which shows the built-in default.
 */
export function AiPolicyFields({
  lang,
  ai,
  onChange,
}: {
  lang: Lang;
  ai: AiConfig;
  onChange: (next: Pick<AiConfig, "policyOrgName" | "policyUrl">) => void;
}) {
  const orgId = useId();
  const orgHintId = useId();
  const urlId = useId();
  const urlHintId = useId();
  const urlErrorId = useId();
  const urlEnvRejectedId = useId();
  const urlNoBuiltinId = useId();
  const policy = resolveAiPolicy(ai);
  const orgValue = ai.policyOrgName ?? DEFAULT_AI_POLICY_ORG;
  // ★ A never-set link shows what the consent screen will actually use — the built-in
  //   link only while the owner is the built-in one, otherwise nothing.
  const urlValue = ai.policyUrl ?? policy.url ?? "";
  const urlInvalid = urlValue.trim() !== "" && !isSafePolicyUrl(urlValue);
  // ★★ Say WHY the link went blank. Renaming or clearing the owner drops the built-in
  //   link, and with it the consent screen's "read and accept" checkbox — on a consent
  //   surface that must never happen silently.
  const builtinLinkDropped = !policy.urlFromEnv && ai.policyUrl === undefined && policy.org !== DEFAULT_AI_POLICY_ORG;
  const urlDescribedBy = [
    urlHintId,
    urlInvalid && urlErrorId,
    builtinLinkDropped && urlNoBuiltinId,
    policy.urlEnvRejected && urlEnvRejectedId,
  ].filter(Boolean).join(" ");

  return (
    <div className="mt-3 space-y-2">
      <div>
        <Caption htmlFor={policy.orgFromEnv ? undefined : orgId}>{t(lang, "aiPolicyOrgLabel")}</Caption>
        {policy.orgFromEnv ? (
          <FieldHint className="mt-1">{t(lang, "aiPolicyOrgFromEnv")}</FieldHint>
        ) : (
          <>
            <Input
              id={orgId}
              className="mt-1 w-full"
              value={orgValue}
              maxLength={MAX_AI_POLICY_FIELD}
              onChange={(e) => onChange({ policyOrgName: e.target.value })}
              aria-describedby={orgHintId}
            />
            <FieldHint id={orgHintId} className="mt-1">{t(lang, "aiPolicyOrgHint")}</FieldHint>
          </>
        )}
      </div>
      <div>
        <Caption htmlFor={policy.urlFromEnv ? undefined : urlId}>{t(lang, "aiPolicyUrlLabel")}</Caption>
        {policy.urlFromEnv ? (
          <FieldHint className="mt-1">{t(lang, "aiPolicyUrlFromEnv")}</FieldHint>
        ) : (
          <>
            <Input
              id={urlId}
              className="mt-1 w-full"
              type="url"
              inputMode="url"
              value={urlValue}
              placeholder="https://"
              maxLength={MAX_AI_POLICY_FIELD}
              onChange={(e) => onChange({ policyUrl: e.target.value })}
              aria-invalid={urlInvalid || undefined}
              aria-describedby={urlDescribedBy}
            />
            <FieldHint id={urlHintId} className="mt-1">{t(lang, "aiPolicyUrlHint")}</FieldHint>
            {urlInvalid && <FieldError id={urlErrorId}>{t(lang, "aiPolicyUrlInvalid")}</FieldError>}
            {builtinLinkDropped && (
              <FieldHint id={urlNoBuiltinId} className="mt-1">{t(lang, "aiPolicyUrlNoBuiltin")}</FieldHint>
            )}
            {policy.urlEnvRejected && (
              <FieldHint id={urlEnvRejectedId} className="mt-1">{t(lang, "aiPolicyUrlEnvRejected")}</FieldHint>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A `<label>` bound to its input, or plain text when an environment value has
 *  replaced the input — a label pointing at no control names nothing. */
function Caption({ htmlFor, children }: { htmlFor: string | undefined; children: ReactNode }) {
  const cls = "block text-xs text-muted-foreground";
  return htmlFor ? <label htmlFor={htmlFor} className={cls}>{children}</label> : <p className={cls}>{children}</p>;
}
