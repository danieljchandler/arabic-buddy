/**
 * Browser behaviour a containerised Chromium does not provide.
 *
 * Deliberately small. Media capture is handled by Chromium's own
 * `--use-fake-device-for-media-stream` flag (see playwright.config.ts) rather
 * than by stand-ins here: that yields a real `MediaStream` with real
 * `MediaStreamTrack`s, and the difference is not cosmetic — a hand-written
 * stand-in is rejected outright by `RTCPeerConnection.addTrack`, which is how
 * the conversation simulator's live-voice panel starts a session. Faking as
 * little as possible is what keeps these tests about the app.
 *
 * Injected via `page.addInitScript`, which serialises the function into the
 * page, so it cannot reference anything outside its own body.
 */
export function installBrowserFakes(): void {
  // The container's Chromium has no clipboard permission, so every copy button
  // throws a NotAllowedError that has nothing to do with the app.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => undefined,
      readText: async () => "",
      write: async () => undefined,
      read: async () => [],
    },
  });

  // Headless Chromium ships no speech voices, and the alphabet and pronunciation
  // pages call speak() on mount.
  const synthesis = window.speechSynthesis as SpeechSynthesis | undefined;
  if (synthesis) {
    synthesis.speak = () => undefined;
    synthesis.cancel = () => undefined;
  }
}
