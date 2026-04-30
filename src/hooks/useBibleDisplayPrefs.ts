import { useCallback, useEffect, useState } from "react";
import {
  BibleDisplayPrefs,
  loadBibleDisplayPrefs,
  saveBibleDisplayPrefs,
  subscribeBibleDisplayPrefs,
} from "@/lib/bibleDisplayPrefs";

export function useBibleDisplayPrefs() {
  const [prefs, setPrefs] = useState<BibleDisplayPrefs>(() => loadBibleDisplayPrefs());

  useEffect(() => subscribeBibleDisplayPrefs(() => setPrefs(loadBibleDisplayPrefs())), []);

  const update = useCallback((patch: Partial<BibleDisplayPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveBibleDisplayPrefs(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
