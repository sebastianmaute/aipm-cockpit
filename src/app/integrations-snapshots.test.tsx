import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { defaultSettings } from "./settings-types";
import { savePortfolioMode } from "./portfolio-mode";
import { saveRegistry } from "./projects-registry";

describe("IntegrationsSection snapshot controls", () => {
  it("renders the recording toggle + cadence select inside the Turso block when Turso is enabled", () => {
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true } } };
    const { getByLabelText, getByText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />);
    expect(getByText(/Snapshot trend recording/i)).toBeTruthy();
    expect(getByLabelText(/Snapshot cadence/i)).toBeTruthy();
  });

  it("warns when recording is enabled but no Turso URL is configured", () => {
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true } }, snapshots: { enabled: true, cadence: "weekly" as const } };
    const { getByText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />);
    expect(getByText(/no Turso database URL is set/i)).toBeTruthy();
  });

  it("does NOT warn when a Turso URL is configured", () => {
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true, databaseUrl: "https://db.example.com" } }, snapshots: { enabled: true, cadence: "weekly" as const } };
    const { queryByText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />);
    expect(queryByText(/no Turso database URL is set/i)).toBeNull();
  });

  it("disables the recording toggle until the portfolio is on Turso (file mode)", () => {
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true } } };
    const { getByText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />);
    const label = getByText(/Snapshot trend recording/i).closest("label")!;
    const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("shows 'Move to Turso' and fires it when configured + callback provided (file mode)", () => {
    const onMigrateToTurso = vi.fn();
    const settings = {
      ...defaultSettings,
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl: "https://db.example.com", authToken: "tok" },
      },
    };
    const { getByText } = render(
      <IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} onMigrateToTurso={onMigrateToTurso} />,
    );
    fireEvent.click(getByText("Move to Turso"));
    expect(onMigrateToTurso).toHaveBeenCalledTimes(1);
  });

  it("switching the portfolio to Turso persists storageConfig.kind 'turso' (regression: workspace stayed on the local file)", () => {
    window.localStorage.clear();
    const settings = {
      ...defaultSettings,
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl: "https://x.turso.io", authToken: "tok" },
      },
    };
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
    try {
      const { getByLabelText, getByText } = render(
        <IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />,
      );
      const select = getByLabelText("Portfolio storage") as HTMLSelectElement;
      select.value = "turso";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      fireEvent.click(getByText("Save & switch portfolio"));

      const persisted = JSON.parse(window.localStorage.getItem("aipm-cockpit:settings") ?? "{}");
      expect(persisted.storageConfig?.kind).toBe("turso");
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("switching the portfolio back to File restores the current file project's backend config (regression: leftover 'turso' stranded the workspace)", () => {
    window.localStorage.clear();
    savePortfolioMode("turso");
    saveRegistry({
      currentProjectId: "p1",
      projects: [{ id: "p1", name: "Local", code: "LO", storageConfig: { kind: "local-json" } }],
    });
    const settings = {
      ...defaultSettings,
      storageConfig: { kind: "turso" as const },
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl: "https://x.turso.io", authToken: "tok" },
      },
    };
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
    try {
      const { getByLabelText, getByText } = render(
        <IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />,
      );
      const select = getByLabelText("Portfolio storage") as HTMLSelectElement;
      select.value = "file";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      fireEvent.click(getByText("Save & switch portfolio"));

      const persisted = JSON.parse(window.localStorage.getItem("aipm-cockpit:settings") ?? "{}");
      expect(persisted.storageConfig?.kind).toBe("local-json");
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("updates cadence via onChange", () => {
    const onChange = vi.fn();
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true } } };
    const { getByLabelText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={onChange} />);
    const select = getByLabelText(/Snapshot cadence/i) as HTMLSelectElement;
    select.value = "daily";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.snapshots.cadence).toBe("daily");
  });
});
