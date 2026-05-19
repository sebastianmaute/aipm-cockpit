import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  TaskFormProvider,
  useTaskForm,
  emptyForm,
  emptyBulkEdit,
} from "./task-form-context";

function wrapper({ children }: { children: ReactNode }) {
  return <TaskFormProvider>{children}</TaskFormProvider>;
}

describe("TaskFormProvider", () => {
  test("exposes the documented defaults", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });
    expect(result.current.form).toEqual(emptyForm());
    expect(result.current.bulkEdit).toEqual(emptyBulkEdit());
    expect(result.current.editingId).toBeNull();
    expect(result.current.taskModalOpen).toBe(false);
    expect(result.current.bulkEditOpen).toBe(false);
  });
});
