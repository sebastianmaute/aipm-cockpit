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

/** The two rules that carry a numeric threshold. The other two are on/off. */
const CAP_RULES: readonly TimelogRuleId[] = ["timelogCapPerEntry", "timelogCapPerDay"];

/** The threshold window this component will PERSIST, deliberately the same
 *  expression `sanitizeTimelogPolicy` applies on load and `isCap`
 *  (`timelog-policy.ts`) applies when evaluating — all three derived from
 *  `MAX_HOURS_PER_DAY` so a second, differently-worded bound cannot drift away
 *  from the other two. Returns `undefined` for anything the policy must not
 *  hold, which is also exactly the value the writer stores for it.
 *  ★ `Number("")` is `0` and `Number("x")` is `NaN`, so a blank or unparsable
 *  field falls out of `> 0` / `Number.isFinite` without a separate emptiness
 *  test — one that would be a permanently-unreachable conjunct. */
function parseCap(text: string): number | undefined {
  const n = Number(text);
  return Number.isFinite(n) && n > 0 && n <= MAX_HOURS_PER_DAY ? n : undefined;
}

/** A threshold the user is typing, and the value that keystroke wrote into the
 *  policy. Held because the field is bound to the PERSISTED value while an
 *  out-of-range value is deliberately never persisted: without it, the box
 *  would blank under the typist at the exact keystroke that took the number out
 *  of range. `wrote` is what lets the reconcile below tell OUR write apart from
 *  someone else's. */
interface ThresholdDraft {
  readonly text: string;
  readonly wrote: number | undefined;
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
  const [drafts, setDrafts] = useState<Partial<Record<TimelogRuleId, ThresholdDraft>>>({});

  // ★★★ RENDER-TIME RECONCILE, never a `useEffect` —
  // `react-hooks/set-state-in-effect` is BANNED and fatal here. A draft lives
  // only while the policy still holds what that draft wrote; anything else means
  // somebody ELSE moved the threshold (another tab, an AI write, a project
  // switch) and the draft is abandoned rather than left masking it. Comparing
  // against `wrote` rather than against the parsed text is what keeps our own
  // write from reading as an external one — the two are equal by construction,
  // so a controlled parent echoing our value back never drops the draft.
  const staleDrafts = CAP_RULES.filter((rule) => {
    const draft = drafts[rule];
    return draft !== undefined && policy[rule]?.threshold !== draft.wrote;
  });
  if (staleDrafts.length > 0) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const rule of staleDrafts) delete next[rule];
      return next;
    });
  }

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

  /** ★★★ THE WRITER'S WINDOW, and the whole point is that it is `parseCap` —
   *  the SAME expression the loader and the engine use. `min`/`max` on the field
   *  are decorative (they block neither typing nor a paste), and the writer used
   *  to be `Number(e.target.value) || undefined`: `-5` persisted and failed
   *  `isCap` immediately, so the rule sat pressed and inert from the first
   *  keystroke; `999` persisted, evaluated in-session as a cap that can never
   *  fire, and was then dropped by `sanitizeTimelogPolicy` on the next load.
   *  Nothing out of range reaches the policy now — the field goes on showing it
   *  and the notice says why it does not count. */
  function commitThreshold(rule: TimelogRuleId, text: string) {
    const cap = parseCap(text);
    setDrafts((prev) => ({ ...prev, [rule]: { text, wrote: cap } }));
    setRule(rule, { threshold: cap });
  }

  /** What the field is currently offering, as the cap it would persist —
   *  `undefined` when it is not one, which is precisely when the rule is on but
   *  cannot evaluate. */
  function effectiveCap(rule: TimelogRuleId): number | undefined {
    const draft = drafts[rule];
    return draft === undefined ? policy[rule]?.threshold : parseCap(draft.text);
  }

  // ★★ `aria-label`, never a placeholder — a placeholder is NOT an accessible
  // name, and a placeholder-only input is an axe-critical failure that still
  // LOOKS labeled. The two labels are distinct strings so the two spinbuttons
  // cannot share an accessible name (WCAG 2.4.6); axe cannot see that class at
  // all, so `timelog-settings.test.tsx` is the only detector.
  function thresholdField(
    rule: TimelogRuleId,
    labelKey: Parameters<typeof t>[1],
    incomplete: boolean,
    noticeId: string,
  ) {
    const draft = drafts[rule];
    return (
      <Input
        size="xs"
        type="number"
        min={1}
        max={MAX_HOURS_PER_DAY}
        aria-label={t(lang, labelKey)}
        invalid={incomplete}
        // ★ Only while the notice actually renders — an `aria-describedby`
        // pointing at an absent element describes nothing and is a dangling
        // reference for every AT that resolves it.
        aria-describedby={incomplete ? noticeId : undefined}
        value={draft?.text ?? String(policy[rule]?.threshold ?? "")}
        onChange={(e) => commitThreshold(rule, e.target.value)}
        className="w-20"
      />
    );
  }

  /** Toggle + threshold + the incomplete-rule notice, for one cap rule.
   *  ★★★ A cap rule can be ON and evaluate NOTHING: `isCap` rejects a missing
   *  threshold, so the rule produces no answer while the toggle reads pressed
   *  and the section says it is on. That is the state the FIRST click creates —
   *  enabling deliberately invents no threshold, because 8h vs 6h is an org
   *  decision and no universal default is correct — and the state the user
   *  re-enters every time they clear the field to retype. Nothing used to mark
   *  it. Do NOT "fix" this by seeding a default; the notice is the fix. */
  function capRule(
    rule: TimelogRuleId,
    toggleKey: Parameters<typeof t>[1],
    fieldKey: Parameters<typeof t>[1],
  ) {
    const on = policy[rule]?.enabled === true;
    const incomplete = on && effectiveCap(rule) === undefined;
    // Row-unique by construction: one row per rule, and `rule` is the row key.
    const noticeId = `timelog-threshold-${rule}`;
    return (
      <div className="flex flex-col items-start gap-1">
        {/* ★ The threshold field renders only while its rule is ON. An inert
            field beside an off rule looks editable and changes nothing, and
            typing in one would write a policy key for a rule the user never
            switched on — the scaffolding the byte-stability note above exists
            to prevent. */}
        <div className="flex items-center gap-2">
          {ruleToggle(rule, toggleKey)}
          {on && thresholdField(rule, fieldKey, incomplete, noticeId)}
        </div>
        {incomplete && (
          <FieldNotice id={noticeId}>
            {t(lang, "timelogThresholdNeeded", MAX_HOURS_PER_DAY)}
          </FieldNotice>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1 text-sm font-medium text-foreground">
        {t(lang, "timelogGuardrailsTitle")}
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">{t(lang, "timelogGuardrailsHint")}</p>
      <div className="flex flex-col items-start gap-2">
        {capRule("timelogCapPerEntry", "insightTimelogCapPerEntryTitle", "timelogEntryCapLabel")}
        {capRule("timelogCapPerDay", "insightTimelogCapPerDayTitle", "timelogDayCapLabel")}
        {ruleToggle("timelogNonWorkingDay", "insightTimelogNonWorkingDayTitle")}
        {ruleToggle("timelogWorkingHours", "insightTimelogWorkingHoursTitle")}
      </div>
    </div>
  );
}
