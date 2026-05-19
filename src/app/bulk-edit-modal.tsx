"use client";

import { type Lang } from "./i18n";
import { useTaskForm } from "./task-form-context";

export interface BulkEditModalProps {
  lang: Lang;
  today: string;
  selectedIds: Set<number>;
  selectedJiraCount: number;
  uniqueGroups: string[];
  uniqueLabels: string[];
  onApply: () => void;
  onCancel: () => void;
}

export function BulkEditModal(props: BulkEditModalProps) {
  const { bulkEditOpen } = useTaskForm();
  if (!bulkEditOpen) return null;
  if (props.selectedIds.size === 0) return null;
  // Real JSX arrives in Task 4.
  return null;
}
