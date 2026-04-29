// Shared config & persistence for the home page section layout.
// Users can hide/show sections and reorder them from Settings.

export type HomeSectionId =
  | "phrase-of-the-day"
  | "placement-banner"
  | "gamification"
  | "discover"
  | "new-words"
  | "review"
  | "my-words"
  | "tutor-upload"
  | "speaking"
  | "grammar"
  | "games"
  | "comprehension"
  | "bible"
  | "souq-news"
  | "dialect-compare"
  | "meme"
  | "learn-from-x"
  | "how-do-i-say"
  | "culture"
  | "transcribe"
  | "my-transcriptions";

export interface HomeSectionMeta {
  id: HomeSectionId;
  label: string;
  description: string;
  /** Sections that should never be hidden (still reorderable). */
  alwaysOn?: boolean;
}

/** Default order — matches the historical layout. */
export const HOME_SECTIONS: HomeSectionMeta[] = [
  { id: "phrase-of-the-day", label: "Phrase of the Day", description: "Daily dialect phrase" },
  { id: "placement-banner", label: "Placement Quiz Prompt", description: "Shown until quiz completed", alwaysOn: true },
  { id: "gamification", label: "Stats & Goals", description: "XP, streak, weekly goal, achievements, quick links" },
  { id: "discover", label: "Discover Videos", description: "Featured video preview" },
  { id: "new-words", label: "New Words", description: "Curriculum vocabulary entry point" },
  { id: "review", label: "Review", description: "Spaced repetition due cards" },
  { id: "my-words", label: "My Words", description: "Your saved vocabulary" },
  { id: "tutor-upload", label: "Tutor Upload", description: "Extract flashcards from tutor audio" },
  { id: "speaking", label: "Speaking Practice", description: "Pronunciation, conversation & stories" },
  { id: "grammar", label: "Grammar Drills", description: "AI-powered grammar exercises" },
  { id: "games", label: "Vocabulary Games", description: "Match, memory, fill-in-the-blank" },
  { id: "comprehension", label: "Comprehension", description: "Listening & reading practice" },
  { id: "bible", label: "Bible Reading", description: "Scripture (only if access granted)", alwaysOn: true },
  { id: "souq-news", label: "Souq News", description: "Daily dialect news" },
  { id: "dialect-compare", label: "Dialect Compare", description: "Compare words across dialects" },
  { id: "meme", label: "Meme Analyzer", description: "Break down Arabic memes" },
  { id: "learn-from-x", label: "Learn from X Post", description: "Analyze posts from X" },
  { id: "how-do-i-say", label: "How do I say…?", description: "Phrase translator" },
  { id: "culture", label: "Culture Guide", description: "Culturally appropriate advice" },
  { id: "transcribe", label: "Transcribe Audio", description: "Convert audio to text" },
  { id: "my-transcriptions", label: "My Transcriptions", description: "Saved transcripts" },
];

const STORAGE_KEY = "lahja:home-layout:v1";

export interface HomeLayoutState {
  /** Ordered list of section ids. */
  order: HomeSectionId[];
  /** Section ids that the user has explicitly hidden. */
  hidden: HomeSectionId[];
}

const DEFAULT_STATE: HomeLayoutState = {
  order: HOME_SECTIONS.map((s) => s.id),
  hidden: [],
};

export function loadHomeLayout(): HomeLayoutState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<HomeLayoutState>;
    const validIds = new Set(HOME_SECTIONS.map((s) => s.id));
    // Filter unknown ids and append any new sections at the end.
    const cleanOrder = (parsed.order ?? []).filter((id): id is HomeSectionId =>
      validIds.has(id as HomeSectionId),
    );
    const missing = HOME_SECTIONS.map((s) => s.id).filter((id) => !cleanOrder.includes(id));
    const hidden = (parsed.hidden ?? []).filter((id): id is HomeSectionId =>
      validIds.has(id as HomeSectionId),
    );
    return { order: [...cleanOrder, ...missing], hidden };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveHomeLayout(state: HomeLayoutState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("lahja:home-layout-changed"));
  } catch {
    // ignore quota/private-mode errors
  }
}

export function isSectionVisible(id: HomeSectionId, state: HomeLayoutState): boolean {
  const meta = HOME_SECTIONS.find((s) => s.id === id);
  if (meta?.alwaysOn) return true;
  return !state.hidden.includes(id);
}
