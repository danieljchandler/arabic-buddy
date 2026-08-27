// Central registry of premium features and the minimum tier required.
// Keep this list in sync with marketing copy on the Pricing page.
//
// Tiers (ascending): 'free' < 'standard' < 'allin'
// A feature requiring 'standard' is unlocked for both Standard and All-In subscribers.
// A feature requiring 'allin' is unlocked only for All-In subscribers.
//
// What a paid tier actually buys is enforced server-side: the removal of the
// per-feature daily caps in supabase/functions/_shared/usageCap.ts, a larger
// monthly voice budget (voiceBudgetCore.ts), and higher allowances on image
// and jingle generation. The features below are the client-side names for the
// gates that exist — this file used to also promise vocabulary caps and
// Discover content tiers that no code enforced, and the pricing page repeated
// them.

export type FeatureTier = 'free' | 'standard' | 'allin';

export type PremiumFeature =
  // Standard tier — the AI tools whose daily free caps a subscription lifts.
  | 'transcribe'
  | 'meme_analyzer'
  | 'how_do_i_say'
  | 'learn_from_x'
  // Enforced today: realtime-session-token refuses the live voice assistant
  // without an active subscription, and meters minutes by tier.
  | 'live_voice'
  // All-In tier
  | 'early_access';

export const FEATURE_REQUIREMENTS: Record<PremiumFeature, Exclude<FeatureTier, 'free'>> = {
  transcribe: 'standard',
  meme_analyzer: 'standard',
  how_do_i_say: 'standard',
  learn_from_x: 'standard',
  live_voice: 'standard',
  early_access: 'allin',
};

export function featureLabel(feature: PremiumFeature): string {
  switch (feature) {
    case 'transcribe': return 'Transcribe tool';
    case 'meme_analyzer': return 'Meme Analyzer';
    case 'how_do_i_say': return 'How Do I Say';
    case 'learn_from_x': return 'Learn from X posts';
    case 'live_voice': return 'Live voice conversations';
    case 'early_access': return 'Early access features';
  }
}
