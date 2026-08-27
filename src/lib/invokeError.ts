/**
 * Turn a failed `supabase.functions.invoke` into what the learner should see.
 *
 * supabase-js reports every non-2xx as a FunctionsHttpError whose `message` is
 * the literal string "Edge Function returned a non-2xx status code" — which a
 * dozen pages were toasting verbatim. The real reason travels in the response
 * body (`{ error, message }`), reachable through `error.context`.
 *
 * The status decides how much of that body a learner gets:
 *  - 429 daily-cap responses become the upgrade toast (via handleCapResponse)
 *    and the caller is told to stand down — the cap is the message.
 *  - 401 becomes a sign-in prompt.
 *  - Other 4xx bodies are shown: edge functions write those for humans
 *    ("Please record for at least a second", "No speech detected").
 *  - 5xx bodies are NOT shown — many functions put raw upstream internals in
 *    them ("openrouter … 401: {...}") — the caller's fallback speaks instead.
 *
 * Usage:
 *   const { data, error } = await supabase.functions.invoke("grammar-drill", { body });
 *   if (error || !data) {
 *     const failure = await describeInvokeFailure(error, data, "Couldn't build the drill.");
 *     if (!failure.capped) toast.error(failure.message);
 *     return;
 *   }
 */
import { showCapToastIfLimited } from "./handleCapResponse";

export interface InvokeFailure {
  /** The failure was a daily-cap 429; the upgrade toast has already been shown. */
  capped: boolean;
  /** Learner-facing message for everything that is not a cap hit. */
  message: string;
}

const SIGN_IN_MESSAGE = "Please sign in to use this feature.";
export const GENERIC_INVOKE_FAILURE = "Something went wrong. Please try again.";

/** Body messages longer than this are internals, whatever their status code. */
const MAX_HUMAN_MESSAGE = 200;

function contextOf(error: unknown): Response | undefined {
  if (!error || typeof error !== "object") return undefined;
  const context = (error as { context?: unknown }).context;
  if (context && typeof context === "object" && "status" in context) {
    return context as Response;
  }
  return undefined;
}

async function bodyOf(response: Response): Promise<{ error?: unknown; message?: unknown } | null> {
  try {
    return (await response.clone().json()) as { error?: unknown; message?: unknown };
  } catch {
    return null;
  }
}

export async function describeInvokeFailure(
  error: unknown,
  data?: unknown,
  fallback: string = GENERIC_INVOKE_FAILURE,
): Promise<InvokeFailure> {
  // Cap hits first: they carry their own toast (with the Upgrade action), and
  // a page that also toasted its own error would show two.
  if (showCapToastIfLimited(error, data)) {
    return { capped: true, message: "Daily free limit reached." };
  }

  const response = contextOf(error);
  if (response) {
    if (response.status === 401) return { capped: false, message: SIGN_IN_MESSAGE };

    if (response.status < 500) {
      const body = await bodyOf(response);
      const text = [body?.message, body?.error].find(
        (value) => typeof value === "string" && value.trim().length > 0,
      ) as string | undefined;
      // Machine keys ("auth_required") and blobs are internals, not messages.
      if (text && text.length <= MAX_HUMAN_MESSAGE && /\s/.test(text.trim())) {
        return { capped: false, message: text };
      }
    }
    // 5xx: the body regularly carries raw upstream internals. Never show it.
    return { capped: false, message: fallback };
  }

  // No response at all — offline, DNS, aborted. The one case where the
  // Error's own message ("Failed to fetch") says less than a plain sentence.
  return { capped: false, message: fallback };
}

/**
 * The throwable form, for hooks that report failure by throwing: the message
 * is already learner-facing, and `capped` travels with it so the page's catch
 * can stand down instead of stacking a second toast on the upgrade toast.
 */
export class InvokeFailureError extends Error {
  readonly capped: boolean;

  constructor(failure: InvokeFailure) {
    super(failure.message);
    this.name = "InvokeFailureError";
    this.capped = failure.capped;
  }
}

export async function toInvokeFailureError(
  error: unknown,
  data?: unknown,
  fallback?: string,
): Promise<InvokeFailureError> {
  if (error instanceof InvokeFailureError) return error;
  return new InvokeFailureError(await describeInvokeFailure(error, data, fallback));
}

/** True when a caught error is a cap hit whose toast has already been shown. */
export function isCappedError(error: unknown): boolean {
  return error instanceof InvokeFailureError && error.capped;
}
