"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { TaskFormProvider } from "./task-form-context";
import {
  type ChangeItem,
  type Milestone,
  type RaidItem,
  type Resource,
  type Stakeholder,
  type Task,
} from "./types";

/** The workspace slices a test may seed. Every one is optional and defaults to
 *  empty, so existing callers passing `tasks` alone are untouched.
 *  ★ Slices are added here ON DEMAND — this is not meant to grow into a mirror
 *  of `Workspace`. A test needing one the hook under test never reads would be
 *  paying setup cost for nothing. */
export interface TestSeed {
  tasks?: Task[];
  resources?: Resource[];
  raid?: RaidItem[];
  changes?: ChangeItem[];
  milestones?: Milestone[];
  stakeholders?: Stakeholder[];
}

function Seeder({ seed }: { seed: TestSeed }) {
  const { setTasks, setResources, setRaid, setChanges, setMilestones, setStakeholders } =
    useWorkspace();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    // ★ Each guarded on non-empty rather than set unconditionally: an empty
    // write is not a no-op for a provider that starts with its own default,
    // and it would also mint a fresh array identity for every unseeded slice.
    if (seed.tasks?.length) setTasks(seed.tasks);
    if (seed.resources?.length) setResources(seed.resources);
    if (seed.raid?.length) setRaid(seed.raid);
    if (seed.changes?.length) setChanges(seed.changes);
    if (seed.milestones?.length) setMilestones(seed.milestones);
    if (seed.stakeholders?.length) setStakeholders(seed.stakeholders);
    // Seed once on mount; subsequent `seed` prop changes are intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function TestProviders({
  children,
  tasks = [],
  seed,
}: {
  children: ReactNode;
  /** Kept as its own prop — every existing caller passes it positionally by
   *  name, and folding it into `seed` would be a churn-only rename. When both
   *  are given, `seed.tasks` wins. */
  tasks?: Task[];
  seed?: TestSeed;
}) {
  const merged: TestSeed = { tasks, ...seed };
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <Seeder seed={merged} />
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
