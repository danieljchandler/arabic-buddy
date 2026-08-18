/**
 * Preset avatars — Sadu woven medallions and Gulf cultural motifs.
 *
 * Presets are plain static assets under `public/avatars/`, and picking one simply
 * writes its `src` into `profiles.avatar_url`. That keeps every existing consumer
 * (Profile, Friends, Leaderboard, vocab battles) working unchanged — they already
 * treat `avatar_url` as an opaque URL — and needs no schema change.
 */

export type PresetAvatarCategory = 'sadu' | 'motif';

export interface PresetAvatar {
  id: string;
  /** Public path written into `profiles.avatar_url`. */
  src: string;
  label: string;
  /** Arabic name, shown alongside the label for the cultural motifs. */
  labelAr?: string;
  category: PresetAvatarCategory;
}

export const PRESET_AVATARS: PresetAvatar[] = [
  // Sadu weave medallions
  { id: 'sadu-rose', src: '/avatars/sadu-rose.png', label: 'Rose Weave', category: 'sadu' },
  { id: 'sadu-star', src: '/avatars/sadu-star.png', label: 'Star Weave', category: 'sadu' },
  { id: 'sadu-lattice', src: '/avatars/sadu-lattice.png', label: 'Gold Lattice', category: 'sadu' },
  { id: 'sadu-sand', src: '/avatars/sadu-sand.png', label: 'Sand Weave', category: 'sadu' },
  { id: 'sadu-chevron', src: '/avatars/sadu-chevron.png', label: 'Chevron Bands', category: 'sadu' },
  { id: 'sadu-kilim', src: '/avatars/sadu-kilim.png', label: 'Kilim Field', category: 'sadu' },
  { id: 'sadu-hooks', src: '/avatars/sadu-hooks.png', label: 'Latch Hook', category: 'sadu' },
  { id: 'sadu-triband', src: '/avatars/sadu-triband.png', label: 'Three Diamonds', category: 'sadu' },

  // Cultural motifs
  { id: 'motif-dallah', src: '/avatars/motif-dallah.png', label: 'Dallah', labelAr: 'دلة', category: 'motif' },
  { id: 'motif-finjan', src: '/avatars/motif-finjan.png', label: 'Finjan', labelAr: 'فنجان', category: 'motif' },
  { id: 'motif-mabkhara', src: '/avatars/motif-mabkhara.png', label: 'Mabkhara', labelAr: 'مبخرة', category: 'motif' },
  { id: 'motif-palm', src: '/avatars/motif-palm.png', label: 'Date Palm', labelAr: 'نخلة', category: 'motif' },
  { id: 'motif-camel', src: '/avatars/motif-camel.png', label: 'Camel', labelAr: 'جمل', category: 'motif' },
];

/** Find the preset matching a stored `avatar_url`, if it is a preset at all. */
export const findPresetByUrl = (url: string | null | undefined): PresetAvatar | undefined => {
  if (!url) return undefined;
  // Stored values are same-origin paths, but tolerate an absolute URL too.
  const path = url.startsWith('http') ? new URL(url).pathname : url;
  return PRESET_AVATARS.find((a) => a.src === path);
};

export const isPresetAvatarUrl = (url: string | null | undefined): boolean =>
  findPresetByUrl(url) !== undefined;
