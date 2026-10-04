import ardahRow1 from "@/assets/celebrations/ardah/row-1.webp";
import ardahRow2 from "@/assets/celebrations/ardah/row-2.webp";
import ardahRow3 from "@/assets/celebrations/ardah/row-3.webp";
import ardahDrummer1 from "@/assets/celebrations/ardah/drummer-1.webp";
import ardahDrummer2 from "@/assets/celebrations/ardah/drummer-2.webp";

/**
 * The cutout stills for each dance, in the order `DanceDefinition.sequence`
 * indexes them. Generated performers, posed from written descriptions of the
 * reference keyframes, cut out and finished in grayscale with a rough paper
 * edge. docs/celebrations.md says how a set is made.
 */
export interface DanceArt {
  /** The row of dancers, one still per pose. Every still shares one crop and scale. */
  row: readonly string[];
  drummer: readonly string[];
}

export const DANCE_ART: Record<string, DanceArt> = {
  ardah: {
    // rest (keyframes 5, 6) · swords forward (7) · swords overhead (8)
    row: [ardahRow1, ardahRow2, ardahRow3],
    // drum overhead, stick on the face (9) · drum at head height, stick away (11)
    drummer: [ardahDrummer1, ardahDrummer2],
  },
};
