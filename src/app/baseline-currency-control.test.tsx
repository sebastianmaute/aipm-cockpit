import { describe, expect, test } from "vitest";
import { useEffect, type ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { BaselineCurrencyControl } from "./baseline-currency-control";
import type { FxRates, ResourcePlan, Role } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
// The table CACHED in the workspace — present in every test, so a control that
// read it instead of `sessionRates` would be enabled in the first one.
const cached: FxRates = { base: "EUR", date: "2026-01-02", fetchedAt: "2026-01-02T00:00:00.000Z", rates: { EUR: 1, USD: 1.1, GBP: 0.8, INR: 90 } };
const session: FxRates = { base: "EUR", date: "2026-10-13", fetchedAt: "2026-10-13T00:00:00.000Z", rates: { EUR: 1, USD: 1.08, GBP: 0.852, INR: 91 } };

function Seeder() {
  const { setPlan, setRoles, setFxRates } = useWorkspace();
  useEffect(() => {
    setPlan(plan);
    setRoles(roles);
    setFxRates(cached);
  }, [setPlan, setRoles, setFxRates]);
  return null;
}

function Probe() {
  const { plan: p, roles: r, baselineHistory, fxRates } = useWorkspace();
  return (
    <>
      <span data-testid="currency">{p.currency}</span>
      <span data-testid="rate">{String(r[0]?.internalRate ?? "")}</span>
      <span data-testid="history">{JSON.stringify(baselineHistory)}</span>
      <span data-testid="cached">{fxRates ? "cached" : "none"}</span>
    </>
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <Seeder />
        <Probe />
        {children}
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

const renderControl = (sessionRates: FxRates | null) =>
  render(<BaselineCurrencyControl lang="en-US" sessionRates={sessionRates} workdayHours={8} />, { wrapper });

async function openSwitchToGbp() {
  renderControl(session);
  await waitFor(() => expect(screen.getByTestId("rate").textContent).toBe("100"));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project currency" }), "GBP");
  return screen.getByRole("dialog", { name: "Switch project currency to GBP?" });
}

describe("BaselineCurrencyControl", () => {
  test("is disabled with the needs-rates text while only a CACHED table exists (Review Focus 3)", async () => {
    renderControl(null);
    await waitFor(() => expect(screen.getByTestId("cached").textContent).toBe("cached"));
    const select = screen.getByRole("combobox", { name: "Project currency" });
    expect(select).toBeDisabled();
    expect(screen.getByText("Refresh the ECB rates first: the switch converts your rates at today's rate.")).toBeInTheDocument();
    expect(select).toHaveAccessibleDescription(/Refresh the ECB rates first/);
  });

  test("with session rates the select is enabled and carries no needs-rates text", async () => {
    renderControl(session);
    await waitFor(() => expect(screen.getByTestId("currency").textContent).toBe("EUR"));
    expect(screen.getByRole("combobox", { name: "Project currency" })).toBeEnabled();
    expect(screen.queryByText(/Refresh the ECB rates first/)).not.toBeInTheDocument();
  });

  test("choosing GBP opens the dialog with the converted rows; Cancel (focused on open) changes nothing", async () => {
    const dialog = await openSwitchToGbp();
    const row = within(dialog).getByText("€100.00").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("£85.20")).toBeInTheDocument();
    expect(within(dialog).getByText("1 EUR = 0.852 GBP (ECB, 2026-10-13)")).toBeInTheDocument();
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    await userEvent.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("currency").textContent).toBe("EUR");
    expect(screen.getByTestId("rate").textContent).toBe("100");
    expect(screen.getByTestId("history").textContent).toBe("[]");
    expect(screen.getByRole("combobox", { name: "Project currency" })).toHaveValue("EUR");
  });

  test("Confirm switches the currency, converts the rate and records one history entry", async () => {
    const dialog = await openSwitchToGbp();
    await userEvent.click(within(dialog).getByRole("button", { name: "Switch to GBP" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("currency").textContent).toBe("GBP");
    expect(screen.getByTestId("rate").textContent).toBe("85.2");
    const history = JSON.parse(screen.getByTestId("history").textContent ?? "[]") as Array<{ currency: string; perPrevious?: number }>;
    expect(history).toHaveLength(1);
    expect(history[0].currency).toBe("GBP");
    expect(history[0].perPrevious).toBe(0.852);
    expect(screen.getByRole("combobox", { name: "Project currency" })).toHaveValue("GBP");
  });

  test("Escape closes the dialog like Cancel", async () => {
    const dialog = await openSwitchToGbp();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("currency").textContent).toBe("EUR");
    expect(screen.getByTestId("rate").textContent).toBe("100");
    expect(screen.getByTestId("history").textContent).toBe("[]");
  });
});
