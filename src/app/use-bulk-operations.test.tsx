// src/app/use-bulk-operations.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import { defaultSettings } from "./settings-menu";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { TaskFormProvider } from "./task-form-context";
import {
  useBulkOperations,
  type UseBulkOperationsArgs,
} from "./use-bulk-operations";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function makeArgs(
  overrides?: Partial<UseBulkOperationsArgs>,
): UseBulkOperationsArgs {
  return {
    lang: "en-US" as Lang,
    settings: defaultSettings,
    setSettings: vi.fn(),
    handlers: {
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSendInquiry: vi.fn(),
    },
    onCancelEdit: vi.fn(),
    logActivity: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

function renderBulk(overrides?: Partial<UseBulkOperationsArgs>) {
  const args = makeArgs(overrides);
  const { result } = renderHook(
    () => ({
      bulk: useBulkOperations(args),
      workspace: useWorkspace(),
    }),
    { wrapper: Wrapper },
  );
  return { result, args };
}

describe("useBulkOperations", () => {
  describe("initial state", () => {
    it("selectedIds is empty initially", () => {
      const { result } = renderBulk();
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });

    it("allVisibleSelected is false initially", () => {
      const { result } = renderBulk();
      expect(result.current.bulk.allVisibleSelected).toBe(false);
    });
  });
});
