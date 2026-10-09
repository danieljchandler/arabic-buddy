import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  assetKey,
  getAsset,
  type AssetKeyInput,
  type WordAsset,
  type WordAssetClient,
} from "../../supabase/functions/_shared/wordAssets";

/**
 * The shared asset made for a word — its picture, recording or jingle — if
 * anyone has made one yet.
 *
 * Read-only, and straight from the table: `word_assets` is public-read, and
 * the key is folded here by the same module the edge functions file under
 * (`_shared/wordAssets.ts`), so the browser and the generators cannot disagree
 * on what "the same word" means. Making a missing asset is a generation with a
 * cost, so it is not this hook's to start; `word-asset`'s `ensure` is for the
 * generators.
 *
 * Everything that is not an asset reads as none: a word the store cannot file
 * (no Arabic in it, Fusha) asks nothing at all, and a failed read — the table
 * not yet applied to the live project above all — is a miss, so a card asking
 * for a picture shows what it showed before the store existed.
 */
export function useWordAsset(input: AssetKeyInput | null): {
  asset: WordAsset | null;
  url: string | null;
  isLoading: boolean;
} {
  const key = input ? assetKey(input) : null;

  const { data, isLoading } = useQuery({
    queryKey: ["word-asset", key?.kind, key?.dialect, key?.conceptKey, key?.styleVersion],
    enabled: key !== null,
    // A filed asset never changes; only a new style version replaces it, and
    // that is a different key. A miss is not cached, so a picture filed a
    // moment later (by this learner's own `ensure`) is seen on the next look.
    staleTime: (query) => (query.state.data ? 60 * 60 * 1000 : 0),
    // `word_assets` is not in the generated types until its migration is
    // applied, hence the structural client.
    queryFn: () => getAsset(supabase as unknown as WordAssetClient, key!),
  });

  const asset = data ?? null;
  return { asset, url: asset?.url ?? null, isLoading: key !== null && isLoading };
}
