/**
 * Whether a video still will still be there tomorrow.
 *
 * TikTok's oEmbed does not hand back a plain image address. It hands back a
 * *signed* one:
 *
 *   https://p16-common-sign.tiktokcdn-us.com/tos-maliva-p-0068/2367c7d4~tplv-tiktokx-origin.image
 *     ?dr=9636&x-expires=1788613200&x-signature=ci9fkBhPJk6V5lwZMykET4c7mA0%3D&...
 *
 * `x-expires` is roughly forty-eight hours out. Store that URL on the row and
 * the video has a picture for two days and a broken image forever after —
 * which is exactly what "the thumbnails keep dropping out, I have to fetch
 * them again" is. Re-fetching mints another two-day URL, so the fix looked
 * like it worked, twice a week, for ever.
 *
 * YouTube rows never had the problem: `getThumbnailCandidates` re-derives
 * `i.ytimg.com/vi/<id>/…` from the video id at render time, so nothing stored
 * on the row has to survive. TikTok and Instagram stills cannot be derived
 * from anything, so the only durable answer is to keep our own copy — and to
 * do that, we first have to be able to tell a URL that expires from one that
 * does not. That is all this module is.
 *
 * Deliberately dependency-free: imported verbatim by the browser (the admin
 * video pages) and by Deno (`thumbnailMirror.ts` and the functions that copy
 * a still into our own storage), so the two can never disagree about which
 * URLs are ephemeral.
 */

/** Query parameters that carry an absolute expiry as decimal epoch seconds. */
const DECIMAL_EXPIRY_PARAMS = new Set(["x-expires", "expires"]);

/**
 * Meta's CDNs spell the same thing as lowercase hex (`oe=68B4C1D0`). Only
 * honoured on their own hosts: eight hex digits is a common enough shape that
 * reading it as an expiry anywhere would misjudge unrelated URLs.
 */
const HEX_EXPIRY_PARAMS = new Set(["oe"]);
const HEX_EXPIRY_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

/** Epoch milliseconds outside this range are something other than an expiry. */
const PLAUSIBLE_FROM = Date.UTC(2000, 0, 1);
const PLAUSIBLE_UNTIL = Date.UTC(2100, 0, 1);

/** Above this, the number is already milliseconds rather than seconds. */
const MILLISECONDS_THRESHOLD = 1e11;

/**
 * When the still behind this URL stops being served, or null when the URL
 * makes no such promise (and so is presumed permanent).
 */
export function thumbnailExpiresAt(url: string | null | undefined): number | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  for (const [rawName, value] of parsed.searchParams) {
    const name = rawName.toLowerCase();

    let seconds: number | null = null;
    if (DECIMAL_EXPIRY_PARAMS.has(name) && /^\d+$/.test(value)) {
      seconds = Number(value);
    } else if (
      HEX_EXPIRY_PARAMS.has(name) &&
      /^[0-9a-f]{8}$/i.test(value) &&
      HEX_EXPIRY_HOSTS.test(parsed.hostname)
    ) {
      seconds = parseInt(value, 16);
    }
    if (seconds === null) continue;

    const ms = seconds > MILLISECONDS_THRESHOLD ? seconds : seconds * 1000;
    if (ms >= PLAUSIBLE_FROM && ms <= PLAUSIBLE_UNTIL) return ms;
  }

  return null;
}

/**
 * True for a still that is on loan: it works now and will stop working, so it
 * must be copied rather than stored.
 */
export function isEphemeralThumbnailUrl(url: string | null | undefined): boolean {
  return thumbnailExpiresAt(url) !== null;
}

/** True once the loan is up — the row shows a broken image from here on. */
export function isExpiredThumbnailUrl(
  url: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const expiresAt = thumbnailExpiresAt(url);
  return expiresAt !== null && expiresAt <= now;
}

/** True for a still already sitting in our own Supabase storage. */
export function isMirroredThumbnailUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes("/storage/v1/object/public/");
}
