import { useEffect, useRef } from "react";
import { matchesHotkey } from "./dictation-hotkey";
import { getActiveDictationTarget } from "./dictation-target";

/** Global hold-to-talk: while the configured combo is held, drive the focused
 *  field's mic (press on keydown, release on keyup). No active target → the key
 *  passes through untouched. Disabled in popouts. */
export function useDictationHotkey(combo: string | undefined, isPopout: boolean): void {
  const comboRef = useRef(combo);
  useEffect(() => {
    comboRef.current = combo;
  }, [combo]);
  const heldRef = useRef(false);
  useEffect(() => {
    if (isPopout) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || heldRef.current) return;
      const c = comboRef.current;
      if (!c || !matchesHotkey(e, c)) return;
      const target = getActiveDictationTarget();
      if (!target) return;
      e.preventDefault();
      heldRef.current = true;
      target.press();
    };
    const onUp = (e: KeyboardEvent) => {
      if (!heldRef.current) return;
      void e;
      heldRef.current = false;
      getActiveDictationTarget()?.release();
    };
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
    };
  }, [isPopout]);
}
