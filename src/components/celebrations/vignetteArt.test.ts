import { describe, expect, it } from "vitest";
import { VIGNETTES } from "@/lib/vignettes";
import { DANCES } from "@/lib/dances";
import { DANCE_ART, artFor } from "./danceArt";
import { VIGNETTE_ART } from "./vignetteArt";

/**
 * Every vignette is a handful of cutout stills found by file name
 * (`still-N.webp`, `helper-N.webp`), so the way it goes wrong is a missing or
 * misnumbered file: a scene that asks for a pose it has no picture of, and
 * shows nothing at that beat. These hold each vignette's `sequence` to the
 * stills that exist.
 */

describe("the vignettes' art", () => {
  it("has art for every vignette, and none for a vignette that is not in the catalogue", () => {
    for (const v of VIGNETTES) expect(VIGNETTE_ART[v.id], v.id).toBeDefined();
    expect(Object.keys(VIGNETTE_ART).sort()).toEqual(VIGNETTES.map((v) => v.id).sort());
  });

  it("has a still for every pose a vignette asks for, and none it never shows", () => {
    for (const v of VIGNETTES) {
      const art = VIGNETTE_ART[v.id];
      const asked = new Set([...v.sequence, ...(v.ladder ?? []).flatMap((r) => r.sequence)]);
      expect(art.dancers.length, v.id).toBe(asked.size);
      for (const i of asked) expect(art.dancers[i], `${v.id} pose ${i}`).toBeTruthy();
    }
  });

  it("has a helper still for every stroke a vignette asks for, and none it never shows", () => {
    for (const v of VIGNETTES) {
      const art = VIGNETTE_ART[v.id];
      expect(new Set(v.musicianSequence).size, v.id).toBe(art.musician.length);
      for (const i of v.musicianSequence) expect(art.musician[i], `${v.id} helper ${i}`).toBeTruthy();
    }
  });

  it("numbers the stills in order from one, so the order on disk is the order in the sequence", () => {
    for (const v of VIGNETTES) {
      const urls = VIGNETTE_ART[v.id].dancers;
      expect(new Set(urls).size, v.id).toBe(urls.length);
    }
  });

  it("keeps each box on the stage", () => {
    for (const [id, art] of Object.entries(VIGNETTE_ART)) {
      for (const box of [art.dancersBox, art.musicianBox]) {
        if (!box) continue;
        expect(box.width, id).toBeGreaterThan(0);
        expect(box.height, id).toBeGreaterThan(0);
        expect(box.left + box.width, id).toBeLessThanOrEqual(102);
        expect(box.height, id).toBeLessThanOrEqual(100);
      }
    }
  });

  it("plays no music: nothing here has a recording", () => {
    for (const art of Object.values(VIGNETTE_ART)) expect(art.music).toBeUndefined();
  });

  it("is found by the same lookup as a dance's, without one shadowing the other", () => {
    expect(artFor("ardah")).toBe(DANCE_ART.ardah);
    for (const v of VIGNETTES) expect(artFor(v.id)).toBe(VIGNETTE_ART[v.id]);
    expect(artFor("dabke")).toBeUndefined();
    for (const d of DANCES) expect(VIGNETTE_ART[d.id], d.id).toBeUndefined();
  });
});
