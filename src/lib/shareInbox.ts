/**
 * Reads content shared into the app (Android share sheet → Web Share Target)
 * and hands it off to the destination feature.
 *
 * Two mechanisms, two lifetimes:
 *
 * 1. The Cache Storage inbox. The service worker receives the share-target
 *    POST and stashes the payload in the `hakiya-share-inbox` cache (names and
 *    entry paths must stay in sync with public/sw.js). It survives reloads and
 *    the login bounce, so a share made while signed out is still there after
 *    authentication. `takeSharedPayload()` consumes it — read once, then gone.
 *
 * 2. The in-memory handoff. Once /share has decided where a payload belongs,
 *    it parks the concrete item (text, URL, or File) here and navigates; the
 *    destination page consumes it on mount. In-memory is deliberate: a File
 *    can't go through sessionStorage or query params, and SPA navigation never
 *    reloads the page. If the user hard-refreshes mid-handoff the destination
 *    simply opens empty, which is the page's normal state.
 */

const SHARE_CACHE = "hakiya-share-inbox";
const META_PATH = "/__share-inbox/meta";
const FILE_PATH_PREFIX = "/__share-inbox/file-";

/** Ignore stashed shares older than this — a forgotten share from last week
 * suddenly auto-translating after an unrelated login would be baffling. */
const MAX_INBOX_AGE_MS = 30 * 60 * 1000;

export interface SharedPayload {
  title: string;
  text: string;
  url: string;
  files: File[];
}

interface InboxMeta {
  title?: string;
  text?: string;
  url?: string;
  files?: Array<{ index: number; name: string; type: string; size: number }>;
  receivedAt?: number;
}

function cachesAvailable(): boolean {
  return typeof caches !== "undefined" && typeof caches.open === "function";
}

async function clearInbox(): Promise<void> {
  if (!cachesAvailable()) return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);
  } catch {
    // Best-effort; a stale entry is filtered by MAX_INBOX_AGE_MS anyway.
  }
}

/**
 * Consume the share-target stash: returns the payload and empties the inbox,
 * or null when nothing (fresh) is waiting.
 */
export async function takeSharedPayload(): Promise<SharedPayload | null> {
  if (!cachesAvailable()) return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaResponse = await cache.match(META_PATH);
    if (!metaResponse) return null;

    const meta = (await metaResponse.json()) as InboxMeta;
    if (meta.receivedAt && Date.now() - meta.receivedAt > MAX_INBOX_AGE_MS) {
      await clearInbox();
      return null;
    }

    const files: File[] = [];
    for (const entry of meta.files ?? []) {
      const fileResponse = await cache.match(`${FILE_PATH_PREFIX}${entry.index}`);
      if (!fileResponse) continue;
      const blob = await fileResponse.blob();
      files.push(new File([blob], entry.name || `shared-${entry.index}`, { type: entry.type || blob.type }));
    }

    await clearInbox();
    return {
      title: typeof meta.title === "string" ? meta.title : "",
      text: typeof meta.text === "string" ? meta.text : "",
      url: typeof meta.url === "string" ? meta.url : "",
      files,
    };
  } catch (err) {
    console.warn("[shareInbox] failed to read inbox:", err);
    return null;
  }
}

/**
 * Park a text/URL payload in the inbox so it survives the /auth bounce.
 * (Files arrive via the service worker and are already persisted there.)
 */
export async function stashSharedPayload(payload: Pick<SharedPayload, "title" | "text" | "url">): Promise<void> {
  if (!cachesAvailable()) return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      META_PATH,
      new Response(
        JSON.stringify({ ...payload, files: [], receivedAt: Date.now() }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
  } catch (err) {
    console.warn("[shareInbox] failed to stash payload:", err);
  }
}

// ── In-memory handoff to destination pages ──────────────────────────────────

export type ShareHandoff =
  | { kind: "text"; text: string }
  | { kind: "url"; url: string }
  | { kind: "file"; file: File };

let pendingHandoff: ShareHandoff | null = null;

export function setShareHandoff(handoff: ShareHandoff): void {
  pendingHandoff = handoff;
}

/**
 * Take the pending handoff if it matches `kind`. Destination pages call this
 * on mount; a non-matching handoff is left in place (it belongs to a
 * different page).
 */
export function consumeShareHandoff<K extends ShareHandoff["kind"]>(
  kind: K,
): Extract<ShareHandoff, { kind: K }> | null {
  if (pendingHandoff?.kind !== kind) return null;
  const taken = pendingHandoff as Extract<ShareHandoff, { kind: K }>;
  pendingHandoff = null;
  return taken;
}
