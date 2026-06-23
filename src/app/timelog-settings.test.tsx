import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("./use-secrets", () => ({ saveSecretValue: vi.fn().mockResolvedValue(undefined) }));
import * as secrets from "./use-secrets";
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
});
