import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("./use-secrets", () => ({ saveSecretValue: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./timelog-api", () => ({
  listUsers: vi.fn(),
  getPrivileges: vi.fn(),
}));
import * as secrets from "./use-secrets";
import * as timelogApi from "./timelog-api";
import { TimelogSettings } from "./timelog-settings";
import { defaultTimelogConfig } from "./timelog-types";
import { t } from "./i18n";

describe("TimelogSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seals the token via saveSecretValue on input", () => {
    let cfg = { ...defaultTimelogConfig, enabled: true };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={(n) => (cfg = n)} />);
    fireEvent.change(screen.getByLabelText(t("en-US", "timelogToken")), {
      target: { value: "tok123" },
    });
    expect(secrets.saveSecretValue).toHaveBeenCalledWith("timelogApiToken", "tok123", "device");
  });

  it("hides config fields until enabled", () => {
    render(
      <TimelogSettings lang="en-US" config={defaultTimelogConfig} onChange={() => {}} />,
    );
    expect(screen.queryByLabelText(t("en-US", "timelogHost"))).toBeNull();
  });

  it("test() SUCCESS renders timelogTestOk", async () => {
    vi.mocked(timelogApi.listUsers).mockResolvedValue([
      { userId: 1, firstName: "Ada", lastName: "Lovelace", initials: "AL", email: "ada@example.com", isActive: true },
    ]);
    vi.mocked(timelogApi.getPrivileges).mockResolvedValue({ registrationAllTasks: false });

    const cfg = { ...defaultTimelogConfig, enabled: true, host: "h", tenant: "t", apiToken: "tok" };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogTest") }));

    await screen.findByText(/1/);
  });

  it("test() FAILURE renders timelogTestFail", async () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    vi.mocked(timelogApi.listUsers).mockRejectedValue(err);
    vi.mocked(timelogApi.getPrivileges).mockResolvedValue({ registrationAllTasks: false });

    const cfg = { ...defaultTimelogConfig, enabled: true, host: "h", tenant: "t", apiToken: "tok" };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogTest") }));

    await screen.findByText(/401/);
  });

  it("renders timelogTokenInvalid warning when tokenInvalidAt is set", () => {
    const cfg = { ...defaultTimelogConfig, enabled: true, tokenInvalidAt: "2024-01-01T00:00:00Z" };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={() => {}} />);
    expect(screen.getByText(t("en-US", "timelogTokenInvalid"))).toBeTruthy();
  });
});
