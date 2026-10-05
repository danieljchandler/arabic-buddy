import { useCallback, useEffect, useState } from "react";
import {
  loadCelebrationSongsEnabled,
  saveCelebrationSongsEnabled,
  subscribeCelebrationPrefs,
} from "@/lib/celebrationPrefs";

/** Reactive hook for the "celebration songs" preference. */
export function useCelebrationPrefs() {
  const [enabled, setEnabled] = useState<boolean>(() => loadCelebrationSongsEnabled());

  useEffect(
    () => subscribeCelebrationPrefs(() => setEnabled(loadCelebrationSongsEnabled())),
    [],
  );

  const setEnabledPersist = useCallback((value: boolean) => {
    setEnabled(value);
    saveCelebrationSongsEnabled(value);
  }, []);

  return { enabled, setEnabled: setEnabledPersist };
}
