import ardahDancer1 from "@/assets/celebrations/ardah/dancer-1.webp";
import ardahDancer2 from "@/assets/celebrations/ardah/dancer-2.webp";
import ardahDancer3 from "@/assets/celebrations/ardah/dancer-3.webp";
import ardahDancer4 from "@/assets/celebrations/ardah/dancer-4.webp";
import ardahDancer5 from "@/assets/celebrations/ardah/dancer-5.webp";
import ardahDancer6 from "@/assets/celebrations/ardah/dancer-6.webp";
import ardahDrummer1 from "@/assets/celebrations/ardah/drummer-1.webp";
import ardahDrummer2 from "@/assets/celebrations/ardah/drummer-2.webp";

/**
 * The cutout stills for each dance, in the order `DanceDefinition.sequence`
 * indexes them. Generated performers, cut out and finished in grayscale with
 * a rough paper edge (see docs/celebrations.md for how a set is made).
 */
export interface DanceArt {
  dancer: readonly string[];
  drummer: readonly string[];
}

export const DANCE_ART: Record<string, DanceArt> = {
  ardah: {
    dancer: [ardahDancer1, ardahDancer2, ardahDancer3, ardahDancer4, ardahDancer5, ardahDancer6],
    drummer: [ardahDrummer1, ardahDrummer2],
  },
};
