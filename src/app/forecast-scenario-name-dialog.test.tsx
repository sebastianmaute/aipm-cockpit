import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastScenarioNameDialog } from "./forecast-scenario-name-dialog";
import type { ForecastScenario } from "./forecast-scenarios";
import { loadI18n, type Lang } from "./i18n";

const LIST: ForecastScenario[] = [{ id: 1, name: "Alpha", changes: [] }, { id: 2, name: "Beta", changes: [] }];

function renderDialog(over: { note?: string; exceptId?: number | null; initialName?: string; lang?: Lang; refuse?: string } = {}) {
  const onSave = vi.fn((): string | null => over.refuse ?? null);
  const onCancel = vi.fn();
  render(
    <ForecastScenarioNameDialog
      lang={over.lang ?? "en-US"} open title="Save as scenario" initialName={over.initialName ?? ""} note={over.note} list={LIST}
      exceptId={over.exceptId ?? null} onSave={onSave} onCancel={onCancel}
    />,
  );
  return { onSave, onCancel, user: userEvent.setup() };
}
const nameInput = () => screen.getByRole("textbox", { name: "Name" });
const describedText = () => {
  const id = nameInput().getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : null;
};

describe("ForecastScenarioNameDialog", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("trims, refuses empty and taken names", async () => {
    const { onSave, user } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Save as scenario" })).toBeInTheDocument();
    await user.type(nameInput(), "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(describedText()).toBe("Enter a name.");
    await user.clear(nameInput());
    await user.type(nameInput(), " alpha ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(describedText()).toBe("Another scenario already has this name.");
    await user.clear(nameInput());
    await user.type(nameInput(), "  Gamma  {Enter}");
    expect(onSave).toHaveBeenCalledWith("Gamma");
  });

  it("a rename may keep its own name", async () => {
    const { onSave, user } = renderDialog({ exceptId: 1, initialName: "Alpha" });
    expect(nameInput()).toHaveValue("Alpha");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Alpha");
  });

  it("a refused write keeps the dialog open with its reason beside the name", async () => {
    const { onSave, onCancel, user } = renderDialog({ refuse: "Not saved: the scenarios were changed elsewhere." });
    await user.type(nameInput(), "Gamma");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Gamma");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Save as scenario" })).toBeInTheDocument();
    expect(describedText()).toBe("Not saved: the scenarios were changed elsewhere.");
    expect(document.activeElement).toBe(nameInput());
  });

  // Final review Important 1: the field usually already has focus here (autoFocus, then Enter), so moving focus
  // announces nothing: the message itself must be an alert, and a repeated refusal must re-announce it.
  it("a refusal from Enter is an alert the field is described by, and a repeat remounts it", async () => {
    const { user } = renderDialog();
    await user.type(nameInput(), "alpha{Enter}");
    const first = screen.getByRole("alert");
    expect(first).toHaveTextContent("Another scenario already has this name.");
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput().getAttribute("aria-describedby")).toBe(first.id);
    await user.keyboard("{Enter}");
    const second = screen.getByRole("alert");
    expect(second).toHaveTextContent("Another scenario already has this name.");
    expect(second).not.toBe(first);
  });

  it("a refused Save click focuses the field only once it is aria-invalid and described by the alert", async () => {
    const { user } = renderDialog({ refuse: "Not saved: the scenarios were changed elsewhere." });
    await user.type(nameInput(), "Gamma");
    const seen: (string | null | undefined)[][] = [];
    nameInput().addEventListener("focus", () => {
      const err = document.getElementById(nameInput().getAttribute("aria-describedby") ?? "");
      seen.push([nameInput().getAttribute("aria-invalid"), err?.getAttribute("role"), err?.textContent]);
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(seen).toEqual([["true", "alert", "Not saved: the scenarios were changed elsewhere."]]);
  });

  it("shows the frozen scope note", () => {
    renderDialog({ note: "+10% = 6 tasks today" });
    expect(screen.getByText("+10% = 6 tasks today")).toBeInTheDocument();
  });

  it("Escape cancels", async () => {
    const { onSave, onCancel, user } = renderDialog();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses an empty name in German", async () => {
    const { user } = renderDialog({ lang: "de" });
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    const id = input.getAttribute("aria-describedby");
    expect(id ? document.getElementById(id)?.textContent : null).toBe("Geben Sie einen Namen ein.");
  });
});
