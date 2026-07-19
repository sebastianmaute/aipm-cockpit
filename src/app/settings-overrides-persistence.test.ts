// src/app/settings-overrides-persistence.test.ts
// JSON round-trip + byte-stability for Workspace.settingsOverrides (per-project
// policy overrides). Phase 1 wires the JSON path ONLY — the other five storage
// paths (CSV/MD/Turso-single/Turso-tenant/IndexedDB) land later.
//
// Like timelogLinks/steeringCommittee this field is storage-only and additive:
// an override-less workspace must NOT emit a "settingsOverrides" key.

import { describe, it, expect } from "vitest";
import { emptyWorkspace, workspaceToJson, jsonToWorkspace } from "./workspace";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import type { SettingsOverrides } from "./settings-types";

const SAMPLE_OVERRIDES: SettingsOverrides = {
  nextActions: { scopePendingRed: 8, staticPenalty: 30 },
  notifications: { dueSoonWorkdays: 5, birthday: { enabled: false, leadDays: 10 } },
  timezone: { timezone: "Europe/Berlin", additionalTimezones: ["UTC", "America/New_York"] },
};

function wsWithOverrides() {
  return { ...emptyWorkspace(), settingsOverrides: SAMPLE_OVERRIDES };
}

describe("JSON codec — settingsOverrides", () => {
  it("round-trips settingsOverrides", () => {
    const restored = jsonToWorkspace(workspaceToJson(wsWithOverrides()));
    expect(restored.settingsOverrides).toEqual(SAMPLE_OVERRIDES);
  });

  it("override-less workspace has no settingsOverrides key in JSON output", () => {
    expect(workspaceToJson(emptyWorkspace())).not.toContain("settingsOverrides");
  });

  it("drops junk overrides on load (sanitized through sanitizeSettingsOverrides)", () => {
    const ws = {
      ...emptyWorkspace(),
      settingsOverrides: {
        nextActions: { scheduleSpiWarn: 9, bogusKey: 1 }, // out-of-bounds -> default; unknown dropped
        timezone: { timezone: "Not/AZone" }, // invalid -> dropped
      } as unknown as SettingsOverrides,
    };
    const restored = jsonToWorkspace(workspaceToJson(ws));
    expect(restored.settingsOverrides).toEqual({ nextActions: { scheduleSpiWarn: 0.9 } });
  });

  it("an all-junk settingsOverrides in a loaded file is dropped (undefined)", () => {
    // Simulate an untrusted file whose overrides hold no valid field: the load
    // path sanitizes to {} (no sub-key) and leaves the field off.
    const json = JSON.stringify({
      schemaVersion: 11,
      tasks: [],
      raid: [],
      settingsOverrides: { nextActions: {}, timezone: { timezone: "bad" } },
    });
    expect(jsonToWorkspace(json).settingsOverrides).toBeUndefined();
  });
});

describe("CSV codec — settingsOverrides", () => {
  it("round-trips settingsOverrides", () => {
    const restored = csvToWorkspace(workspaceToCsv(wsWithOverrides()));
    expect(restored.settingsOverrides).toEqual(SAMPLE_OVERRIDES);
  });

  it("override-less workspace emits no # SETTINGS OVERRIDES section", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# SETTINGS OVERRIDES");
  });
});

describe("Markdown codec — settingsOverrides", () => {
  it("round-trips settingsOverrides", () => {
    const restored = markdownToWorkspace(workspaceToMarkdown(wsWithOverrides()));
    expect(restored.settingsOverrides).toEqual(SAMPLE_OVERRIDES);
  });

  it("override-less workspace emits no ## Settings Overrides section", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Settings Overrides");
  });
});
