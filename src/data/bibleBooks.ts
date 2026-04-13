/**
 * Static Bible book metadata.
 *
 * Each entry carries the USFM code (used by the YouVersion API), English name,
 * Arabic name, and the total number of chapters in that book.
 *
 * The list covers the 66-book Protestant canon.
 */

export interface BibleBook {
  usfm: string;
  name: string;
  nameArabic: string;
  chapters: number;
}

export const OLD_TESTAMENT: BibleBook[] = [
  { usfm: "GEN", name: "Genesis", nameArabic: "التكوين", chapters: 50 },
  { usfm: "EXO", name: "Exodus", nameArabic: "الخروج", chapters: 40 },
  { usfm: "LEV", name: "Leviticus", nameArabic: "اللاويين", chapters: 27 },
  { usfm: "NUM", name: "Numbers", nameArabic: "العدد", chapters: 36 },
  { usfm: "DEU", name: "Deuteronomy", nameArabic: "التثنية", chapters: 34 },
  { usfm: "JOS", name: "Joshua", nameArabic: "يشوع", chapters: 24 },
  { usfm: "JDG", name: "Judges", nameArabic: "القضاة", chapters: 21 },
  { usfm: "RUT", name: "Ruth", nameArabic: "راعوث", chapters: 4 },
  { usfm: "1SA", name: "1 Samuel", nameArabic: "صموئيل الأول", chapters: 31 },
  { usfm: "2SA", name: "2 Samuel", nameArabic: "صموئيل الثاني", chapters: 24 },
  { usfm: "1KI", name: "1 Kings", nameArabic: "الملوك الأول", chapters: 22 },
  { usfm: "2KI", name: "2 Kings", nameArabic: "الملوك الثاني", chapters: 25 },
  { usfm: "1CH", name: "1 Chronicles", nameArabic: "أخبار الأيام الأول", chapters: 29 },
  { usfm: "2CH", name: "2 Chronicles", nameArabic: "أخبار الأيام الثاني", chapters: 36 },
  { usfm: "EZR", name: "Ezra", nameArabic: "عزرا", chapters: 10 },
  { usfm: "NEH", name: "Nehemiah", nameArabic: "نحميا", chapters: 13 },
  { usfm: "EST", name: "Esther", nameArabic: "أستير", chapters: 10 },
  { usfm: "JOB", name: "Job", nameArabic: "أيوب", chapters: 42 },
  { usfm: "PSA", name: "Psalms", nameArabic: "المزامير", chapters: 150 },
  { usfm: "PRO", name: "Proverbs", nameArabic: "الأمثال", chapters: 31 },
  { usfm: "ECC", name: "Ecclesiastes", nameArabic: "الجامعة", chapters: 12 },
  { usfm: "SNG", name: "Song of Solomon", nameArabic: "نشيد الأنشاد", chapters: 8 },
  { usfm: "ISA", name: "Isaiah", nameArabic: "إشعياء", chapters: 66 },
  { usfm: "JER", name: "Jeremiah", nameArabic: "إرميا", chapters: 52 },
  { usfm: "LAM", name: "Lamentations", nameArabic: "مراثي إرميا", chapters: 5 },
  { usfm: "EZK", name: "Ezekiel", nameArabic: "حزقيال", chapters: 48 },
  { usfm: "DAN", name: "Daniel", nameArabic: "دانيال", chapters: 12 },
  { usfm: "HOS", name: "Hosea", nameArabic: "هوشع", chapters: 14 },
  { usfm: "JOL", name: "Joel", nameArabic: "يوئيل", chapters: 3 },
  { usfm: "AMO", name: "Amos", nameArabic: "عاموس", chapters: 9 },
  { usfm: "OBA", name: "Obadiah", nameArabic: "عوبديا", chapters: 1 },
  { usfm: "JON", name: "Jonah", nameArabic: "يونان", chapters: 4 },
  { usfm: "MIC", name: "Micah", nameArabic: "ميخا", chapters: 7 },
  { usfm: "NAM", name: "Nahum", nameArabic: "ناحوم", chapters: 3 },
  { usfm: "HAB", name: "Habakkuk", nameArabic: "حبقوق", chapters: 3 },
  { usfm: "ZEP", name: "Zephaniah", nameArabic: "صفنيا", chapters: 3 },
  { usfm: "HAG", name: "Haggai", nameArabic: "حجّي", chapters: 2 },
  { usfm: "ZEC", name: "Zechariah", nameArabic: "زكريا", chapters: 14 },
  { usfm: "MAL", name: "Malachi", nameArabic: "ملاخي", chapters: 4 },
];

export const NEW_TESTAMENT: BibleBook[] = [
  { usfm: "MAT", name: "Matthew", nameArabic: "متّى", chapters: 28 },
  { usfm: "MRK", name: "Mark", nameArabic: "مرقس", chapters: 16 },
  { usfm: "LUK", name: "Luke", nameArabic: "لوقا", chapters: 24 },
  { usfm: "JHN", name: "John", nameArabic: "يوحنّا", chapters: 21 },
  { usfm: "ACT", name: "Acts", nameArabic: "أعمال الرسل", chapters: 28 },
  { usfm: "ROM", name: "Romans", nameArabic: "رومية", chapters: 16 },
  { usfm: "1CO", name: "1 Corinthians", nameArabic: "كورنثوس الأولى", chapters: 16 },
  { usfm: "2CO", name: "2 Corinthians", nameArabic: "كورنثوس الثانية", chapters: 13 },
  { usfm: "GAL", name: "Galatians", nameArabic: "غلاطية", chapters: 6 },
  { usfm: "EPH", name: "Ephesians", nameArabic: "أفسس", chapters: 6 },
  { usfm: "PHP", name: "Philippians", nameArabic: "فيلبي", chapters: 4 },
  { usfm: "COL", name: "Colossians", nameArabic: "كولوسي", chapters: 4 },
  { usfm: "1TH", name: "1 Thessalonians", nameArabic: "تسالونيكي الأولى", chapters: 5 },
  { usfm: "2TH", name: "2 Thessalonians", nameArabic: "تسالونيكي الثانية", chapters: 3 },
  { usfm: "1TI", name: "1 Timothy", nameArabic: "تيموثاوس الأولى", chapters: 6 },
  { usfm: "2TI", name: "2 Timothy", nameArabic: "تيموثاوس الثانية", chapters: 4 },
  { usfm: "TIT", name: "Titus", nameArabic: "تيطس", chapters: 3 },
  { usfm: "PHM", name: "Philemon", nameArabic: "فليمون", chapters: 1 },
  { usfm: "HEB", name: "Hebrews", nameArabic: "العبرانيين", chapters: 13 },
  { usfm: "JAS", name: "James", nameArabic: "يعقوب", chapters: 5 },
  { usfm: "1PE", name: "1 Peter", nameArabic: "بطرس الأولى", chapters: 5 },
  { usfm: "2PE", name: "2 Peter", nameArabic: "بطرس الثانية", chapters: 3 },
  { usfm: "1JN", name: "1 John", nameArabic: "يوحنّا الأولى", chapters: 5 },
  { usfm: "2JN", name: "2 John", nameArabic: "يوحنّا الثانية", chapters: 1 },
  { usfm: "3JN", name: "3 John", nameArabic: "يوحنّا الثالثة", chapters: 1 },
  { usfm: "JUD", name: "Jude", nameArabic: "يهوذا", chapters: 1 },
  { usfm: "REV", name: "Revelation", nameArabic: "رؤيا يوحنّا", chapters: 22 },
];

export const ALL_BOOKS: BibleBook[] = [...OLD_TESTAMENT, ...NEW_TESTAMENT];

/**
 * Bible translations available on bible.com (YouVersion).
 *
 * `id` is the YouVersion numeric version identifier.
 * These are the well-known Arabic translations plus the requested English ESV.
 */
export interface BibleVersion {
  id: number;
  abbreviation: string;
  name: string;
  language: "ar" | "en";
}

export const ARABIC_VERSIONS: BibleVersion[] = [
  { id: 28, abbreviation: "SVD", name: "Smith & Van Dyke (فان دايك)", language: "ar" },
  { id: 86, abbreviation: "KEH", name: "Ketab El Hayat (كتاب الحياة)", language: "ar" },
  { id: 37, abbreviation: "ERV-AR", name: "Easy-to-Read Version (الترجمة العربية المبسّطة)", language: "ar" },
  { id: 167, abbreviation: "NAV", name: "New Arabic Version (الترجمة العربية الجديدة)", language: "ar" },
];

export const ENGLISH_VERSION: BibleVersion = {
  id: 59,
  abbreviation: "ESV",
  name: "English Standard Version",
  language: "en",
};
