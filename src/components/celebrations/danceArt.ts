import ardahRow1 from "@/assets/celebrations/ardah/row-1.webp";
import ardahRow2 from "@/assets/celebrations/ardah/row-2.webp";
import ardahRow3 from "@/assets/celebrations/ardah/row-3.webp";
import ardahDrummer1 from "@/assets/celebrations/ardah/drummer-1.webp";
import ardahDrummer2 from "@/assets/celebrations/ardah/drummer-2.webp";
import ayyalaRow1 from "@/assets/celebrations/ayyala/row-1.webp";
import ayyalaRow2 from "@/assets/celebrations/ayyala/row-2.webp";
import ayyalaRow3 from "@/assets/celebrations/ayyala/row-3.webp";
import ayyalaRow4 from "@/assets/celebrations/ayyala/row-4.webp";
import ayyalaDrummer1 from "@/assets/celebrations/ayyala/drummer-1.webp";

/**
 * The cutout stills for each dance, in the order `DanceDefinition.sequence`
 * indexes them. Generated performers, posed from written descriptions of the
 * reference keyframes, cut out and finished in grayscale with a rough paper
 * edge. docs/celebrations.md says how a set is made.
 */

/** Where a figure stands on the stage, as percentages of the stage. */
export interface StageBox {
  left: number;
  width: number;
  height: number;
}

export interface DanceArt {
  /** The dancers, one still per pose. Every still shares one crop and scale. */
  dancers: readonly string[];
  /** The musician, one still per stroke. Empty for a dance shown without one. */
  musician: readonly string[];
  /** Where the dancers stand, when not where the Ardah's row does. */
  dancersBox?: StageBox;
  /** Where the musician stands, when not where the Ardah's drummer does. */
  musicianBox?: StageBox;
}

export const DANCE_ART: Record<string, DanceArt> = {
  ardah: {
    // rest (keyframes 5, 6) · swords forward (7) · swords overhead (8)
    dancers: [ardahRow1, ardahRow2, ardahRow3],
    // drum overhead, stick on the face (9) · drum at head height, stick away (11)
    musician: [ardahDrummer1, ardahDrummer2],
  },
  ayyala: {
    // cane up (keyframe 6) · arm out (5) · canes forward (4) · bow (7)
    dancers: [ayyalaRow1, ayyalaRow2, ayyalaRow3, ayyalaRow4],
    // frame drum held up at head height (9)
    musician: [ayyalaDrummer1],
    // The drum is held out toward the row; a little more floor between them.
    dancersBox: { left: 25, width: 76, height: 66 },
    musicianBox: { left: -5, width: 38, height: 50 },
  },
};
