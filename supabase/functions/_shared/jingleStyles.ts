// Music-style descriptors for the flashcard/phrase jingle generators.
//
// Lyria has a strong prior toward generic "Arabic pop", which in practice comes
// out sounding Khaliji (oud + Gulf percussion + Gulf-accented vocals) whatever
// dialect the word came from. A one-line style hint is not enough to move it,
// so each dialect gets concrete instrumentation, rhythm and vocal-accent cues
// plus an explicit exclusion of the styles it must NOT drift into.

export interface JingleStyle {
  /** Positive style description handed to the music model. */
  style: string;
  /** Styles the model must avoid, phrased as a hard constraint. */
  avoid: string;
}

export function getJingleStyle(dialect: string): JingleStyle {
  if (dialect === "Egyptian") {
    return {
      style:
        "Modern Egyptian pop / mahraganat-flavoured shaabi from Cairo: bright accordion and mizmar hooks, " +
        "tabla (darbuka) and riq percussion with a driving Egyptian maqsoum/baladi groove, playful synth stabs, " +
        "hand claps, and cheerful vocals sung in an unmistakably Cairene Egyptian accent (Egyptian ج pronounced as a hard 'g')",
      avoid:
        "Do NOT use Khaliji/Gulf styles (no oud-led khaliji sawt, no Gulf 'samri'/'khaliji' rhythms, no Gulf-accented vocals), " +
        "no Levantine dabke, no Yemeni folk, and no Modern Standard Arabic recitation feel.",
    };
  }
  if (dialect === "Yemeni") {
    return {
      style:
        "Yemeni folk-pop from Sana'a: qanbus/oud plucking, simple hand-drum (mirwas) groove, warm modal melody, " +
        "and vocals sung in a clearly Yemeni accent",
      avoid:
        "Do NOT use Khaliji/Gulf pop or Egyptian shaabi styles, and no Modern Standard Arabic recitation feel.",
    };
  }
  return {
    style:
      "Khaliji/Gulf Arabic pop: oud and qanun lines, Gulf percussion (tabl, mirwas) with a samri-style groove, " +
      "and cheerful vocals sung in a Gulf (Khaleeji) accent",
    avoid:
      "Do NOT use Egyptian shaabi/mahraganat or Yemeni folk styles, and no Modern Standard Arabic recitation feel.",
  };
}

/** One-line descriptor for inline prompt interpolation. */
export function getJingleStyleLine(dialect: string): string {
  const { style, avoid } = getJingleStyle(dialect);
  return `${style}. ${avoid}`;
}
