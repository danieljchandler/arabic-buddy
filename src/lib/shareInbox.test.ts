import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeShareHandoff,
  setShareHandoff,
  stashSharedPayload,
  takeSharedPayload,
} from "./shareInbox";

/**
 * The share inbox has two halves with different lifetimes: a Cache Storage
 * stash written by the service worker (must survive reloads and the login
 * bounce, must be consumed exactly once) and an in-memory handoff to the
 * destination page (must only be taken by the page it was addressed to).
 *
 * jsdom has no Cache Storage, so a minimal in-memory `caches` stands in. It
 * implements just what the module uses: open / match / put / delete / keys.
 */

class FakeCache {
  private entries = new Map<string, Response>();
  match(path: string) {
    return Promise.resolve(this.entries.get(path)?.clone());
  }
  put(path: string, response: Response) {
    this.entries.set(path, response);
    return Promise.resolve();
  }
  delete(path: string) {
    return Promise.resolve(this.entries.delete(path));
  }
  keys() {
    return Promise.resolve([...this.entries.keys()]);
  }
}

let fakeCaches: Map<string, FakeCache>;

beforeEach(() => {
  fakeCaches = new Map();
  vi.stubGlobal("caches", {
    open: (name: string) => {
      if (!fakeCaches.has(name)) fakeCaches.set(name, new FakeCache());
      return Promise.resolve(fakeCaches.get(name));
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Write an inbox entry the way public/sw.js does. */
async function stashLikeServiceWorker(meta: Record<string, unknown>, files: File[] = []) {
  const cache = fakeCaches.get("hakiya-share-inbox") ?? new FakeCache();
  fakeCaches.set("hakiya-share-inbox", cache);
  await cache.put(
    "/__share-inbox/meta",
    new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }),
  );
  for (let i = 0; i < files.length; i++) {
    await cache.put(`/__share-inbox/file-${i}`, new Response(files[i]));
  }
}

describe("takeSharedPayload", () => {
  it("returns null when nothing was shared", async () => {
    expect(await takeSharedPayload()).toBeNull();
  });

  it("reads text, url and files back and empties the inbox", async () => {
    await stashLikeServiceWorker(
      {
        title: "A clip",
        text: "شوف هذا",
        url: "https://vt.tiktok.com/x/",
        files: [{ index: 0, name: "note.m4a", type: "audio/mp4", size: 3 }],
        receivedAt: Date.now(),
      },
      [new File(["abc"], "note.m4a", { type: "audio/mp4" })],
    );

    const payload = await takeSharedPayload();
    expect(payload).not.toBeNull();
    expect(payload!.text).toBe("شوف هذا");
    expect(payload!.url).toBe("https://vt.tiktok.com/x/");
    expect(payload!.files).toHaveLength(1);
    expect(payload!.files[0].name).toBe("note.m4a");
    expect(payload!.files[0].type).toBe("audio/mp4");

    // Consumed exactly once: a reload of /share must not re-fire the share.
    expect(await takeSharedPayload()).toBeNull();
  });

  it("discards a stale share instead of springing it on a later visit", async () => {
    await stashLikeServiceWorker({
      text: "old news",
      files: [],
      receivedAt: Date.now() - 31 * 60 * 1000,
    });

    expect(await takeSharedPayload()).toBeNull();
  });

  it("survives an environment with no Cache Storage at all", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await takeSharedPayload()).toBeNull();
    await expect(stashSharedPayload({ title: "", text: "hi", url: "" })).resolves.toBeUndefined();
  });
});

describe("stashSharedPayload", () => {
  it("round-trips a text payload through the inbox (the login bounce)", async () => {
    await stashSharedPayload({ title: "", text: "مرحبا", url: "" });

    const payload = await takeSharedPayload();
    expect(payload!.text).toBe("مرحبا");
    expect(payload!.files).toEqual([]);
  });
});

describe("share handoff", () => {
  it("delivers to the matching kind and only once", () => {
    setShareHandoff({ kind: "text", text: "مرحبا" });
    expect(consumeShareHandoff("text")).toEqual({ kind: "text", text: "مرحبا" });
    expect(consumeShareHandoff("text")).toBeNull();
  });

  it("leaves a handoff addressed to a different page untouched", () => {
    setShareHandoff({ kind: "url", url: "https://x.com/a/status/1" });
    // Translate mounts and asks for text; the URL is not for it.
    expect(consumeShareHandoff("text")).toBeNull();
    expect(consumeShareHandoff("url")).toEqual({ kind: "url", url: "https://x.com/a/status/1" });
  });
});
