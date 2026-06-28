"use client";
import { useState } from "react";
import { t, type Lang } from "./i18n";
import { FieldNotice } from "./field-feedback";
import type { TimelogConfig, TimelogScopeMode } from "./timelog-types";
import { saveSecretValue } from "./use-secrets";
import { listUsers, getPrivileges } from "./timelog-api";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";
import { useIntegrationDisclaimer } from "./integration-disclaimer";

interface Props {
  lang: Lang;
  config: TimelogConfig;
  onChange: (next: TimelogConfig) => void;
}

export function TimelogSettings({ lang, config, onChange }: Props) {
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

  const field = `mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`;

  return (
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
              className={`text-AIPM-dark-blue underline dark:text-AIPM-light-grey ${FOCUS_RING}`}
            >
              https://login.timelog.com/personaltoken
            </a>{" "}
            {t(lang, "timelogTokenHelpAfter")}
          </p>
          <label className="block text-xs">
            {t(lang, "timelogHost")}
            <input
              className={field}
              value={config.host}
              onChange={(e) => set({ host: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            {t(lang, "timelogTenant")}
            <input
              className={field}
              value={config.tenant}
              onChange={(e) => set({ tenant: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            {t(lang, "timelogEmail")}
            <input
              className={field}
              type="email"
              value={config.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            {t(lang, "timelogToken")}
            <input
              className={field}
              type="password"
              autoComplete="off"
              aria-label={t(lang, "timelogToken")}
              value={config.apiToken}
              onChange={(e) => handleToken(e.target.value)}
            />
            <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
          </label>
          {config.tokenInvalidAt && (
            <p className="text-xs text-AIPM-pink-strong">{t(lang, "timelogTokenInvalid")}</p>
          )}
          <label className="block text-xs">
            {t(lang, "timelogScope")}
            <select
              className={field}
              value={config.scopeMode}
              onChange={(e) => set({ scopeMode: e.target.value as TimelogScopeMode })}
            >
              <option value="auto">{t(lang, "timelogScopeAuto")}</option>
              <option value="self">{t(lang, "timelogScopeSelf")}</option>
              <option value="org">{t(lang, "timelogScopeOrg")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing}
            className={`self-start rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-AIPM-dark-blue disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            {t(lang, "timelogTest")}
          </button>
          {testResult && <p className="text-xs text-muted-foreground">{testResult}</p>}
        </div>
      )}
    </div>
  );
}
