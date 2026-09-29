"use client";

import { useId, useState } from "react";
import { type Lang, t } from "../i18n";
import { type Settings } from "../settings-types";
import { TextButton } from "../text-button";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP, DEFAULT_MAX_CHAT_TURNS } from "../settings-types";
import {
  DEFAULT_INSIGHT_REC_INTERVAL_MIN,
  MIN_INSIGHT_REC_INTERVAL_MIN,
  MAX_INSIGHT_REC_INTERVAL_MIN,
  clampInsightRecInterval,
} from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { FieldError, FieldNotice } from "../field-feedback";
import { aiKeyMessageKey } from "../ai-key-status";
import { useAiKeyStatus } from "../use-ai-key-check";
import { Banner } from "../banner";
import { FieldHint } from "../field-hint";
import { AiUsagePanel } from "./ai-usage-panel";
import { AiPolicyFields } from "./ai-policy-fields";
import { saveSecretValue, setSecretPassphrase } from "../use-secrets";
import { isPassphraseLocked, loadSealed, removeSealed } from "../secrets-store";
import { Button } from "../button";
import { Checkbox, HintedLabel, Input, Select } from "../form-controls";
import { useIntegrationDisclaimer } from "../integration-disclaimer";
import { useConfirm } from "../confirm-dialog";
import { useToastContext } from "../toast-context";
import { useChatModels } from "../use-chat-models";
import { isValidAnthropicApiKey } from "../chat-models";

interface AiSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
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

export function AiSection({ lang, settings, onChange, hideUsage }: AiSectionProps) {
  const { notifyEnable } = useIntegrationDisclaimer();
  const aiHeadingId = useId();
  const behaviourHeadingId = useId();
  const apiKeyNoteId = useId();
  const modelHintId = useId();
  const confirm = useConfirm();
  const showToast = useToastContext();
  const { options: modelOptions, loaded: modelsLoaded } = useChatModels(settings.ai.apiKey, settings.ai.enabled === true, settings.ai.model);
  // §650 — the in-memory key verdict (rejected / forbidden / unreadable), shown beside the key field
  // and, for a key that IS present but was refused, in place of the "enter a valid key" model hint.
  const apiKeyStatusId = useId();
  const keyStatusMsg = aiKeyMessageKey(useAiKeyStatus());
  const modelHintKey =
    keyStatusMsg && keyStatusMsg !== "aiKeyUnreadable" && settings.ai.apiKey.trim() ? keyStatusMsg : "aiModelNeedsKey";
  const sessionCap = settings.ai.sessionTokenCap ?? DEFAULT_SESSION_TOKEN_CAP;
  const weeklyCap = settings.ai.weeklyTokenCap ?? DEFAULT_WEEKLY_TOKEN_CAP;

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
    if (value.trim() === "") {
      // §565 blank-first rule (as jira/timelog/turso): an emptied key REMOVES the seal and the
      // flag — else the blanked key rehydrated from the store on reload. `removeSealed` also
      // cancels a seal still in flight for an earlier keystroke (§609).
      // ★★ EXCEPT a passphrase-wrapped record: its plaintext is never hydrated into settings (the
      //   chat unlock keeps it local), so this field shows "" for a LOCKED key, and typing a
      //   character then deleting it would land here and destroy a key the user never saw. A
      //   passphrase key is forgotten only via "Remove stored secret" (or the lock untick).
      // ★ Known limit: the check is the RECORD's wrap, not whether this session held the plaintext,
      //   so a passphrase key the user typed + saved here (field shows it) is also kept when the
      //   field is emptied. Deliberate — the stored flag and Remove button stay truthful, and
      //   "Remove stored secret" is the way out.
      if (!isPassphraseLocked("anthropicApiKey")) {
        removeSealed("anthropicApiKey");
        setKeyStored(false);
      }
    } else if (keyWrap === "device" && isValidAnthropicApiKey(value)) {
      // §609: a seal superseded by a later keystroke or a clear resolves false — no "stored" flag.
      void saveSecretValue("anthropicApiKey", value, "device").then((stored) => {
        if (stored) setKeyStored(true);
      });
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
        // §609: false = a newer op on this key (a "Save passphrase", a clear) began during the seal.
        // Don't force device over it: show what the STORE now holds (a clear → device, nothing
        // stored). A passphrase save still in flight sets the wrap itself when it lands.
        if (!(await saveSecretValue("anthropicApiKey", settings.ai.apiKey, "device"))) {
          setKeyWrap(isPassphraseLocked("anthropicApiKey") ? "passphrase" : "device");
          setKeyStored(loadSealed("anthropicApiKey") != null);
          return;
        }
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
      if (await setSecretPassphrase("anthropicApiKey", settings.ai.apiKey, keyPassphrase)) {
        setKeyStored(true);
        // §609: the record IS passphrase-wrapped now — also after a superseded untick re-seal
        // reset the wrap from the store while this seal was still in flight.
        setKeyWrap("passphrase");
      }
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

  return (
    <div className="mb-4" role="group" aria-labelledby={aiHeadingId}>
      <span className="mb-1 flex items-center gap-1">
        {/* The tooltip trigger sits BESIDE the labelling <span>, not inside it —
            it is a role="button" span, so nesting it in the aria-labelledby
            target would fold its own name into the group's, same landmine as
            an interactive control inside a <label>. A <p> here is invalid
            content model (a <span> accepts phrasing content only) — <span>
            carries the same id without the violation. */}
        <span id={aiHeadingId} className="text-sm font-medium text-foreground">
          {t(lang, "aiAssistant")}
        </span>
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
      {/* ★★ The hint sits OUTSIDE the naming <label> (open-followups §386),
          and so does the storage notice: inside the label it joined the
          key field's accessible NAME. It is now the field's description. */}
      <div className="mt-2">
        <HintedLabel
          hint={<InfoTooltip text={t(lang, "aiApiKeyTooltip")} />}
          caption={<span className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "aiApiKey")}</span>}
        >
          <Input
            className="w-full"
            type="password"
            autoComplete="off"
            value={settings.ai.apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            onBlur={handleApiKeyBlur}
            placeholder={t(lang, "aiApiKeyPlaceholder")}
            aria-describedby={keyStatusMsg ? `${apiKeyStatusId} ${apiKeyNoteId}` : apiKeyNoteId}
            aria-invalid={keyStatusMsg ? true : undefined}
          />
        </HintedLabel>
        {keyStatusMsg && <FieldError id={apiKeyStatusId}>{t(lang, keyStatusMsg)}</FieldError>}
        <FieldNotice id={apiKeyNoteId}>{t(lang, "credentialStorageNote")}</FieldNotice>
      </div>
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
            <Button
              className="self-start whitespace-nowrap"
              disabled={!settings.ai.apiKey.trim() || !keyPassphrase || keyPassphrase !== keyConfirm}
              onClick={handleLockConfirm}
            >
              {t(lang, "secretPassphraseSave")}
            </Button>
            <FieldHint>{t(lang, "secretLockWarning")}</FieldHint>
          </div>
        )}
        {keyStored && (
          <Button
            size="xs"
            variant="destructive"
            className="mt-2"
            onClick={handleRemoveSecret}
            title={t(lang, "secretPassphraseRemoveHint")}
          >
            {t(lang, "secretPassphraseRemove")}
          </Button>
        )}
      </div>
      {/* ★★ Hint outside the naming <label> (open-followups §386). The
          needs-a-key hint below moved out too: inside the label it joined the
          select's accessible NAME. It is now the select's description. */}
      <div className="mt-2">
      <HintedLabel
        hint={<InfoTooltip text={t(lang, "aiModelTooltip")} />}
        caption={<span className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "aiModel")}</span>}
      >
        <Select
          className="w-full"
          aria-describedby={!modelsLoaded ? modelHintId : undefined}
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
      </HintedLabel>
      {!modelsLoaded && (
        <FieldHint id={modelHintId} className="mt-1">
          {t(lang, modelHintKey)}
        </FieldHint>
      )}
      </div>
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
      <AiPolicyFields
        lang={lang}
        ai={settings.ai}
        onChange={(patch) => onChange({ ...settings, ai: { ...settings.ai, ...patch } })}
      />

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

      {/* Assistant behaviour. These sat under the "Operating guides" heading
          but have nothing to do with guides — the guides extraction surfaced
          the mis-grouping rather than carrying it along. */}
      {/* ★ `role="group"` + `aria-labelledby`, NOT a bare <p> and NOT an <h3>.
          The <p> the guides extraction took with it labelled this block
          VISUALLY only — settings-view supplies a shared <h2>, but
          settings-menu.tsx, backend-setup-wizard.tsx and project-empty-state.tsx
          mount AiSection with no heading at all, so for AT the four settings sat
          in an unlabeled generic on three surfaces. An <h3> would fix the
          semantics but has no <h2> ancestor on exactly those three surfaces,
          which would break the document outline for heading navigation there;
          the group carries the name without claiming a position in the
          document outline. `useId` because AiSection
          is mounted by four different surfaces and a literal id could collide. */}
      <div
        role="group"
        aria-labelledby={behaviourHeadingId}
        className="mt-4 border-t border-line pt-4"
      >
        <p id={behaviourHeadingId} className="text-sm font-medium text-foreground">
          {t(lang, "aiBehaviourHeading")}
        </p>
        {/* ★★ Ground-in-guides is DELIBERATELY rendered here AND in
            ai-guides-section.tsx. The guides section is only reachable from the
            settings rail, but THREE surfaces mount AiSection outside it —
            settings-menu.tsx, backend-setup-wizard.tsx's AI step and
            project-empty-state.tsx — and none of them has any other route to
            this setting. It silently vanished from all three when the guides
            block was extracted, because nothing pinned it.
            Duplication is safe rather than merely tolerable: settings-view
            mounts exactly ONE `active` section, so the two copies are never in
            the DOM together (no duplicate-accessible-name collision), and both
            bind the same `settings.ai.groundInGuides` through the same
            `onChange`, so they cannot drift. Keep BOTH copies pinned by a
            test — deleting either one is invisible otherwise. */}
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

        {/* search_history tool (B2a). Default ON (undefined = on) — the tool is
            only billed when the model actually calls it. */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "settingsAiHistorySearch")}
            checked={settings.ai.historySearch !== false}
            onChange={() =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  historySearch: settings.ai.historySearch === false,
                },
              })
            }
          />
          <span className="text-xs text-foreground">
            {t(lang, "settingsAiHistorySearch")}
          </span>
        </label>
        <FieldHint className="mt-1">
          {t(lang, "settingsAiHistorySearchHelp")}
        </FieldHint>

        {/* Ambient activity recap (B2b). Default ON (undefined = on). */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "settingsAiActivityRecap")}
            checked={settings.ai.activityRecap !== false}
            onChange={() =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  activityRecap: settings.ai.activityRecap === false,
                },
              })
            }
          />
          <span className="text-xs text-foreground">
            {t(lang, "settingsAiActivityRecap")}
          </span>
        </label>
        <FieldHint className="mt-1">
          {t(lang, "settingsAiActivityRecapHelp")}
        </FieldHint>

        {/* Chat-thread search + the ambient pointer (B2c). Default ON (undefined = on). */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "settingsAiChatSearch")}
            checked={settings.ai.chatSearch !== false}
            onChange={() =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  chatSearch: settings.ai.chatSearch === false,
                },
              })
            }
          />
          <span className="text-xs text-foreground">
            {t(lang, "settingsAiChatSearch")}
          </span>
        </label>
        <FieldHint className="mt-1">
          {t(lang, "settingsAiChatSearchHelp")}
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
      </div>
        </>
      )}
    </div>
  );
}
