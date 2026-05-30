// Curated topic catalog for Listen. Each category has prompt seeds; users can
// always type their own.

export interface TopicCategory {
  id: string;
  label: string;
  emoji: string;
  topics: string[];
}

export const TOPIC_CATEGORIES: TopicCategory[] = [
  {
    id: "culture",
    label: "Culture & Identity",
    emoji: "🕌",
    topics: [
      "The dying art of pearl diving in the Gulf",
      "Why hospitality means everything in our culture",
      "How weddings have changed in one generation",
      "The story behind a beloved local dish",
      "Why coffee is more than a drink",
    ],
  },
  {
    id: "history",
    label: "History",
    emoji: "📜",
    topics: [
      "How the spice trade shaped our cities",
      "The lost kingdom of Saba",
      "Why old Sanaa looks like nowhere else on earth",
      "The forgotten women rulers of Arabia",
      "How one map changed the Middle East",
    ],
  },
  {
    id: "tech",
    label: "Tech & Future",
    emoji: "🚀",
    topics: [
      "How AI is changing the way we learn languages",
      "Why everyone is suddenly building apps",
      "The dark side of social media addiction",
      "Will robots replace your barista?",
      "How TikTok reshaped Arabic music",
    ],
  },
  {
    id: "psychology",
    label: "Mind & Psychology",
    emoji: "🧠",
    topics: [
      "Why we procrastinate even when it hurts us",
      "The science of habits that actually stick",
      "How to spot a manipulator in conversation",
      "Why nostalgia feels so good",
      "What loneliness really does to your brain",
    ],
  },
  {
    id: "science",
    label: "Science",
    emoji: "🔬",
    topics: [
      "Why the desert holds the secret to better farming",
      "How sleep cleans your brain at night",
      "What a black hole would do to you",
      "The strange biology of camels",
      "Why some people never seem to age",
    ],
  },
  {
    id: "business",
    label: "Business & Money",
    emoji: "💼",
    topics: [
      "How a tea stall became a global brand",
      "Why most startups fail in year two",
      "The hidden economics of a souq",
      "What young entrepreneurs get wrong",
      "How oil changed everything — and what comes next",
    ],
  },
  {
    id: "sports",
    label: "Sports",
    emoji: "⚽",
    topics: [
      "Why football unites a country like nothing else",
      "The science of falconry training",
      "How camel racing went high-tech",
      "What it really takes to climb Everest",
      "The rise of women's sports in the region",
    ],
  },
  {
    id: "food",
    label: "Food & Travel",
    emoji: "🍽️",
    topics: [
      "A perfect day in old Cairo",
      "Why mansaf is more than a meal",
      "The street food capitals of the Arab world",
      "How spices traveled the silk road",
      "Why everyone is moving to Riyadh",
    ],
  },
  {
    id: "ideas",
    label: "Big Ideas",
    emoji: "💡",
    topics: [
      "Does free will really exist?",
      "Why we tell ourselves stories",
      "The hidden power of small daily rituals",
      "Why boredom might be a superpower",
      "What we mean when we say 'home'",
    ],
  },
];
