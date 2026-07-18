"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { FieldNotice } from "./field-feedback";
import { fieldClass } from "./form-controls";
import { TextButton } from "./text-button";
import { InfoTooltip } from "./info-tooltip";
import {
  type JiraIssueType,
  type JiraProject,
  type JiraUser,
  classifyJiraError,
  formatJiraError,
  listIssueTypes,
  listProjects,
  searchUsers,
  testConnection,
} from "./jira-api";
import {
  type JiraAssigneeMode,
  type JiraConfig,
  defaultJiraConfig,
} from "./settings-types";
import { saveSecretValue } from "./use-secrets";
import { useIntegrationDisclaimer } from "./integration-disclaimer";
import { FOCUS_RING } from "./interaction-styles";
import { Button } from "./button";
import { reportSilentFailure } from "./guard-feedback";
import { useToastContext } from "./toast-context";

// Canonical field shell, single-sourced from the shared primitive (was a
// copy-declared ring-1 string; now the ring-2 ui-green standard).
const inputClass = fieldClass();

type Status =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

export function JiraSettingsSection({
  lang,
  config,
  onChange,
  alwaysOpen = false,
}: {
  lang: Lang;
  config: JiraConfig;
  onChange: (next: JiraConfig) => void;
  /** Modern settings view already scopes to one section, so the collapsible
   *  toggle is redundant there — render the body always-expanded with no toggle. */
  alwaysOpen?: boolean;
}) {
  const { notifyEnable } = useIntegrationDisclaimer();
  const showToast = useToastContext();
  const [open, setOpen] = useState(false);
  const isOpen = alwaysOpen || open;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [issueTypes, setIssueTypes] = useState<JiraIssueType[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<JiraUser[]>([]);
  const userSearchTimer = useRef<number | null>(null);

  const creds = {
    siteUrl: config.siteUrl,
    email: config.email,
    apiToken: config.apiToken,
  };
  const credsReady = !!(config.siteUrl && config.email && config.apiToken);

  // Reset issueTypes synchronously during render when credentials/project are absent.
  const issueTypesEnabled = credsReady && !!config.projectKey;
  const [prevIssueTypesEnabled, setPrevIssueTypesEnabled] = useState(issueTypesEnabled);
  if (prevIssueTypesEnabled !== issueTypesEnabled) {
    setPrevIssueTypesEnabled(issueTypesEnabled);
    if (!issueTypesEnabled) setIssueTypes([]);
  }

  // When project changes, reload issue types.
  useEffect(() => {
    if (!credsReady || !config.projectKey) return;
    let cancelled = false;
    listIssueTypes(creds, config.projectKey)
      .then((list) => {
        if (!cancelled) setIssueTypes(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setIssueTypes([]);
          reportSilentFailure(showToast, lang, "jira.issueTypesLoadFailed", e, "guardJiraIssueTypesFailed");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.projectKey, config.siteUrl, config.email, config.apiToken]);

  // Reset userResults synchronously during render when search is inactive.
  const userSearchEnabled =
    config.assigneeMode === "specific" && credsReady && !!config.projectKey;
  const [prevUserSearchEnabled, setPrevUserSearchEnabled] = useState(userSearchEnabled);
  if (prevUserSearchEnabled !== userSearchEnabled) {
    setPrevUserSearchEnabled(userSearchEnabled);
    if (!userSearchEnabled) setUserResults([]);
  }

  // Debounced user search for the "specific assignee" picker.
  useEffect(() => {
    if (
      config.assigneeMode !== "specific" ||
      !credsReady ||
      !config.projectKey
    ) {
      return;
    }
    if (userSearchTimer.current !== null) {
      window.clearTimeout(userSearchTimer.current);
    }
    userSearchTimer.current = window.setTimeout(() => {
      searchUsers(creds, config.projectKey, userQuery)
        .then(setUserResults)
        .catch(() => setUserResults([]));
    }, 300);
    return () => {
      if (userSearchTimer.current !== null) {
        window.clearTimeout(userSearchTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userQuery,
    config.assigneeMode,
    config.projectKey,
    config.siteUrl,
    config.email,
    config.apiToken,
  ]);

  async function handleTest() {
    if (!credsReady) return;
    setStatus({ kind: "loading", label: t(lang, "jiraTesting") });
    try {
      const me = await testConnection(creds);
      setStatus({
        kind: "ok",
        message: t(lang, "jiraConnectedAs", me.displayName),
      });
      onChange({ ...config, tokenInvalidAt: undefined });
      // Auto-load projects after a successful test.
      try {
        const list = await listProjects(creds);
        setProjects(list);
      } catch (e) {
        reportSilentFailure(showToast, lang, "jira.projectListLoadFailed", e, "guardJiraProjectListFailed");
      }
    } catch (err) {
      setStatus({ kind: "err", message: formatJiraError(err) });
      if (classifyJiraError(err) === "auth") {
        onChange({ ...config, tokenInvalidAt: new Date().toISOString() });
      }
    }
  }

  function update<K extends keyof JiraConfig>(key: K, value: JiraConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  // The API token is a secret: device-seal it into the secrets store (AES-256-GCM)
  // the moment it changes, mirroring the Anthropic key / Turso token. writeSettings
  // blanks `jira.apiToken` from the localStorage settings blob, so this seal is what
  // survives a reload; on load it is decrypted back into memory (hydrateSecretsInto).
  function handleApiTokenChange(value: string) {
    update("apiToken", value);
    void saveSecretValue("jiraApiToken", value, "device");
  }

  function toggleIssueType(name: string) {
    const next = config.issueTypes.includes(name)
      ? config.issueTypes.filter((n) => n !== name)
      : [...config.issueTypes, name];
    update("issueTypes", next);
  }

  function reset() {
    setStatus({ kind: "idle" });
    setProjects([]);
    setIssueTypes([]);
    setUserResults([]);
    onChange(defaultJiraConfig);
  }

  const projectName =
    config.projectName ||
    projects.find((p) => p.key === config.projectKey)?.name ||
    "";

  return (
    <div className="mb-4">
      {!alwaysOpen && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between text-sm font-medium text-foreground hover:text-ui-dark-blue"
          aria-expanded={open}
        >
          <span>{t(lang, "jiraIntegration")}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {config.enabled
              ? t(lang, "jiraStatusOn")
              : t(lang, "jiraStatusOff")}
            <span
              aria-hidden
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            >
              ▸
            </span>
          </span>
        </button>
      )}

      {isOpen && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => {
                  if (e.target.checked) notifyEnable();
                  update("enabled", e.target.checked);
                }}
                className="h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green"
              />
              <span className="text-foreground">
                {t(lang, "jiraEnable")}
              </span>
            </label>
            <InfoTooltip text={t(lang, "jiraEnableTooltip")} />
          </div>

          {config.enabled && (
          <fieldset className="space-y-2">
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {t(lang, "jiraSiteUrl")}
                <InfoTooltip text={t(lang, "jiraSiteUrlTooltip")} />
              </span>
              <input
                type="url"
                value={config.siteUrl}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  // Defense in depth: drop the update if the value parses as
                  // a URL with a non-http(s) scheme (e.g. javascript:, data:,
                  // file:). The render-time guard in task-manager.tsx is the
                  // primary XSS defense; this prevents such values from ever
                  // reaching localStorage. Partial / not-yet-parseable input
                  // is still accepted so the user can keep typing.
                  if (v) {
                    try {
                      const u = new URL(v);
                      if (u.protocol !== "http:" && u.protocol !== "https:")
                        return;
                    } catch {
                      // Not a parseable URL yet — let it through.
                    }
                  }
                  update("siteUrl", v);
                }}
                placeholder="https://acme.atlassian.net"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {t(lang, "jiraEmail")}
                <InfoTooltip text={t(lang, "jiraEmailTooltip")} />
              </span>
              <input
                type="email"
                value={config.email}
                onChange={(e) => update("email", e.target.value.trim())}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {t(lang, "jiraApiToken")}
                <InfoTooltip text={t(lang, "jiraApiTokenTooltip")} />
              </span>
              <input
                type="password"
                autoComplete="off"
                value={config.apiToken}
                onChange={(e) => handleApiTokenChange(e.target.value)}
                placeholder="ATATT…"
                className={inputClass}
              />
              <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-blue"
              >
                {t(lang, "jiraApiTokenLink")} ↗
              </a>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">
                {t(lang, "jiraTokenExpires")}
              </span>
              <input
                type="date"
                className={inputClass}
                value={config.tokenExpiresAt ?? ""}
                onChange={(e) => onChange({ ...config, tokenExpiresAt: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t(lang, "jiraTokenExpiresHint")}</p>
            </label>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleTest}
                disabled={!credsReady || status.kind === "loading"}
              >
                {status.kind === "loading"
                  ? status.label
                  : t(lang, "jiraTest")}
              </Button>
              {status.kind === "ok" && (
                <span className="text-xs text-ui-green-strong">
                  ✓ {status.message}
                </span>
              )}
              {status.kind === "err" && (
                <span className="text-xs text-ui-pink-strong">
                  ⚠ {status.message}
                </span>
              )}
            </div>

            {projects.length > 0 && (
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  {t(lang, "jiraProject")}
                  <InfoTooltip text={t(lang, "jiraProjectTooltip")} />
                </span>
                <select
                  value={config.projectKey}
                  onChange={(e) => {
                    const key = e.target.value;
                    const proj = projects.find((p) => p.key === key);
                    onChange({
                      ...config,
                      projectKey: key,
                      projectName: proj?.name ?? "",
                      issueTypes: [],
                    });
                  }}
                  className={inputClass}
                >
                  <option value="">— {t(lang, "jiraPickProject")} —</option>
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {config.projectKey && projectName && projects.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t(lang, "jiraCurrentProject", projectName, config.projectKey)}
              </p>
            )}

            {config.projectKey && projects.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(lang, "jiraExtraProjectsLabel")}
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t(lang, "jiraExtraProjectsHint")}
                </p>
                <ul className="space-y-1">
                  {projects
                    .filter((p) => p.key !== config.projectKey)
                    .map((p) => {
                      const entry = (config.extraProjects ?? []).find(
                        (e) => e.key === p.key,
                      );
                      const included = !!entry;
                      return (
                        <li
                          key={p.key}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={included}
                              aria-label={`${t(lang, "jiraExtraProjectInclude")} – ${p.name} (${p.key})`}
                              onChange={(e) => {
                                const current = config.extraProjects ?? [];
                                const next = e.target.checked
                                  ? [
                                      ...current,
                                      {
                                        key: p.key,
                                        name: p.name,
                                        readOnly: true,
                                      },
                                    ]
                                  : current.filter((x) => x.key !== p.key);
                                onChange({ ...config, extraProjects: next });
                              }}
                              className={`h-4 w-4 ${FOCUS_RING}`}
                            />
                            <span className="text-foreground">
                              {p.name}{" "}
                              <span className="text-muted-foreground">
                                ({p.key})
                              </span>
                            </span>
                          </label>
                          {included && (
                            <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={entry.readOnly}
                                aria-label={`${t(lang, "jiraReadOnly")} – ${p.name} (${p.key})`}
                                onChange={(e) => {
                                  const next = (config.extraProjects ?? []).map(
                                    (x) =>
                                      x.key === p.key
                                        ? { ...x, readOnly: e.target.checked }
                                        : x,
                                  );
                                  onChange({ ...config, extraProjects: next });
                                }}
                                className={`h-3.5 w-3.5 ${FOCUS_RING}`}
                              />
                              {t(lang, "jiraReadOnly")}
                            </label>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}

            {config.projectKey &&
              projects.length === 0 &&
              (config.extraProjects ?? []).length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(lang, "jiraExtraProjectsLabel")}
                  </p>
                  <ul className="space-y-1">
                    {(config.extraProjects ?? []).map((e) => (
                      <li
                        key={e.key}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="text-foreground">
                          {e.name}{" "}
                          <span className="text-muted-foreground">
                            ({e.key})
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={e.readOnly}
                              aria-label={`${t(lang, "jiraReadOnly")} – ${e.name} (${e.key})`}
                              onChange={(ev) => {
                                const next = (config.extraProjects ?? []).map(
                                  (x) =>
                                    x.key === e.key
                                      ? { ...x, readOnly: ev.target.checked }
                                      : x,
                                );
                                onChange({ ...config, extraProjects: next });
                              }}
                              className={`h-3.5 w-3.5 ${FOCUS_RING}`}
                            />
                            {t(lang, "jiraReadOnly")}
                          </label>
                          <TextButton
                            tone="danger"
                            aria-label={`${t(lang, "jiraExtraProjectRemove")} – ${e.name} (${e.key})`}
                            onClick={() =>
                              onChange({
                                ...config,
                                extraProjects: (config.extraProjects ?? []).filter(
                                  (x) => x.key !== e.key,
                                ),
                              })
                            }
                            className="text-xs"
                          >
                            {t(lang, "jiraExtraProjectRemove")}
                          </TextButton>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {issueTypes.length > 0 && (
              <div>
                <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  {t(lang, "jiraIssueTypes")}
                  <InfoTooltip text={t(lang, "jiraIssueTypesTooltip")} />
                </span>
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {issueTypes
                    .filter((it) => !it.subtask)
                    .map((it) => (
                      <li key={it.id}>
                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={config.issueTypes.includes(it.name)}
                            onChange={() => toggleIssueType(it.name)}
                            className="h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green"
                          />
                          {it.name}
                        </label>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div>
              <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {t(lang, "jiraAssignee")}
                <InfoTooltip text={t(lang, "jiraAssigneeTooltip")} />
              </span>
              <div className="flex flex-wrap gap-3 text-xs">
                {(
                  ["currentUser", "any", "specific"] as JiraAssigneeMode[]
                ).map((mode) => (
                  <label key={mode} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="jira-assignee-mode"
                      checked={config.assigneeMode === mode}
                      onChange={() => update("assigneeMode", mode)}
                      className="h-3 w-3 cursor-pointer text-ui-dark-blue focus:ring-ui-green"
                    />
                    <span className="text-foreground">
                      {t(lang, `jiraAssignee_${mode}`)}
                    </span>
                  </label>
                ))}
              </div>

              {config.assigneeMode === "specific" && config.projectKey && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder={t(lang, "jiraUserSearch")}
                    className={inputClass}
                  />
                  {config.assigneeDisplayName && (
                    <p className="text-xs text-foreground">
                      ✓{" "}
                      {t(
                        lang,
                        "jiraAssigneeSelected",
                        config.assigneeDisplayName,
                      )}
                    </p>
                  )}
                  {userResults.length > 0 && (
                    <ul className="max-h-40 overflow-y-auto rounded-md border border-line">
                      {userResults.map((u) => (
                        <li
                          key={u.accountId}
                          className="border-b border-line last:border-b-0"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onChange({
                                ...config,
                                assigneeAccountId: u.accountId,
                                assigneeDisplayName: u.displayName,
                              })
                            }
                            className={`block w-full px-3 py-1.5 text-left text-xs ${
                              config.assigneeAccountId === u.accountId
                                ? "bg-surface-muted text-ui-dark-blue"
                                : "text-foreground hover:bg-surface-muted"
                            }`}
                          >
                            {u.displayName}
                            {u.emailAddress && (
                              <span className="ml-2 text-muted-foreground">
                                {u.emailAddress}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <TextButton
              tone="danger"
              onClick={reset}
              className="text-xs"
            >
              {t(lang, "jiraReset")}
            </TextButton>
          </fieldset>
          )}

          <p className="text-xs text-muted-foreground">
            {t(lang, "jiraNote")}
          </p>
        </div>
      )}
    </div>
  );
}
