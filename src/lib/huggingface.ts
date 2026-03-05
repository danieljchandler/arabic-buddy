import OpenAI from "openai";

const BASE_URL = "https://router.huggingface.co/v1";

const MODEL_MAP = {
  standard: "tiiuae/Falcon-H1-7B-Instruct:cheapest",
  premium: "inceptionai/Jais-2-8B-Chat:cheapest",
} as const;

const DEFAULT_SYSTEM_PROMPT =
  "You are an expert Gulf Arabic of all varieties language tutor. Respond accurately using the specific dialect requested, focusing on authenticity and cultural nuance.";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function getClient(): OpenAI {
  const apiKey = import.meta.env.VITE_HF_TOKEN;
  if (!apiKey) {
    throw new Error(
      "VITE_HF_TOKEN is not set. Please add it to your environment variables.",
    );
  }
  return new OpenAI({ baseURL: BASE_URL, apiKey, dangerouslyAllowBrowser: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getDialectResponse(
  prompt: string,
  modelTier: "standard" | "premium",
): Promise<string> {
  const client = getClient();
  const model = MODEL_MAP[modelTier];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: DEFAULT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      });

      const content = response.choices?.[0]?.message?.content;
      if (content) return content;

      throw new Error("Empty response from model");
    } catch (err: unknown) {
      const status =
        err instanceof Error && "status" in err
          ? (err as { status: number }).status
          : undefined;
      const isRetryable =
        err instanceof Error &&
        (/503|529|busy|overloaded|rate/i.test(err.message) ||
          status === 503 ||
          status === 529 ||
          status === 429);

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[huggingface] Attempt ${attempt + 1} failed, retrying in ${backoff}ms…`,
        );
        await delay(backoff);
        continue;
      }

      console.error("[huggingface] Request failed:", err);
      return "عذرًا، الخدمة مشغولة حاليًا. يرجى المحاولة مرة أخرى بعد قليل. (Sorry, the service is temporarily busy. Please try again shortly.)";
    }
  }

  return "عذرًا، الخدمة مشغولة حاليًا. يرجى المحاولة مرة أخرى بعد قليل. (Sorry, the service is temporarily busy. Please try again shortly.)";
}
