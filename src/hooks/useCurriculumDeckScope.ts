import { useCallback, useEffect, useState } from "react";
import {
  loadCurriculumDeckScope,
  saveCurriculumDeckScope,
  subscribeCurriculumDeckScope,
  type CurriculumDeckScope,
} from "@/lib/curriculumDeck";

/**
 * Reactive hook for "which curriculum words belong in my review deck".
 *
 * Read in the state initialiser, like `useLeechPrefs`, because this value is
 * part of `useDueWords`' query key. Settling it in an effect instead meant
 * every mount fired a deck query under the *wrong* key first: the query
 * function doesn't consume TanStack Query's abort signal, so that discarded
 * paginated read ran to completion and cached a `requested` deck for a learner
 * who had asked for `everything`. Twice the table reads, and worse — that
 * cached empty deck is fresh for five minutes, so a later mount would read it
 * before the effect ran and `/review` would forward straight past the
 * curriculum on its `<Navigate>` path.
 */
export function useCurriculumDeckScope() {
  const [scope, setScope] = useState<CurriculumDeckScope>(loadCurriculumDeckScope);

  useEffect(
    () => subscribeCurriculumDeckScope(() => setScope(loadCurriculumDeckScope())),
    [],
  );

  const setScopePersist = useCallback((value: CurriculumDeckScope) => {
    setScope(value);
    saveCurriculumDeckScope(value);
  }, []);

  return { scope, setScope: setScopePersist };
}
