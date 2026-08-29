/**
 * The things a learner can do, and where each one lives.
 *
 * This is the whole navigation model in one file. Before it, the app spread 44
 * entries across three hub screens (Learn 9, Practice 13, Me 22) and asked the
 * learner to read a list before doing anything. The list is gone: four skills
 * on the chooser, three verbs reachable from everywhere, two doors onto the
 * sequential paths, and the long tail still routable by URL but no longer
 * competing for attention.
 *
 * Skills and verbs are deliberately separate types. The four skills are a
 * closed, permanent set — the classic language quadrant — and each one owns a
 * page because speaking needs a mic and writing needs a keyboard. The verbs are
 * utilities you apply to whatever is in front of you, so they repeat in the
 * dock and on the chooser without confusing anything.
 *
 * Each skill also owns its *activities*, and that list is the fix for a real
 * bug this navigation shipped with. Sending "Read" straight to /reading — one
 * of five reading surfaces — left Souq News, the Reading Library, Stories and
 * Bible Reading with no door but the account page, filed next to the meme
 * analyser under "Tools & content". They still worked; nobody could find them.
 * A skill is a category, so it opens the category, and the thing you reach for
 * most sits first.
 */

import skillListenArt from "@/assets/illustrations/skill-listen.webp";
import skillReadArt from "@/assets/illustrations/skill-read.webp";
import skillSpeakArt from "@/assets/illustrations/skill-speak.webp";
import skillWriteArt from "@/assets/illustrations/skill-write.webp";

export interface Surface {
  id: string;
  /** English label — the app's chrome speaks English; Arabic is the material. */
  label: string;
  /** The skill named in Arabic, set small under the label on the chooser. */
  arabic?: string;
  to: string;
  /** Lucide icon name, resolved at the call site to keep this file data-only. */
  icon: string;
}

/** One thing you can actually go and do, listed under the skill it trains. */
export interface Activity {
  label: string;
  /** One line on what it is. The skill pages are short enough to afford it —
   *  it was twenty-two of these that made the old Me page a page you scan. */
  description: string;
  to: string;
  icon: string;
  /** Entitlement this needs; hidden rather than shown broken without it. */
  requires?: "auth" | "bible";
}

export interface Skill extends Surface {
  arabic: string;
  /** The tile's accent: four steps from charcoal to Desert Red, all inside the
   *  brand ramp. Tints, not hues — the old hubs accented tiles sky-blue, amber
   *  and emerald, colours left over from before the brand guide. Carried here
   *  so the chooser tile and the skill's own header cannot drift apart.
   *
   *  A `hsl(var(--skill-*))` reference rather than a hex, so night majlis can
   *  lighten it (index.css defines both halves). It used to paint the whole
   *  tile; the tile carries `art` now and the tint is the rule beneath it. */
  tint: string;
  /** The painted scene on the chooser tile — same watercolour hand as the
   *  dialect cards and the campfire. Before these, every tile was its flat
   *  `tint` plus a 24px icon, which left roughly 60% of the app's main menu
   *  as bare colour. */
  art: string;
  /** Primary first: the one a learner picking this skill most likely wants. */
  activities: Activity[];
}

/** The four language skills. Order is the one every syllabus uses. */
export const SKILLS: Skill[] = [
  {
    id: "listen",
    label: "Listen",
    arabic: "استماع",
    to: "/skills/listen",
    tint: "hsl(var(--skill-listen))",
    art: skillListenArt,
    icon: "Headphones",
    activities: [
      {
        label: "Listening Practice",
        description: "Dictation drills pitched at your level",
        to: "/listening",
        icon: "Headphones",
      },
      {
        label: "Episodes",
        description: "Graded audio, taken a sentence at a time",
        to: "/listen",
        icon: "AudioLines",
        requires: "auth",
      },
      {
        label: "Video Library",
        description: "Every clip in the app, by dialect and level",
        to: "/discover",
        icon: "Video",
      },
    ],
  },
  {
    id: "read",
    label: "Read",
    arabic: "قراءة",
    to: "/skills/read",
    tint: "hsl(var(--skill-read))",
    art: skillReadArt,
    icon: "BookOpen",
    activities: [
      {
        label: "Reading Practice",
        description: "Passages written for your level — tap any word",
        to: "/reading",
        icon: "BookOpen",
      },
      {
        label: "Reading Library",
        description: "Graded stories to work through at your own pace",
        to: "/reading-library",
        icon: "Library",
      },
      {
        label: "Souq News",
        description: "Headlines retold in dialect",
        to: "/souq-news",
        icon: "Newspaper",
      },
      {
        label: "Interactive Stories",
        description: "Branching stories you steer as you read",
        to: "/stories",
        icon: "BookOpenText",
      },
      {
        label: "Bible Reading",
        description: "Passages side by side with the English",
        to: "/bible",
        icon: "BookMarked",
        requires: "bible",
      },
    ],
  },
  {
    id: "speak",
    label: "Speak",
    arabic: "تحدّث",
    to: "/skills/speak",
    tint: "hsl(var(--skill-speak))",
    art: skillSpeakArt,
    icon: "Mic",
    activities: [
      {
        label: "Pronunciation Practice",
        description: "Say a line, hear exactly what to fix",
        to: "/pronunciation",
        icon: "Mic",
      },
      {
        label: "Conversation Simulator",
        description: "Talk your way through a real situation",
        to: "/conversation",
        icon: "MessagesSquare",
      },
      {
        label: "Native Feedback",
        description: "Send a recording to a native speaker",
        to: "/native-feedback",
        icon: "Headset",
        requires: "auth",
      },
    ],
  },
  {
    id: "write",
    label: "Write",
    arabic: "كتابة",
    to: "/skills/write",
    tint: "hsl(var(--skill-write))",
    art: skillWriteArt,
    icon: "PenLine",
    activities: [
      {
        label: "Writing Practice",
        description: "Write to a prompt and get it corrected",
        to: "/write",
        icon: "PenLine",
      },
      {
        /* Grammar is cross-cutting, but writing is where this app makes you
           produce the structures cold, so this is the skill that wants it. */
        label: "Grammar Drills",
        description: "Targeted drills on the structures you keep missing",
        to: "/grammar",
        icon: "SpellCheck",
      },
    ],
  },
];

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

/** Verbs, not places. They act on whatever the learner is looking at. */
export const VERBS: Surface[] = [
  { id: "upload", label: "Upload", to: "/tutor-upload", icon: "Upload" },
  { id: "ask", label: "Ask", to: "/how-do-i-say", icon: "MessageCircleQuestion" },
  { id: "games", label: "Games", to: "/vocab-games", icon: "Gamepad2" },
];

/**
 * The sequential paths. Where Ingleezy has to announce its curriculum as
 * coming, Hakiya already ships both of these — so the doors open, and each one
 * carries progress, because a path is the one thing on the chooser that has a
 * position to report.
 */
export const PATHS: Surface[] = [
  { id: "alphabet", label: "Alphabet Journey", arabic: "الحروف", to: "/alphabet", icon: "BookA" },
  { id: "curriculum", label: "Curriculum", arabic: "الدروس", to: "/curriculum", icon: "Route" },
];
