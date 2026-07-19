"use client";

// Shared draft+error state for entity edit modals whose local `draft` mirrors
// a nullable entity prop (absence / milestone / resource). Every adopter
// repeated the identical trio verbatim:
//
//   const [draft, setDraft] = useState<T | null>(initial);
//   const [error, setError] = useState<string | null>(null);
//   function update<K extends keyof T>(key, value) {
//     setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
//     setError(null);
//   }
//
// `update` immutably patches one field and clears any pending validation error
// (the field-edit behavior every adopter had). `setDraft`/`setError` are
// exposed so each modal's own render-time reconcile (reset the draft when the
// prop identity changes) and multi-field setters keep working unchanged.

import { useState, type Dispatch, type SetStateAction } from "react";

export interface DraftState<T> {
  draft: T | null;
  setDraft: Dispatch<SetStateAction<T | null>>;
  update: <K extends keyof T>(key: K, value: T[K]) => void;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useDraftState<T extends object>(initial: T | null): DraftState<T> {
  const [draft, setDraft] = useState<T | null>(initial);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof T>(key: K, value: T[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setError(null);
  }

  return { draft, setDraft, update, error, setError };
}
