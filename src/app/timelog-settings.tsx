"use client";
import { useState } from "react";
import { t, type Lang } from "./i18n";
import { FieldNotice } from "./field-feedback";
import { Banner } from "./banner";
import type {
  TimelogConfig,
  TimelogLinks,
  TimelogPolicy,
  TimelogRulePolicy,
  TimelogRuleId,
  TimelogScopeMode,
} from "./timelog-types";
import { ToggleButton } from "./toggle-button";
import { MAX_HOURS_PER_DAY } from "./types";
import { saveSecretValue } from "./use-secrets";
import { listUsers, getPrivileges } from "./timelog-api";
import { FOCUS_RING, INTERACTIVE } from "./interaction-styles";
import { useIntegrationDisclaimer } from "./integration-disclaimer";
import { Input, Select } from "./form-controls";

interface Props {
  lang: Lang;
  config: TimelogConfig;
  onChange: (next: TimelogConfig) => void;
  /** Workspace-level guardrail policy rides on the `timelogLinks` blob, NOT on
   *  the per-device `config` — the rules are a team decision and travel with
   *  the project.
   *  ★ OPTIONAL because three of this component's four non-test call sites are
   *  PRE-PROJECT surfaces (`backend-setup-wizard`, `backend-config-modal`,
   *  `settings-menu`) with no workspace blob to store a policy on. There the
   *  guardrails section is not rendered at all, rather than rendering controls
   *  whose writes would go nowhere — a control that looks live and does
   *  nothing is the false affordance this repo already bans elsewhere. */
  links?: TimelogLinks;
  onLinksChange?: (next: TimelogLinks) => void;
}

export function TimelogSettings({ lang, config, onChange, links, onLinksChange }: Props) {
  const { notifyEnable } = useIntegrationDisclaimer();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const set = (patch: Partial<TimelogConfig>) => onChange({ ...config, ...patch });

  function handleToken(value: string) {
    set({ apiToken: value, tokenInvalidAt: undefined });
    void saveSecretValue("timelogApiToken", value, "device");
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const creds = { host: config.host, tenant: config.tenant, token: config.apiToken };
      const [users, priv] = await Promise.all([listUsers(creds), getPrivileges(creds)]);
      const scope =
        config.scopeMode === "auto"
          ? priv.registrationAllTasks
            ? "org"
            : "self"
          : config.scopeMode;
      setTestResult(t(lang, "timelogTestOk", String(users.length), scope));
      set({ tokenInvalidAt: undefined });
    } catch (e) {
      const status =
        e instanceof Error && typeof (e as unknown as { status?: unknown }).status === "number"
          ? (e as unknown as { status: number }).status
          : 0;
      setTestResult(t(lang, "timelogTestFail", String(status)));
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="text-sm font-medium text-foreground">{t(lang, "timelogTitle")}</h3>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={config.enabled}
          onChange={(e) => {
            if (e.target.checked) notifyEnable();
            set({ enabled: e.target.checked });
          }}
        />
        <span>{t(lang, "timelogEnable")}</span>
      </label>
      {config.enabled && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t(lang, "timelogTokenHelpBefore")}{" "}
            <a
              href="https://login.timelog.com/personaltoken"
              target="_blank"
              rel="noopener noreferrer"
              className={`text-ui-dark-blue underline dark:text-ui-light-grey ${FOCUS_RING}`}
            >
              https://login.timelog.com/personaltoken
            </a>{" "}
            {t(lang, "timelogTokenHelpAfter")}
          </p>
          <label className="block text-xs">
            {t(lang, "timelogHost")}
            <Input
              size="xs"
              className="mt-1 w-full"
              value={config.host}
              onChange={(e) => set({ host: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            {t(lang, "timelogTenant")}
            <Input
              size="xs"
              className="mt-1 w-full"
              value={config.tenant}
              onChange={(e) => set({ tenant: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            {t(lang, "timelogEmail")}
            <Input
              size="xs"
              className="mt-1 w-full"
              type="email"
              value={config.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            {t(lang, "timelogToken")}
            <Input
              size="xs"
              className="mt-1 w-full"
              type="password"
              autoComplete="off"
              aria-label={t(lang, "timelogToken")}
              value={config.apiToken}
              onChange={(e) => handleToken(e.target.value)}
            />
            <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
          </label>
          {config.tokenInvalidAt && (
            <Banner severity="error">{t(lang, "timelogTokenInvalid")}</Banner>
          )}
          <label className="block text-xs">
            {t(lang, "timelogScope")}
            <Select
              size="xs"
              className="mt-1 w-full"
              value={config.scopeMode}
              onChange={(e) => set({ scopeMode: e.target.value as TimelogScopeMode })}
            >
              <option value="auto">{t(lang, "timelogScopeAuto")}</option>
              <option value="self">{t(lang, "timelogScopeSelf")}</option>
              <option value="org">{t(lang, "timelogScopeOrg")}</option>
            </Select>
          </label>
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing}
            className={`self-start rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-ui-dark-blue disabled:cursor-not-allowed disabled:opacity-50 dark:text-ui-light-grey ${INTERACTIVE}`}
          >
            {t(lang, "timelogTest")}
          </button>
          {testResult && <p className="text-xs text-muted-foreground">{testResult}</p>}
        </div>
      )}
    </div>
    {links !== undefined && onLinksChange !== undefined && (
      <TimelogGuardrails lang={lang} links={links} onLinksChange={onLinksChange} />
    )}
    </>
  );
}

/** The four review-time booking rules, all OFF until the user turns them on.
 *  Split out of `TimelogSettings` so the two workspace props can be NON-optional
 *  here — the parent renders this only when both are present, which removes the
 *  "guard that can never fire" a single-component version would need. */
function TimelogGuardrails({
  lang,
  links,
  onLinksChange,
}: {
  lang: Lang;
  links: TimelogLinks;
  onLinksChange: (next: TimelogLinks) => void;
}) {
  const policy = links.policy ?? {};

  // ★★ BYTE-STABILITY, and it is the reason this is not a one-line spread.
  // `TimelogPolicy` is Partial by construction, and `sanitizeTimelogLinks`
  // drops the `policy` key ONLY when no rule key is left — a
  // `{rule: {enabled: false}}` entry survives sanitising intact. So a writer
  // that merely spread the patch in would let "switch a rule on, then off"
  // leave scaffolding behind, and a workspace whose Settings were opened would
  // stop serialising byte-identically to what it was before this feature.
  // A rule back at its DEFAULT (off, no threshold) is therefore deleted, and an
  // empty policy drops the key entirely. A threshold the user actually typed is
  // NOT scaffolding and survives switching the rule off, so it is still there
  // when they switch it back on. Pinned by the two round-trip cases in
  // `timelog-settings.test.tsx`.
  function setRule(rule: TimelogRuleId, patch: Partial<TimelogRulePolicy>) {
    const cur = policy[rule] ?? { enabled: false };
    const enabled = patch.enabled ?? cur.enabled;
    const threshold = "threshold" in patch ? patch.threshold : cur.threshold;
    const nextPolicy: TimelogPolicy = { ...policy };
    if (!enabled && threshold === undefined) delete nextPolicy[rule];
    else nextPolicy[rule] = { enabled, ...(threshold !== undefined ? { threshold } : {}) };
    const next: TimelogLinks = { ...links };
    if (Object.keys(nextPolicy).length > 0) next.policy = nextPolicy;
    else delete next.policy;
    onLinksChange(next);
  }

  // ★★ `ToggleButton`, never a hand-rolled `aria-pressed` button: the primitive
  // carries the non-colour `data-pressed-marker` (WCAG 1.4.1) and the derived
  // 3:1 state border (1.4.11). Do NOT add a `dark:border-*` override —
  // `scheme-apply.ts` already sets that property per scheme AND mode.
  // ★★ Each label names the condition the rule FLAGS, i.e. what pressed=true
  // ENABLES, and never flips with state: "Day over the booking cap, pressed"
  // reads as "that rule is on" (WCAG 4.1.2).
  function ruleToggle(rule: TimelogRuleId, labelKey: Parameters<typeof t>[1]) {
    return (
      <ToggleButton
        pressed={policy[rule]?.enabled === true}
        onToggle={() => setRule(rule, { enabled: policy[rule]?.enabled !== true })}
        lang={lang}
      >
        {t(lang, labelKey)}
      </ToggleButton>
    );
  }

  // ★★ `aria-label`, never a placeholder — a placeholder is NOT an accessible
  // name, and a placeholder-only input is an axe-critical failure that still
  // LOOKS labeled. The two labels are distinct strings so the two spinbuttons
  // cannot share an accessible name (WCAG 2.4.6); axe cannot see that class at
  // all, so `timelog-settings.test.tsx` is the only detector.
  function thresholdField(rule: TimelogRuleId, labelKey: Parameters<typeof t>[1]) {
    return (
      <Input
        size="xs"
        type="number"
        min={1}
        max={MAX_HOURS_PER_DAY}
        aria-label={t(lang, labelKey)}
        value={policy[rule]?.threshold ?? ""}
        onChange={(e) => setRule(rule, { threshold: Number(e.target.value) || undefined })}
        className="w-20"
      />
    );
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1 text-sm font-medium text-foreground">
        {t(lang, "timelogGuardrailsTitle")}
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">{t(lang, "timelogGuardrailsHint")}</p>
      <div className="flex flex-col items-start gap-2">
        {/* ★ The threshold field renders only while its rule is ON. An inert
            field beside an off rule looks editable and changes nothing, and
            typing in one would write a policy key for a rule the user never
            switched on — the scaffolding the byte-stability note above exists
            to prevent. */}
        <div className="flex items-center gap-2">
          {ruleToggle("timelogCapPerEntry", "insightTimelogCapPerEntryTitle")}
          {policy.timelogCapPerEntry?.enabled === true &&
            thresholdField("timelogCapPerEntry", "timelogEntryCapLabel")}
        </div>
        <div className="flex items-center gap-2">
          {ruleToggle("timelogCapPerDay", "insightTimelogCapPerDayTitle")}
          {policy.timelogCapPerDay?.enabled === true &&
            thresholdField("timelogCapPerDay", "timelogDayCapLabel")}
        </div>
        {ruleToggle("timelogNonWorkingDay", "insightTimelogNonWorkingDayTitle")}
        {ruleToggle("timelogWorkingHours", "insightTimelogWorkingHoursTitle")}
      </div>
    </div>
  );
}
