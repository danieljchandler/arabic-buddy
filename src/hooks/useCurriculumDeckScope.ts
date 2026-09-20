import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_CURRICULUM_DECK_SCOPE,
  loadCurriculumDeckScope,
  saveCurriculumDeckScope,
  subscribeCurriculumDeckScope,
  type CurriculumDeckScope,
} from "@/lib/curriculumDeck";

/**
 * Reactive hook for "which curriculum words belong in my review deck".
 *
 * Reads the default on first render rather than the stored value, then settles
 * in an effect: the review deck is built from this, and a first paint that
 * disagreed with localStorage would build a deck and immediately rebuild it.
 */
export function useCurriculumDeckScope() {
  const [scope, setScope] = useState<CurriculumDeckScope>(DEFAULT_CURRICULUM_DECK_SCOPE);

  useEffect(() => {
    setScope(loadCurriculumDeckScope());
    return subscribeCurriculumDeckScope(() => setScope(loadCurriculumDeckScope()));
  }, []);

  const setScopePersist = useCallback((value: CurriculumDeckScope) => {
    setScope(value);
    saveCurriculumDeckScope(value);
  }, []);

  return { scope, setScope: setScopePersist };
}
