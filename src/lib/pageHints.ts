/**
 * Centralized friendly explanations for major pages and tools.
 * Used by <InfoHint /> next to page headers and section titles.
 */
export const PAGE_HINTS: Record<string, { title: string; body: string; cta?: string }> = {
  review: {
    title: "Review",
    body: "Your daily spaced-repetition session. Rate each card honestly — we'll resurface it at just the right moment so it sticks for good.",
    cta: "Try a quick 5-card warmup.",
  },
  "my-words": {
    title: "My Words",
    body: "Every word you've saved across the app lives here. Filter by dialect, search, or jump straight into a flashcard review.",
  },
  "my-phrases": {
    title: "My Phrases",
    body: "Set phrases and useful expressions you've saved. Practice them in context so they roll off the tongue when you need them.",
  },
  "mywords-review": {
    title: "Flashcard Review",
    body: "Audio plays, image shows — your job is to recall the word. Self-rate to teach the algorithm how well you knew it.",
  },
  discover: {
    title: "Discover",
    body: "Curated native videos with tap-to-translate subtitles. The fastest way to train your ear on real-world Arabic.",
    cta: "Tap any word in the subtitles to save it.",
  },
  transcribe: {
    title: "Transcribe",
    body: "Drop in audio, video, TikTok, or YouTube and get a word-by-word transcript with translations, dialect notes, and tappable vocab.",
  },
  share: {
    title: "Shared with Hikaya",
    body: "Content shared from another app lands here. AI checks what it is — Arabic text, a voice note, a screenshot, a link — and routes it to the right tool automatically.",
  },
  translate: {
    title: "Translate & Save",
    body: "Paste Arabic text and get a sentence-by-sentence breakdown — literal + natural + cultural notes. Tap any word to save it to My Words.",
  },
  quiz: {
    title: "Quiz",
    body: "Quick multiple-choice rounds to test recall. Great as a 2-minute warmup or cooldown between bigger sessions.",
  },
  "reading-practice": {
    title: "Reading Practice",
    body: "Curated short stories at your level. Tap any word for instant meaning, or ask the tutor anything about the passage.",
  },
  pronunciation: {
    title: "Pronunciation Practice",
    body: "Speak a phrase and get instant scoring on accuracy, fluency, and individual sounds. Powered by speech-recognition AI.",
  },
  meme: {
    title: "Meme Analyzer",
    body: "Paste any Arabic meme and we'll break down the text, the joke, and the dialect cues — culture and comprehension in one go.",
  },
  "learn-from-x": {
    title: "Learn from X",
    body: "Drop in an X (Twitter) post URL. We'll extract the Arabic, translate it, and turn the vocabulary into flashcards.",
  },
  "tutor-upload": {
    title: "Tutor Upload",
    body: "Upload a lesson recording with your tutor and we'll auto-cut it into flashcards with audio, translations, and images.",
  },
  conversation: {
    title: "Conversation Simulator",
    body: "Free-form chat with an AI tutor that only speaks your chosen dialect. No judgment — just speaking reps.",
  },
  "souq-news": {
    title: "Souq News",
    body: "Easy-to-read news summaries in your dialect, with a quick comprehension quiz at the end.",
  },
  stories: {
    title: "Interactive Stories",
    body: "Choose-your-own-adventure stories in Arabic. Decisions branch the narrative and reinforce vocab in context.",
  },
  "placement-quiz": {
    title: "Placement Quiz",
    body: "20 adaptive questions that pinpoint your CEFR level so we can tune every lesson to where you actually are.",
  },
  "set-phrases": {
    title: "Set Phrases",
    body: "High-frequency expressions for real-life situations — greetings, ordering, bargaining, and more.",
  },
  "daily-challenge": {
    title: "Daily Challenge",
    body: "A bite-size mixed-skill workout. Keep your streak alive and earn bonus XP — bigger multipliers the longer you go.",
  },
  leaderboard: {
    title: "Leaderboard",
    body: "See how your XP stacks up against other learners this week. Friendly competition = consistent practice.",
  },
  friends: {
    title: "Friends",
    body: "Add learning buddies, share streaks, and cheer each other on. Studying together makes it stick.",
  },
  today: {
    title: "Today",
    body: "Your personalized daily plan. Finish the ring and you've hit your goal — everything else is bonus reps.",
  },
  settings: {
    title: "Settings",
    body: "Tune dialects, display preferences, audio, hints, and more. Everything that shapes your learning experience.",
  },
  "bible-reading": {
    title: "Bible Reading",
    body: "Read scripture in Arabic with verse-by-verse translations and tappable vocabulary.",
  },
  "bible-lessons": {
    title: "Bible Lessons",
    body: "Guided lessons built from biblical passages — great for vocabulary tied to spiritual or classical themes.",
  },
  "grammar-drills": {
    title: "Grammar Drills",
    body: "Targeted exercises on verb forms, agreement, and tricky constructions. Build the scaffolding under your vocab.",
  },
  "listening-practice": {
    title: "Listening Practice",
    body: "Audio-only drills that train your ear. Listen, recall, check — no reading allowed.",
  },
  "vocab-games": {
    title: "Vocab Games",
    body: "Quick playful rounds — matching, speed rounds, and battles. Learning that doesn't feel like studying.",
  },
  "vocab-battles": {
    title: "Vocab Battles",
    body: "Head-to-head vocab duels against other learners or the AI. Fast-paced, points-based, addictive.",
  },
  "dialect-compare": {
    title: "Dialect Compare",
    body: "See how the same word or phrase shifts across Gulf, Egyptian, Yemeni and more. Build dialect intuition.",
  },
  "culture-guide": {
    title: "Culture Guide",
    body: "Customs, etiquette, and context that turn language into real communication. Avoid the awkward moments.",
  },
  "how-do-i-say": {
    title: "How Do I Say...",
    body: "Type anything in English and get the natural way to say it in your chosen dialect — not just a dictionary swap.",
  },
  "my-transcriptions": {
    title: "My Transcriptions",
    body: "Everything you've transcribed, organized and searchable. Jump back into any session anytime.",
  },
  "liked-videos": {
    title: "Liked Videos",
    body: "Your saved Discover videos in one place. Rewatch favorites, mine them for vocab, or share with friends.",
  },
  "learning-analytics": {
    title: "Learning Analytics",
    body: "Charts of your streak, time spent, words learned, and weak spots. See your progress in numbers.",
  },
  pricing: {
    title: "Plans",
    body: "Compare what's included on each plan. Upgrade anytime — your progress is always yours.",
  },
  onboarding: {
    title: "Welcome",
    body: "A 60-second setup so we can personalize your dialect, goals, and pace. Skip anytime.",
  },

  // ─── Pages with no InfoHint of their own ───────────────────────────────────
  // Everything below is here for the Ask AI assistant rather than for a hint
  // bubble. A page that publishes no context of its own falls back to its
  // route's hint (see `buildPagePayload`), so a missing entry means the tutor
  // is answering "what am I looking at?" with nothing but a URL.
  // `src/test/askAiCoverage.test.ts` is what keeps that from happening again.
  choose: {
    title: "What do you want to practise?",
    body: "The chooser: every skill the app trains — listening, speaking, reading, writing, vocabulary and grammar — with the tools that build each one.",
  },
  skill: {
    title: "One skill, end to end",
    body: "Everything in the app that trains a single skill, ordered from the gentlest way in to the most demanding.",
  },
  curriculum: {
    title: "The curriculum",
    body: "The staged path through spoken Arabic: stages, the lessons inside them, and where the learner has got to.",
  },
  learn: {
    title: "Lessons",
    body: "The lesson path — new words and structures introduced a handful at a time, each one built on the last.",
  },
  alphabet: {
    title: "The Arabic alphabet",
    body: "Letters, their shapes in each position, and the sounds English does not have. The reading foundation everything else sits on.",
  },
  bridge: {
    title: "MSA Bridge",
    body: "For learners arriving from Modern Standard Arabic: what changes in the spoken dialect, word by word and structure by structure.",
  },
  mistakes: {
    title: "My Mistakes",
    body: "The errors this learner has actually made, drawn from their reviews, drills and conversations — drilled until they stop happening.",
  },
  monologue: {
    title: "Monologue",
    body: "Speak at length on a prompt and get it back transcribed, scored and corrected.",
  },
  write: {
    title: "Writing Practice",
    body: "Write in the dialect and get it corrected — spelling, word choice, and whether it sounds like something a native would write.",
  },
  clips: {
    title: "Word Clips",
    body: "Short clips of single words and phrases said by native speakers, for training the ear on one thing at a time.",
  },
  "native-feedback": {
    title: "Native Feedback",
    body: "Recordings waiting on a native speaker's judgement, and the corrections that have come back.",
  },
  "saved-chats": {
    title: "Chat History",
    body: "Every Ask AI conversation this learner has had, newest first. Opening one puts it back in the panel to carry on.",
  },
  me: {
    title: "Me",
    body: "The learner's own hub: streak, progress, saved decks, and everything they have collected across the app.",
  },
  profile: {
    title: "Profile",
    body: "The learner's account, dialect, level and goals.",
  },
  terms: {
    title: "Terms of Service",
    body: "The legal terms for using Hikaya. Not a lesson — nothing here is Arabic practice.",
  },
  privacy: {
    title: "Privacy Policy",
    body: "What Hikaya stores, why, and how a learner gets it back or deleted. Not a lesson.",
  },
};
