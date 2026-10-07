import type { DanceArt, StageBox } from "./danceArt";

/**
 * The cutout stills for each vignette (`@/lib/vignettes`), found by name rather
 * than imported one by one: a vignette's folder under `src/assets/celebrations/`
 * holds `still-1.webp`, `still-2.webp` … for its figure, in the order its
 * `sequence` indexes them, and `helper-1.webp` … for the second figure beside
 * it (the cook with his fan, the guest with his cup), in the order its
 * `musicianSequence` indexes them. The dances' folders use other names
 * (`row-`, `dancer-`, `drummer-`), so the two never mix.
 *
 * Made the way the dances' are (docs/celebrations.md, "Making a new dance"):
 * generated objects and people, described to the image model in words, cut out
 * with `scripts/celebrations/make_cutouts.py still|helper`.
 */

const files = import.meta.glob<string>("@/assets/celebrations/*/{still,helper}-*.webp", {
  eager: true,
  import: "default",
});

const NAME = /\/celebrations\/([^/]+)\/(still|helper)-(\d+)\.webp$/;

function collect(): Record<string, { still: string[]; helper: string[] }> {
  const found: Record<string, { still: [number, string][]; helper: [number, string][] }> = {};
  for (const [path, url] of Object.entries(files)) {
    const m = NAME.exec(path);
    if (!m) continue;
    const [, id, role, n] = m;
    (found[id] ??= { still: [], helper: [] })[role as "still" | "helper"].push([Number(n), url]);
  }
  return Object.fromEntries(
    Object.entries(found).map(([id, roles]) => [
      id,
      {
        still: roles.still.sort((a, b) => a[0] - b[0]).map(([, url]) => url),
        helper: roles.helper.sort((a, b) => a[0] - b[0]).map(([, url]) => url),
      },
    ]),
  );
}

/** Where a vignette's figures stand when not where the dances' do. See `STAGE` below. */
interface Boxes {
  dancersBox?: StageBox;
  musicianBox?: StageBox;
}

/**
 * A grill is wider than a row of dancers is tall, and the cook stands at its
 * left in the open floor; the one-offs are single objects, so they take the
 * middle of the stage. These are the same two boxes the dances use for a solo
 * (dancers on the right, the helper at the left edge), tuned by eye against
 * the finished stills.
 */
const LADDER_BOXES: Boxes = {
  dancersBox: { left: 22, width: 76, height: 62 },
  musicianBox: { left: -2, width: 32, height: 54 },
};
const OBJECT_BOX: Boxes = { dancersBox: { left: 18, width: 78, height: 64 } };

const BOXES: Record<string, Boxes> = {
  mishkak: LADDER_BOXES,
  kababgi: LADDER_BOXES,
  madhbi: LADDER_BOXES,
  // The host is tall and stands under the caption: keep his head below it.
  dallah: { dancersBox: { left: 32, width: 62, height: 62 }, musicianBox: { left: -4, width: 34, height: 52 } },
  zaffa: { dancersBox: { left: 24, width: 78, height: 62 }, musicianBox: { left: -4, width: 30, height: 54 } },
  bakhoor: { dancersBox: { left: 28, width: 62, height: 64 } },
  // The oyster is wide and tall: clear of the cheer's label.
  lulu: { dancersBox: { left: 24, width: 72, height: 58 } },
  football: { dancersBox: { left: 22, width: 76, height: 68 } },
};

export const VIGNETTE_ART: Record<string, DanceArt> = Object.fromEntries(
  Object.entries(collect()).map(([id, { still, helper }]) => [
    id,
    { dancers: still, musician: helper, ...(BOXES[id] ?? OBJECT_BOX) } satisfies DanceArt,
  ]),
);
