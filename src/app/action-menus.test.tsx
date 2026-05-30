import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ActionMenus } from "./action-menus";
import { t } from "./i18n";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("ActionMenus", () => {
  it("renders the Export, Help, and Version menu triggers", () => {
    render(
      <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} />,
      { wrapper: Wrapper },
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "exportTitle") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "help") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "version") }),
    ).toBeInTheDocument();
  });
});
