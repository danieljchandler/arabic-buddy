import { VIGNETTE_ART } from "./vignetteArt";
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
import assayaDancer1 from "@/assets/celebrations/assaya/dancer-1.webp";
import assayaDancer2 from "@/assets/celebrations/assaya/dancer-2.webp";
import assayaDancer3 from "@/assets/celebrations/assaya/dancer-3.webp";
import assayaDancer4 from "@/assets/celebrations/assaya/dancer-4.webp";
import tanouraDancer1 from "@/assets/celebrations/tanoura/dancer-1.webp";
import tanouraDancer2 from "@/assets/celebrations/tanoura/dancer-2.webp";
import tanouraDancer3 from "@/assets/celebrations/tanoura/dancer-3.webp";
import tanouraDancer4 from "@/assets/celebrations/tanoura/dancer-4.webp";
import tanouraDancer5 from "@/assets/celebrations/tanoura/dancer-5.webp";
import tanouraDancer6 from "@/assets/celebrations/tanoura/dancer-6.webp";
import tanouraDrummer1 from "@/assets/celebrations/tanoura/drummer-1.webp";
import tahtibPair1 from "@/assets/celebrations/tahtib/pair-1.webp";
import tahtibPair2 from "@/assets/celebrations/tahtib/pair-2.webp";
import tahtibPair3 from "@/assets/celebrations/tahtib/pair-3.webp";
import tahtibDrummer1 from "@/assets/celebrations/tahtib/drummer-1.webp";
import tahtibDrummer2 from "@/assets/celebrations/tahtib/drummer-2.webp";
import baraaRow1 from "@/assets/celebrations/baraa/row-1.webp";
import baraaRow2 from "@/assets/celebrations/baraa/row-2.webp";
import baraaRow3 from "@/assets/celebrations/baraa/row-3.webp";
import baraaRow4 from "@/assets/celebrations/baraa/row-4.webp";
import baraaDrummer1 from "@/assets/celebrations/baraa/drummer-1.webp";
import mizmarDancer1 from "@/assets/celebrations/mizmar/dancer-1.webp";
import mizmarDancer2 from "@/assets/celebrations/mizmar/dancer-2.webp";
import mizmarDancer3 from "@/assets/celebrations/mizmar/dancer-3.webp";
import mizmarClapper1 from "@/assets/celebrations/mizmar/clapper-1.webp";
import mizmarClapper2 from "@/assets/celebrations/mizmar/clapper-2.webp";
import razhaRow1 from "@/assets/celebrations/razha/row-1.webp";
import razhaRow2 from "@/assets/celebrations/razha/row-2.webp";
import razhaRow3 from "@/assets/celebrations/razha/row-3.webp";
import razhaDrummer1 from "@/assets/celebrations/razha/drummer-1.webp";
import khammariRow1 from "@/assets/celebrations/khammari/row-1.webp";
import khammariRow2 from "@/assets/celebrations/khammari/row-2.webp";
import khammariRow3 from "@/assets/celebrations/khammari/row-3.webp";
import khammariDrummer1 from "@/assets/celebrations/khammari/drummer-1.webp";
import sanaaniRow1 from "@/assets/celebrations/sanaani/row-1.webp";
import sanaaniRow2 from "@/assets/celebrations/sanaani/row-2.webp";
import sanaaniSinger1 from "@/assets/celebrations/sanaani/singer-1.webp";
import ardahMusic from "@/assets/celebrations/ardah/music.mp3";
import ayyalaMusic from "@/assets/celebrations/ayyala/music.mp3";
import assayaMusic from "@/assets/celebrations/assaya/music.mp3";
import tanouraMusic from "@/assets/celebrations/tanoura/music.mp3";
import tahtibMusic from "@/assets/celebrations/tahtib/music.mp3";
import sanaaniMusic from "@/assets/celebrations/sanaani/music.mp3";
import mizmarMusic from "@/assets/celebrations/mizmar/music.mp3";
import khammariMusic from "@/assets/celebrations/khammari/music.mp3";
import razhaMusic from "@/assets/celebrations/razha/music.mp3";
import baraaMusic from "@/assets/celebrations/baraa/music.mp3";

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
  /**
   * The dance's music: a loop cut on the beat the scene is timed to, from
   * the stretch of the reference footage where that beat was measured. Test
   * audio for now, played only in previews or with `?dancemusic=on`
   * (src/lib/danceMusic.ts); a dance without one dances in silence.
   */
  music?: string;
}

export const DANCE_ART: Record<string, DanceArt> = {
  ardah: {
    // rest (keyframes 5, 6) · swords forward (7) · swords overhead (8)
    dancers: [ardahRow1, ardahRow2, ardahRow3],
    // drum overhead, stick on the face (9) · drum at head height, stick away (11)
    musician: [ardahDrummer1, ardahDrummer2],
    music: ardahMusic,
  },
  ayyala: {
    // cane up (keyframe 6) · arm out (5) · canes forward (4) · bow (7)
    dancers: [ayyalaRow1, ayyalaRow2, ayyalaRow3, ayyalaRow4],
    // frame drum held up at head height (9)
    musician: [ayyalaDrummer1],
    // The drum is held out toward the row; a little more floor between them.
    dancersBox: { left: 25, width: 76, height: 66 },
    musicianBox: { left: -5, width: 38, height: 50 },
    music: ayyalaMusic,
  },
  assaya: {
    // spin, cane across the chest (keyframe 6) · cane across the shoulders (9)
    // · lunge, cane held out (8) · cane upright over the hand (7)
    dancers: [assayaDancer1, assayaDancer2, assayaDancer3, assayaDancer4],
    musician: [],
    // A solo, so he takes the middle of the stage.
    dancersBox: { left: 18, width: 72, height: 66 },
    music: assayaMusic,
  },
  tanoura: {
    // the turn, a quarter at a time: front · profile to the right · back ·
    // profile to the left (keyframe 4's dancer) · the upper layer overhead,
    // front and back (4)
    dancers: [tanouraDancer1, tanouraDancer2, tanouraDancer3, tanouraDancer4, tanouraDancer5, tanouraDancer6],
    // a frame drum held against the chest (10)
    musician: [tanouraDrummer1],
    // The skirt's disc is wider than the dancer is tall: give him the
    // middle of the stage and the musician the edge.
    dancersBox: { left: 20, width: 80, height: 70 },
    musicianBox: { left: -6, width: 30, height: 46 },
    music: tanouraMusic,
  },
  tahtib: {
    // apart, sticks in an open V (keyframe 3) · crossed overhead, chest to
    // chest (4) · one stick level, the other raised (6)
    dancers: [tahtibPair1, tahtibPair2, tahtibPair3],
    // the open hand on the skin · lifted between strokes (8)
    musician: [tahtibDrummer1, tahtibDrummer2],
    // A pair facing each other is wider than it is tall: the floor between
    // them is the point, so they take the width and the drummer the edge.
    dancersBox: { left: 18, width: 84, height: 64 },
    musicianBox: { left: -7, width: 30, height: 44 },
    music: tahtibMusic,
  },
  baraa: {
    // dagger at the waist (keyframe 3) · blade up by the head (4) · folded,
    // blade at the brow (4) · low, dagger at the side (5)
    dancers: [baraaRow1, baraaRow2, baraaRow3, baraaRow4],
    // the drum on a strap at the hip, a stick in each hand (3)
    musician: [baraaDrummer1],
    // The row stands looser than the Ardah's, so its still is wider: move it
    // right and the drummer left so he stays in the open floor before it.
    dancersBox: { left: 30, width: 70, height: 64 },
    musicianBox: { left: -5, width: 34, height: 48 },
    music: baraaMusic,
  },
  mizmar: {
    // stride, cane down to the floor (keyframe 10) · cane vertical overhead
    // (7) · cane level overhead, mid-twirl (4)
    dancers: [mizmarDancer1, mizmarDancer2, mizmarDancer3],
    // hands apart · palms meeting (6)
    musician: [mizmarClapper1, mizmarClapper2],
    // One dancer, and his stills leave headroom for the cane held overhead:
    // a tall box in the middle of the stage, the clapper at the edge.
    dancersBox: { left: 30, width: 60, height: 88 },
    musicianBox: { left: 0, width: 28, height: 56 },
    music: mizmarMusic,
  },
  razha: {
    // canes upright (keyframe 2) · raised and crossing (3) · held low
    dancers: [razhaRow1, razhaRow2, razhaRow3],
    // a barrel drum on a sling, the stick raised (6)
    musician: [razhaDrummer1],
    dancersBox: { left: 28, width: 72, height: 68 },
    musicianBox: { left: -3, width: 34, height: 52 },
    music: razhaMusic,
  },
  khammari: {
    // upright (keyframe 1) · lean · bow (3)
    dancers: [khammariRow1, khammariRow2, khammariRow3],
    // a frame drum held at the chest (4)
    musician: [khammariDrummer1],
    dancersBox: { left: 30, width: 70, height: 64 },
    musicianBox: { left: -3, width: 32, height: 54 },
    music: khammariMusic,
  },
  sanaani: {
    // hands joined in a chain (keyframe 1) · released, walking (3)
    dancers: [sanaaniRow1, sanaaniRow2],
    // an oud player singing, seated (8)
    musician: [sanaaniSinger1],
    // Three men side by side, arms out, are wider than they are tall, so
    // they take the width; the singer sits low at the edge, partly off it.
    dancersBox: { left: 12, width: 92, height: 62 },
    musicianBox: { left: -9, width: 30, height: 34 },
    music: sanaaniMusic,
  },
};

/**
 * The art for any scene the stage can play: a dance's, or a vignette's
 * (`./vignetteArt`). Undefined for an id with no stills.
 */
export function artFor(id: string): DanceArt | undefined {
  return DANCE_ART[id] ?? VIGNETTE_ART[id];
}
