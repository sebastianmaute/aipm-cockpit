"use client";

// "This project" settings — per-project overrides of otherwise per-device
// settings. POLICY groups (next-actions / notifications / timezone) write the
// project-travelling `Workspace.settingsOverrides` blob; APPEARANCE writes the
// per-device-per-project appearance store. Each group has a "device default |
// override" toggle; when on it seeds from the current EFFECTIVE value and reveals
// that group's controls (the policy groups REUSE the existing section
// components fed the effective settings + an override-writing onChange).
import { useSyncExternalStore, type ReactNode } from "react";
import { type Lang, type TranslationKey, t } from "../i18n";
import type { Settings, SettingsOverrides } from "../settings-types";
import { useWorkspace } from "../workspace-context";
import { useEffectiveSettings } from "../use-effective-settings";
import {
  getAppearanceSnapshot,
  subscribeAppearance,
  saveProjectAppearance,
  type ProjectAppearancePref,
} from "../project-appearance-prefs";
import { SegmentedControl } from "../segmented-control";
import { NextActionsSection } from "./next-actions-section";
import { NotificationsSection } from "./notifications-section";
import { TimezoneSettingsSection } from "./timezone-settings-section";

type PolicyKey = "nextActions" | "notifications" | "timezone";

/** A group row: title + a device/override toggle, and (when on) its controls. */
function OverrideGroup({
  lang,
  titleKey,
  overridden,
  onToggle,
  children,
}: {
  lang: Lang;
  titleKey: TranslationKey;
  overridden: boolean;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t(lang, titleKey)}</h3>
        <SegmentedControl<"device" | "project">
          value={overridden ? "project" : "device"}
          ariaLabel={`${t(lang, titleKey)} – ${t(lang, "projectOverrideToggle")}`}
          options={[
            { value: "device", label: t(lang, "projectOverrideUseDevice") },
            { value: "project", label: t(lang, "projectOverrideOn") },
          ]}
          onChange={(v) => onToggle(v === "project")}
        />
      </div>
      {overridden && (
        <div className="rounded-md border border-line bg-surface-muted p-3">{children}</div>
      )}
    </section>
  );
}

export function ProjectOverridesSection({
  lang,
  projectId,
}: {
  lang: Lang;
  /** device settings — unused directly; effective is derived via the hook. */
  settings: Settings;
  projectId: string;
}) {
  const { settingsOverrides, setSettingsOverrides } = useWorkspace();
  const effective = useEffectiveSettings(projectId);
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    () => getAppearanceSnapshot(projectId),
    () => getAppearanceSnapshot(projectId),
  );

  function setPolicy<K extends PolicyKey>(key: K, value: SettingsOverrides[K] | undefined): void {
    setSettingsOverrides((prev) => {
      const next: SettingsOverrides = { ...(prev ?? {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return Object.keys(next).length ? next : undefined;
    });
  }

  function togglePolicy(key: PolicyKey, on: boolean): void {
    if (!on) {
      setPolicy(key, undefined);
      return;
    }
    // Seed from the current EFFECTIVE value so the group is non-empty and nothing
    // visibly changes at toggle time.
    if (key === "nextActions") setPolicy("nextActions", effective.nextActions);
    else if (key === "notifications") setPolicy("notifications", effective.notifications);
    else
      // NOTE: on a system-default zone with no extra zones this seeds an EMPTY
      // timezone override — the toggle reads ON in-session but sanitize drops the
      // empty group on save, so it reverts to OFF after reload (benign: effective
      // == device either way). It becomes durable once the user picks a zone.
      setPolicy("timezone", {
        timezone: effective.timezone,
        additionalTimezones: effective.additionalTimezones,
      });
  }

  function setAppearance(patch: Partial<ProjectAppearancePref>): void {
    saveProjectAppearance(projectId, { ...appearance, ...patch });
  }
  function toggleAppearance(on: boolean): void {
    if (!on) {
      saveProjectAppearance(projectId, {});
      return;
    }
    // Only density + view-hints are project-overridable in the UI. tasksViewMode
    // is EXCLUDED: the Open Points pane has its own table/board toggle (writes
    // the device default), so a per-project override would fight it (the pane
    // would snap back). It stays a pure device preference.
    saveProjectAppearance(projectId, {
      dashboardDensity: effective.dashboardDensity ?? "comfortable",
      showViewHints: effective.showViewHints !== false,
    });
  }
  const appearanceOn = Object.keys(appearance).length > 0;

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">{t(lang, "projectOverridesIntro")}</p>

      <OverrideGroup
        lang={lang}
        titleKey="settingsSectionNextActions"
        overridden={settingsOverrides?.nextActions !== undefined}
        onToggle={(on) => togglePolicy("nextActions", on)}
      >
        <NextActionsSection
          lang={lang}
          settings={effective}
          onChange={(next) => setPolicy("nextActions", next.nextActions)}
        />
      </OverrideGroup>

      <OverrideGroup
        lang={lang}
        titleKey="settingsSectionNotifications"
        overridden={settingsOverrides?.notifications !== undefined}
        onToggle={(on) => togglePolicy("notifications", on)}
      >
        <NotificationsSection
          lang={lang}
          settings={effective}
          onChange={(next) => setPolicy("notifications", next.notifications)}
        />
      </OverrideGroup>

      <OverrideGroup
        lang={lang}
        titleKey="tzSettingsTitle"
        overridden={settingsOverrides?.timezone !== undefined}
        onToggle={(on) => togglePolicy("timezone", on)}
      >
        <TimezoneSettingsSection
          lang={lang}
          settings={effective}
          hideDisplaySwitcher
          onChange={(next) =>
            setPolicy("timezone", {
              timezone: next.timezone,
              additionalTimezones: next.additionalTimezones,
            })
          }
        />
      </OverrideGroup>

      <OverrideGroup
        lang={lang}
        titleKey="settingsSectionAppearance"
        overridden={appearanceOn}
        onToggle={toggleAppearance}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground">
            {t(lang, "dashboardDensityLabel")}
            <SegmentedControl<"comfortable" | "compact">
              value={effective.dashboardDensity ?? "comfortable"}
              ariaLabel={t(lang, "dashboardDensityLabel")}
              options={[
                { value: "comfortable", label: t(lang, "dashboardDensityComfortable") },
                { value: "compact", label: t(lang, "dashboardDensityCompact") },
              ]}
              onChange={(v) => setAppearance({ dashboardDensity: v })}
            />
          </label>
          <label className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground">
            {t(lang, "showViewHintsLabel")}
            <SegmentedControl<"shown" | "hidden">
              value={effective.showViewHints !== false ? "shown" : "hidden"}
              ariaLabel={t(lang, "showViewHintsLabel")}
              options={[
                { value: "shown", label: t(lang, "viewHintsShown") },
                { value: "hidden", label: t(lang, "viewHintsHidden") },
              ]}
              onChange={(v) => setAppearance({ showViewHints: v === "shown" })}
            />
          </label>
        </div>
      </OverrideGroup>
    </div>
  );
}
