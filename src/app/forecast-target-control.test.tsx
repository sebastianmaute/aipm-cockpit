import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastTargetControl } from "./forecast-target-control";
import { loadI18n } from "./i18n";

describe("ForecastTargetControl", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("offers the three targets as radios, the stored one checked", () => {
    render(<ForecastTargetControl lang="en-US" value={80} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Target confidence" });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Even odds 50%", "Safe to commit 80%", "Cautious 95%"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("clicking 95 calls onChange(95) with a number", async () => {
    const onChange = vi.fn();
    render(<ForecastTargetControl lang="en-US" value={80} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Cautious 95%" }));
    expect(onChange).toHaveBeenCalledWith(95);
  });

  it("disabled, no radio fires", async () => {
    const onChange = vi.fn();
    render(<ForecastTargetControl lang="en-US" value={50} onChange={onChange} disabled />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Safe to commit 80%" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reads in German with the German percent", () => {
    render(<ForecastTargetControl lang="de" value={95} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Zielsicherheit" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Vorsichtig 95 %" }).getAttribute("aria-checked")).toBe("true");
  });
});
