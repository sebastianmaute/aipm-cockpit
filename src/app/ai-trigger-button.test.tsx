import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiTriggerButton } from "./ai-trigger-button";
import { t } from "./i18n";

// `raciSuggest` ("Suggest RACI") stands in for a caller's own idle label — the
// plan's `aiSuggest` is not a real TranslationKey. It is one of the six AI
// trigger sites' actual labels and shares no substring with "Stop", which the
// name/label assertions below depend on.
describe("AiTriggerButton", () => {
  it("shows the feature label and runs when idle", async () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    render(
      <AiTriggerButton lang="en-US" busy={false} onRun={onRun} onCancel={onCancel} idleLabelKey="raciSuggest" />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "raciSuggest") });
    await userEvent.click(btn);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("flips BOTH the visible label and the accessible name to Stop when busy", () => {
    render(
      <AiTriggerButton lang="en-US" busy onRun={vi.fn()} onCancel={vi.fn()} idleLabelKey="raciSuggest" />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "aiStop") });
    // WCAG 2.5.3: the visible text must be part of the accessible name.
    expect(btn).toHaveTextContent(t("en-US", "aiStop"));
    expect(btn).not.toHaveTextContent(t("en-US", "raciSuggest"));
  });

  it("routes the click to onCancel while busy", async () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    render(
      <AiTriggerButton lang="en-US" busy onRun={onRun} onCancel={onCancel} idleLabelKey="raciSuggest" />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "aiStop") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("keeps a real disabled attribute so a disabled trigger cannot fire", async () => {
    const onRun = vi.fn();
    render(
      <AiTriggerButton
        lang="en-US"
        busy={false}
        onRun={onRun}
        onCancel={vi.fn()}
        idleLabelKey="raciSuggest"
        disabled
      />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "raciSuggest") });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onRun).not.toHaveBeenCalled();
  });
});
