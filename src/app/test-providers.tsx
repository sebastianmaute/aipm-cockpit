"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { TaskFormProvider } from "./task-form-context";
import { type Task } from "./types";

function Seeder({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (tasks.length > 0) setTasks(tasks);
  }, [tasks, setTasks]);
  return null;
}

export function TestProviders({
  children,
  tasks = [],
}: {
  children: ReactNode;
  tasks?: Task[];
}) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <Seeder tasks={tasks} />
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
