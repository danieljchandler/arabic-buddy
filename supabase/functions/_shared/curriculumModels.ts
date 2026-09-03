import { MODEL_IDS } from "./modelRegistry.ts";

/**
 * The models the Curriculum Builder lets an admin pick from.
 *
 * This is the one list both sides read: the `ModelSelector` in the browser
 * renders it, and `curriculum-chat` accepts exactly these ids (plus retired
 * aliases). They used to be two hand-kept lists, and the day they drifted the
 * selector's *default* was an id the function had never heard of, so every new
 * session failed on its first message with "Unknown model".
 *
 * Ids come from the registry so a model bump reaches this tool too. `fanar`
 * and the Gemma id are the two the registry does not own by that name.
 */
export interface CurriculumModelOption {
  id: string;
  name: string;
  provider: string;
  description: string;
  badge?: string;
}

export const CURRICULUM_MODEL_OPTIONS: readonly CurriculumModelOption[] = [
  {
    id: MODEL_IDS.GEMINI_FLASH,
    name: "Gemini 3.7 Flash",
    provider: "Google",
    description: "Pipeline-aligned drafter. Top dialect quality.",
    badge: "Recommended",
  },
  {
    id: MODEL_IDS.CLAUDE,
    name: "Claude Sonnet 5",
    provider: "OpenRouter",
    description: "Pipeline-aligned drafter & judge.",
    badge: "Pipeline",
  },
  {
    id: "fanar",
    name: "Fanar 2 (27B)",
    provider: "Qatar (QCRI)",
    description: "Arabic-native specialist, 32k context.",
    badge: "Arabic Expert",
  },
  {
    id: MODEL_IDS.SABA,
    name: "Mistral Saba",
    provider: "OpenRouter",
    description: "Arabic-focused 24B. Cheap second opinion.",
    badge: "Arabic",
  },
  {
    id: MODEL_IDS.QWEN,
    name: "Qwen 3.8 Max",
    provider: "OpenRouter",
    description: "Third verifier (weighted lower than Gemini/Claude).",
    badge: "Verifier",
  },
  {
    id: MODEL_IDS.GEMINI_PRO,
    name: "Gemini 3.1 Pro",
    provider: "Google",
    description: "Heavy reasoning; the dialect validator's judge.",
  },
  {
    id: "google/gemma-3-12b-it",
    name: "Gemma 3 12B",
    provider: "OpenRouter",
    description: "Good Arabic understanding.",
  },
];

/** What a new session starts on. Must be an id in the list above. */
export const DEFAULT_CURRICULUM_MODEL: string = MODEL_IDS.GEMINI_FLASH;

export const curriculumModelName = (id: string): string =>
  CURRICULUM_MODEL_OPTIONS.find((option) => option.id === id)?.name ?? id;
