// The single active dictation target — the focused field a global hotkey drives.
export interface DictationTarget { press: () => void; release: () => void; label: string; }

let active: DictationTarget | null = null;

export function setActiveDictationTarget(t: DictationTarget | null): void { active = t; }
export function getActiveDictationTarget(): DictationTarget | null { return active; }
/** Clear ONLY if `t` is still the active target (avoids a stale blur clearing a newer focus). */
export function clearDictationTargetIf(t: DictationTarget): void { if (active === t) active = null; }
