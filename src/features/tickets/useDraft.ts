"use client";
// Keeps an unsent draft in the browser (drafts.ts): restores it once after mount, before the first
// paint, then saves every later change. The server HTML is always empty, so the restore cannot
// happen in the initial state without a hydration mismatch.
import { useEffect, useLayoutEffect, useState } from "react";

export function useDraft<T>(load: () => T | null, save: (value: T) => void, apply: (value: T) => void, value: T): void {
  const [restored, setRestored] = useState(false);
  useLayoutEffect(() => {
    const d = load();
    if (d) apply(d);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Until the restore has landed the state is still the empty one: saving it would erase the draft.
  useEffect(() => {
    if (restored) save(value);
  }, [restored, save, value]);
}
