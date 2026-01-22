import catImage from "@/assets/animal-cat.png";
import appleImage from "@/assets/food-apple.png";
import sunImage from "@/assets/nature-sun.png";
import redImage from "@/assets/color-red.png";
import chairImage from "@/assets/home-chair.png";
import hammerImage from "@/assets/tool-hammer.png";

export interface VocabularyWord {
  id: string;
  topic: string;
  wordArabic: string;
  wordEnglish: string;
  imageUrl: string;
  audioUrl: string;
}

export interface Topic {
  id: string;
  name: string;
  nameArabic: string;
  icon: string;
  gradient: string;
  words: VocabularyWord[];
}

// Sample data structure - replace image/audio URLs with your uploads
export const topics: Topic[] = [
  {
    id: "colors",
    name: "Colors",
    nameArabic: "ألوان",
    icon: "🎨",
    gradient: "bg-gradient-sunny",
    words: [
      {
        id: "color-red",
        topic: "colors",
        wordArabic: "أحمر",
        wordEnglish: "Red",
        imageUrl: redImage,
        audioUrl: "",
      },
      {
        id: "color-blue",
        topic: "colors",
        wordArabic: "أزرق",
        wordEnglish: "Blue",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "color-yellow",
        topic: "colors",
        wordArabic: "أصفر",
        wordEnglish: "Yellow",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "color-green",
        topic: "colors",
        wordArabic: "أخضر",
        wordEnglish: "Green",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
    ],
  },
  {
    id: "animals",
    name: "Animals",
    nameArabic: "حيوانات",
    icon: "🦁",
    gradient: "bg-gradient-coral",
    words: [
      {
        id: "animal-cat",
        topic: "animals",
        wordArabic: "قطة",
        wordEnglish: "Cat",
        imageUrl: catImage,
        audioUrl: "",
      },
      {
        id: "animal-dog",
        topic: "animals",
        wordArabic: "كلب",
        wordEnglish: "Dog",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "animal-bird",
        topic: "animals",
        wordArabic: "طير",
        wordEnglish: "Bird",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "animal-fish",
        topic: "animals",
        wordArabic: "سمكة",
        wordEnglish: "Fish",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
    ],
  },
  {
    id: "household",
    name: "Home",
    nameArabic: "البيت",
    icon: "🏠",
    gradient: "bg-gradient-mint",
    words: [
      {
        id: "home-chair",
        topic: "household",
        wordArabic: "كرسي",
        wordEnglish: "Chair",
        imageUrl: chairImage,
        audioUrl: "",
      },
      {
        id: "home-table",
        topic: "household",
        wordArabic: "طاولة",
        wordEnglish: "Table",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "home-bed",
        topic: "household",
        wordArabic: "سرير",
        wordEnglish: "Bed",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "home-door",
        topic: "household",
        wordArabic: "باب",
        wordEnglish: "Door",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
    ],
  },
  {
    id: "tools",
    name: "Tools",
    nameArabic: "أدوات",
    icon: "🔧",
    gradient: "bg-gradient-sky",
    words: [
      {
        id: "tool-hammer",
        topic: "tools",
        wordArabic: "مطرقة",
        wordEnglish: "Hammer",
        imageUrl: hammerImage,
        audioUrl: "",
      },
      {
        id: "tool-scissors",
        topic: "tools",
        wordArabic: "مقص",
        wordEnglish: "Scissors",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "tool-pencil",
        topic: "tools",
        wordArabic: "قلم",
        wordEnglish: "Pencil",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "tool-brush",
        topic: "tools",
        wordArabic: "فرشاة",
        wordEnglish: "Brush",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
    ],
  },
  {
    id: "food",
    name: "Food",
    nameArabic: "طعام",
    icon: "🍎",
    gradient: "bg-gradient-pink",
    words: [
      {
        id: "food-apple",
        topic: "food",
        wordArabic: "تفاحة",
        wordEnglish: "Apple",
        imageUrl: appleImage,
        audioUrl: "",
      },
      {
        id: "food-banana",
        topic: "food",
        wordArabic: "موزة",
        wordEnglish: "Banana",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "food-bread",
        topic: "food",
        wordArabic: "خبز",
        wordEnglish: "Bread",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "food-water",
        topic: "food",
        wordArabic: "ماء",
        wordEnglish: "Water",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
    ],
  },
  {
    id: "nature",
    name: "Nature",
    nameArabic: "طبيعة",
    icon: "🌳",
    gradient: "bg-gradient-lavender",
    words: [
      {
        id: "nature-sun",
        topic: "nature",
        wordArabic: "شمس",
        wordEnglish: "Sun",
        imageUrl: sunImage,
        audioUrl: "",
      },
      {
        id: "nature-moon",
        topic: "nature",
        wordArabic: "قمر",
        wordEnglish: "Moon",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "nature-tree",
        topic: "nature",
        wordArabic: "شجرة",
        wordEnglish: "Tree",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
      {
        id: "nature-flower",
        topic: "nature",
        wordArabic: "وردة",
        wordEnglish: "Flower",
        imageUrl: "/placeholder.svg",
        audioUrl: "",
      },
    ],
  },
];

export const getTopicById = (id: string): Topic | undefined => {
  return topics.find((topic) => topic.id === id);
};
