// src/app/use-modal-visibility.ts
import { useCallback, useMemo } from "react";
import { useWorkspace } from "./workspace-context";
import type { FieldTier, ModalId } from "./modal-fields";
import {
  applyTier, tierOf, toggleField as toggleFieldPure, visibleFields,
  type FieldVisibilityConfig, type ModalVisibility,
} from "./field-visibility";

export interface ModalVisibilityApi {
  mode: FieldTier | "custom";
  isVisible: (fieldId: string) => boolean;
  setMode: (tier: FieldTier) => void;
  toggleField: (fieldId: string) => void;
  reset: () => void;
}

const DEFAULT_TIER: FieldTier = "advanced";

export function useModalVisibility(modalId: ModalId): ModalVisibilityApi {
  const { fieldVisibility, setFieldVisibility } = useWorkspace();
  const cfg: ModalVisibility | undefined = fieldVisibility?.[modalId];

  const visible = useMemo(() => visibleFields(modalId, cfg), [modalId, cfg]);
  const mode = useMemo(() => tierOf(modalId, cfg), [modalId, cfg]);

  const write = useCallback(
    (next: ModalVisibility | undefined) => {
      setFieldVisibility((prev: FieldVisibilityConfig | undefined) => {
        const base = { ...(prev ?? {}) };
        if (next === undefined) delete base[modalId];
        else base[modalId] = next;
        return Object.keys(base).length > 0 ? base : undefined;
      });
    },
    [modalId, setFieldVisibility],
  );

  const setMode = useCallback((tier: FieldTier) => write(applyTier(modalId, tier)), [modalId, write]);
  const toggle = useCallback(
    (fieldId: string) => write(toggleFieldPure(modalId, cfg ?? applyTier(modalId, DEFAULT_TIER), fieldId)),
    [modalId, cfg, write],
  );
  const reset = useCallback(() => write(undefined), [write]);

  const isVisible = useCallback((fieldId: string) => visible.has(fieldId), [visible]);

  return { mode, isVisible, setMode, toggleField: toggle, reset };
}
