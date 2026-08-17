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
 * full page because speaking needs a mic and writing needs a keyboard. The
 * verbs are utilities you apply to whatever is in front of you, so they repeat
 * in the dock and on the chooser without confusing anything.
 */

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

/** The four language skills. Order is the one every syllabus uses. */
export const SKILLS: Surface[] = [
  { id: "listen", label: "Listen", arabic: "استماع", to: "/listen", icon: "Headphones" },
  { id: "read", label: "Read", arabic: "قراءة", to: "/reading", icon: "BookOpen" },
  { id: "speak", label: "Speak", arabic: "تحدّث", to: "/pronunciation", icon: "Mic" },
  { id: "write", label: "Write", arabic: "كتابة", to: "/write", icon: "PenLine" },
];

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
