"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { type Settings } from "../settings-types";
import { TextButton } from "../text-button";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP, DEFAULT_MAX_CHAT_TURNS, DEFAULT_TOKEN_MULTIPLIER } from "../settings-types";
import {
  DEFAULT_INSIGHT_REC_INTERVAL_MIN,
  MIN_INSIGHT_REC_INTERVAL_MIN,
  MAX_INSIGHT_REC_INTERVAL_MIN,
  clampInsightRecInterval,
} from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { FieldNotice } from "../field-feedback";
import { Banner } from "../banner";
import { FieldHint } from "../field-hint";
import { AiUsagePanel } from "./ai-usage-panel";
import { AiViewScopeDisclosure } from "./ai-view-scope-disclosure";
import type { UseOperatingGuidesResult } from "../use-operating-guides";
import type { OperatingGuide, GuideScope } from "../operating-guide";
import { guidesCharCount, GUIDE_CHAR_BUDGET } from "../operating-guide";
import { FEATURE_MODULES } from "../feature-modules";
import type { AppMode, FeatureModuleId } from "../feature-modules";
import { allNavViews, navLabelKey, type AppView } from "../nav-config";
import { saveSecretValue, setSecretPassphrase } from "../use-secrets";
import { isPassphraseLocked, loadSealed, removeSealed } from "../secrets-store";
import { INTERACTIVE } from "../interaction-styles";
import { Checkbox, Input, Select, Textarea } from "../form-controls";
import { useIntegrationDisclaimer } from "../integration-disclaimer";
import { useConfirm } from "../confirm-dialog";
import { useToastContext } from "../toast-context";
import { useChatModels } from "../use-chat-models";
import { isValidAnthropicApiKey } from "../chat-models";

interface AiSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  operatingGuides?: UseOperatingGuidesResult;
  /** Hide the live usage bars (which need an AiUsageProvider). Set on the
   *  new-project config surface, where there is no project/usage context yet. */
  hideUsage?: boolean;
}

function CapInput({
  label,
  value,
  defaultValue,
  onChange,
  hint,
  min = 1,
  max,
  step = 1,
  decimal = false,
}: {
  label: string;
  value: number | undefined;
  defaultValue: number;
  onChange: (n: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  decimal?: boolean;
}) {
  const displayed = value != null && value > 0 ? value : defaultValue;
  return (
    <div className="mt-2 block">
      <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {hint ? <InfoTooltip text={hint} /> : null}
      </span>
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={displayed}
        onChange={(e) => {
          const n = decimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
          if (!Number.isFinite(n) || n <= 0) {
            onChange(defaultValue);
            return;
          }
          // Clamp a directly-typed value to [min, max] (the max/min attrs are only
          // spinner hints; a typed value ignores them).
          onChange(Math.min(max ?? Infinity, Math.max(min, n)));
        }}
        className="w-full"
      />
    </div>
  );
}

const APP_MODES: AppMode[] = ["simple", "modular", "advanced"];
const SCOPE_VIEWS: AppView[] = allNavViews();

interface GuideDraft {
  name: string;
  content: string;
  priority: number;
  scopeModes: AppMode[];
  scopeModules: FeatureModuleId[];
  scopeViews: AppView[];
}

function emptyDraft(): GuideDraft {
  return { name: "", content: "", priority: 10, scopeModes: [], scopeModules: [], scopeViews: [] };
}

function draftFromGuide(g: OperatingGuide): GuideDraft {
  return {
    name: g.name,
    content: g.content,
    priority: g.priority,
    scopeModes: (g.scope.modes ?? []) as AppMode[],
    scopeModules: (g.scope.modules ?? []) as FeatureModuleId[],
    scopeViews: (g.scope.views ?? []) as AppView[],
  };
}

function draftToScope(draft: GuideDraft): GuideScope {
  return {
    ...(draft.scopeModes.length ? { modes: draft.scopeModes } : {}),
    ...(draft.scopeModules.length ? { modules: draft.scopeModules } : {}),
    ...(draft.scopeViews.length ? { views: draft.scopeViews } : {}),
  };
}

interface GuideFormProps {
  lang: Lang;
  draft: GuideDraft;
  onChange: (d: GuideDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}

function GuideForm({ lang, draft, onChange, onSave, onCancel, busy }: GuideFormProps) {
  function toggleMode(mode: AppMode) {
    const next = draft.scopeModes.includes(mode)
      ? draft.scopeModes.filter((m) => m !== mode)
      : [...draft.scopeModes, mode];
    onChange({ ...draft, scopeModes: next });
  }

  function toggleModule(id: FeatureModuleId) {
    const next = draft.scopeModules.includes(id)
      ? draft.scopeModules.filter((m) => m !== id)
      : [...draft.scopeModules, id];
    onChange({ ...draft, scopeModules: next });
  }

  function toggleView(view: AppView) {
    const next = draft.scopeViews.includes(view)
      ? draft.scopeViews.filter((v) => v !== view)
      : [...draft.scopeViews, view];
    onChange({ ...draft, scopeViews: next });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuideName")}</span>
        <Input
          type="text"
          size="xs"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className="w-full"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuideContent")}</span>
        <Textarea
          value={draft.content}
          rows={6}
          size="xs"
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          className="w-full"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuidePriority")}</span>
        <Input
          type="number"
          size="xs"
          min={1}
          step={1}
          value={draft.priority}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ ...draft, priority: Number.isFinite(n) && n > 0 ? n : draft.priority });
          }}
          className="w-24"
        />
      </label>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">
          {draft.scopeModes.length === 0 &&
          draft.scopeModules.length === 0 &&
          draft.scopeViews.length === 0
            ? t(lang, "aiGuideScopeAny")
            : t(lang, "aiGuideScopeModes")}
        </legend>
        <div className="flex flex-wrap gap-3">
          {APP_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-1 text-xs text-foreground">
              <Checkbox
                aria-label={mode}
                checked={draft.scopeModes.includes(mode)}
                onChange={() => toggleMode(mode)}
              />
              {mode}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">{t(lang, "aiGuideScopeModules")}</legend>
        <div className="flex flex-wrap gap-3">
          {FEATURE_MODULES.map((m) => (
            <label key={m.id} className="flex items-center gap-1 text-xs text-foreground">
              <Checkbox
                aria-label={t(lang, m.labelKey)}
                checked={draft.scopeModules.includes(m.id)}
                onChange={() => toggleModule(m.id)}
              />
              {t(lang, m.labelKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">{t(lang, "aiGuideScopeViews")}</legend>
        <div className="flex flex-wrap gap-3">
          {SCOPE_VIEWS.map((view) => (
            <label key={view} className="flex items-center gap-1 text-xs text-foreground">
              <Checkbox
                aria-label={t(lang, navLabelKey(view))}
                checked={draft.scopeViews.includes(view)}
                onChange={() => toggleView(view)}
              />
              {t(lang, navLabelKey(view))}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          disabled={busy || !draft.name.trim()}
          onClick={onSave}
          className={`rounded-md border border-line bg-ui-green px-3 py-1 text-xs font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, "aiGuideSave")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface ${INTERACTIVE}`}
        >
          {t(lang, "aiGuideCancel")}
        </button>
      </div>
    </div>
  );
}

export function AiSection({ lang, settings, onChange, operatingGuides, hideUsage }: AiSectionProps) {
  const { notifyEnable } = useIntegrationDisclaimer();
  const confirm = useConfirm();
  const showToast = useToastContext();
  const { options: modelOptions, loaded: modelsLoaded } = useChatModels(settings.ai.apiKey, settings.ai.enabled === true, settings.ai.model);
  const sessionCap = settings.ai.sessionTokenCap ?? DEFAULT_SESSION_TOKEN_CAP;
  const weeklyCap = settings.ai.weeklyTokenCap ?? DEFAULT_WEEKLY_TOKEN_CAP;

  // Guide form state: null = closed, "add" = new guide, string id = editing existing
  const [formMode, setFormMode] = useState<null | "add" | string>(null);
  const [draft, setDraft] = useState<GuideDraft>(emptyDraft);

  // API-key at-rest wrap mode + passphrase entry (with a confirm field so a typo
  // can't silently lock the key under an unknown passphrase).
  const [keyWrap, setKeyWrap] = useState<"device" | "passphrase">(() =>
    isPassphraseLocked("anthropicApiKey") ? "passphrase" : "device",
  );
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [keyConfirm, setKeyConfirm] = useState("");
  const [keyStored, setKeyStored] = useState(() => loadSealed("anthropicApiKey") != null);

  function handleApiKeyChange(value: string) {
    onChange({ ...settings, ai: { ...settings.ai, apiKey: value } });
    if (keyWrap === "device" && isValidAnthropicApiKey(value)) {
      void saveSecretValue("anthropicApiKey", value, "device").then(() => setKeyStored(true));
    }
  }

  // Validate the typed key on blur: a malformed key is discarded (blanked +
  // un-sealed) with an error toast, so a typo can't silently masquerade as a
  // stored credential.
  function handleApiKeyBlur() {
    const k = settings.ai.apiKey.trim();
    if (k && !isValidAnthropicApiKey(k)) {
      showToast("error", t(lang, "aiKeyInvalid"));
      onChange({ ...settings, ai: { ...settings.ai, apiKey: "" } });
      removeSealed("anthropicApiKey");
      setKeyStored(false);
    }
  }

  function handleLockToggle(checked: boolean) {
    if (checked) {
      // device → passphrase: reveal the passphrase + confirm fields + Save button.
      // Don't seal yet — we need the (confirmed) passphrase first.
      setKeyWrap("passphrase");
      return;
    }
    // Unset the passphrase requirement. If the plaintext is in memory we can
    // re-seal it device-wrapped (keeps the value); otherwise the value is locked
    // and unknown, so we forget the sealed secret entirely (re-enter to use it).
    // EITHER WAY the wrap state flips to device so the checkbox actually toggles
    // (the old early-return left it stuck checked when the key was locked).
    void (async () => {
      if (settings.ai.apiKey.trim()) {
        await saveSecretValue("anthropicApiKey", settings.ai.apiKey, "device");
        setKeyStored(true);
      } else if (isPassphraseLocked("anthropicApiKey")) {
        removeSealed("anthropicApiKey");
        setKeyStored(false);
      }
      setKeyWrap("device");
      setKeyPassphrase("");
      setKeyConfirm("");
    })();
  }

  function handleLockConfirm() {
    // Defensive gate only — blur already discards a malformed key and load-time
    // sanitize pattern-checks it; we just refuse to passphrase-seal it here.
    if (!isValidAnthropicApiKey(settings.ai.apiKey)) {
      showToast("error", t(lang, "aiKeyInvalid"));
      return;
    }
    void (async () => {
      await setSecretPassphrase("anthropicApiKey", settings.ai.apiKey, keyPassphrase);
      setKeyStored(true);
      setKeyPassphrase("");
      setKeyConfirm("");
    })();
  }

  // Forget the stored secret completely (ciphertext + passphrase) and blank the
  // in-memory value, returning to the default device wrap.
  async function handleRemoveSecret() {
    if (!(await confirm({ message: t(lang, "secretPassphraseRemoveConfirm") }))) return;
    removeSealed("anthropicApiKey");
    onChange({ ...settings, ai: { ...settings.ai, apiKey: "" } });
    setKeyStored(false);
    setKeyWrap("device");
    setKeyPassphrase("");
    setKeyConfirm("");
  }

  const keyPassphraseMismatch = keyPassphrase !== "" && keyConfirm !== "" && keyPassphrase !== keyConfirm;

  const og = operatingGuides;

  function openAdd() {
    setDraft(emptyDraft());
    setFormMode("add");
  }

  function openEdit(g: OperatingGuide) {
    setDraft(draftFromGuide(g));
    setFormMode(g.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  async function handleSave() {
    if (!og) return;
    if (formMode === "add") {
      await og.create(draft.name.trim(), draft.content, {
        priority: draft.priority,
        scope: draftToScope(draft),
      });
    } else if (formMode !== null) {
      const existing = og.guides.find((g) => g.id === formMode);
      if (existing) {
        await og.update({
          ...existing,
          name: draft.name.trim(),
          content: draft.content,
          priority: draft.priority,
          scope: draftToScope(draft),
        });
      }
    }
    closeForm();
  }

  const overBudget =
    og != null &&
    guidesCharCount(og.guides.filter((g) => g.enabled)) > GUIDE_CHAR_BUDGET;

  return (
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "aiAssistant")}
        <InfoTooltip text={t(lang, "aiAssistantTooltip")} />
      </span>
      <label className="mt-2 flex items-center gap-2">
        <Checkbox
          checked={settings.ai.enabled === true}
          onChange={(e) => {
            if (e.target.checked) notifyEnable();
            onChange({ ...settings, ai: { ...settings.ai, enabled: e.target.checked } });
          }}
        />
        <span className="text-xs text-foreground">{t(lang, "aiEnable")}</span>
      </label>
      <FieldHint className="mt-1">{t(lang, "aiEnableHelp")}</FieldHint>
      {settings.ai.enabled === true && (
        <>
      <label className="mt-2 block">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          {t(lang, "aiApiKey")}
          <InfoTooltip text={t(lang, "aiApiKeyTooltip")} />
        </span>
        <Input
          className="w-full"
          type="password"
          autoComplete="off"
          value={settings.ai.apiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
          onBlur={handleApiKeyBlur}
          placeholder={t(lang, "aiApiKeyPlaceholder")}
        />
        <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
      </label>
      <div className="mt-2">
        <label className="flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "secretLockPassphrase")}
            checked={keyWrap === "passphrase"}
            onChange={(e) => handleLockToggle(e.target.checked)}
          />
          <span className="text-xs text-foreground">{t(lang, "secretLockPassphrase")}</span>
        </label>
        {keyWrap === "passphrase" && (
          <div className="mt-2 flex flex-col gap-2">
            <Input
              className="w-full"
              type="password"
              autoComplete="off"
              aria-label={t(lang, "secretPassphrasePlaceholder")}
              placeholder={t(lang, "secretPassphrasePlaceholder")}
              value={keyPassphrase}
              onChange={(e) => setKeyPassphrase(e.target.value)}
            />
            <Input
              className="w-full"
              type="password"
              autoComplete="off"
              aria-label={t(lang, "secretPassphraseConfirm")}
              placeholder={t(lang, "secretPassphraseConfirm")}
              value={keyConfirm}
              onChange={(e) => setKeyConfirm(e.target.value)}
            />
            {keyPassphraseMismatch && (
              <Banner severity="error">{t(lang, "secretPassphraseMismatch")}</Banner>
            )}
            <button
              type="button"
              disabled={!settings.ai.apiKey.trim() || !keyPassphrase || keyPassphrase !== keyConfirm}
              onClick={handleLockConfirm}
              className={`self-start whitespace-nowrap rounded-md border border-line bg-ui-green px-3 py-2 text-xs font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
            >
              {t(lang, "secretPassphraseSave")}
            </button>
            <FieldHint>{t(lang, "secretLockWarning")}</FieldHint>
          </div>
        )}
        {keyStored && (
          <button
            type="button"
            onClick={handleRemoveSecret}
            title={t(lang, "secretPassphraseRemoveHint")}
            className={`mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ui-pink-strong hover:bg-surface-muted ${INTERACTIVE}`}
          >
            {t(lang, "secretPassphraseRemove")}
          </button>
        )}
      </div>
      <label className="mt-2 block">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          {t(lang, "aiModel")}
          <InfoTooltip text={t(lang, "aiModelTooltip")} />
        </span>
        <Select
          className="w-full"
          value={settings.ai.model}
          onChange={(e) =>
            onChange({
              ...settings,
              ai: {
                ...settings.ai,
                model: e.target.value,
              },
            })
          }
        >
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        {!modelsLoaded && (
          <FieldHint as="span" className="mt-1 block">
            {t(lang, "aiModelNeedsKey")}
          </FieldHint>
        )}
      </label>
      <FieldHint className="mt-2">
        {t(lang, "aiApiKeyHint")}
      </FieldHint>
      {settings.ai.consentAccepted ? (
        <p className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>✓ {t(lang, "aiConsentGranted")}</span>
          <TextButton
            tone="danger"
            onClick={() =>
              onChange({
                ...settings,
                ai: { ...settings.ai, consentAccepted: false },
              })
            }
            className="text-xs"
          >
            {t(lang, "aiConsentRevoke")}
          </TextButton>
        </p>
      ) : (
        <p className="mt-2 text-xs text-ui-purple">
          {t(lang, "aiConsentRequired")}
        </p>
      )}

      {/* Token cap inputs */}
      <CapInput
        label={t(lang, "aiSessionCap")}
        hint={t(lang, "aiSessionCapHint")}
        value={settings.ai.sessionTokenCap}
        defaultValue={DEFAULT_SESSION_TOKEN_CAP}
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, sessionTokenCap: n } })
        }
      />
      <CapInput
        label={t(lang, "aiWeeklyCap")}
        hint={t(lang, "aiWeeklyCapHint")}
        value={settings.ai.weeklyTokenCap}
        defaultValue={DEFAULT_WEEKLY_TOKEN_CAP}
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, weeklyTokenCap: n } })
        }
      />
      <CapInput
        label={t(lang, "aiTokenMultiplier")}
        hint={t(lang, "aiTokenMultiplierHint")}
        value={settings.ai.tokenMultiplier}
        defaultValue={DEFAULT_TOKEN_MULTIPLIER}
        min={0.1}
        step={0.5}
        decimal
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, tokenMultiplier: n } })
        }
      />
      <CapInput
        label={t(lang, "aiMaxTurns")}
        hint={t(lang, "aiMaxTurnsHint")}
        value={settings.ai.maxChatTurns}
        defaultValue={DEFAULT_MAX_CHAT_TURNS}
        min={1}
        max={50}
        step={1}
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, maxChatTurns: n } })
        }
      />

      {/* Live usage bars — sourced from AiUsageProvider */}
      {!hideUsage && <AiUsagePanel lang={lang} sessionCap={sessionCap} weeklyCap={weeklyCap} />}

      {/* Operating guides */}
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm font-medium text-foreground">{t(lang, "aiGuidesHeading")}</p>
        <FieldHint className="mt-1">{t(lang, "aiGuidesDesc")}</FieldHint>

        {/* Master toggle */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "aiGroundInGuides")}
            checked={settings.ai.groundInGuides}
            onChange={() =>
              onChange({
                ...settings,
                ai: { ...settings.ai, groundInGuides: !settings.ai.groundInGuides },
              })
            }
          />
          <span className="text-xs text-foreground">{t(lang, "aiGroundInGuides")}</span>
        </label>

        {/* Action Center AI suggestions toggle (default ON; undefined = on) */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "settingsAiActionSuggestions")}
            checked={settings.ai.actionSuggestions !== false}
            onChange={() =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  actionSuggestions: settings.ai.actionSuggestions === false,
                },
              })
            }
          />
          <span className="text-xs text-foreground">
            {t(lang, "settingsAiActionSuggestions")}
          </span>
        </label>
        <FieldHint className="mt-1">
          {t(lang, "settingsAiActionSuggestionsHelp")}
        </FieldHint>

        {/* Proactive insight recommendations (SP2). Default OFF (opt-in) — recurring billed calls. */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "aiInsightRecommendations")}
            checked={settings.ai.insightRecommendations === true}
            onChange={() =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  insightRecommendations: settings.ai.insightRecommendations !== true,
                },
              })
            }
          />
          <span className="text-xs text-foreground">
            {t(lang, "aiInsightRecommendations")}
          </span>
        </label>
        <FieldHint className="mt-1">
          {t(lang, "aiInsightRecommendationsDesc")}
        </FieldHint>

        {/* Cadence for the background runner (SP4). Only meaningful while the
            feature is on, so it rides the toggle. Every value routes through
            clampInsightRecInterval — the SAME clamp the sanitizer and the
            runner use — so a directly-typed value can never drive an unbounded
            rate of BILLED API calls. */}
        {settings.ai.insightRecommendations === true && (
          <CapInput
            label={t(lang, "aiInsightRecInterval")}
            hint={t(lang, "aiInsightRecIntervalHint")}
            value={settings.ai.insightRecommendationIntervalMinutes}
            defaultValue={DEFAULT_INSIGHT_REC_INTERVAL_MIN}
            min={MIN_INSIGHT_REC_INTERVAL_MIN}
            max={MAX_INSIGHT_REC_INTERVAL_MIN}
            step={15}
            onChange={(n) =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  insightRecommendationIntervalMinutes: clampInsightRecInterval(n),
                },
              })
            }
          />
        )}

        {og != null && (
          <>
            {overBudget && (
              <Banner severity="error" className="mt-2">
                {t(lang, "aiGuideBudgetWarning")}
              </Banner>
            )}

            {/* Guide list */}
            <ul className="mt-3 flex flex-col gap-2">
              {og.guides.map((g) => (
                <li key={g.id} className="rounded-md border border-line bg-surface p-2">
                  {formMode === g.id ? (
                    <GuideForm
                      lang={lang}
                      draft={draft}
                      onChange={setDraft}
                      onSave={() => { void handleSave(); }}
                      onCancel={closeForm}
                      busy={og.busy}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-xs font-medium text-foreground">{g.name}</span>
                      {g.builtIn && (
                        <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-line">
                          {t(lang, "aiGuideBuiltInBadge")}
                        </span>
                      )}
                      <label className="flex items-center gap-1 text-xs text-foreground">
                        <Checkbox
                          aria-label={`${t(lang, "aiGuideEnabled")} – ${g.name}`}
                          checked={g.enabled}
                          onChange={() => { void og.update({ ...g, enabled: !g.enabled }); }}
                        />
                        {t(lang, "aiGuideEnabled")}
                      </label>
                      <button
                        type="button"
                        aria-label={`${t(lang, "aiGuideEdit")} – ${g.name}`}
                        onClick={() => openEdit(g)}
                        className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-foreground ${INTERACTIVE}`}
                      >
                        {t(lang, "aiGuideEdit")}
                      </button>
                      {!g.builtIn && (
                        <button
                          type="button"
                          aria-label={`${t(lang, "aiGuideDelete")} – ${g.name}`}
                          onClick={() => { void og.remove(g.id); }}
                          className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ui-pink-strong ${INTERACTIVE}`}
                        >
                          {t(lang, "aiGuideDelete")}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* Add guide */}
            {formMode === "add" ? (
              <GuideForm
                lang={lang}
                draft={draft}
                onChange={setDraft}
                onSave={() => { void handleSave(); }}
                onCancel={closeForm}
                busy={og.busy}
              />
            ) : (
              <button
                type="button"
                onClick={openAdd}
                className={`mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground ${INTERACTIVE}`}
              >
                {t(lang, "aiGuideAdd")}
              </button>
            )}
          </>
        )}
      </div>

      <AiViewScopeDisclosure lang={lang} />
        </>
      )}
    </div>
  );
}
