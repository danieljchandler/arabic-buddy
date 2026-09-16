/**
 * Shared client for the streaming (SSE) edge functions.
 *
 * The streamed replies bypass supabase-js (`functions.invoke` buffers the whole
 * body), so callers used to hand-roll a fetch + SSE parser each — and both
 * copies sent the anon publishable key instead of the signed-in session token,
 * which made `enforceDailyCap` reject every request with 401. This helper owns
 * the transport once: real session JWT when available, OpenAI-style
 * `choices[0].delta.content` frame parsing, and typed errors that carry the
 * status + JSON body so callers can route 401/402/429 to the right UI.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  readAppFrame,
  type NativeReviewFrame,
} from "../../supabase/functions/_shared/arabicReviewCore";

export class SseChatError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed (${status})`);
    this.name = "SseChatError";
    this.status = status;
    this.body = body;
  }
}

export interface StreamChatArgs {
  functionName: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  /** Called for every token; `accumulated` is the full reply so far. */
  onDelta: (delta: string, accumulated: string) => void;
  /**
   * The answer is finished — fired on the provider's `[DONE]`, which is no
   * longer the same moment as this promise resolving.
   *
   * `assistant-chat` appends a native-speaker review of its own Arabic after
   * that terminator, so the connection outlives the text by up to the review's
   * deadline. A caller that drives a spinner or a disabled composer off "the
   * reply is done" wants this, not the resolved promise, or the composer stays
   * locked for seconds after the last word has landed.
   */
  onContentComplete?: (full: string) => void;
  /** A native-review frame, if the function sent one. */
  onNativeReview?: (review: NativeReviewFrame) => void;
}

/** Stream a chat completion from an edge function; resolves to the full reply. */
export async function streamChat({
  functionName,
  body,
  signal,
  onDelta,
  onContentComplete,
  onNativeReview,
}: StreamChatArgs): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? anonKey}`,
        apikey: anonKey,
      },
      signal,
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok || !resp.body) {
    let parsed: unknown;
    try {
      parsed = await resp.json();
    } catch {
      /* non-JSON error body */
    }
    const message =
      (parsed as { message?: string; error?: string } | undefined)?.message ??
      (parsed as { error?: string } | undefined)?.error;
    throw new SseChatError(resp.status, parsed, message);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let contentComplete = false;

  const finishContent = () => {
    if (contentComplete) return;
    contentComplete = true;
    onContentComplete?.(accumulated);
  };

  // Read until the *server* closes, not until `[DONE]`. The two used to be the
  // same event; they stopped being when the assistant began appending its
  // native review after the provider's terminator, and a loop that broke on
  // `[DONE]` would drop that frame on the floor every time.
  for (;;) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") {
        finishContent();
        continue;
      }
      let frame: { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } } | undefined;
      try {
        frame = JSON.parse(json);
      } catch {
        // A malformed frame. Lines are only parsed once their newline has
        // arrived, so this is never "partial JSON split across chunks" — and
        // re-buffering it (as this used to) jammed the parser: the bad line
        // sat at the head of the buffer forever and every later, valid frame
        // piled up behind it unparsed, silently truncating the reply.
        console.warn("Skipping malformed SSE frame:", json.slice(0, 200));
        continue;
      }
      // Providers report mid-stream failures as an error frame inside a 200
      // response. Surface it — swallowing it returned a truncated (often
      // empty) reply as a successful completion.
      if (frame?.error) {
        throw new SseChatError(200, frame, frame.error.message ?? "The reply was interrupted upstream");
      }
      // App frames ride the same stream under their own key, so a payload of
      // ours can never be mistaken for a provider frame with an odd shape.
      const review = readAppFrame(frame);
      if (review) {
        onNativeReview?.(review);
        continue;
      }
      const delta = frame?.choices?.[0]?.delta?.content;
      // Content after the terminator is not content. The loop reads past
      // `[DONE]` now, and dropping these keeps the old guarantee: whatever a
      // provider emits after saying it is finished never lands in the reply.
      if (delta && !contentComplete) {
        accumulated += delta;
        onDelta(delta, accumulated);
      }
    }
  }

  // A stream that closed without a terminator still finished — the callback is
  // a promise about the content, not about the provider's manners.
  finishContent();
  return accumulated;
}
