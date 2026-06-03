import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { defaultSettings } from "./settings-types";

describe("IntegrationsSection snapshot controls", () => {
  it("renders the recording toggle + cadence select inside the Turso block when Turso is enabled", () => {
    const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, turso: { enabled: true } } };
    const { getByLabelText, getByText } = render(<IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />);
    expect(getByText(/Snapshot trend recording/i)).toBeTruthy();
    expect(getByLabelText(/Snapshot cadence/i)).toBeTruthy();
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
