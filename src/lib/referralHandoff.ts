/**
 * Carries a friend's referral code from the share link to the redeem box.
 *
 * `ReferralCard` shares `https://hakiya.app/?ref=<CODE>`. A friend who taps it
 * lands signed out, signs up, gets bounced through onboarding and only then
 * reaches the profile page where the code can be entered — by which time the
 * query string is long gone. So the app stashes the code in localStorage on
 * first load (`captureReferralFromUrl`, called once from `App`), strips it
 * from the address bar, and the card picks it up whenever it next mounts.
 *
 * Storage is best-effort throughout: a blocked or full localStorage means the
 * friend types the code by hand, exactly as before this module existed. Nothing
 * here may throw.
 *
 * The code format mirrors `supabase/functions/referral/index.ts`: eight
 * characters from an alphabet with no 0/O/1/I. Anything else in `?ref=` is
 * dropped rather than stashed, so a mangled link cannot park junk that the
 * card would then submit and get a "That code doesn't exist" for.
 */

export const REFERRAL_STORAGE_KEY = "hakiya_referral_code";
export const REFERRAL_QUERY_PARAM = "ref";

/** Same alphabet and length as the edge function's `generateCode()`. */
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/** Trim + uppercase, the same normalisation the edge function applies on redeem. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** The referral code carried by a search string (`?ref=...`), or null. */
export function referralCodeFromSearch(search: string): string | null {
  try {
    return normalizeReferralCode(new URLSearchParams(search).get(REFERRAL_QUERY_PARAM));
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    // Some browsers throw on the accessor itself when site data is blocked.
    return null;
  }
}

export function stashReferralCode(code: string): void {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return;
  try {
    storage()?.setItem(REFERRAL_STORAGE_KEY, normalized);
  } catch {
    // Quota or privacy mode — the learner can still type the code.
  }
}

/** The stashed code, left in place. */
export function peekReferralCode(): string | null {
  try {
    return normalizeReferralCode(storage()?.getItem(REFERRAL_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** The stashed code, removed — call once it has been redeemed or is useless. */
export function consumeReferralCode(): string | null {
  const code = peekReferralCode();
  try {
    storage()?.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Nothing to do; a stale stash is harmless and overwritten by the next link.
  }
  return code;
}

/** `search` with the `ref` param removed, ready for `history.replaceState`. */
export function stripReferralParam(search: string): string {
  try {
    const params = new URLSearchParams(search);
    params.delete(REFERRAL_QUERY_PARAM);
    const rest = params.toString();
    return rest ? `?${rest}` : "";
  } catch {
    return search;
  }
}

/**
 * On app load: stash `?ref=` if present and drop it from the URL without a
 * reload, so the code survives the sign-up redirect and the address bar
 * doesn't keep re-offering it. Returns the code it captured, or null.
 */
export function captureReferralFromUrl(
  win: Pick<Window, "location" | "history"> | undefined = typeof window !== "undefined"
    ? window
    : undefined,
): string | null {
  if (!win) return null;
  try {
    const code = referralCodeFromSearch(win.location.search);
    if (!code) return null;
    stashReferralCode(code);
    const cleaned =
      win.location.pathname + stripReferralParam(win.location.search) + win.location.hash;
    win.history.replaceState(win.history.state, "", cleaned);
    return code;
  } catch {
    return null;
  }
}
