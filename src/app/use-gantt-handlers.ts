"use client";
import { useCallback } from "react";
import type React from "react";
import { type Task } from "./types";
import { sanitizeIsoDate } from "./sanitize";

export interface UseGanttHandlersArgs {
  tasksRef: React.RefObject<readonly Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<readonly Task[]>>;
  today: string;
}

export function useGanttHandlers(args: UseGanttHandlersArgs): {
  handleGanttBarUpdate: (edit: {
    taskId: number;
    startDate: string;
    dueDate: string;
  }) => void;
} {
  const { tasksRef, setTasks, today } = args;

  const handleGanttBarUpdate = useCallback(
    (edit: { taskId: number; startDate: string; dueDate: string }) => {
      const start = sanitizeIsoDate(edit.startDate);
      const due = sanitizeIsoDate(edit.dueDate);
      if (!due) return;
      const finalStart = start && start > due ? due : start;
      const stamp = new Date().toISOString();
      const next = tasksRef.current.map((row) =>
        row.id === edit.taskId
          ? {
              ...row,
              startDate: finalStart || undefined,
              dueDate: due,
              lastUpdateDate: today,
              localModifiedAt: stamp,
            }
          : row,
      );
      tasksRef.current = next;
      setTasks(next);
    },
    [tasksRef, setTasks, today],
  );

  return { handleGanttBarUpdate };
}
