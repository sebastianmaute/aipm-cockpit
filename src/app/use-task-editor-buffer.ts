// src/app/use-task-editor-buffer.ts
// Shared create-mode editor buffer: stages RAID items + task links while a task
// has no id yet, then flushes them once the parent id is resolved (Tasks 7 + 8).
"use client";
import { useCallback, useRef, useState } from "react";
import type { RaidCategory } from "./types";

export interface RaidSpec {
  category: RaidCategory | string;
  title: string;
}

export interface LinkSpec {
  childId: number;
  direction: "predecessor" | "successor";
  type: string;
}

interface Deps {
  applyRaid: (parentId: number, spec: RaidSpec) => void;
  applyLink: (parentId: number, spec: LinkSpec) => void;
}

export interface TaskEditorBuffer {
  pendingRaid: readonly RaidSpec[];
  pendingLinks: readonly LinkSpec[];
  stageRaid: (spec: RaidSpec) => void;
  stageLink: (spec: LinkSpec) => void;
  discard: () => void;
  flush: (parentId: number) => void;
}

/**
 * Buffer create-mode staged RAID + links. `flush(parentId)` applies each staged
 * item once the parent id exists, then clears; `discard()` clears without
 * applying.
 *
 * Strict-mode-safe: the current buffer arrays are read from a `useRef` inside
 * `flush`/`discard` (mirrors the `stackRef` pattern in `undo/use-undo-stack.ts`),
 * so the impure apply side-effects run OUTSIDE any state updater — a React
 * strict-mode double-invoke of a state updater can never apply them twice.
 */
export function useTaskEditorBuffer({ applyRaid, applyLink }: Deps): TaskEditorBuffer {
  const [pendingRaid, setPendingRaid] = useState<readonly RaidSpec[]>([]);
  const [pendingLinks, setPendingLinks] = useState<readonly LinkSpec[]>([]);
  const raidRef = useRef<readonly RaidSpec[]>(pendingRaid);
  const linkRef = useRef<readonly LinkSpec[]>(pendingLinks);

  const stageRaid = useCallback((spec: RaidSpec) => {
    const next = [...raidRef.current, spec];
    raidRef.current = next;
    setPendingRaid(next);
  }, []);

  const stageLink = useCallback((spec: LinkSpec) => {
    const next = [...linkRef.current, spec];
    linkRef.current = next;
    setPendingLinks(next);
  }, []);

  const discard = useCallback(() => {
    raidRef.current = [];
    linkRef.current = [];
    setPendingRaid([]);
    setPendingLinks([]);
  }, []);

  const flush = useCallback((parentId: number) => {
    const raid = raidRef.current;
    const links = linkRef.current;
    raidRef.current = [];
    linkRef.current = [];
    raid.forEach((spec) => applyRaid(parentId, spec));
    links.forEach((spec) => applyLink(parentId, spec));
    setPendingRaid([]);
    setPendingLinks([]);
  }, [applyRaid, applyLink]);

  return { pendingRaid, pendingLinks, stageRaid, stageLink, discard, flush };
}
