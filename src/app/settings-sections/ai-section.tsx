"use client";

import { type Lang, t } from "../i18n";
import type { ChatModel, Settings } from "../settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { FieldNotice } from "../field-feedback";
import { AiUsagePanel } from "./ai-usage-panel";

interface AiSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

function CapInput({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number | undefined;
  defaultValue: number;
  onChange: (n: number) => void;
}) {
  const displayed = value != null && value > 0 ? value : defaultValue;
  return (
    <label className="mt-2 block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={1}
        step={1}
        value={displayed}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n > 0 ? n : defaultValue);
        }}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
    </label>
  );
}

export function AiSection({ lang, settings, onChange }: AiSectionProps) {
  const sessionCap = settings.ai.sessionTokenCap ?? DEFAULT_SESSION_TOKEN_CAP;
  const weeklyCap = settings.ai.weeklyTokenCap ?? DEFAULT_WEEKLY_TOKEN_CAP;

  return (
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "aiAssistant")}
        <InfoTooltip text={t(lang, "aiAssistantTooltip")} />
      </span>
      <label className="mt-2 block">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          {t(lang, "aiApiKey")}
          <InfoTooltip text={t(lang, "aiApiKeyTooltip")} />
        </span>
        <input
          type="password"
          autoComplete="off"
          value={settings.ai.apiKey}
          onChange={(e) =>
            onChange({
              ...settings,
              ai: { ...settings.ai, apiKey: e.target.value },
            })
          }
          placeholder={t(lang, "aiApiKeyPlaceholder")}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        />
        <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
      </label>
      <label className="mt-2 block">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          {t(lang, "aiModel")}
          <InfoTooltip text={t(lang, "aiModelTooltip")} />
        </span>
        <select
          value={settings.ai.model}
          onChange={(e) =>
            onChange({
              ...settings,
              ai: {
                ...settings.ai,
                model: e.target.value as ChatModel,
              },
            })
          }
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        >
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="claude-opus-4-7">Claude Opus 4.7</option>
          <option value="claude-haiku-4-5-20251001">
            Claude Haiku 4.5
          </option>
        </select>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(lang, "aiApiKeyHint")}
      </p>
      {settings.ai.consentAccepted ? (
        <p className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>✓ {t(lang, "aiConsentGranted")}</span>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...settings,
                ai: { ...settings.ai, consentAccepted: false },
              })
            }
            className="text-xs font-medium text-AIPM-pink underline-offset-2 hover:underline"
          >
            {t(lang, "aiConsentRevoke")}
          </button>
        </p>
      ) : (
        <p className="mt-2 text-xs text-AIPM-purple">
          {t(lang, "aiConsentRequired")}
        </p>
      )}

      {/* Token cap inputs */}
      <CapInput
        label={t(lang, "aiSessionCap")}
        value={settings.ai.sessionTokenCap}
        defaultValue={DEFAULT_SESSION_TOKEN_CAP}
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, sessionTokenCap: n } })
        }
      />
      <CapInput
        label={t(lang, "aiWeeklyCap")}
        value={settings.ai.weeklyTokenCap}
        defaultValue={DEFAULT_WEEKLY_TOKEN_CAP}
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, weeklyTokenCap: n } })
        }
      />

      {/* Live usage bars — sourced from AiUsageProvider */}
      <AiUsagePanel lang={lang} sessionCap={sessionCap} weeklyCap={weeklyCap} />
    </div>
  );
}
