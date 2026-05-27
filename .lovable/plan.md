# Extend MSA Bridge to Egyptian & Yemeni

Phase 1 shipped Gulf-only bridge rules. This adds parity for the other two active dialect modules so the `/bridge` page and `TappableArabicText` MSA row work across all three.

## Scope

- Data only. No UI, no schema changes. Reuses existing `msa_transformation_rules` table, `useMsaRules` hook, and `MsaBridge.tsx` page (already dialect-filtered).
- ~14 rules per dialect, mirroring the Gulf seed structure across the 4 categories.

## Egyptian rules (~14)

Sound shifts
- ق → ʔ (hamza): قال → ʔāl
- ث → ت/س: ثلاثة → تلاتة
- ذ → د/ز: هذا → ده
- ج → g (hard): جميل → gameel

Pronouns
- أنتَ → إنتَ (same spelling, soft); أنتِ → إنتي
- نحن → احنا
- هم → هما

Verb prefixes
- present continuous بـ: بيكتب (he is writing)
- future حـ: حيروح (he will go)
- negation مش / ما...ش: مش عارف، ماعرفش

Vocab swaps
- ماذا → إيه
- الآن → دلوقتي
- أريد → عايز / عايزة
- كيف → إزاي
- لماذا → ليه

## Yemeni rules (~14)

Sound shifts
- ق → g (Sanaani) / q retained in some regions: قلب → galb
- ث → th retained (unlike Gulf/Egy): ثلاثة → thalāthah
- ذ → dh retained: هذا → hādhā
- ج → j retained: جميل → jameel
- ك stays ك (no chimchim)

Pronouns
- أنتَ → أنت; أنتم → أنتو
- نحن → حنا / نحنا
- هم → هم (retained)

Verb prefixes
- present indicative بـ (Sanaani) or bare stem (Ta'izzi): بيكتب / يكتب
- future عاد / شـ: شيروح
- negation ما...ش or just ما: ما يعرفش / ما يعرف

Vocab swaps
- ماذا → ماذا / شو
- الآن → دحين / الحين
- أريد → أبغى / أشتي (Ta'izzi)
- كيف → كيف (retained, often kayf)
- لماذا → ليش / علاش

## Technical section

Single migration: `INSERT INTO public.msa_transformation_rules (...)` with ~28 rows. Each row sets `dialect`, `category` (sound_shift/pronoun/verb_prefix/vocab_swap), `rule_name`, `msa_pattern`, `dialect_pattern`, `example_msa`, `example_dialect`, `notes`, `display_order`, `status='published'`. No code, no types, no hook changes — `useMsaRules(dialect)` already filters by dialect param and `MsaBridge.tsx` reads the current dialect from `DialectContext`.

## Out of scope

- No example audio (`example_audio_url` left null; can be backfilled later via TTS).
- No "From MSA" lesson generation for these dialects yet (that's Phase 3).
- No changes to vocabulary `msa_form` backfill.
