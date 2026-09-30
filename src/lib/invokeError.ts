/**
 * Turn a failed `supabase.functions.invoke` into what the learner should see.
 *
 * supabase-js reports every non-2xx as a FunctionsHttpError whose `message` is
 * the literal string "Edge Function returned a non-2xx status code" — which a
 * dozen pages were toasting verbatim. The real reason travels in the response
 * body (`{ error, message }`), reachable through `error.context`.
 *
 * What a learner gets of that body:
 *  - 429 daily-cap responses (`error: "daily_limit_reached"`) become the
 *    upgrade toast (via handleCapResponse) and the caller is told to stand
 *    down — the cap is the message. A 429 that is *not* the cap (a vendor's
 *    quota refusal relayed with a `message`) is an ordinary failure and its
 *    message is shown.
 *  - 401 becomes a sign-in prompt.
 *  - A JSON `message` string is shown whatever the status, as long as it
 *    reads as a sentence: functions write that field for humans ("Please
 *    record for at least a second", "The model is out of credit"). During the
 *    2026-09-29 sweep every AI page failed with a 5xx whose message said
 *    exactly what was wrong, and the learner saw "Please try again".
 *  - A JSON `error` string is shown only when it reads as a sentence (has
 *    whitespace, no JSON braces): "model unavailable" is a message,
 *    "auth_required" is a key, and "openrouter … 401: {...}" is an upstream
 *    dump — that last one is what 5xx `error` fields regularly carry.
 *  - A bare non-JSON 4xx body gets the same sentence test; 5xx bare bodies
 *    are never shown.
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

async function textOf(response: Response): Promise<string> {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Short enough to be a message, not a blob. */
function humanLength(text: string): boolean {
  return text.length <= MAX_HUMAN_MESSAGE;
}

/**
 * A sentence has whitespace and no JSON in it. Machine keys
 * ("scene_index_out_of_range") fail the first test; upstream dumps
 * ("openrouter … 401: {...}") fail the second.
 */
function readsAsSentence(text: string): boolean {
  return humanLength(text) && /\s/.test(text) && !/[{}[\]]/.test(text);
}

const CAP_ERROR_KEY = "daily_limit_reached";

export async function describeInvokeFailure(
  error: unknown,
  data?: unknown,
  fallback: string = GENERIC_INVOKE_FAILURE,
): Promise<InvokeFailure> {
  const response = contextOf(error);
  const body = response ? await bodyOf(response) : null;

  // A 429 with a human message that is not the cap (a vendor quota refusal
  // relayed by the function) is a failure like any other, not an upsell.
  const vendorRefusal =
    response?.status === 429 && body !== null && asString(body.error) !== CAP_ERROR_KEY &&
    asString(body.message) !== undefined;

  // Cap hits first: they carry their own toast (with the Upgrade action), and
  // a page that also toasted its own error would show two.
  if (!vendorRefusal && showCapToastIfLimited(error, data)) {
    return { capped: true, message: "Daily free limit reached." };
  }

  if (response) {
    if (response.status === 401) return { capped: false, message: SIGN_IN_MESSAGE };

    if (body) {
      // The same sentence test as `error`: a function writing for a human
      // writes a sentence, and a one-word `message` ("boom", "failed") is a
      // key by another name.
      const message = asString(body.message);
      if (message && readsAsSentence(message)) {
        return { capped: false, message };
      }
      const errorText = asString(body.error);
      if (errorText && readsAsSentence(errorText)) {
        return { capped: false, message: errorText };
      }
    } else if (response.status < 500) {
      // Not JSON: a bare string. 4xx ones are written for humans; a bare 5xx
      // body is a stack trace or a proxy page.
      const text = (await textOf(response)).trim();
      if (text && readsAsSentence(text)) return { capped: false, message: text };
    }
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
