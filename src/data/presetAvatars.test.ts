import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { PRESET_AVATARS, findPresetByUrl, isPresetAvatarUrl } from './presetAvatars';

describe('presetAvatars', () => {
  it('has unique ids and srcs', () => {
    expect(new Set(PRESET_AVATARS.map((a) => a.id)).size).toBe(PRESET_AVATARS.length);
    expect(new Set(PRESET_AVATARS.map((a) => a.src)).size).toBe(PRESET_AVATARS.length);
  });

  it('ships the image file every preset points at', () => {
    for (const avatar of PRESET_AVATARS) {
      expect(existsSync(`public${avatar.src}`), `missing asset for ${avatar.id}`).toBe(true);
    }
  });

  it('resolves a stored url back to its preset', () => {
    const first = PRESET_AVATARS[0];
    expect(findPresetByUrl(first.src)).toEqual(first);
    expect(findPresetByUrl(`https://hakiya.app${first.src}`)).toEqual(first);
  });

  it('treats uploaded and empty urls as non-presets', () => {
    expect(findPresetByUrl(null)).toBeUndefined();
    expect(findPresetByUrl('')).toBeUndefined();
    expect(isPresetAvatarUrl('https://xyz.supabase.co/storage/v1/object/public/avatars/u/a.jpg')).toBe(false);
  });
});
