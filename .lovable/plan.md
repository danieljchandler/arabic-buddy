
## Scope: apply the fix to all three dialects (Gulf, Egyptian, Yemeni)

The Yemeni false positives I documented earlier come from three structural bugs, all dialect-agnostic. The same bugs would fire for Gulf and Egyptian content as soon as admins enter rules with realistic contrastive examples. So every fix below is global — Yemeni is just the dialect with enough traffic to expose it.

### Root causes (all dialects)

1. **Phrase splitter in `harvestForbiddenTokens` (`dialectHelpers.ts`).** Any multi-word string in a rule's `examples.bad` is split into individual Arabic words and each becomes a forbidden token. Neutral words like `البيت / كيف / من / في / أنا / هو / اليوم / كبير / حالك / صديقي / السوق / القهوة` end up forbidden because they appeared inside a contrastive MSA sentence.
2. **Hardcoded `DIALECT_EXTRA` in `msaLeakDetector.ts`** has inaccuracies per dialect:
   - Yemeni: `شلون, شلونك, زين, وش, أبي, شفيك, لاحين, يبغى, أبغى, مرة` — all valid Yemeni; must be removed.
   - Gulf: `كيف, كويس` — `كيف حالك` is a normal Gulf greeting; `كويس` is borderline. Remove `كيف`; demote `كويس`.
   - Egyptian: `كيف` — used in Egyptian too. Remove. Keep `شلونك/هالحين/واجد/يبي/زين/خوش/بغيت/ذحين` (genuinely non-Egyptian).
3. **No Arabic normalization** before matching. Alef variants (`أ ا إ آ`), `ى/ي`, `ة/ه`, and tashkeel cause spelling mismatches in both directions.

Secondary: admins get no UI guidance on what belongs in "Bad examples", and the leak detector logs independently of the native-speaker validator — single-word matches get logged even when the validator says the text is authentic.

## Plan

### 1. Make the token harvester safe (all dialects) — `_shared/dialectHelpers.ts`
- Stop splitting multi-word `examples.bad` into per-word tokens. Multi-word entries are kept only as whole-phrase matches; single-token entries become forbidden tokens.
- Drop any harvested token that falls in a per-dialect `ALWAYS_ALLOWED` whitelist (step 3).
- Add `normalizeArabic(s)`: strip tashkeel + tatweel, unify `أإآ→ا`, `ى→ي`, `ة→ه`, collapse whitespace. Apply to both candidates and the scanned text.

### 2. Rewrite hardcoded leak lists (all dialects) — `_shared/msaLeakDetector.ts`
- **Yemeni:** keep only forms unambiguous outside Yemen — `إزيك, دلوقتي, عايز, عاوز, كده, مفيش, النهاردة, شخبارك, شخبارش, هالحين, خوش`. Remove the rest.
- **Gulf:** keep `إزيك, إزاي, دلوقتي, عايز, عاوز, كده, ده, دي, مفيش, النهاردة` (clearly Egyptian); also `بغيت/ذحين/أشتي` (clearly Yemeni). Remove `كيف`. Demote/remove `كويس`.
- **Egyptian:** keep `شلونك, هالحين, واجد, يبي, إمبي, زين, خوش, بغيت, ذحين, شخبارك, شخبارش, وين`. Remove `كيف`.
- Apply normalization before matching everywhere.
- Add per-dialect `ALWAYS_ALLOWED` sets (pronouns, particles, common nouns valid in that dialect) consumed by both detector and harvester so no rule entry can ever forbid them.

### 3. Gate logging on validator agreement — `_shared/msaViolationLogger.ts`
- Extend `logMsaViolations` with an optional `validatorScore` / `validatorVerdict`.
- When the native validator already ran and returned `score >= 4` / verdict `pass`, downgrade severity to `low` and skip the native-review enqueue. The validator becomes the source of truth for borderline single-word hits across all dialects.

### 4. Pass validator results through at every call site
Update the 4 callers to forward the validator result: `_shared/aiBrain.ts`, `conversation-practice/index.ts`, `curriculum-chat/index.ts`, `free-chat/index.ts`. No-op when the validator hasn't run.

### 5. Clarify the admin "Bad examples" field — `src/pages/admin/AdminDialectRules.tsx`
- Inline help next to the bad-examples editor, shown for ALL dialects:
  - "Enter ONLY forms that are always wrong in this dialect (e.g. `ليس`, `لماذا`, `أريد`, `الآن`)."
  - "Do NOT paste full MSA sentences. Neutral words inside them (`البيت`, `كيف`, `أنا`) will get flagged as leaks."
  - "For contrastive 'say X, not Y' examples, use a `msa_substitutions` rule — those are not fed to the leak detector."
- Client-side warning when a bad-example string contains >2 Arabic words OR contains a token from that dialect's `ALWAYS_ALLOWED` whitelist.

### 6. No DB migration / no data cleanup required
Once the harvester is fixed, over-broad existing bad examples stop polluting the detector automatically (5-minute cache TTL). Historical `dialect_rule_violations` rows are left intact.

### Files to touch
- `supabase/functions/_shared/dialectHelpers.ts`
- `supabase/functions/_shared/msaLeakDetector.ts`
- `supabase/functions/_shared/msaViolationLogger.ts`
- `supabase/functions/_shared/aiBrain.ts`
- `supabase/functions/conversation-practice/index.ts`
- `supabase/functions/curriculum-chat/index.ts`
- `supabase/functions/free-chat/index.ts`
- `src/pages/admin/AdminDialectRules.tsx`
