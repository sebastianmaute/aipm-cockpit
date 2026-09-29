// §650 — the AI key banner, in isolation. Its MOUNT in both shells (and its absence from popouts)
// is pinned in task-manager.ai-key-banner.test.tsx, which renders the real task-manager.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AiKeyBanner } from "./notifications";
import { loadI18n, t } from "./i18n";

const EN_COPY = {
  rejected: "Claude rejected your Anthropic API key. Enter a new key in Settings → AI.",
  forbidden:
    "Your Anthropic API key isn't allowed to make this request. Check the key's permissions in the Anthropic Console, or enter a different key in Settings → AI.",
  unreadable: "Your saved Anthropic API key couldn't be read on this device. Enter it again in Settings → AI.",
} as const;

describe("AiKeyBanner", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it.each(Object.entries(EN_COPY))("renders the exact EN copy for %s", (status, copy) => {
    render(
      <AiKeyBanner status={status as keyof typeof EN_COPY} lang="en-US" onOpenSettings={() => {}} onDismiss={() => {}} />,
    );
    const region = screen.getByRole("region", { name: "Anthropic API key problem" });
    expect(region).toHaveTextContent(copy);
  });

  it("its one action opens AI settings, by keyboard as well as by click", async () => {
    const onOpenSettings = vi.fn();
    render(<AiKeyBanner status="rejected" lang="en-US" onOpenSettings={onOpenSettings} onDismiss={() => {}} />);
    const button = screen.getByRole("button", { name: "Open AI settings" });
    fireEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<AiKeyBanner status="forbidden" lang="en-US" onOpenSettings={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "alertBannerDismiss") }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders in German", () => {
    render(<AiKeyBanner status="unreadable" lang="de" onOpenSettings={() => {}} onDismiss={() => {}} />);
    const region = screen.getByRole("region", { name: "Problem mit dem Anthropic-API-Schlüssel" });
    expect(region).toHaveTextContent(
      "Ihr gespeicherter Anthropic-API-Schlüssel konnte auf diesem Gerät nicht gelesen werden. Geben Sie ihn unter Einstellungen → KI erneut ein.",
    );
    expect(screen.getByRole("button", { name: "KI-Einstellungen öffnen" })).toBeInTheDocument();
  });
});
