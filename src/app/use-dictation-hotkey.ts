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
  const heldTargetRef = useRef<{ release: () => void } | null>(null);
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
      heldTargetRef.current = target;
      target.press();
    };
    const onUp = (e: KeyboardEvent) => {
      if (!heldRef.current) return;
      const c = comboRef.current;
      const mainKey = c ? c.split("+").pop() : undefined;
      const evKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (mainKey && evKey !== mainKey) return;
      heldRef.current = false;
      heldTargetRef.current?.release();
      heldTargetRef.current = null;
    };
    const onBlur = () => {
      if (!heldRef.current) return;
      heldRef.current = false;
      heldTargetRef.current?.release();
      heldTargetRef.current = null;
    };
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isPopout]);
}
