# Gulf Arabic (Khaleeji) Pre-A1 → B1 Curriculum Research Brief

Prepared for Hikaya content authors. Scope: Stage 1 Foundations (Pre-A1→A1), Stage 2 Building Blocks (A1→A2), Stage 3 The Bridge (A2→B1). Everything in Arabic below is *spoken Gulf*, never MSA. Where a form is contested between Gulf countries it is labelled; where a claim could not be verified online it is marked **[own knowledge]**.

Conventions used in this brief:
- Transliteration follows the app's `TRANSLITERATION_RULES.Gulf` (ق = g, ع = 3 or ʿ, ح = H, خ = kh, emphatics capitalised, long vowels doubled). ج is written **j/y** as a pair where the countries split (Riyadh/Jeddah *j*, Kuwait/UAE/Qatar/Bahrain mostly *y*), otherwise *j*. See §3 for the decision this forces.
- Six grammar category ids from `supabase/functions/_shared/grammarTaxonomy.ts`: `verb-conjugation`, `pronouns`, `negation`, `possessives`, `questions`, `sentence-structure`. Anything that does not fit (numbers, particles) is tagged with the nearest id plus a note; the taxonomy's own fallback (`canonicalGrammarKey` → slug) will hold it as a separate concept, which is fine.
- Leak-detector constraints from `msaLeakDetector.ts` are respected throughout: never الآن/لماذا/هؤلاء/ذلك/سوف/ليس/الذي/التي/الذين/عندما(avoid)/بينما/أيضاً/كذلك, never Egyptian إزيك/إزاي/دلوقتي/عايز/كده/مفيش/النهاردة. هذا/هذه/عندما are whitelisted for Gulf, but authors should still prefer هذي over هذه and لما/يوم over عندما.

---

## 1. Sources consulted

| # | Source | URL | What it contributed |
|---|--------|-----|---------------------|
| 1 | Clive Holes, *Colloquial Arabic of the Gulf*, 2nd ed. (Routledge) — Apple Books / Perlego / Amazon listings | https://books.apple.com/us/book/colloquial-arabic-of-the-gulf/id1034737177 · https://www.perlego.com/book/1567821/colloquial-arabic-of-the-gulf-pdf · https://www.amazon.com/Colloquial-Arabic-Gulf-Book-Only/dp/1138958123 | Unit ordering of the standard learner course: Unit 1 = expressions of quantity ("a bottle of milk"), orders/requests ("Come here!", "Go!"), please/thank-you; then the article, the dual, the plural, numbers & prices, simple descriptive sentences, and only *then* the past-tense verb; each unit has a "Cultural Point" and a "Reading Arabic" section; Appendix 1 "Variations in pronunciation". The Routledge product page itself returned 403. The earlier edition (*Colloquial Arabic of the Gulf and Saudi Arabia*) has 20 units per https://arabicgoals.com/how-to-learn-colloquial-gulf-arabic-on-your-own/. |
| 2 | Hamdi Qafisheh, *A Short Reference Grammar of Gulf Arabic* (1977) — ERIC record, vdoc.pub TOC | https://eric.ed.gov/?id=ED133997 · https://vdoc.pub/documents/a-short-reference-grammar-of-gulf-arabic-6glq0fp1i6c0 | Structure: phonology / morphology / syntax / five daily-life texts; syntax chapters: nominal sentences, pseudo-verbal sentences (عند/في/مع as "verbs"), verbal sentences, topical sentences, conditional sentences (open / unlikely / unreal), verb strings. This is the skeleton behind §4's ordering (nominal → pseudo-verbal → verbal → conditional). |
| 3 | Frances Altorfer, *Complete Spoken Arabic of the Arabian Gulf* (Teach Yourself) | https://us.teachyourself.com/products/complete-spoken-arabic-of-the-arabian-gulf-beginner-to-intermediate-course · https://www.amazon.com/Complete-Spoken-Arabian-Beginner-Intermediate/dp/1444105469 | Thematic unit sequence: introducing yourself → everyday situations → phone → work; topics listed: asking for someone on the phone, ordering a sandwich, asking about family, buying a ticket, weather, finding things, sending a letter. Claimed endpoint B2. |
| 4 | GulfArabic.com e-learning grammar index (units G.2, G.4) | https://www.gulfarabic.com/g43_phrases_numbers.php · https://www.gulfarabic.com/g24_arabic_possessive_maal.php · https://www.gulfarabic.com/g47_learn_arabic_verbs_past_2.php | Cardinal/ordinal paradigms with Gulf forms (ثلاث/ثلاثة, ثمان/ثمانية…), counting rule for 1–2 vs 3–10; full مال possessive paradigm incl. feminine مالت-; past-tense paradigms of جا (ييت/يا/يات/ياو), شاف, راح; the site's own grammar ordering (definite article → pronouns → possessives → مال → commands → plurals → adjectives → comparison → numbers → time → question words → demonstratives → past tense). |
| 5 | Amin Academy Gulf Arabic lessons | https://aminacademy.org/the-future-tense/ · https://aminacademy.org/comparative-and-superlative-adjectives-in-gulf-arabic/ · https://aminacademy.org/expressions/ · https://aminacademy.org/demonstrative-pronouns-in-gulf-arabic/ · https://aminacademy.org/the-present-continuous/ | Future بـ paradigm on سوّى (بسوي/بتسوي/بتسوين/بنسوي/بيسوي/بيساون); comparative pattern أفعل with أكبر/أجمل/أطول/أكثر/أرخص; expression list (لو سمحت, إي, إي بلى, أكيد, طبعاً, بضبط, عجبني, أبي/ما أبي, ما ودي, أدري/ما أدري, لازم); demonstratives هذا/هذي/هذول + far هذاك, هذيل; present continuous with قاعد (قاعدة تكتب رسالة). |
| 6 | Persson, "The role of the b-prefix in Gulf Arabic dialects as a marker of future, intent and/or irrealis", *JAIS* 8 | https://www.lancaster.ac.uk/jais/volume/docs/vol8/persson_web.htm | Corpus finding: Gulf بـ is *not* the Egyptian/Levantine indicative بـ; it marks future/intent/irrealis — 64% of its non-future uses are in conditionals, plus past habituals. راح is the "cleaner" future marker (12 non-future uses vs 126 for بـ). Examples quoted in §4. |
| 7 | Wikipedia — Gulf Arabic, Emirati Arabic, Kuwaiti Arabic, Bahraini Gulf Arabic | https://en.wikipedia.org/wiki/Gulf_Arabic · https://en.wikipedia.org/wiki/Emirati_Arabic · https://en.wikipedia.org/wiki/Kuwaiti_Arabic · https://en.wikipedia.org/wiki/Bahraini_Gulf_Arabic | Pronoun table (آنا/إنت/إنتِ/هو/هي/نحن/إنتم/إنتن/هم/هن — with the note that most speakers do not keep the feminine plurals); ق→g historically with MSA re-imports; ج→y optional and never in recent MSA loans; ك→ch most often in the 2fs suffix; Emirati negation "mub (مب)… maš (مش) in Abu Dhabi, mub in the Northern Emirates, mā (ما) on the East Coast"; Emirati /diyaay/ chicken, /simach/ fish, /gahwa/; Kuwaiti reflexes g and ch, SVO more than VSO, pre-verbal auxiliaries قَعَ/قام; Bahraini Persian/Urdu loans (دولاغ socks, جوتي shoe). |
| 8 | Africarxiv paper on Gulf negation (via search snippet) | https://africarxiv.ubuntunet.net/server/api/core/bitstreams/b608f129-a18b-43df-9742-4426f6738dab/content | Kuwaiti uses مو in ~93% of non-verbal negation vs مب ~5%; a cline runs from Kuwait (مو) to the Emirates (مب); ماهوب/مهوب and bare هوب attested. |
| 9 | LivingArabic — phonetic notes on the Gulf dialects | https://www.livingarabic.com/phonetic-notes-on-the-gulf-dialects | قال→gaal, رفيق→rafiij (Kuwaiti q→j), قدر→kidr (some Bahraini), جا→yaa, وجه→weeh, ك→ch near front vowels (كيف→cheef, ديك→diich), ض/ظ merge, imāla بيتها→beethe, Bahraini question-final stressed /e/. |
| 10 | SaudiDialect.com — common phrases; Najdi; Hijazi | https://saudidialect.com/common-saudi-arabic-phrases/ · https://saudidialect.com/najdi-arabic/ · https://saudidialect.com/hijazi-arabic/ | Saudi phrase list (هلا والله, هلا فيك, يسعد صباحك, عساك بخير, ما قصرت, أبشر, على راسي, وش السالفة, عطني الزبدة, بكم هذا, شبعت, ما أدري, شوي شوي); Najdi: وش/منو/وين/ليش, negation ما زين/ما أبغى, copula dropped, حق possession (الكتاب حقي), future بـ or راح, ما فيه; Hijazi mixed speech: ث→ت (talaata), ذ→د (hāda); "Hijazi is not one dialect". |
| 11 | WordReference: Saudi Arabic أبي/أبغى | https://forum.wordreference.com/threads/saudi-arabic-%D8%A3%D8%A8%D9%8A-%D8%A3%D8%A8%D8%BA%D9%89.2416319/ | Both أبي and أبغى live in Saudi speech; ودّي also; politeness note: to an elder use past وش بغيت؟ rather than وش تبي؟. |
| 12 | Eton Institute — 10 Emirati words | https://etoninstitute.com/blog/10-emirati-words-youll-hear-in-almost-every-conversation/ | مرحبا الساع, شو اليديد, ما شي, هيه (yes), وايد, طرّش (send), أونه (as if), جي (like this), خيبة, كشخة. |
| 13 | Aquascript Emirati vocabulary | https://aquascript.com/emirati-arabic/vocabulary/ | شحالك/شحالج, تمام بخير وإنته, إنت وين؟, شو تسوي/تسوين؟, تغديت؟ |
| 14 | StoryLearning — 74 Gulf Arabic phrases | https://storylearning.com/learn/arabic/arabic-tips/gulf-arabic-phrases | Country-labelled greetings (شلونك Kuwait/Qatar, اشحالك UAE, وشلونك Saudi, شو خبارك), حياك الله→الله يحييك, مشكور/مشكورين, تسلم إيدك, يعطيك العافية, أمور طيبة؟, نشوفك على خير, شلون أروح…؟, ممكن تعيد مرة ثانية؟, الساعة كم؟ |
| 15 | Wikipedia — CEFR global scale | https://en.wikipedia.org/wiki/Common_European_Framework_of_Reference_for_Languages | A1 "Can understand and use familiar everyday expressions and very basic phrases aimed at the satisfaction of needs of a concrete type"; A2 "…sentences and frequently used expressions related to areas of most immediate relevance (very basic personal and family information, shopping, local geography, employment)"; B1 "…main points of clear standard input on familiar matters regularly encountered in work, school, leisure". The coe.int Companion Volume pages returned 403; the *Overall spoken interaction* descriptors quoted in §7 are **[own knowledge]** of the 2020 Companion Volume (https://rm.coe.int/cefr-companion-volume-with-new-descriptors-2018/1680787989). |
| 16 | Al Ramsa Institute (Emirati) — A1 group course; levels PDF (403) | https://alramsa.ae/product/online-group-course-spoken-emirati-arabic-beginner-level-a1/ · https://alramsa.ae/wp-content/uploads/2023/10/2.-course-levels-A1-to-B3.pdf | A1 "starts from the absolute ground up with fundamental greetings, introductions, and numbers", ~400 words, taught in transliteration first (no script prerequisite). Their YouTube channel id UCZppcNmTZmr_fLeXdQ5d1Gw is already seeded. |
| 17 | Indiana University MELC-A 310 Gulf Arabic I | https://academics.iu.edu/courses/bloomington/melc-a-310-gulf-arabic-i.html | University Gulf I topic list: greetings, self-introductions, preferences, shopping, transportation, education, work, dining, hobbies, daily activities — communicative/proficiency-based. |
| 18 | Gahwa etiquette — The National; Abu Dhabi Culture (UNESCO ICH); Gulf News; SaudiDialect | https://www.thenationalnews.com/arts-culture/2025/05/12/coffee-ceremony-arabic-gulf-gahwa-brewing-tradition/ · https://abudhabiculture.ae/en/cultural-heritage/intangible/unesco-ich-inscribed-elements/gahwa-arabic-coffee · https://gulfnews.com/uae/the-coffee-once-served-in-sheikh-zayeds-majlis-and-the-story-behind-every-finjan-of-gahwa-in-uae-1.500663743 · https://saudidialect.com/saudi-coffee-gahwa-culture/ | Dallah in left hand, finjan in right; serve clockwise from most honoured/eldest; quarter-full cup; youngest male = gahwaji; shake the cup to decline; right hand only, even for left-handers. |
| 19 | Eid / condolence phrase sources — NaTakallam, Alifbee, HiNative | https://natakallam.com/blog/how-to-wish-someone-a-happy-eid-in-arabic-dialects/ · https://blog.alifbee.com/condolences-in-arabic/ · https://hinative.com/questions/21608640 | Gulf Eid: عيدكم مبارك وعساكم من عواده → مبارك علينا وعليكم; عظم الله أجركم → أجرنا وأجركم; مبروك → الله يبارك فيك. |
| 20 | Kunya / kinship — Playaling family terms; Wikipedia | https://playaling.com/family-members-in-arabic/ | أبو فلان / أم فلان addressed by eldest son's name. |
| 21 | ArabicGoals — 11 YouTube channels for Gulf learners; how to learn Gulf Arabic | https://arabicgoals.com/11-youtube-channels-learners-gulf-arabic-dialects/ · https://arabicgoals.com/how-to-learn-colloquial-gulf-arabic-on-your-own/ | Level ratings for Learn Arabic–Kuwaiti (beginner), Jana Vlogs (beginner–intermediate), Thamaniyeh (int–adv), Belmokhba, Sowt Afkari, Qalby Etmaan, Ya'rob, Masameer, Ahmed Sharif, Khambalah, Hitham (all intermediate). |
| 22 | Takki (web series), Tash ma Tash, Shabab Al Bomb — Wikipedia / Mille | https://en.wikipedia.org/wiki/Takki_(web_series) · https://en.wikipedia.org/wiki/Tash_ma_Tash · https://www.milleworld.com/best-khaleeji-series-must-watch/ | Takki: Saudi (Jeddah) YouTube-native series, 3 seasons/36 episodes of 10–20 min, now on Netflix; Tash ma Tash 1993–2023 sketch comedy; Shabab Al Bomb self-contained Saudi youth episodes. |
| 23 | Easy Arabic channel | https://www.youtube.com/channel/UCb235Y4KE9oKSEl6BEAGUGA | Confirms Easy Arabic's street interviews are Egypt/Palestine/Tunisia — there is **no Easy-Languages Gulf edition**; Gulf "street interview" content must come from local creators (§8). |
| 24 | Repo files read | `_shared/dialectHelpers.ts`, `_shared/msaLeakDetector.ts`, `_shared/dialectSubvarieties.ts`, `_shared/grammarTaxonomy.ts`, `curriculum-chat/index.ts`, `migrations/20260823090500_seed_content_channels.sql`, `curriculum/lahja_lesson1_v2.xlsx`, scratchpad `docx/curriculum.txt` §§3–6 | Constraints, the existing Lesson 1 (12 object words, ق→g and ع spotlights, receptive-only until Lesson 4), the Stage 2 grammar table (pronoun suffixes, present tense, ما negation, question words, possessives) and the Stage 3 list (past tense, لو conditionals, comparatives, عشان/لأن, "بـ + verb for habitual" — see §4 for a correction on that last item). |

Own-knowledge items not verifiable online in this pass are flagged inline. The big reference works (Holes 1990 *Gulf Arabic* Croom Helm descriptive grammar; Johnstone 1967 *Eastern Arabian Dialect Studies*; Holes' *Dialect, Culture and Society in Eastern Arabia*) are behind paywalls and are cited from memory.

---

## 2. Variety to teach and why

**Recommendation: a "neutral Khaleeji" core** — the forms shared by urban Saudi (Eastern Province + Najdi-leaning Riyadh media speech), Kuwait, Bahrain, Qatar and the UAE — presented in the register `dialectSubvarieties.ts` already calls `khaliji-media` ("the levelled register of Gulf TV and adverts — deliberately no one country"). Reasons:

1. It is what the seeded video corpus actually is. The channel seed is ~60% Saudi, ~25% Kuwaiti, ~15% UAE/Qatar/Bahrain; a learner will hear all of them in the first week of Stage 2 video, so the course cannot pretend one country is "the" dialect.
2. The shared core is large. Pronouns, suffixes, verb morphology, ما/مو negation, وين/ليش/متى/منو/كم, عند/مع/فيه, بـ future, اللي, قاعد, واجد/وايد, زين, يالله, إن شاء الله, and 90% of the everyday lexicon are identical or trivially predictable across the five countries.
3. The systematic variants are few, regular, and *learnable as a table*. The course should teach the neutral form first and show the variant table as a "same word, different city" card, never as five separate vocabularies.

### 2.1 The neutral core, by decision

| Feature | Teach as core | Why |
|---|---|---|
| "How are you" | شلونك؟ *shlonak* (m) / شلونج؟ *shlonich* (f) — with شخبارك؟ *shkhbaarak* as the second greeting | شلونك is Kuwait/Qatar/Bahrain/Eastern Saudi and understood everywhere; the repo's own identity block and demonstrations use شلونك/شخبارك. |
| "What" | شنو *shinu* as core in Kuwaiti-facing content, وش *wish* in Saudi-facing content; teach both by Stage 1 L10 | Neither is "wrong" anywhere; the corpus splits ~50/50. |
| "Now" | الحين *al-Heen* (universal) and هالحين *halHeen* (the repo's default) | الحين is understood from Riyadh to Fujairah. |
| "I want" | أبي *abi* / يبي *yabi* as core; أبغى *abgha* / يبغى *yabgha* as the Saudi twin | ALWAYS_ALLOWED.Gulf carries ابي/يبي/بغيت; the DIALECT_EXTRA.Egyptian list treats يبي/إمبي as Gulf markers. |
| "A lot / very" | واجد *waajid* (Saudi/Kuwaiti older) and وايد *waayid* (UAE/Qatar/younger Kuwaiti) — teach as one word with two pronunciations | Same word, ج→y. |
| "Not" (before nouns/adjectives) | مو *mu* core; مب *mub* as Emirati/Qatari variant | Kuwaiti corpus: مو 93% (source 8). |
| Feminine "you" suffix | ـج *-ich* in Kuwait/Bahrain/Qatar/UAE; ـك *-ik* in Saudi. Teach ـك first (script-stable), then the ـج card | Kashkasha is the single most audible cross-country split; the app's own rules already note ك→ch. |
| ج | Show both /j/ and /y/ from Lesson 1; audio should be recorded in the sub-variety of the voice actor and labelled | See §3. |

### 2.2 Cross-country variant table (to be a recurring "same word, different city" card)

| Meaning | Kuwait | Bahrain/Qatar | UAE | Saudi Najd (Riyadh) | Saudi Hijaz (Jeddah) | Notes |
|---|---|---|---|---|---|---|
| How are you? (m/f) | شلونك / شلونج *shlonak / shlonich* | شلونك / شلونج; also شخبارك | شحالك / شحالج *shHaalak / shHaalich* | وشلونك / كيفك *wishlonak / keefak* | كيفك / كيف حالك *keefak* | شخبارك *shkhbaarak* "what's your news" works everywhere as the second question. |
| What? | شنو *shinu* / شـ+ (شسمك؟) | شنو / شو | شو *shu* | وش *wish* / وشو | إيش *eesh* | Kuwaiti prefixes شـ to verbs: شتبي؟ *shitbi* "what do you want?" — Emirati شو تبا؟ Najdi وش تبي؟ |
| Now | الحين / هالحين | الحين | الحين *alHeen* | الحين / هالحين | دحين *daHeen* | Never الآن. |
| Yes | إي *ee* / إيه | إي / هيه | هيه *heeh* / إي | إيه *eeh* / إي | أيوه *aywa* / إيه | لا "no" everywhere; بلى after a negative question. |
| I want | أبي *abi* | أبي / أبغى | أبا *aba* / أبغي | أبغى *abgha* / أبي / ودي | أبغى / أبى | 3ms يبي / يبغى / يبا. |
| Not (nominal) | مو | مو / مب | مب *mub* | مو / ماهوب *maahub* / مهوب | مو / مش (Hijazi) | Teach مو; never ليس. |
| Like this | جذي *chidhi* | جذي / كذا | جي *chee* / جذيه | كذا *chidha* / كذا | كده — **no**: Hijazi says كذا *kida* | كده is on the Gulf leak list; write كذا. |
| Very (Saudi) | واجد | واجد/وايد | وايد | مرة *marra* / واجد | مرة / كثير | مرة "very" is a Saudi shibboleth. |
| Tomorrow | باچر / باكر *baachir* | باكر | باكر *baachir* | بكرة / باكر *bukra* | بكرة *bukra* | Spell باكر in Kuwait/UAE materials, بكرة in Saudi. |
| Yesterday | أمس *ams* | أمس | أمس / البارحة | أمس / البارح | أمبارح *imbaariH* | البارحة *il-baarHa* is pan-Gulf "last night/yesterday". |
| Friend(s) | ربع *rab3* / صديق | ربع | ربع / رفيج | ربع / صديق | صاحب / صديق | ربع "the gang, my people" is the Gulf marker. |
| Kids | يهال *yihaal* / بزران | يهال | يهال | عيال *3yaal* | عيال | عيال is safest neutral. |
| Man / woman | ريّال *rayyaal* / حرمة | ريّال / حرمة | ريّال / حرمة | رجّال *rajjaal* / حرمة | رجّال / حرمة, ست | ج→y again. |
| Then / so | عيل *3eel* / يعني | عيل / عجل | عيل | أجل *ajal* / عجل | طيب / يعني | Discourse marker; teach at A2. |
| Send | طرّش *Tarrash* | طرّش | طرّش | أرسل / رسل | أرسل | Source 12. |
| Sit | قعد *gi3ad* | قعد | يلس *yilas* (جلس) | قعد / جلس | قعد | Progressive marker follows: قاعد vs يالس. |
| There is | فيه *fiih* / أكو *aku* | فيه / هست | فيه / هست *hast* | فيه | فيه | Teach فيه; mention أكو (Kuwait, from Iraqi) and هست (UAE/Qatar, from Persian). |
| Water | ماي *maay* | ماي | ماي | ماي / موية *moya* | موية *moya* | Lesson 1 already uses ماي; add موية as the Saudi card at Stage 1 L9. |
| Coffee (Arabic) | قهوة *gahwa* | قهوة | قهوة *gahwa* (also *jahwa* in old Emirati) | قهوة *gahwa* | قهوة *gahwa* | ق→g everywhere. |
| I don't know | ما أدري *ma adri* | ما أدري | ما أدري / ما عرف | ما أدري | ما أدري / ما أعرف | ما أدري is the Gulf marker. |
| Money | فلوس *fluus* | فلوس | فلوس / بيزات *beezaat* | فلوس | فلوس | Currency: دينار (KW/BH), ريال (SA/QA), درهم (UAE). |

Rule for authors: **write the neutral form in the lesson body; put the variant in a "🎯 same word, different city" side-card** with country flags. Do not invent a sixth "pan-Gulf" form that nobody says (e.g. never write ماذا, أين, كيف حالك as the Gulf line).

### 2.3 What is *not* core (do not teach before B1)

- Feminine plural pronouns/suffixes (إنتن/هن, ـكن/ـهن, تروحن/يروحن) — Bedouin/Najdi/inland Emirati only (`khaliji-badu`, `najdi`, `al-ain-inland` in the taxonomy). Mention once as a listening note.
- Bahrani (Shia village) forms, Omani forms, Shiḥḥi — flagged sub-varieties, out of scope.
- Hijazi-specific ث→ت / ذ→د / ق as *g* but with Egyptian-flavoured lexicon (كمان, ايوه, دحين) — show as "you will hear this in Jeddah" cards only.
- Gulf Pidgin Arabic (expat-worker register: في, ما في, سوي, أنا يروح) — learners will hear it in shops; teach recognition at B1 with a warning not to imitate it.

---

## 3. Script & sound notes for Pre-A1/A1

Lesson 1 already spotlights ق→g (قهوة), ع (عين), خ (خبز) and long ā (كتاب/باب). Build outward from that.

### 3.1 The Gulf consonant facts learners need

| Letter | MSA value | Gulf value(s) | Anchor words (already in / near Lesson 1) | Notes |
|---|---|---|---|---|
| ق | q | **g** (all countries), *j/dz* in some Kuwaiti/Bahraini words | قهوة *gahwa*, قال *gaal*, قلب *galb*, سوق *suug*, قريب *gareeb* | MSA re-imports keep /q/: القرآن, قانون, قصيدة. Source 7, 9. Kuwaiti رفيق→*rafiij* "friend" (source 9). |
| ج | j | **j** in Saudi; **y** in Kuwait/UAE/Qatar/Bahrain for inherited words | دجاج *diyaay/dijaaj*, جا *ya/ja*, واجد *waayid/waajid*, رجّال *rayyaal/rajjaal*, جديد *yideed/jideed* | Never in MSA loans: جامعة *jaami3a*, مسجد *masjid/masyid* both heard. **Decision needed:** the app's `TRANSLITERATION_RULES.Gulf` says "ج → y"; with Saudi voices in the corpus this will mislabel half the clips. Recommend the rule read "ج → j (Saudi) / y (Kuwait, UAE, Qatar, Bahrain); follow the speaker" and that lesson cards show both. |
| ك | k | **ch** before/after front vowels and in the 2fs suffix in Kuwait/Bahrain/Qatar/UAE/Eastern Saudi; **k** in Najd/Hijaz | كيف *cheef/keef*, سمك *simach/simak*, كلب *chalb/kalb*, شلونك→شلونج *shlonich* | Source 7 ("most often in the 2fs suffix"), 9. Spelling: Kuwait writes چ or ج; UAE writes ج. |
| ث ذ ظ | θ ð ðˤ | **kept** (unlike Cairo/Levant) — ثلاث *thalaath*, ذاك *dhaak*, ظهر *DHuhur* | Hijaz merges ث→ت/س, ذ→د/ز in "mixed" speech (source 10) — mark as Jeddah card. |
| ض / ظ | ḍ / ðˤ | merge to **ظ** (DH): ضرب *DHarab*, بعض *ba3aDH* | Source 9. Teach one emphatic sound for both letters. |
| ع | ʿ | ʿ (pharyngeal) — عين, عشا, سبع, عشرة, عيال | Already spotlighted. |
| ح | ḥ | H — حليب *Haleeb*, حلو *Hilu*, الحين *alHeen*, حرمة | |
| خ / غ | x / ɣ | kh / gh — خبز, خالي "my uncle", غالي "expensive", غدا "lunch" | |
| ه | h | h; final ـه after vowels = *-h* (بيته *beetah*) | |
| ء | ʔ | often dropped: أكل→*akal/kal*, أخذ→*khadh*; ماي not ماء; شي not شيء | The identity block already insists on شي. |
| Emphatics ص ط ض/ظ | | Capitalise in translit: صار *Saar*, طلع *Tila3*, ظهر *DHuhur*; they colour neighbouring vowels (سوق *suug* with a dark u). | |
| Imāla | | final ـة/ـه after non-emphatics tends to *-e*: بيتها *beetha/beethe* (source 9), مدرسة *madrese* in Bahrain/Kuwait | Listening note only. |

### 3.2 Vowel patterns worth a card each
- Short *i/u* in unstressed closed syllables where MSA has *a*: كتب *kitab* "he wrote", شرب *shirab*, سمع *sima3*, قعد *gi3ad*. Teach the past tense with this vowel from the start (§4).
- CvCC → CvCvC at the end of a word: ظهر *DHuhur*, شهر *shahar*, بحر *baHar*, عشر *3ashar*.
- Diphthongs stay: بيت *beet/bayt*, يوم *yoom*, لون *loon*. (Lesson 1 uses *bayt*; either is fine, be consistent per voice.)
- Stress: penultimate heavy syllable — *ma-DRA-sa*, *si-YAA-ra*, *shlo-NICH*.

### 3.3 Suggested "sound spotlight" per early lesson (Stage 1)

| Lesson | Spotlight | Anchor words |
|---|---|---|
| L1 (exists) | ق = g, ع, خ, long ā | قهوة, عين, خبز, كتاب |
| L2 | ح vs ه; ص | حليب, ساعة, هذا; صحن |
| L3 | ج = j / y (two voices, one word) | جدة/يدة "grandma", دجاج, أخوي |
| L4 | Greeting intonation; ـك vs ـج (شلونك/شلونج) | شلونك, شلونج, شخبارك |
| L5 | ك→ch "kashkasha" listening; ث/ذ kept | كيف/چيف, ثلاث, ذاك |
| L6 | Numbers: ث in ثنين/ثلاث/ثمان; ع in أربع/سبع/تسع/عشر | ثنين, ثلاث, أربع, سبع, عشرة |
| L7 | Hamza dropping; ماي/موية | أنا→آنا, اسمي, ماي/موية |
| L8 | ط / ض~ظ emphatics | طيب, تفضل, ضيف/ظيف |
| L9 | غ vs خ; ي vs ج in واجد/وايد | غدا, غالي, خبز, واجد |
| L10 | ذ in هذا/هذي/ذاك; ش prefix شنو/شسمك | هذا, هذي, ذاك, شنو |
| L11 | و/ي long vowels; يوم/وين | وين, يوم, بيت, سوق |
| L12 | Stress & imāla; putting it together | مدرسة, سيارة, بيتها |

Script sequencing (Module 1A of the design doc) can run in parallel; the first four lessons should never *require* reading — Al Ramsa teaches its whole A1 in transliteration (source 16), and the existing Lesson 1 is receptive-only by design.

---

## 4. Grammar inventory A1 → A2 → B1

Ordering principle (from Qafisheh's syntax order and Holes' unit order, sources 1–2): nominal sentences → pseudo-verbal sentences (عند/في/مع) → the verb (imperfect first, because it carries wants/needs/routines; past second) → subordination. Each entry: target level, taxonomy id, forms, examples (Arabic / translit / gloss), traps.

Levels: **A1** = Stage 1 late & Stage 2 early; **A2** = Stage 2; **B1** = Stage 3.

### 4.1 Subject pronouns & the verbless sentence — A1 — `pronouns`, `sentence-structure`

| | Singular | Plural |
|---|---|---|
| 1 | آنا / أنا *aana* | إحنا *iHna* (also نحن *niHin* Bedouin/Emirati, حنّا *Hinna* Najdi) |
| 2m | إنت *inta* | إنتو *intu* / إنتم *intum* |
| 2f | إنتي *inti* (Kuwaiti/Emirati also إنتِ *inti*) | (إنتن *intin* — badu only) |
| 3m | هو *huwa* | هم *hum* |
| 3f | هي *hiya* | (هن *hin* — badu only) |

No "to be" in the present: pronoun + noun/adjective. Adjective agrees m/f/pl.

- آنا من الكويت. *aana min il-kweet.* — I'm from Kuwait.
- إنتي تعبانة؟ *inti ta3baana?* — Are you (f) tired?
- هم بالبيت. *hum bil-beet.* — They're at home.
- هذا الأكل زين واجد. *haadha l-akil zeen waajid.* — This food is very good.

Traps: never ليس/لست for "not" (§4.6); write آنا or أنا, both are Gulf. بـ "in/at" (بالبيت) is as common as في.

### 4.2 Demonstratives & هالـ — A1 — `pronouns`

| | near | far |
|---|---|---|
| m | هذا *haadha* | هذاك *hadhaak* / ذاك *dhaak* |
| f | هذي *haadhi* | هذيك *hadheech* / ذيك *dheech* |
| pl | هذول *hadhool* / هذيل *hadheel* | هذولاك *hadhoolaak* / ذولاك |
| attached | هالـ *hal-* + noun: هالبيت *hal-beet*, هالحين *halHeen*, هالمرة *hal-marra*, هاليوم *hal-yoom* | |

- شنو هذا؟ — هذا قلم. *shinu haadha? — haadha galam.* — What's this? — It's a pen. (source 5)
- هذي سيارتي وهذيك سيارة أخوي. *haadhi sayyaarti w-hadheech sayyaarat akhuuy.* — This is my car and that one is my brother's.
- هالأكل حلو. *hal-akil Hilu.* — This food is tasty.
- هذول ربعي. *hadhool rab3i.* — These are my friends.

Traps: ذلك/هؤلاء/تلك are on the universal leak list — use ذاك/هذول. هذه is whitelisted but prefer هذي in dialogue. Emirati sometimes ذي *dhi* for هذي.

### 4.3 Possessive suffixes — A1 — `possessives`

| | after consonant | after vowel (أبو, أخو, في, على) |
|---|---|---|
| my | ـي *-i* — بيتي *beeti* | ـي *-y* — أبوي *abuuy*, أخوي *akhuuy* |
| your m | ـك *-ak* — بيتك *beetak* | ـك *-k* — أبوك *abuuk* |
| your f | ـك *-ik* (Saudi) / ـج *-ich* (KW, BH, QA, UAE) — بيتك *beetik* / بيتج *beetich* | أبوج *abuuch* |
| his | ـه *-ah/-uh* — بيته *beetah* | أبوه *abuuh* |
| her | ـها *-ha* — بيتها *beetha* | أبوها *abuuha* |
| our | ـنا *-na* — بيتنا *beetna* | أبونا *abuuna* |
| your pl | ـكم *-kum* — بيتكم *beetkum* | أبوكم *abuukum* |
| their | ـهم *-hum* — بيتهم *beethum* | أبوهم *abuuhum* |

Feminine nouns in ـة take *-t-* before the suffix: سيارة→سيارتي *sayyaarti*, مدرسة→مدرستها *madrasatha*, قهوة→قهوتك *gahwatak*.

- هذا بيتنا وهذا بيتكم. *haadha beetna w-haadha beetkum.* — This is our house and this is yours.
- أمي وأبوي بالبيت. *ummi w-abuuy bil-beet.* — My mum and dad are at home.
- شلونك؟ شلون أهلك؟ *shlonak? shlon ahlak?* — How are you? How's your family?

Traps: ـكِ *-ki* is MSA; Gulf feminine is *-ik/-ich*. Do not write ـكِ with a kasra.

### 4.4 Object suffixes — A2 — `pronouns`

Same set as §4.3 except 1s = ـني *-ni*. Attach to verbs and to some particles.

- شفتك أمس بالسوق. *shiftak ams bis-suug.* — I saw you yesterday at the market.
- عطني الماي لو سمحت. *3aTni l-maay law samaHt.* — Give me the water, please.
- خلّها عندك. *khallha 3indak.* — Keep it with you.
- أحبك / أحبج. *aHibbak / aHibbich.* — I love you (m/f).

### 4.5 Possession beyond suffixes: حق / مال, and the iḍāfa — A2 — `possessives`

- Iḍāfa: بيت أبوي *beet abuuy* "my father's house", سيارة خالد *sayyaarat khaalid*.
- حق *Hagg* (Saudi, Qatar, Bahrain, also UAE): الكتاب حقي *il-kitaab Haggi* "the book is mine"; السيارة حقت أخوي *is-sayyaara Haggat akhuuy*. (source 10)
- مال *maal* (Kuwait, Bahrain, UAE): الكتاب مالي *il-kitaab maali*; الثلاجة مالتها *ith-thallaaja maalatha* "her fridge". Full paradigm مالي/مالك/مالج/ماله/مالها/مالنا/مالكم/مالهم, feminine مالتي… (source 4)
- لـ *li-* "belongs to": هذا لي / هذا لك *haadha li / haadha lik*; لمن هذا؟ *li-man haadha?* "whose is this?"

- هذا الجوال حق منو؟ — حقي. *haadha l-jawwaal Hagg minu? — Haggi.* — Whose phone is this? — Mine.
- الشنطة مال أختي. *ish-shanTa maal ukhti.* — The bag is my sister's.
- عندك سيارة؟ — إي، بس مو لي، لأبوي. *3indak sayyaara? — ee, bas mu li, l-abuuy.* — Got a car? — Yes, but it's not mine, it's my dad's.

Traps: بتاع is Egyptian, تبع is Levantine — never in Gulf text. Prefer حق in Saudi-facing and مال in Kuwaiti/Emirati-facing lessons; both understood everywhere.

### 4.6 Negation — A1 (ما, لا) → A2 (مو/مب, ولا, محد) — `negation`

| Negates | Particle | Example |
|---|---|---|
| verbs (all tenses) | ما *ma* | ما أبي *ma abi* "I don't want"; ما رحت *ma riHt* "I didn't go"; ما بروح *ma baruuH* "I won't go" |
| pseudo-verbs عند/مع/في/لـ | ما | ما عندي فلوس *ma 3indi fluus*; ما فيه *ma fiih* "there isn't"; ما معي *ma ma3i* |
| nouns/adjectives/pronouns | مو *mu* (KW/SA/BH/QA) · مب *mub* (UAE/QA) · ماهوب/مهوب *maahub* (Najdi) | آنا مو جوعان *aana mu juu3aan* "I'm not hungry"; هذا مب زين *haadha mub zeen* "this isn't good" |
| imperatives | لا *la* + imperfect | لا تروح *la truuH* "don't go"; لا تنسين *la tinseen* (f) |
| "no" / "neither…nor" | لا; ولا…ولا | لا، ما أبي. *la, ma abi.*; لا شاي ولا قهوة *la chaay wala gahwa* |
| nobody / nothing / never | محد *maHHad*, ما شي *ma shay* / ولا شي *wala shay*, أبد *abad*/ أبداً, كلش ما *killish ma* (KW) | محد جا *maHHad ya* "nobody came"; ما شي *ma shay* "nothing" (UAE, source 12) |
| tag "isn't it?" | مو كذا؟ *mu chidha?* / مو جذي؟ *mu chidhi?* / مب جي؟ *mub chee?* | حلو، مو كذا؟ — "nice, isn't it?" |

- ما أدري وين هو. *ma adri ween huwa.* — I don't know where he is.
- هذا مو بيتي، بيت جاري. *haadha mu beeti, beet jaari.* — This isn't my house, it's my neighbour's.
- لا تسوي كذا! *la tsawwi chidha!* — Don't do that!
- ما عندي وقت الحين. *ma 3indi wagt alHeen.* — I don't have time now.

Traps: **ليس/لست never** (universal leak list). **مش** is Egyptian/Levantine; Abu Dhabi and Hijaz do say it (source 7), but the corpus norm is مو/مب — do not generate مش. **مو vs مب**: identical function; choose by the lesson's country card, never mix in one speaker's mouth. Najdi ماهوب/ماهيب/ماهم *maahub/maahib/maahum* agree with the subject — advanced listening note only.

### 4.7 Question words & yes/no questions — A1 (شنو/وش, وين, شلون/كيف, كم/بكم, منو) → A2 (ليش, متى, شكثر/شقد, أي, لمن) — `questions`

| Meaning | Core | Variants | Example |
|---|---|---|---|
| what | شنو *shinu* / وش *wish* | شو *shu* (UAE/QA), إيش *eesh* (Hijaz); prefixed شـ: شسمك؟ *sh-ismak*, شتبي؟ *shitbi*, شفيك؟ *shfiik* "what's wrong with you" | شنو هذا؟ / وش هذا؟ *shinu / wish haadha?* |
| where | وين *ween* | من وين *min ween* "from where"; لوين *li-ween* "to where" | وين الحمام؟ *ween il-Hammaam?* |
| how | شلون *shlon* / كيف *keef* | شحال- (UAE greeting only) | شلون أروح السوق؟ *shlon aruuH is-suug?* |
| why | ليش *leesh* | علاش (Omani, ignore) | ليش ما جيت؟ *leesh ma yeet/jeet?* |
| when | متى *mita* | يوم؟ (relative only) | متى تروح الدوام؟ *mita truuH id-dawaam?* |
| who | منو *minu* (KW/BH/QA/UAE) / من *min* (SA) | مين *miin* (Hijaz) | منو هذا؟ *minu haadha?* |
| how much (price) | بكم *bikam* | بچم *bicham* (KW) | بكم هذا؟ *bikam haadha?* |
| how many | كم *kam* + singular | | كم ولد عندك؟ *kam walad 3indak?* |
| how much (quantity) | شكثر *shkithir* (KW/BH), شقد *shgadd* (SA/QA/UAE) | كم | شكثر تبي؟ *shkithir tabi?* "how much do you want?" |
| which | أي *ayy* / يا *ya* | | أي واحد؟ *ayy waaHid?* |
| whose | حق منو / لمن *li-man* | مال منو | هذا حق منو؟ |
| is it…? (yes/no) | intonation only | | إنت كويتي؟ *inta kweeti?* |

- وين رحت أمس؟ — رحت بيت خالي. *ween riHt ams? — riHt beet khaali.* (from the repo demonstrations)
- شنو تبي تشرب؟ قهوة ولا شاي؟ *shinu tabi tishrab? gahwa wala chaay?* — What do you want to drink? Coffee or tea?
- ليش متأخر؟ *leesh mit'akhkhir?* — Why (are you) late?
- الساعة كم؟ *is-saa3a kam?* — What time is it?

Traps: never لماذا/ماذا/أين/هل/من أين. Question word usually stays *in situ* or fronted — both are fine (رحت وين؟ / وين رحت؟). Kuwaiti/Emirati ش- prefixing (شسوي؟ *shasawwi* "what should I do?") deserves its own card at A2.

### 4.8 Existence فيه / ما فيه — A1 — `sentence-structure`

- فيه *fiih* "there is/are"; ما فيه *ma fiih* "there isn't". Kuwaiti أكو / ماكو *aku / maaku*; Emirati/Qatari هست / ما هست *hast / ma hast* (variants only).
- فيه قهوة؟ — إي فيه. *fiih gahwa? — ee fiih.* — Is there coffee? — Yes, there is.
- ما فيه مشكلة. *ma fiih mushkila.* — No problem.
- فيه واحد بالباب. *fiih waaHid bil-baab.* — There's someone at the door.

### 4.9 "Have": عند / مع / لـ — A1 — `possessives` (pseudo-verbal)

| | عند (possess) | مع (have on you) | لـ (belong / have a relation) |
|---|---|---|---|
| I | عندي *3indi* | معي *ma3i* / معاي *ma3aay* | لي *li* |
| you m/f | عندك *3indak* / عندك *3indik* (عندج *3indich*) | معك *ma3ak* / معج | لك *lik* |
| he/she | عنده *3indah* / عندها *3indaha* | معه *ma3ah* / معها | له *lah* / لها |
| we/you pl/they | عندنا / عندكم / عندهم | معنا / معكم / معهم | لنا / لكم / لهم |

- عندي سيارة بس ما عندي رخصة. *3indi sayyaara bas ma 3indi rukhSa.* — I have a car but no licence.
- معك فلوس؟ *ma3ak fluus?* — Got money on you?
- لي أخ وأختين. *li akh w-ukhteen.* — I have a brother and two sisters.
- عندك دوام باكر؟ *3indak dawaam baachir?* — Do you have work tomorrow?

Past: كان عندي *kaan 3indi* "I had"; future: بيكون عندي *biykuun 3indi*.
Traps: never لدي/لديك. عند + person = "at X's place": عند خالي *3ind khaali* "at my uncle's".

### 4.10 Present tense (imperfect) — A1 (1s/2ms/3ms with أبي/أروح/أشرب) → A2 (full paradigm) — `verb-conjugation`

Paradigm of راح *raaH* "go" (hollow) and كتب *kitab* "write" (sound); prefixes *a-/ti-/yi-/ni-* with the vowel often dropped in speech (source 5):

| | راح | كتب | سوّى "do/make" |
|---|---|---|---|
| آنا | أروح *aruuH* | أكتب *aktib* | أسوي *asawwi* |
| إنت | تروح *truuH* | تكتب *tiktib* | تسوي *tsawwi* |
| إنتي | تروحين *truuHeen* | تكتبين *tiktibeen* | تسوين *tsawween* |
| هو | يروح *yruuH* | يكتب *yiktib* | يسوي *ysawwi* |
| هي | تروح *truuH* | تكتب *tiktib* | تسوي *tsawwi* |
| إحنا | نروح *nruuH* | نكتب *niktib* | نسوي *nsawwi* |
| إنتو | تروحون *truuHuun* | تكتبون *tiktibuun* | تسوون *tsawwuun* |
| هم | يروحون *yruuHuun* | يكتبون *yiktibuun* | يسوون *ysawwuun* |

The bare imperfect covers present habitual *and* present general *and* "want/plan" complements — there is **no indicative بـ** as in Egyptian (بيروح) or Levantine. Saying بيروح in Gulf means "he *will* go" (§4.11).

- كل يوم أروح الدوام الساعة سبع. *kill yoom aruuH id-dawaam is-saa3a sab3.* — Every day I go to work at seven.
- تشربين قهوة؟ *tishrabeen gahwa?* — Do you (f) drink coffee?
- وين تسكن؟ — أسكن بالدمام. *ween tiskin? — askin bid-dammaam.* — Where do you live? — In Dammam.
- شتسوون هالحين؟ *sh-tsawwuun halHeen?* — What are you (pl) doing now?

Traps: the -ūn/-īn endings are kept (تروحون, تروحين) — never the MSA ـونَ/ـينَ with nūn-dropping. The design doc's Stage 2 table has "بـ + verb prefix for habitual actions" — that is the Egyptian/Levantine function; **in Gulf the bare imperfect is habitual and بـ is future/intent/irrealis** (source 6). Fix that line in the design doc.

### 4.11 Future & intention: بـ, راح, and يبي — A2 — `verb-conjugation`

- بـ *b-* + imperfect: بروح *baruuH* "I'll go", بتروح *bitruuH*, بتروحين *bitruuHeen*, بيروح *biyruuH*, بنروح *binruuH*, بتروحون *bitruuHuun*, بيروحون *biyruuHuun*. Also "would" in conditionals (§4.20) and past habitual with كان.
- راح *raaH* / رح *raH* + imperfect: راح أروح *raaH aruuH* — the more purely future marker (source 6), commoner in Saudi/Oman and younger speakers.
- Intention with يبي: أبي أروح *abi aruuH* "I want to go / I'm going to go".
- Negative future: ما بروح *ma baruuH* / مو رايح أروح *mu raayiH aruuH* / ما راح أروح.

- باكر بروح البحر. *baachir baruuH il-baHar.* — Tomorrow I'll go to the sea.
- بتجي معنا؟ *bityi/bitji ma3na?* — Will you come with us?
- راح نسافر الصيف إن شاء الله. *raaH nsaafir iS-Seef in shaa' allah.* — We'll travel in the summer, God willing.
- إن شاء الله بشوفك بكرة. *in shaa' allah bashuufak bukra.* — I'll see you tomorrow, God willing.

Traps: **never سوف or سـ** (leak list). Always follow a future with إن شاء الله in dialogue models — it is grammatical politeness in the Gulf. Persson's examples show بـ in non-future: الناس بيكونون عايشين في خيام "(if…) people would be living in tents"; عدد سكان عمان كل يوم بيزيد "the population increases every day" — so do not gloss بـ as "will" mechanically.

### 4.12 Wants, needs, ability, permission — A1 (أبي/يبي, لازم, ممكن) → A2 (أقدر, ودي, يعرف, خلني) — `verb-conjugation`, `sentence-structure`

| Meaning | Forms | Notes |
|---|---|---|
| want | أبي *abi*, تبي *tabi*, تبين *tabeen*, يبي *yabi*, نبي *nabi*, تبون *tabuun*, يبون *yabuun*; Saudi أبغى/تبغى/يبغى *abgha/tabgha/yabgha*; Emirati أبا/تبا/يبا *aba/taba/yaba*; past بغيت *bagheet* | Complement = bare imperfect: أبي أشرب *abi ashrab*. |
| would like / I'd rather | ودي *widdi*, ودك *widdak*, وده *widdah* | ودي أروح *widdi aruuH* "I'd love to go"; ما ودي *ma widdi* "I'd rather not" (source 5). |
| must / have to | لازم *laazim* (invariable) | لازم تروح *laazim truuH*; ما لازم / مو لازم *mu laazim* "no need". |
| can (possibility/permission) | ممكن *mumkin* | ممكن أدخل؟ *mumkin adkhul?* "may I come in?" |
| can (ability) | أقدر *agdar*, تقدر *tigdar*, يقدر *yigdar*; past قدرت *gidart* | ما أقدر *ma agdar* "I can't". |
| know how to | أعرف *a3arif* + imperfect | أعرف أسوق *a3arif asuug* "I can drive". |
| let me / let him | خلني *khallni*, خله *khallah*, خلنا *khallna* | خلني أشوف *khallni ashuuf* "let me see". |
| it needs | يبيله *yabiilah* / يباله *yabaalah* | يبيله وقت *yabiilah wagt* "it needs time". |
| is it OK / does it work | يصير؟ *ySiir?* / ما يصير *ma ySiir* | ما يصير كذا "that's not on". |

- أبي قهوة لو سمحت. *abi gahwa law samaHt.* — I'd like a coffee please.
- لازم أروح البيت الحين. *laazim aruuH il-beet alHeen.* — I have to go home now.
- تقدر تساعدني؟ *tigdar tsaa3idni?* — Can you help me?
- ممكن تعيد مرة ثانية؟ *mumkin t3iid marra thaanya?* — Could you say that again? (source 14)

Traps: أريد is MSA — the vocab rules list إمبي/أبي instead. **يبي vs يبغى**: same verb (بغى), Saudi keeps the غ; both fine, keep one per speaker. Never يريد/أريد/يرغب.

### 4.13 Imperatives — A1 (روح/تعال/خذ/عطني/قول/شوف/اقعد/تفضل) → A2 (full, negative) — `verb-conjugation`

| verb | m | f | pl |
|---|---|---|---|
| go | روح *ruuH* | روحي *ruuHi* | روحوا *ruuHu* |
| come | تعال *ta3aal* | تعالي *ta3aali* | تعالوا *ta3aalu* |
| take | خذ *khudh* | خذي *khidhi* | خذوا *khidhu* |
| give me | عطني *3aTni* | عطيني *3aTiini* | عطوني *3aTuuni* |
| say/tell me | قول / قلي *guul / gil-li* | قولي / قوليلي | قولوا |
| look/see | شوف *shuuf* | شوفي *shuufi* | شوفوا *shuufu* |
| sit | اقعد *ig3ad* (UAE ايلس *iylis*) | اقعدي | اقعدوا |
| eat / drink | كل *kil* / اشرب *ishrab* | كلي / اشربي | كلوا / اشربوا |
| listen | اسمع *isma3* | اسمعي | اسمعوا |
| wait | انطر *inTir* (KW/BH/UAE) / انتظر *intaDHir* (SA) | انطري | انطروا |
| stop/stand | وقّف *waggif* / اوقف *oogaf* | | |
| do | سوّ *saww* / سوي *sawwi* | سوي | سووا |
| let's go | يالله *yalla* | | |
| please (formula) | لو سمحت *law samaHt* / تفضل *tfaDDal* / الله يخليك *allah ykhalliik* | لو سمحتي / تفضلي | لو سمحتوا / تفضلوا |

Negative: لا + imperfect: لا تروح / لا تروحين / لا تروحون *la truuH / la truuHeen / la truuHuun*.

- تعال هني! *ta3aal hini!* — Come here!
- خذ هذا وعطني ذاك. *khudh haadha w-3aTni dhaak.* — Take this and give me that.
- لا تنسى الفلوس. *la tinsa l-fluus.* — Don't forget the money.
- تفضل، اقعد. *tfaDDal, ig3ad.* — Please, sit down.

Traps: MSA لا تذهب, اذهب, هيا — never. تعال is the only "come" (never إجي/تعالى with ى in MSA spelling).

### 4.14 Past tense (perfect) — A2 (sound + hollow, 1s/2s/3s) → late A2 (full) — `verb-conjugation`

| | كتب "write" (sound) | راح "go" (hollow) | شرب "drink" | مشى "walk" (defective) | جا / يا "come" |
|---|---|---|---|---|---|
| آنا | كتبت *kitabt* | رحت *riHt* | شربت *shirabt* | مشيت *misheet* | جيت / ييت *jeet / yeet* |
| إنت | كتبت *kitabt* | رحت *riHt* | شربت | مشيت | جيت |
| إنتي | كتبتي *kitabti* | رحتي *riHti* | شربتي | مشيتي | جيتي |
| هو | كتب *kitab* | راح *raaH* | شرب *shirab* | مشى *misha* | جا / يا *ja / ya* |
| هي | كتبت *kitbat* | راحت *raaHat* | شربت *shirbat* | مشت *mishat* | جات / يات *jaat / yaat* |
| إحنا | كتبنا *kitabna* | رحنا *riHna* | شربنا | مشينا | جينا |
| إنتو | كتبتوا *kitabtu* | رحتوا *riHtu* | شربتوا | مشيتوا | جيتوا |
| هم | كتبوا *kitbaw* | راحوا *raaHaw* | شربوا *shirbaw* | مشوا *mishaw* | جوا / ياو *jaw / yaw* |

Gulf hallmarks: 3ms *kitab/shirab* (i-vowel), 3fs *kitbat* (vowel dropped), 3pl *-aw* (كتبوا *kitbaw*, راحوا *raaHaw*; source 4 gives ياو *yaaw* "they came"). Hollow verbs shorten in 1/2 persons: قال→قلت *gilt*, شاف→شفت *shift/chift*, كان→كنت *kint*, جاب→جبت *jibt*, نام→نمت *nimt*.

- رحت السوق وشريت عيش. *riHt is-suug w-shireet 3eesh.* — I went to the market and bought rice.
- وين كنت أمس؟ — كنت عند أهلي. *ween kint ams? — kint 3ind ahli.* — Where were you yesterday? — At my family's.
- جاو الربع وقعدنا بالمجلس لين الفجر. *jaw ir-rab3 w-gi3adna bil-majlis leen il-fajir.* — The guys came and we sat in the majlis till dawn.
- شفتي الفيلم؟ — لا، ما شفته. *shifti l-film? — la, ma shiftah.* — Did you (f) see the film? — No, I didn't.

Traps: MSA ذهب/رأى/أراد never; Gulf is راح/شاف/بغى. MSA 3pl كتبوا *katabuu* vs Gulf *kitbaw* — TTS needs the tashkeel كِتْبَوْ. أكل/أخذ lose the hamza: كل *kal* "he ate" (KW/UAE) or أكل *akal* (SA); خذ *khadh* "he took" (KW/UAE), أخذ *akhadh* (SA).

### 4.15 كان + noun / + imperfect / + participle — A2 → B1 — `verb-conjugation`, `sentence-structure`

- كان + noun/adj = past state: كان تعبان *kaan ta3baan* "he was tired"; كانت الدنيا حر *kaanat id-dinya Harr* "it was hot".
- كان + imperfect = past habitual/continuous: كنت أروح كل يوم *kint aruuH kill yoom* "I used to go every day". With بـ: كان بيروح "he was going to go".
- كان + عند/في: كان عندي *kaan 3indi* "I had"; كان فيه *kaan fiih* "there was".
- Future/hypothetical: بيكون *biykuun*, يكون *ykuun*.
- صار *Saar* "became / happened": شصار؟ *sh-Saar?* "what happened?"; صار الوقت *Saar il-wagt* "it's time".

- أول كنا نسكن بالكويت، الحين بالرياض. *awwal kinna niskin bil-kweet, alHeen bir-riyaaDH.* — We used to live in Kuwait, now in Riyadh.
- كان عندهم عزيمة واجد حلوة. *kaan 3indhum 3aziima waajid Hilwa.* — They had a really nice dinner party. (repo demonstration)
- ما كان فيه أحد بالبيت. *ma kaan fiih aHad bil-beet.* — There was nobody home.

### 4.16 Active participles as tense — A2 (رايح, جاي, قاعد, ساكن, عارف) → B1 (ماخذ, شايف, ناسي, متأخر, مسافر) — `verb-conjugation`

The participle (فاعل pattern) is the everyday "-ing / have done" form. It agrees m/f/pl (رايح / رايحة / رايحين).

| participle | meaning | example |
|---|---|---|
| رايح *raayiH* | going / about to go | وين رايح؟ *ween raayiH?* "where are you off to?" |
| جاي / ياي *jaay / yaay* | coming | آنا جاي *aana jaay* "I'm on my way" |
| قاعد *gaa3id* / يالس *yaalis* | sitting; (aux: in the middle of) | قاعد بالبيت *gaa3id bil-beet* |
| ساكن *saakin* | living (resident) | ساكن بالشارقة *saakin bish-shaarja* |
| عارف *3aarif* | knowing | ما آنا عارف *ma ana 3aarif* "I don't know / I'm not aware" |
| ماخذ *maakhidh* | having taken | ماخذ إجازة *maakhidh ijaaza* "I've taken leave" |
| شايف *shaayif* | having seen / seeing | شايفه؟ *shaayfah?* "have you seen him?" |
| ناسي *naasi* | having forgotten | ناسي اسمه *naasi ismah* |
| نايم *naayim* | asleep | لا تدق، نايمين *la tdigg, naaymiin* |
| فاهم *faahim* | understanding | فاهم عليك *faahim 3aleek* "I get you" |
| واقف *waagif* | standing / parked | السيارة واقفة برا *is-sayyaara waagfa barra* |
| مسافر *msaafir* | away travelling | أبوي مسافر *abuuy msaafir* |
| متأخر *mit'akhkhir* | late | ليش متأخر؟ |
| ماكل / شارب *maakil / shaarib* | have eaten / drunk | ماكل؟ *maakil?* "have you eaten?" |
| راجع *raaji3* | coming back | توني راجع من السوق *tawni raaji3 min is-suug* (repo demonstration) |

- آنا رايح الدوام، بتجي؟ *aana raayiH id-dawaam, bityi?* — I'm heading to work, coming?
- إنتي ساكنة وين؟ *inti saakna ween?* — Where do you (f) live?
- هو ماخذ سيارتي. *huwa maakhidh sayyaarti.* — He's taken my car.

### 4.17 Progressive: قاعد / يالس + imperfect — A2 — `verb-conjugation`

- قاعد *gaa3id* (KW/SA/BH/QA), يالس *yaalis* (UAE, from جالس) + imperfect; agrees: قاعدة *gaa3da*, قاعدين *gaa3diin*. Bare imperfect also works for "now" with الحين. (source 5: قاعدة تكتب رسالة "she is writing a letter".)
- شتسوي؟ — قاعد آكل. *sh-tsawwi? — gaa3id aakil.* — What are you doing? — I'm eating.
- الحين يالسين نتريا الباص. *alHeen yaalsiin nitrayya l-baaS.* — We're waiting for the bus now. (UAE)
- كانوا قاعدين يسولفون. *kaanaw gaa3diin ysoolfuun.* — They were chatting.

Traps: Levantine عم / Egyptian بـ never. Kuwaiti also uses قام + imperfect for "started to" (source 7): قام يصيح *gaam ySiiH* "he started shouting" — B1 listening note.

### 4.18 Relative clause اللي — A2 → B1 — `sentence-structure`

اللي *illi* for all genders/numbers, after a definite noun; indefinite heads take no relative. Resumptive pronoun stays.

- الريّال اللي شفته أمس كويتي. *ir-rayyaal illi shiftah ams kweeti.* — The man I saw yesterday is Kuwaiti.
- هذي المطعم اللي قلت لك عنه. *haadha l-maT3am illi gilt lik 3annah.* — This is the restaurant I told you about.
- اللي يبي يجي، يجي. *illi yabi yiyi, yiyi.* — Whoever wants to come, come.
- سوي اللي تبيه. *sawwi lli tabiih.* — Do what you want.

Traps: الذي/التي/الذين are on the leak list. Note the Yemeni corpus counts in the detector comments (اللي 4,406 vs الذي 2,259) — Gulf is even more lopsided.

### 4.19 Comparative & superlative — A2 → B1 — `sentence-structure`

Pattern أفعل *af3al* (source 5): كبير→أكبر *akbar*, صغير→أصغر *aSghar*, زين/حلو→أحسن *aHsan* / أحلى *aHla*, رخيص→أرخص *arkhaS*, غالي→أغلى *aghla*, كثير→أكثر *akthar*, قليل→أقل *agall*, طويل→أطول *aTwal*, قريب→أقرب *agrab*, سهل→أسهل *ashal*, صعب→أصعب *aS3ab*, سريع→أسرع *asra3*, جديد→أجدد *ajdad*, قديم→أقدم *agdam*. Invariable for gender. Comparative + من *min*; superlative = أفعل + indefinite noun, or الـ + أفعل, or أفعل واحد.

- الرياض أكبر من الدوحة. *ir-riyaaDH akbar min id-dooHa.* — Riyadh is bigger than Doha.
- هذا أرخص شوي. *haadha arkhaS shway.* — This one is a bit cheaper.
- أحسن مطعم بالحي هذا. *aHsan maT3am bil-Hayy haadha.* — This is the best restaurant in the neighbourhood.
- منو أطول، إنت ولا أخوك؟ *minu aTwal, inta wala akhuuk?* — Who's taller, you or your brother?
- Periphrastic for long adjectives: مهم أكثر *muhimm akthar* "more important"; زيادة *ziyaada* "more/extra".

### 4.20 Conditionals: إذا / لو / إن — B1 — `sentence-structure`

- إذا *idha* — real/likely; apodosis imperative, imperfect or بـ-future.
- لو *law* — hypothetical/counterfactual, but in speech also "if" generally; counterfactual apodosis often كان + past or بـ (source 6: 64% of non-future بـ sits in conditionals).
- إن *in* — fixed phrases (إن شاء الله) and Najdi conditionals إن جيت *in jeet*.
- Also لو … لو / يا … يا "whether…or"; حتى لو *Hatta law* "even if".

- إذا جيت الكويت، اتصل فيني. *idha jeet il-kweet, ittaSil fiini.* — If you come to Kuwait, call me.
- لو عندي فلوس كان اشتريت بيت. *law 3indi fluus kaan ishtareet beet.* — If I had money I'd have bought a house.
- لو تبي، بنروح سوا. *law tabi, binruuH sawa.* — If you like, we'll go together.
- إذا ما فيه زحمة بنوصل بعشر دقايق. *idha ma fiih zaHma binooSal bi-3ashar dagaayig.* — If there's no traffic we'll arrive in ten minutes.
- Persson example: الولد إذا بيتزوج زوجته تقول… "if a boy is getting married his wife will say…".

Traps: never MSA لو كان لدي / سوف. Use كان + past for "would have".

### 4.21 Connectors & subordinators — A2 (و, بس, عشان, لأن, بعدين, قبل/بعد) → B1 (لين, يوم/لما, عقب ما, قبل لا, مع إن, وإلا, يا…يا, دام, إن "that") — `sentence-structure`

| word | meaning | example |
|---|---|---|
| بس *bas* | but; only; enough; just | حلو بس غالي *Hilu bas ghaali* "nice but expensive"; بس! "enough!" |
| لكن *laakin* | but (slightly formal) | |
| عشان *3ashaan* / علشان | because of / in order to / so that | عشان أوصل بدري *3ashaan awSal badri* "so I arrive early"; عشان كذا *3ashaan chidha* "that's why" |
| لأن / لأنه *li'ann(ah)* | because | ما جيت لأني تعبان *ma jeet li'anni ta3baan* |
| لين *leen* | until; when (Gulf marker) | قعدنا لين الفجر; لين وصلت "when I arrived" |
| يوم *yoom* | when (past narrative; Najdi/UAE) | يوم شفته، ضحك *yoom shiftah, DHiHak* "when I saw him he laughed" |
| لما *lamma* / لمن | when | لما تخلص، اتصل *lamma tkhalliS, ittaSil* |
| عقب / عقب ما *3ugub (ma)* | after (KW/BH/UAE) | عقب الغدا *3ugub il-ghada* "after lunch" |
| بعد / بعد ما *ba3ad (ma)* | after | بعد ما أخلص *ba3ad ma akhalliS* |
| قبل / قبل لا *gabil (la)* | before | قبل لا تروح *gabil la truuH* "before you go" |
| بعدين *ba3deen* | then / later | |
| أول *awwal* | first / before (in the past) | أول شي *awwal shay* "first thing" |
| وإلا / ولا *walla* | or (in questions) | شاي ولا قهوة؟ |
| يا … يا *ya…ya* | either … or | يا تجي يا تخليني *ya tiyi ya tkhalliini* |
| مع إن *ma3 inn* | although | |
| دام *daam* | as long as / since | دامك هني، اقعد *daamak hini, ig3ad* |
| إن / إنه *inn(ah)* | that (after قال, أظن, أدري) | قال إنه بيجي *gaal innah biyi* |
| علطول / على طول *3ala Tuul* | straight away; straight ahead | |
| ترى *tara* | you know / by the way / mind you | ترى الدوام باكر *tara d-dawaam baachir* |
| عاد *3aad* | then / so / come on (insistence, contrast) | يالله عاد *yalla 3aad* "come on then"; ما عاد *ma 3aad* "no longer" |
| بعد *ba3ad* | also / too; still; anything else? | آنا بعد *aana ba3ad* "me too"; بعد؟ "what else?" |
| كمان | **Levantine/Egyptian "also" — do not generate**; Gulf = بعد / زود | |

Traps: أيضاً/كذلك/بينما/عندما flagged (عندما whitelisted but unwanted). لين "until" and يوم "when" are the two connectors that most strongly mark Gulf speech — the repo demonstrations use لين.

### 4.22 Dual & plurals (sound and broken) — A1 (a few high-frequency plurals) → A2 (dual, ـين/ـات rules) → B1 (broken patterns) — `sentence-structure`

- Dual ـين *-een*: يومين *yoomeen*, بيتين *beeteen*, ساعتين *saa3teen*, ولدين *waladeen*. Gulf keeps the dual on nouns (not on verbs/adjectives; adjectives go plural: بيتين كبار).
- Sound ـين *-iin* (male humans/participles): مدرسين *mudarrisiin*, سعوديين, رايحين; ـات *-aat* (feminine, loans, some things): سيارات *sayyaaraat*, بنات *banaat*, تلفونات.
- Broken plurals the learner needs early: بيت/بيوت *byuut*, باب/أبواب *abwaab*, كرسي/كراسي *karaasi*, كتاب/كتب *kutub*, ولد/أولاد or عيال *awlaad / 3yaal*, بنت/بنات, رجال/رجاجيل or ريّال/رياييل *rayaayiil*, حرمة/حريم *Hariim* (also نسوان *niswaan*), يوم/أيام *ayyaam*, شهر/شهور *shhuur*, سنة/سنين *sniin*, ريال/ريالات, دينار/دنانير *danaaniir*, درهم/دراهم *daraahim*, فلس/فلوس, مطعم/مطاعم *maTaa3im*, سوق/أسواق *aswaag*, شجرة/أشجار or شيرات, صديق/أصدقاء → in speech ربع, أخ/إخوان *ikhwaan*, أخت/خوات *khawaat*, عم/عمام *3maam*, خال/خوال *khwaal*, ضيف/ضيوف *DHyuuf*, سيارة/سيارات, جوال/جوالات, دكان/دكاكين *dakaakiin*, طاولة/طاولات, قلم/أقلام, صحن/صحون *SHuun*, كأس/كاسات, يد/أيادي, عين/عيون *3yuun*.

- عندي ولدين وبنت. *3indi waladeen w-bint.* — I have two boys and a girl.
- الربع كلهم جاو. *ir-rab3 killahum jaw.* — The whole gang came.
- فيه بيوت واجد جديدة بهالحي. *fiih byuut waajid yideeda b-hal-Hayy.* — There are lots of new houses in this area.

### 4.23 Numbers with nouns — A1 (1–10) → A2 (11–100, prices, ordinals) — nearest id `sentence-structure` (will slug to its own concept)

| | m / f | with a noun |
|---|---|---|
| 1 | واحد / وحدة *waaHid / waHda* | follows the noun: بيت واحد, بنت وحدة |
| 2 | ثنين / ثنتين *thneen / thinteen* | dual instead: بيتين; ثنين alone when counting |
| 3 | ثلاث / ثلاثة *thalaath / thalaatha* | short form + plural: ثلاث بيوت *thalaath byuut*, ثلاث بنات |
| 4 | أربع / أربعة *arba3 / arba3a* | أربع سيارات |
| 5 | خمس / خمسة *khams / khamsa* | خمس ريالات *khams riyaalaat* |
| 6 | ست / ستة *sitt / sitta* | ست دنانير |
| 7 | سبع / سبعة *sab3 / sab3a* | سبع أيام (with t before a vowel: سبعت أيام *sab3at ayyaam*) |
| 8 | ثمان / ثمانية *thimaan / thimaanya* | ثمان ساعات |
| 9 | تسع / تسعة *tis3 / tis3a* | |
| 10 | عشر / عشرة *3ashar / 3ashra* | عشر دقايق *3ashar dagaayig* |
| 11–19 | احدعش *iHda3ash*, اثنعش *ithna3ash*, ثلثطعش *thalaTTa3ash*, أربعطعش *arba3Ta3ash*, خمسطعش *khamsTa3ash*, سطعش *siTTa3ash*, سبعطعش *sab3aTa3ash*, ثمنطعش *thamanTa3ash*, تسعطعش *tis3aTa3ash* | + **singular**: خمسطعش دقيقة |
| tens | عشرين *3ishriin*, ثلاثين *thalaathiin*, أربعين, خمسين, ستين, سبعين, ثمانين, تسعين | + singular: عشرين ريال *3ishriin riyaal* |
| 100 / 200 / 1000 | مية *miya* / ميتين *miiteen* / ألف *alf*; 3000 ثلاث آلاف | مية درهم *miyat dirham* |
| compounds | واحد وعشرين *waaHid w-3ishriin*, خمسة وثلاثين | |

Gender rule (source 4): the *long* form (ثلاثة) is used when counting abstractly and before masculine plurals in careful speech; in everyday Gulf the short form before any plural is normal and "people are relaxed about it" — do not drill the MSA reverse-agreement rule.

Ordinals: أول/أولى *awwal/uula*, ثاني *thaani*, ثالث *thaalith*, رابع *raabi3*, خامس *khaamis*, سادس *saadis*, سابع *saabi3*, ثامن *thaamin*, تاسع *taasi3*, عاشر *3aashir*. أول مرة *awwal marra* "first time", المرة الثانية *il-marra th-thaanya* "the second time / another time", ثاني يوم *thaani yoom* "the next day".

- بكم هذا؟ — بخمسين ريال. *bikam haadha? — b-khamsiin riyaal.* — How much is this? — Fifty riyals.
- عندي ثلاث خوات وأخوين. *3indi thalaath khawaat w-akhween.* — I have three sisters and two brothers.
- الرحلة الساعة عشرة ونص. *ir-riHla s-saa3a 3ashra w-nuSS.* — The flight is at 10:30.

### 4.24 Time, days, calendar — A2 — nearest id `sentence-structure`

- الساعة كم؟ *is-saa3a kam?* — الساعة وحدة *waHda* / ثنتين *thinteen* / ثلاث *thalaath* … عشرة / احدعش / اثنعش. Minutes: وخمسة *w-khamsa*, وعشر *w-3ashar*, وربع *w-rub3*, وثلث *w-thilth*, ونص *w-nuSS*, ونص وخمسة, إلا ربع *illa rub3*, إلا عشر.
- Parts of the day (prayer-anchored in real speech): الفجر *il-fajir*, الصبح *iS-SubH*, الظهر *iDH-DHuhur*, العصر *il-3aSir*, المغرب *il-maghrib*, العشا *il-3isha*, بالليل *bil-leel*, نص الليل.
- Days: السبت *is-sabt*, الأحد *il-aHad*, الاثنين *il-ithneen*, الثلاثاء / الثلوث *ith-thalaatha / ith-thaluuth*, الأربعاء / الأربعا *il-arba3a*, الخميس *il-khamiis*, الجمعة *il-yim3a / il-jum3a*. Weekend = الخميس والجمعة historically, now الجمعة والسبت.
- Relative time: اليوم *il-yoom*, باكر/بكرة, عقب باكر *3ugub baachir* "day after tomorrow", أمس / البارحة, أول أمس *awwal ams*, هالأسبوع *hal-usbuu3*, الأسبوع الجاي *il-usbuu3 il-jaay* "next week", الشهر اللي فات *ish-shahar illi faat* "last month", هالسنة, السنة الجاية, قبل شوي *gabil shway* "a moment ago", بعد شوي *ba3ad shway* "in a bit", بدري *badri* "early", متأخر.

- الدوام من ثمان لين أربع. *id-dawaam min thimaan leen arba3.* — Work is from eight to four.
- نتقابل الساعة خمس إلا ربع. *nitgaabal is-saa3a khams illa rub3.* — Let's meet at quarter to five.
- الجمعة عندنا غدا عند جدتي. *il-yim3a 3indana ghada 3ind yaddati.* — On Friday we have lunch at my grandmother's.

### 4.25 Small but identity-bearing structures — A2/B1 — various ids

| Structure | Level | id | Forms & examples |
|---|---|---|---|
| تو + suffix "just now" | A2 | `verb-conjugation` | توني *tawni* "I just…", توك *tawwak*, توه *tawwah*, توها, تونا, توهم; تو الناس *taw in-naas* "it's still early". توني راجع من السوق. *tawni raaji3 min is-suug.* — I just got back from the market (repo demonstration). توه طالع. *tawwah Taali3.* — He just left. |
| ليش لا؟ | A2 | `questions` | ليش لا؟ *leesh la?* "why not?" — نروح البحر؟ — ليش لا! |
| يا ليت | B1 | `sentence-structure` | يا ليت *ya leet* "if only / I wish" + suffix: يا ليتني *ya leetni*, يا ليته. يا ليت أقدر أجي. *ya leet agdar ayi.* — I wish I could come. |
| عاد | A2 | discourse | see §4.21; also ما عاد "no longer": ما عاد أروح هناك *ma 3aad aruuH hnaak*. |
| بعد | A2 | discourse | آنا بعد أبي *aana ba3ad abi* "I want too"; بعد شي؟ *ba3ad shay?* "anything else?" |
| خلاص | A1 | discourse | خلاص، فهمت *khalaaS, fihamt* "OK, got it"; "done/finished". |
| يعني | A1 | discourse | filler "I mean / like"; يعني شنو؟ *ya3ni shinu?* "meaning what?" |
| على + suffix (obligation/"my treat") | B1 | `possessives` | علي *3alayy* "on me / my treat"; عليك *3aleek*; عليه *3aleeh*. الغدا علي. |
| Vocatives | A1 | discourse | يا أخوي *ya akhuuy*, يا خوي, ياخي *yaakhi*, يا بنت الناس, يا طويل العمر *ya Tawiil il-3umur* (respectful, "long-lived one"), يا بو فلان, يا الغالي *ya l-ghaali*, يا حبيبي. |
| الله + jussive blessings | A1→B1 | fixed | الله يسلمك, الله يعافيك, الله يخليك, الله يحفظك, الله يوفقك, الله يعينك, الله يرحمه, الله يهداك (mild rebuke "God guide you"), الله يستر. |
| Passive-ish with انـ/تـ | B1 | `verb-conjugation` | انكسر *inkisar* "it broke", انفتح, تغيّر, اتصل — Gulf also has the internal passive (كُتب), rare; teach recognition only. |
| Verb strings (Qafisheh ch. 17) | B1 | `verb-conjugation` | راح يجيب *raaH yjiib* "he went to get", قام يصيح, جا يسأل, خلاه يروح, ظل / بقى يسولف. |

### 4.26 Trap list for the model (what to reject in review)

| Model tends to write | Gulf must be | Notes |
|---|---|---|
| الآن | الحين / هالحين / دحين(Hijaz) | leak list |
| لماذا / ماذا / أين / كيف حالك / هل | ليش / شنو–وش / وين / شلونك–شخبارك / (intonation) | |
| ليس / لست / ليسوا | مو / مب / ما | |
| مش | مو / مب | مش is Egyptian-Levantine (Abu Dhabi/Hijaz aside) |
| الذي / التي / الذين | اللي | |
| سوف / سـ | بـ / راح | |
| أريد / يريد / أرغب | أبي / أبغى / يبي / ودي | |
| كثير / جداً | واجد / وايد / مرة (Saudi) | كثير is heard but not marked; never جداً |
| بـ + imperfect as habitual (بيروح كل يوم) | bare imperfect: يروح كل يوم | Egyptian/Levantine function |
| كمان / برضو / بردو | بعد / زود | |
| أيضاً / كذلك | بعد | |
| عندما / حينما / بينما | لما / لين / يوم | عندما whitelisted, still avoid |
| كده / كدا / هيك | كذا / جذي / جي | كده on Gulf leak list |
| دلوقتي / إزيك / عايز / فين / مفيش / النهاردة | الحين / شلونك / أبي / وين / ما فيه / اليوم | Gulf leak list |
| ذلك / هؤلاء / تلك | ذاك / هذول / ذيك | |
| بتاع / تبع | حق / مال | |
| ماء / شيء / جيد / حسناً | ماي / شي / زين / زين–طيب | |
| يذهب / يرى / يأتي / يتحدث | يروح / يشوف / يجي(ييي) / يتكلم–يسولف | |
| عمّ (Levantine progressive) | قاعد / يالس | |
| ـكِ / ـكَ with MSA harakat | ـك *-ak/-ik* / ـج *-ich* | |
| مو vs مب mixed in one speaker | pick per country card | |
| يبي vs يبغى mixed in one speaker | pick per country card | |

---

## 5. Identity vocabulary

### 5.1 ~120 function words, adverbs, discourse markers (with what they replace)

Format: Gulf — translit — gloss — replaces (MSA / Egyptian).

**Time & place**
1. الحين / هالحين — *alHeen / halHeen* — now — الآن / دلوقتي
2. دحين — *daHeen* — now (Hijaz) — same
3. باكر / بكرة — *baachir / bukra* — tomorrow — غداً / بكرة
4. أمس / البارحة — *ams / il-baarHa* — yesterday / last night — أمس / امبارح
5. اليوم — *il-yoom* — today — اليوم / النهاردة
6. عقب — *3ugub* — after; later — بعد
7. بعدين — *ba3deen* — later, then — لاحقاً / بعدين
8. أول — *awwal* — before, first, previously — سابقاً / زمان
9. لين — *leen* — until; when — حتى
10. يوم — *yoom* — when (narrative) — عندما
11. لما — *lamma* — when — عندما
12. تو / توني — *taw / tawni* — just now — للتو / لسه
13. بدري — *badri* — early — مبكراً
14. متأخر — *mit'akhkhir* — late — متأخر
15. دايم / دايماً — *daayim* — always — دائماً
16. أحياناً / مرات — *aHyaanan / marraat* — sometimes — أحياناً / ساعات
17. أبد / أبداً — *abad* — never / at all — أبداً / خالص
18. على طول — *3ala Tuul* — straight away; straight on — فوراً / على طول
19. هني / هنا / هنيه — *hini / hina / hniyya* — here — هنا
20. هناك / غاد (KW) — *hnaak / ghaad* — there — هناك
21. برا — *barra* — outside — خارج
22. داخل / جوا — *daakhil / juwwa* — inside — داخل
23. فوق / تحت — *foog / taHat* — up / down — فوق / تحت
24. قدام / ورا — *giddaam / wara* — in front / behind — أمام / خلف
25. جنب / يم — *jamb / yamm* — next to — بجانب

**Quantity & degree**
26. واجد / وايد — *waajid / waayid* — a lot, very — كثير / كتير
27. مرة — *marra* — very (Saudi) — جداً / أوي
28. شوي / شوية — *shway / shwayya* — a little — قليلاً / شوية
29. كلش (KW) / بالمرة — *killish / bil-marra* — at all — أبداً / خالص
30. زود — *zood* — more, extra — أكثر / كمان
31. بعد — *ba3ad* — also; still; anything else — أيضاً / كمان
32. بس — *bas* — only; but; enough — فقط / لكن / بس
33. كل — *kill* — every, all — كل
34. نص — *nuSS* — half — نصف
35. هالكثر / هالقد — *hal-kithir / hal-gadd* — this much — بهذا القدر
36. زيادة — *ziyaada* — more, extra — أكثر

**Evaluatives**
37. زين — *zeen* — good, fine, OK — جيد / كويس
38. خوش — *khoosh* — good (before noun: خوش ولد) — جيد
39. حلو — *Hilu* — nice, sweet, good — جميل / حلو
40. كشخة — *kashkha* — smart, stylish — أنيق
41. عجيب — *3ajiib* — amazing — رائع
42. مو زين / مب زين — *mu zeen* — bad, not OK — سيء / مش كويس
43. عادي — *3aadi* — normal, no big deal — عادي
44. بسيطة / هينة — *basiiTa / hayyina* — easy, no problem — بسيطة
45. صعب / سهل — *Sa3b / sahil* — hard / easy
46. غالي / رخيص — *ghaali / rakhiiS* — expensive / cheap
47. صج (KW) / صدق (SA) — *Sij / Sidg* — really, true — حقاً / بجد
48. أكيد — *akiid* — sure — بالتأكيد
49. طبعاً — *Tab3an* — of course
50. بضبط — *biDH-DHabT* — exactly

**Responses & fillers**
51. إي / إيه / هيه — *ee / eeh / heeh* — yes — نعم / أيوه
52. لا — *la* — no
53. بلى — *bala* — yes (contradicting a negative)
54. طيب — *Tayyib* — OK, alright, well — حسناً
55. تمام — *tamaam* — fine, OK
56. خلاص — *khalaaS* — done, enough, OK then
57. يعني — *ya3ni* — I mean, like
58. يالله — *yalla* — let's go, come on, OK bye
59. هيا — *hayya* — let's go (Hijaz)
60. عاد — *3aad* — then, so, come on (insistence)
61. عيل (UAE/KW) / أجل (SA) — *3eel / ajal* — so, then, in that case — إذاً
62. ترى — *tara* — you know, by the way, mind you
63. والله — *wallah* — really / I swear (intensifier)
64. والله العظيم — *wallah il-3aDHiim* — I swear to God
65. ما شاء الله — *ma shaa' allah* — (admiration)
66. إن شاء الله — *in shaa' allah* — God willing (= yes/we'll see)
67. الحمد لله — *il-Hamdillah* — thank God (= I'm fine)
68. أبشر — *abshir* — consider it done (SA)
69. على راسي / على عيني — *3ala raasi / 3ala 3eeni* — gladly
70. تم — *tamm* — done / will do
71. حاضر — *HaaDHir* — at your service (heard; more Levantine/Egyptian)
72. ما عليه / معليش — *ma 3aleeh / ma3leesh* — never mind
73. أشوى / أشوا — *ashwa* — thank goodness
74. عسى ما شر؟ — *3asa ma sharr?* — hope nothing's wrong?
75. شفيك؟ / وش فيك؟ — *shfiik / wish fiik* — what's wrong with you?
76. شصار؟ / وش صار؟ — *sh-Saar / wish Saar* — what happened?
77. شالسالفة؟ / وش السالفة؟ — *shis-saalfa* — what's the story?
78. سالفة — *saalfa* — story, matter — قصة / حكاية
79. ماشي — *maashi* — OK, fine (also Egyptian; Gulf uses it)
80. أوكي — *okay* — OK (universal in Gulf youth speech)
81. لا تشيل هم — *la tshiil hamm* — don't worry
82. ولا يهمك — *wala yhimmak* — don't worry about it
83. الله يهداك — *allah yihdaak* — (mild "come on now")
84. يا ساتر / الله يستر — *ya saatir* — yikes / God protect
85. خيبة (UAE) — *kheeba* — oh no!
86. أونه (UAE) — *awinna* — "as if" (sarcasm)
87. جي / جذي / كذا — *chee / chidhi / chidha* — like this — هكذا / كده
88. شرات / مثل — *shraat / mithil* — like (similar to) — مثل / زي
89. عن جد؟ — *3an jadd?* — seriously?
90. لو سمحت — *law samaHt* — please / excuse me — من فضلك
91. تفضل — *tfaDDal* — go ahead / here you are / come in
92. مشكور / مشكورة — *mashkuur / -a* — thanks — شكراً
93. تسلم / تسلم إيدك — *tislam / tislam iidak* — thanks (to hands that gave)
94. يعطيك العافية — *y3aTiik il-3aafya* — thanks for your effort
95. الله يسلمك / الله يعافيك — *allah ysallimk / y3aafiik* — (replies)
96. الله يخليك — *allah ykhalliik* — please / bless you
97. عفواً / العفو — *3afwan / il-3afu* — you're welcome
98. آسف / آسفة — *aasif / aasfa* — sorry
99. سمحلي / اسمحلي — *simiHli* — excuse me
100. الله يعينك — *allah y3iinak* — good luck with that (sympathy)

**People & things (the words that mark the dialect)**
101. ربع — *rab3* — friends, the gang — أصدقاء
102. ريّال / رجّال — *rayyaal / rajjaal* — man — رجل / راجل
103. حرمة — *Hurma* — woman — امرأة / ست
104. عيال / يهال — *3yaal / yihaal* — kids — أطفال / عيال
105. ولد / بنت — *walad / bint* — boy / girl
106. جوال / تلفون — *jawwaal / tilifoon* — mobile — هاتف / موبايل
107. سيارة / موتر — *sayyaara / mootar* — car
108. دوام / شغل — *dawaam / shughul* — work (shift) / job — عمل
109. فلوس / بيزات — *fluus / beezaat* — money — نقود
110. عيش — *3eesh* — rice (Gulf!) — أرز / رز
111. خبز / خبز رقاق / صمون (KW) — *khubz / samuun* — bread
112. ماي / موية — *maay / moya* — water — ماء / مية
113. مجلس — *majlis / maylis* — sitting room / gathering
114. دلة / فنجان — *dalla / finjaan* — coffee pot / cup
115. بخور / عود — *bkhuur / 3uud* — incense
116. كشتة — *kashta* — desert outing/picnic
117. زحمة — *zaHma* — traffic, crowd
118. وايد شغل / مشغول — *mashghuul* — busy
119. تعبان / جوعان / عطشان / نعسان — *ta3baan / juu3aan / 3aTshaan / na3saan* — tired / hungry / thirsty / sleepy
120. مستانس — *mistaanis* — having a good time — مبسوط
121. شي / ما شي — *shay / ma shay* — thing / nothing — شيء / لا شيء
122. حد / أحد / محد — *Had / aHad / maHHad* — someone / anyone / nobody
123. الدنيا — *id-dinya* — the world; the weather (الدنيا حر "it's hot")
124. شغلة — *shaghla* — thing, matter — أمر

### 5.2 The 40 most useful verbs (present 1s / 3ms · past 3ms · imperative m)

| # | meaning | present 1s | present 3ms | past 3ms | imperative | notes |
|---|---|---|---|---|---|---|
| 1 | go | أروح *aruuH* | يروح *yruuH* | راح *raaH* | روح *ruuH* | |
| 2 | come | أجي / أيي *aji / ayi* | يجي / ييي *yiji / yiyi* | جا / يا *ja / ya* | تعال *ta3aal* | j/y split |
| 3 | see | أشوف *ashuuf* | يشوف *yshuuf* | شاف *shaaf* | شوف *shuuf* | |
| 4 | say | أقول *aguul* | يقول *yguul* | قال *gaal* | قول *guul* | قلي "tell me" |
| 5 | do / make | أسوي *asawwi* | يسوي *ysawwi* | سوّى *sawwa* | سوّ *saww* | |
| 6 | want | أبي / أبغى *abi / abgha* | يبي / يبغى *yabi / yabgha* | بغى *bagha* | — | |
| 7 | eat | آكل *aakil* | ياكل *yaakil* | أكل / كل *akal / kal* | كل *kil* | |
| 8 | drink | أشرب *ashrab* | يشرب *yishrab* | شرب *shirab* | اشرب *ishrab* | |
| 9 | take | آخذ *aakhidh* | ياخذ *yaakhidh* | أخذ / خذ *akhadh / khadh* | خذ *khudh* | |
| 10 | give | أعطي *a3aTi* | يعطي *y3aTi* | عطى *3aTa* | عطني *3aTni* | |
| 11 | bring | أجيب *ajiib* | يجيب *yjiib* | جاب *jaab* | جيب *jiib* | |
| 12 | go back | أرجع *arja3* | يرجع *yirja3* | رجع *rija3* | ارجع *irja3* | |
| 13 | sit / stay | أقعد *ag3ad* | يقعد *yig3ad* | قعد *gi3ad* | اقعد *ig3ad* | UAE يلس |
| 14 | sleep | أنام *anaam* | ينام *ynaam* | نام *naam* | نم *nam* | |
| 15 | get up / stand | أقوم *aguum* | يقوم *yguum* | قام *gaam* | قوم *guum* | |
| 16 | know (fact) | أدري *adri* | يدري *yidri* | درى *dira* | — | ما أدري |
| 17 | know (person/how) | أعرف *a3arif* | يعرف *y3arif* | عرف *3iraf* | — | |
| 18 | understand | أفهم *afham* | يفهم *yifham* | فهم *fiham* | افهم | |
| 19 | can | أقدر *agdar* | يقدر *yigdar* | قدر *gidar* | — | |
| 20 | like / love | أحب *aHibb* | يحب *yHibb* | حب *Habb* | — | يعجبني "I like it" |
| 21 | work | أشتغل *ashtaghil* | يشتغل *yishtaghil* | اشتغل *ishtaghal* | اشتغل | |
| 22 | study | أدرس *adris* | يدرس *yidris* | درس *diras* | ادرس | |
| 23 | write | أكتب *aktib* | يكتب *yiktib* | كتب *kitab* | اكتب | |
| 24 | read | أقرا *agra* | يقرا *yigra* | قرا *gira* | اقرا | |
| 25 | listen / hear | أسمع *asma3* | يسمع *yisma3* | سمع *sima3* | اسمع | |
| 26 | talk / chat | أتكلم / أسولف *atkallam / asoolif* | يتكلم / يسولف | تكلم / سولف | تكلم | UAE يرمس |
| 27 | buy | أشتري *ashtiri* | يشتري *yishtiri* | اشترى / شرى *ishtara / shira* | اشترِ | |
| 28 | pay | أدفع *adfa3* | يدفع *yidfa3* | دفع *difa3* | ادفع | |
| 29 | open | أفتح *aftaH* | يفتح *yiftaH* | فتح *fitaH* | افتح | |
| 30 | close | أسكّر / أبنّد *asakkir / abannid* | يسكّر / يبنّد | سكّر / بنّد | سكّر | بنّد KW/UAE |
| 31 | drive | أسوق *asuug* | يسوق *ysuug* | ساق *saag* | سوق | |
| 32 | walk / leave | أمشي *amshi* | يمشي *yimshi* | مشى *misha* | امشِ | |
| 33 | go out / up | أطلع *aTla3* | يطلع *yiTla3* | طلع *Tila3* | اطلع | |
| 34 | enter | أدخل *adkhul* | يدخل *yidkhul* | دخل *dikhal* | ادخل | |
| 35 | put | أحط *aHuTT* | يحط *yHuTT* | حط *HaTT* | حط | |
| 36 | carry / remove | أشيل *ashiil* | يشيل *yshiil* | شال *shaal* | شيل | |
| 37 | look for | أدوّر *adawwir* | يدوّر *ydawwir* | دوّر *dawwar* | دوّر | |
| 38 | find | ألقى *alga* | يلقى *yilga* | لقى *liga* | — | |
| 39 | wait | أنطر / أنتظر *anTir / antaDHir* | ينطر / ينتظر | نطر / انتظر | انطر | UAE يتريّا |
| 40 | call (phone) | أتصل *attaSil* | يتصل *yittaSil* | اتصل *ittaSal* | اتصل | اتصل فيني / عليّ |
| 41 | send | أرسل / أطرّش *arsil / aTarrish* | يرسل / يطرّش | رسل / طرّش | أرسل / طرّش | طرّش KW/UAE |
| 42 | cook | أطبخ *aTbukh* | يطبخ *yiTbukh* | طبخ *Tibakh* | اطبخ | |
| 43 | wear | ألبس *albas* | يلبس *yilbas* | لبس *libas* | البس | |
| 44 | let / leave | أخلي *akhalli* | يخلي *ykhalli* | خلّى *khalla* | خلّ *khall* | خلك "stay" |
| 45 | become / happen | أصير *aSiir* | يصير *ySiir* | صار *Saar* | — | |
| 46 | be | أكون *akuun* | يكون *ykuun* | كان *kaan* | كن / خلك | |
| 47 | travel | أسافر *asaafir* | يسافر *ysaafir* | سافر *saafar* | سافر | |
| 48 | forget | أنسى *ansa* | ينسى *yinsa* | نسى *nisa* | — | لا تنسى |
| 49 | invite | أعزم *a3zim* | يعزم *y3azim* | عزم *3izam* | اعزم | عزيمة |
| 50 | enjoy oneself | أستانس *astaanis* | يستانس *yistaanis* | استانس *istaanas* | — | |

---

## 6. Cultural competence thread A1 → B1

Order = the order it should surface in lessons. Every pair is "you hear → you say".

### 6.1 Greetings and their replies (A1, Stage 1 L4)
- السلام عليكم *is-salaamu 3aleekum* → وعليكم السلام *w-3aleekum is-salaam*
- هلا / هلا والله / يا هلا *hala / hala wallah / ya hala* — hi/welcome → هلا فيك / هلا بك *hala fiik*
- حياك الله *Hayyaak allah* (welcome / greeting) → الله يحييك *allah yHayyiik*
- مرحبا / مرحبا الساع (UAE) *marHaba s-saa3* → مرحبتين *marHabteen*
- شلونك؟ / شحالك؟ / وشلونك؟ / كيفك؟ → بخير الحمد لله *b-kheer il-Hamdillah* / زين الحمد لله — then return it: وإنت؟ *w-inta?*
- شخبارك؟ *shkhbaarak* / شو الأخبار؟ / شو اليديد؟ (UAE) → أخبار زينة / كله تمام *killah tamaam*
- أمور طيبة؟ *umuur Tayyiba?* → طيبة الحمد لله
- عساك بخير / عساك طيب *3asaak b-kheer* → الله يسلمك / وإنت بخير
- صباح الخير → صباح النور; يسعد صباحك *yis3id SabaaHak* → يسعد صباحك بالخير; مساء الخير → مساء النور
- تصبح على خير *tiSbaH 3ala kheer* → وإنت من أهله *w-inta min ahlah*
- Leaving: مع السلامة *ma3 is-salaama* → الله يسلمك; في أمان الله *fi amaan illah*; نشوفك على خير *nshuufak 3ala kheer*; يالله باي
- Note: greetings are stacked — three or four in a row before any content is normal; teach the *chain*, not single lines.

### 6.2 Religious phrases (A1 → A2)
- إن شاء الله *in shaa' allah* — any future; also a soft "yes/maybe".
- ما شاء الله *ma shaa' allah* — praise without envy; must accompany compliments on children, houses, cars.
- الحمد لله — after eating, when asked how you are, after good news.
- بسم الله *bismillah* — before eating/starting; تفضل بسم الله invites the guest to start.
- الله يعطيك العافية *allah y3aTiik il-3aafya* (to anyone working) → الله يعافيك *allah y3aafiik*.
- الله يسلمك — reply to most thanks/farewells.
- جزاك الله خير / يزاك الله خير (KW/UAE pronunciation) *jazaak allah kheer* → وإياك *w-iyyaak*.
- بارك الله فيك → وفيك.
- الله يرحمه *allah yarHamah* — of the dead.
- الله يحفظك / الله يخليك / الله يوفقك / بالتوفيق.
- صلى الله عليه وسلم after the Prophet's name; أستغفر الله on hearing something bad; لا حول ولا قوة إلا بالله on frustration.
- Prayer times structure the day (§4.24) and shops close briefly for prayer in Saudi (less so now) — learners must read بعد المغرب as a time.

### 6.3 Hospitality: gahwa, majlis, incense (A1 vocabulary in L1/L9; ritual at Stage 2 L14)
- Words: قهوة عربية *gahwa 3arabiyya* (cardamom, saffron), دلة *dalla*, فنجان *finjaan* (pl. فناجين), تمر *tamar*, مجلس *majlis/maylis*, ضيف *DHeef*, معزب *m3azzib* (host), قهوجي *gahwaji*, بخور *bkhuur*, عود *3uud*, مبخرة *mabkhara*.
- Ritual (sources 18): dallah in the left hand, finjan in the right; serve clockwise starting with the eldest/most honoured; pour a quarter cup; keep refilling until the guest **shakes the cup side-to-side** to stop; receive and return with the **right hand** always; the youngest male pours; coffee is served with dates. Bukhoor passed round near the end = polite signal the visit is closing.
- Lines: تفضل *tfaDDal* (come in / help yourself) → الله يخليك / يعطيك العافية; القهوة *il-gahwa?* → بس، الله يسلمك *bas, allah ysallimk*; صحة وعافية *SaHHa w-3aafya* (after a meal) → الله يعافيك; سفرة دايمة *sufra daayma* "may your table always be laid" → الله يديمك / دايم إن شاء الله; بيتك عامر *beetak 3aamir*.
- Guest conduct: shoes off, sit where directed (further from the door = more honoured), do not refuse the first cup, do not admire an object too hard (it may be gifted), ما تقصر *ma tgaSSir* "you spare no effort" as praise.

### 6.4 Food (A1 → A2)
- Meals: ريوق *ryuug* (breakfast; SA also فطور *fuTuur*), غدا *ghada* (lunch — the main meal, 2–4pm), عشا *3asha* (dinner, late), فوالة *fuwaala* (tea-time snacks, KW/BH/QA), سحور / فطور (Ramadan).
- Dishes: كبسة *kabsa* (SA), مجبوس / مچبوس *machbuus* (KW/BH/QA/UAE), مندي *mandi*, مظبي *maDHbi*, هريس *hariis*, جريش *jiriish*, ثريد *thariid*, صالونة *Saaloona* (stew), مرقوق, مطبق *muTabbag*, بلاليط *balaaleeT* (UAE breakfast), خبز رقاق *rgaag*, لقيمات *lgeemaat*, خنفروش, بثيث, تمر, رطب *ruTab* (fresh dates), لبن *laban* (buttermilk), حليب, شاي كرك *chaay karak* / شاي حليب, قهوة تركية vs قهوة عربية, عصير, ماي بارد.
- Phrases: شبعت *shiba3t* "I'm full", الأكل حلو / لذيذ, يبي ملح شوي *yabi milH shway* "needs a bit of salt", عافية / بالعافية → الله يعافيك, تغديت؟ *tghaddeet?* "have you had lunch?" (a greeting), عزمتك *3azamtak* "you're my guest / my treat", الحساب علي.

### 6.5 Family and address forms (A1 L3 → A2)
- أبو / أم + eldest son's name (source 20): أبو محمد / أم محمد; in the Gulf أبو shortens to **بو** *bu*: بو خالد, بو فهد. Childless men still get an assumed kunya (أبو + father's name). Use يا بو فلان as the polite way to address a peer or elder.
- Kin: أبوي *abuuy*, أمي *ummi* / يمّه *yumma* (vocative), أخوي *akhuuy*, أختي *ukhti*, جدي/يدي *yaddi*, جدتي/يدتي, عمي *3ammi* (also any older man), عمتي, خالي *khaali*, خالتي *khaalti* (any older woman), ابن عمي *wild 3ammi* (cousin, also "kinsman"), زوجي / ريّلي, زوجتي / حرمتي / أهلي / الأهل / العيال.
- Respect: يا طويل العمر *ya Tawiil il-3umur* (to a sheikh/elder; humorous between friends), يا الغالي, يا بعد عمري, يا خوي/ياخي, حياك, أستاذ / أبلة (teacher), الشيخ, بابا/ماما (with children).
- Introductions: آنا اسمي… / أنا من… / متزوج ولا عزابي؟ *mitzawwij walla 3azzaabi?* is a normal first-meeting question; عندك عيال؟ — ما شاء الله على the answer.

### 6.6 Money & shopping (A1 L9/L11 → A2 L8)
- Currencies: ريال *riyaal* (SA/QA) + هللة *halala* / درهم *dirham* (QA), درهم *dirham* + فلس (UAE), دينار *diinaar* + فلس *fils* (KW/BH; Kuwaiti dinar has 1000 fils).
- بكم هذا؟ *bikam haadha?* / بچم (KW) — غالي! *ghaali* — رخّص شوي *rakhkhiS shway* "bring it down a bit" — آخر سعر؟ *aakhir si3ir* — سوم *soom* (haggling; يسوم "to bargain", الصوم بالسوق norm in traditional سوق, not in malls) — خلاص عطني ثنين — عندك كاش؟ / بالبطاقة *bil-biTaaqa* — الباقي *il-baagi* (change) — فاتورة *faatuura* — تخفيضات *takhfiiDHaat* (sale) — مول, بقالة *bagaala* (corner shop), سوق شعبي, جمعية (KW co-op).
- Politeness: لو سمحت يا أخوي, الله يخليك, يعطيك العافية on leaving a shop.

### 6.7 Driving culture (A2 → B1)
- Cars are the social space: سيارة/موتر, جيب/لاندكروزر, تفحيط *tafHiiT* (drifting, illegal), زحمة, إشارة *ishaara* (traffic light), دوار *duwwaar* (roundabout), مواقف *mawaagif* (parking), رخصة, بنزين, ساهر *saahir* (Saudi speed cameras), سواق *sawwaag* (driver), فلاشر, يم / جنب / قدام / لف يمين *liff yimiin* / سيدة *siida* "straight" / ارجع.
- Women driving in Saudi since 2018 — content should not treat it as remarkable.

### 6.8 Ramadan & Eid (B1, Stage 3 L9)
- رمضان كريم *ramaDHaan kariim* → الله أكرم *allah akram*; رمضان مبارك; مبارك عليكم الشهر *mbaarak 3aleekum ish-shahar* → علينا وعليكم *3aleena w-3aleekum*.
- صايم *Saayim* (fasting), إمساك, أذان المغرب, فطور *fuTuur* (iftar), سحور *suHuur*, تراويح, غبقة *ghabga* (KW/BH late-night Ramadan gathering), قرقيعان *gargee3aan* (KW/BH/QA/UAE children's sweets night on 14–15 Ramadan; UAE حق الليلة), مدفع الإفطار, العيدية *il-3iidiyya* (cash gift to children).
- Eid: عيدكم مبارك *3iidkum mbaarak* → من العايدين / عساكم من عواده *3asaakum min 3uwwaadah* → مبارك علينا وعليكم (source 19); كل عام وأنتم بخير → وأنتم بخير; عيد الفطر / عيد الأضحى, ذبيحة, صلاة العيد, زيارة الأهل first morning.

### 6.9 Weddings, births, condolences (B1, Stage 3 L10)
- Wedding: عرس *3irs*, ملچة/ملكة *milcha* (contract night), زواج, عزيمة, معرس *m3arris* (groom), عروس; مبروك / ألف مبروك → الله يبارك فيك *allah ybaarik fiik*; عقبال عيالك *3ugbaal 3yaalak* "your children next". Gender-segregated halls are the norm; men's side ends earlier.
- Birth: مبروك ما ياك / مبروك ما جاك *mabruuk ma jaak* → الله يبارك فيك; الله يخليه لكم.
- Condolence: عظم الله أجركم *3aDHDHam allah ajrakum* → أجرنا وأجركم *ajirna w-ajrakum*; أحسن الله عزاكم → أحسن الله عزاكم / شكر الله سعيكم; البقاء لله *il-bagaa' lillah*; الله يرحمه ويغفر له; عزا *3aza* (three days of receiving condolences), العزاء في المجلس/الديوانية.

### 6.10 Obligations of hospitality: عزيمة, ديوانية, visiting (A2 → B1)
- عزيمة *3aziima* (invitation/dinner): accept with إن شاء الله; arriving late-ish is normal; bring nothing or sweets; leave after coffee/bukhoor.
- ديوانية *diwaaniyya* (KW), مجلس (SA/UAE/QA): the men's evening gathering — politics, football, business; women's equivalents are مجالس النساء / استقبال.
- زيارة *ziyaara*, واجب *waajib* (social duty: attending عزا/عرس), صلة الرحم, زيارة المريض; "لازم أعدي عليهم" *laazim a3addi 3aleehum* "I have to drop by them".

### 6.11 Gender & modesty norms (thread through A2/B1 dialogues)
- Dress lexicon: ثوب / كندورة (UAE) / دشداشة (KW/OM) *thoob / kandoora / dishdaasha*, غترة / شماغ *ghutra / shmaagh*, عقال *3igaal*, بشت *bisht*, عباية *3abaaya*, شيلة *sheela*, نقاب, برقع (older Emirati women).
- Greeting across genders: verbal only unless the woman offers a hand; use أختي/يا بنت الناس; do not ask a man about his wife by name — ask عن الأهل / العيال / البيت.
- Dialogue models should default to same-gender pairs for home visits, mixed pairs for shops/offices/hospitals.

### 6.12 National days, symbols, desert life (B1, Stage 3 L12)
- اليوم الوطني *il-yoom il-waTani*: SA 23 Sept (+ يوم التأسيس 22 Feb), UAE 2 Dec (عيد الاتحاد), KW 25–26 Feb (العيد الوطني/عيد التحرير), QA 18 Dec, BH 16 Dec. Vocabulary: علم, عرضة *3arDHa* (sword dance), يولة *yoola* (UAE), مسيرة.
- Desert: صحرا / بر *barr*, كشتة *kashta*, مخيم *mukhayyam*, طلعة *Tal3a*, صقر / طير *Sagr / Teer* (falconry: مقناص *mignaaS*), بعير/جمل *bi3iir* (camel; ناقة f., pl. إبل/بعارين), مزاين الإبل (camel beauty contests), خيمة, شبة *shabba* (campfire), ربيع *rabii3* (the green season), رمال, دق *dagg*.
- Sea heritage (KW/BH/QA/UAE): غوص *ghooS* (pearl diving), لؤلؤ, بوم/محمل (dhows), نهام, صيد/سمك, هامور *haamuur*, صافي, زبيدي (KW).

### 6.13 Majlis conversation topics & Gulf humour (B1)
- Safe topics: football (الهلال، النصر، القادسية، العين; الديربي), cars, weather (الدنيا حر / غبار *ghubaar* / رطوبة), family news, travel (لندن, البوسنة, تايلند), food, prices (الغلا), work/دوام, the Dewaniya's own gossip (سوالف *sawaalif*).
- Humour: self-deprecating about heat/traffic/الدوام, exaggeration (والله من الصبح ما أكلت), teasing between countries (Kuwaiti vs Saudi accent jokes, "السعودي يقول مرة، الكويتي يقول واجد"), sketch-comedy references (Tash ma Tash, Masameer). Sarcasm marker أونه (UAE), ما شاء الله عليك said flat.
- Avoid in generated content: rulers, sectarian topics, alcohol, dating.

---

## 7. Suggested lesson topic sequence

CEFR anchors (source 15 verbatim for the global scale; spoken-interaction lines **[own knowledge]** of the Companion Volume): A1 spoken interaction "Can interact in a simple way but communication is totally dependent on repetition at a slower rate, rephrasing and repair"; A2 "Can communicate in simple and routine tasks requiring a simple and direct exchange of information on familiar and routine matters"; B1 "Can communicate with some confidence on familiar routine and non-routine matters related to their interests and professional field… exchange, check and confirm information".

Legend: **Can-do** = target learner statement; **Grammar** = §4 refs and taxonomy ids; **Culture** = §6 thread; **Words** = English → Gulf (target 12–20 per lesson; Stage 1 words are all concrete/receptive-first, following the existing Lesson 1 spec).

### Stage 1 — Foundations (Pre-A1 → A1), 12 lessons, receptive until L4

**L1 · Objects — the world around you** *(exists: `curriculum/lahja_lesson1_v2.xlsx`)*
Can-do: recognise 12 spoken object words from pictures. Grammar: none. Culture: gahwa cup + dallah image. Words: water ماي, coffee قهوة, bread خبز, chair كرسي, door باب, house بيت, car سيارة, tree شجرة, sun شمس, hand يد, eye عين, book كتاب. Sound: ق=g, ع, خ, ā.

**L2 · Home & everyday objects**
Can-do: recognise 12 more household words; hear هذا/هذي in context (no explanation). Grammar: pre-exposure to هذا/هذي (`pronouns`). Culture: majlis floor seating vs sofa. Words: table طاولة *Taawla*, phone تلفون/جوال, clock/watch ساعة *saa3a*, pen قلم *galam*, key مفتاح *miftaaH*, bag شنطة *shanTa*, bed سرير *sariir*, window دريشة *diriisha* (KW/UAE; SA شباك), tea شاي *chaay*, milk حليب *Haleeb*, dates تمر *tamar*, rice عيش *3eesh*, plate صحن *SaHan*, cup كوب/كاس *kuub/kaas*, light ليت *leet*, TV تلفزيون. Sound: ح vs ه, ص.

**L3 · People & family**
Can-do: recognise family words; recognise أبو/أم + name. Grammar: pre-exposure to ـي "my" (أبوي, أمي) (`possessives`). Culture: kunya (أبو محمد / بو محمد). Words: father أبو/أبوي, mother أم/أمي, brother أخ/أخوي, sister أخت/أختي, son ولد, daughter بنت, man ريّال/رجّال, woman حرمة, boy ولد, girl بنت, kids عيال/يهال, friend(s) صديق/ربع, grandfather جد/يد, grandmother جدة/يدة, uncle عم/خال, aunt عمة/خالة, baby بيبي/طفل. Sound: ج = j/y (يدة/جدة).

**L4 · Greetings — first words out loud**
Can-do: greet and reply, ask "how are you", say goodbye. Grammar: ـك/ـج suffix heard in شلونك/شلونج (`possessives`). Culture: the greeting chain, right-hand handshake. Words/phrases: السلام عليكم→وعليكم السلام, هلا/يا هلا, حياك الله→الله يحييك, شلونك/شلونج/شحالك→بخير الحمد لله, وإنت؟, شخبارك؟→أخبار زينة, صباح الخير→صباح النور, مساء الخير→مساء النور, مع السلامة→الله يسلمك, يالله باي, تصبح على خير. Sound: greeting intonation, ـك vs ـج.

**L5 · Yes, no, please, thanks + Gulf sounds workshop**
Can-do: answer yes/no, thank, apologise, ask for repetition. Grammar: لا / إي; ما أفهم (first ما) (`negation`). Culture: مشكور→الله يسلمك; تفضل. Words: yes إي/هيه/إيه, no لا, please لو سمحت, thanks مشكور/شكراً, reply الله يسلمك/العفو, sorry آسف, excuse me سمحلي, OK زين/طيب/تمام, I don't understand ما أفهم, again? مرة ثانية؟, slowly شوي شوي, I don't know ما أدري, God willing إن شاء الله, praise God الحمد لله, welcome حياك. Sound: kashkasha listening (كيف/چيف), ث/ذ.

**L6 · Numbers 1–10 and counting things**
Can-do: count to 10; say "two X", "three Xs"; understand a price under 10. Grammar: dual ـين; 3–10 + plural (`sentence-structure`). Culture: coins/notes; bargaining word سوم. Words: واحد/وحدة, ثنين/ثنتين, ثلاث, أربع, خمس, ست, سبع, ثمان, تسع, عشر, how much? بكم؟, riyal ريال, dirham درهم, dinar دينار, expensive غالي, cheap رخيص, two houses بيتين, three books ثلاث كتب. Sound: ث in ثنين/ثلاث/ثمان, ع in أربع/سبع/تسع/عشر.

**L7 · Who I am**
Can-do: give name, nationality, city, job; ask the same. Grammar: pronoun + noun sentences; آنا/إنت/إنتي; شسمك/وش اسمك (`pronouns`, `questions`). Culture: first-meeting questions (من وين؟ متزوج؟). Words: my name اسمي, your name اسمك, I'm from آنا من, where from من وين, I live in ساكن في, I work in أشتغل في, student طالب/طالبة, teacher مدرس, engineer مهندس, doctor دكتور, Saudi سعودي, Kuwaiti كويتي, Emirati إماراتي, Qatari قطري, Bahraini بحريني, British بريطاني, American أمريكي, nice to meet you تشرفنا→الشرف لي, married متزوج, single عزابي/عزباء. Sound: hamza dropping, آنا.

**L8 · Wanting and ordering — café**
Can-do: order a drink/snack, say what you want/don't want, pay. Grammar: أبي/ما أبي + noun; تبي؟; لو سمحت + noun (`negation`, `verb-conjugation` pre-exposure). Culture: gahwa served with dates; karak culture. Words: I want أبي/أبغى, do you want? تبي؟/تبين؟, I don't want ما أبي, coffee قهوة, Arabic coffee قهوة عربية, tea شاي, karak كرك, juice عصير, water ماي/موية, cold بارد, hot حار, sugar شكر, no sugar بدون شكر, dates تمر, sweets حلا, the bill الحساب, here you go تفضل, enjoy بالعافية→الله يعافيك. Sound: ط/ض~ظ emphatics (طيب, تفضل).

**L9 · Food at home — breakfast, lunch, dinner**
Can-do: name meals and common dishes; say "delicious / I'm full". Grammar: adjective agreement (حلو/حلوة) (`sentence-structure`). Culture: غدا is the big meal; ما شاء الله on food; هريس/مجبوس/كبسة map. Words: breakfast ريوق/فطور, lunch غدا, dinner عشا, chicken دجاج/دياي, meat لحم, fish سمك/سمچ, rice عيش, bread خبز, egg بيض, cheese جبن, salad سلطة, fruit فواكه, tasty لذيذ/حلو, I'm full شبعت, hungry جوعان, thirsty عطشان, eat كل!, drink اشرب!, bon appétit بالعافية, kabsa كبسة, machbous مجبوس. Sound: غ vs خ; واجد/وايد.

**L10 · This, that, what?**
Can-do: point and ask "what's this?", answer "this is a…", "that's…". Grammar: هذا/هذي/هذول/ذاك; شنو/وش/شو (`pronouns`, `questions`). Culture: none heavy — colours in dress (ثوب أبيض, عباية سودا). Words: this m هذا, this f هذي, these هذول, that ذاك/هذاك, what? شنو/وش/شو, who? منو/من, white أبيض, black أسود, red أحمر, green أخضر, blue أزرق, yellow أصفر, big كبير, small صغير, new جديد/يديد, old قديم, beautiful حلو/جميل, thobe ثوب, abaya عباية. Sound: ذ in demonstratives, ش-prefix.

**L11 · Where? Places in town**
Can-do: ask where something is, understand here/there/near/far and simple directions. Grammar: وين + noun; فيه/ما فيه; بـ/في "in" (`questions`, `sentence-structure`). Culture: mosque as landmark; prayer-time closures. Words: where وين, here هني/هنا, there هناك, near قريب, far بعيد, right يمين, left يسار, straight سيدة/على طول, market سوق, mall مول, mosque مسجد, restaurant مطعم, hospital مستشفى, school مدرسة, work/office دوام/مكتب, airport مطار, bathroom حمام, street شارع, there is فيه, there isn't ما فيه. Sound: long و/ي (وين/يوم/سوق).

**L12 · Days, times of day & consolidation**
Can-do: say the day, morning/evening, "today/tomorrow/yesterday"; hold a 6-turn greeting-to-goodbye exchange. Grammar: nominal time expressions; اليوم/باكر/أمس (`sentence-structure`). Culture: Friday lunch, weekend shift to Fri–Sat; "بعد المغرب" as a time. Words: today اليوم, tomorrow باكر/بكرة, yesterday أمس/البارحة, morning الصبح, noon الظهر, afternoon العصر, sunset المغرب, evening/night بالليل, Saturday السبت, Sunday الأحد, Monday الاثنين, Tuesday الثلاثاء, Wednesday الأربعا, Thursday الخميس, Friday الجمعة, week أسبوع, now الحين/هالحين, later بعدين/عقب, early بدري, late متأخر. Sound: stress & imāla review.

Stage 1 exit ≈ 200 words, ~60 phrases, script recognised, A1 spoken interaction on greetings/identity/ordering/locating.

### Stage 2 — Building Blocks (A1 → A2), 14 lessons, first simplified video from L1

**S2-L1 · Me, you, him, her — describing people**
Can-do: describe self/others with adjectives; say where people are. Grammar: full subject pronouns; nominal sentence + agreement; بالبيت/بالدوام (`pronouns`, `sentence-structure`). Culture: describing people politely (ما شاء الله), no commenting on women's looks. Words: tall طويل, short قصير, tired تعبان, busy مشغول, sick مريض/تعبان, happy مبسوط/مستانس, angry معصب, sleepy نعسان, young صغير, old (person) كبير بالعمر, nice طيب, funny مضحك, quiet هادي, at home بالبيت, at work بالدوام, outside برا, inside داخل, all of us كلنا.

**S2-L2 · My family, my things — possessive suffixes; حق/مال**
Can-do: talk about family and belongings ("my brother's car", "is this yours?"). Grammar: §4.3, §4.5 (`possessives`). Culture: kunya, extended family living together, بو فلان. Words: my/your/his/her/our… on بيت, سيارة, جوال, أهل; whose? حق منو/لمن, mine حقي/مالي, family أهل, wife زوجة/حرمة, husband زوج/ريّل, cousin ولد عمي/بنت خالتي, neighbour جار, grandson حفيد, relatives أقارب/الأهل, house بيت, flat شقة, room غرفة, kitchen مطبخ, garden حديقة/حوش.

**S2-L3 · Having and there being — عندي / معي / فيه**
Can-do: say what you have/don't have, ask if there is X. Grammar: §4.8–4.9, ما + pseudo-verb (`possessives`, `negation`). Culture: عندك عيال؟ as normal small talk. Words: I have عندي, with me معي, there is فيه, there isn't ما فيه, time وقت, money فلوس, car سيارة, licence رخصة, ticket تذكرة, appointment موعد, problem مشكلة, question سؤال, idea فكرة, work دوام/شغل, holiday إجازة, exam اختبار, kids عيال, pet قطو/قطوة (cat), dog كلب/چلب.

**S2-L4 · My day — present tense**
Can-do: describe a daily routine; ask about someone's routine. Grammar: §4.10 full imperfect on راح/شرب/اشتغل/نام (`verb-conjugation`). Culture: prayer-shaped day; قيلولة (siesta); late dinners. Words: wake up أصحى/أقوم, pray أصلي, eat آكل, drink أشرب, go أروح, come back أرجع, work أشتغل, study أدرس, sleep أنام, watch أشوف/أطالع, read أقرا, play ألعب, drive أسوق, cook أطبخ, go out أطلع, every day كل يوم, usually عادةً, sometimes أحياناً/مرات, always دايم.

**S2-L5 · Not, no, never — negation & ليش**
Can-do: negate verbs, nouns, adjectives; answer "why?". Grammar: §4.6 ما/مو–مب/لا; ليش…؟ لأن… (`negation`, `questions`). Culture: softening refusal (إن شاء الله, ما عليه). Words: not (noun) مو/مب, not (verb) ما, no لا, why ليش, because لأن/عشان, never أبد, nobody محد, nothing ما شي, don't! لا تـ, I can't ما أقدر, I don't like ما أحب, not now مو الحين, wrong غلط, right صح, forbidden ممنوع, allowed مسموح, still بعد, no longer ما عاد.

**S2-L6 · Asking everything — question words**
Can-do: ask who/what/where/when/how/how much/which; form yes-no questions by intonation. Grammar: §4.7 full set incl. ش-prefix (`questions`). Culture: personal questions that are normal vs rude. Words: what شنو/وش/شو, who منو/من, where وين, when متى, how شلون/كيف, why ليش, how much بكم/شقد/شكثر, how many كم, which أي, what time الساعة كم, what's wrong شفيك, what happened شصار/وش صار, what's the story شالسالفة, what does it mean يعني شنو, is that so? صج؟/صدق؟, really? عن جد؟.

**S2-L7 · Wants, needs, can — أبي / لازم / ممكن / أقدر**
Can-do: express wants and obligations, ask permission, make requests. Grammar: §4.12 + imperfect complements (`verb-conjugation`). Culture: أبشر / على راسي / تم replies; أبغى vs أبي vs أبا card. Words: want أبي/يبي, would like ودي, must لازم, can (may) ممكن, can (able) أقدر, know how أعرف, need أحتاج/يبيله, let me خلني, help ساعد, try أجرب, wait انطر/انتظر, go in أدخل, sit down أقعد, borrow أستلف, use أستخدم, book أحجز, call أتصل, send أرسل/أطرّش.

**S2-L8 · Shopping & bargaining — numbers 11–100, prices**
Can-do: ask prices, understand totals, bargain lightly, pay. Grammar: §4.23 numbers 11–100 + singular; comparative أرخص/أغلى preview (`sentence-structure`). Culture: سوم in traditional souq, not malls; يعطيك العافية on leaving. Words: 11–20, 30–100, hundred مية, thousand ألف, price سعر, last price آخر سعر, discount خصم/تخفيض, cash كاش, card بطاقة, change الباقي, receipt فاتورة, size مقاس, colour لون, shirt قميص, shoes جوتي/حذاء, perfume عطر, gold ذهب, incense بخور, gift هدية, bargain يسوم, how much all together كم الكل.

**S2-L9 · Getting around — directions & transport**
Can-do: ask for and follow directions; use taxi/bus/metro phrases. Grammar: imperatives §4.13 (روح/لف/وقف), prepositions of place (`verb-conjugation`, `sentence-structure`). Culture: everyone drives; Uber/Careem; women-only carriages (Dubai metro). Words: go straight روح سيدة/على طول, turn لف, right يمين, left يسار, stop وقّف, here هني, roundabout دوار, traffic light إشارة, bridge كوبري/جسر, exit مخرج, taxi تكسي, bus باص, metro مترو, driver سواق, traffic زحمة, parking مواقف, petrol بنزين, near قريب, far بعيد, next to جنب/يم, opposite قبال/مقابل.

**S2-L10 · What time? — clock, schedule, appointments**
Can-do: tell time, arrange a meeting time, say when something opens/closes. Grammar: §4.24; من…لين… (`sentence-structure`). Culture: "after Isha" as an evening time; shops open late; Gulf lateness norms. Words: hour ساعة, minute دقيقة, quarter ربع, half نص, less إلا, appointment موعد, meeting اجتماع, opens يفتح, closes يسكّر/يبنّد, from…to من…لين, before قبل, after بعد/عقب, on time على الوقت, late متأخر, early بدري, dawn الفجر, noon الظهر, afternoon العصر, sunset المغرب, evening العشا.

**S2-L11 · Plans — the future with بـ / راح**
Can-do: talk about weekend/holiday plans, invite, accept/decline. Grammar: §4.11 بـ/راح, negative future, إن شاء الله (`verb-conjugation`). Culture: invitation etiquette (عزيمة), إن شاء الله as soft no. Words: I'll go بروح, will you come? بتجي/بتيي؟, we'll travel بنسافر, weekend الويكند/نهاية الأسبوع, trip رحلة/طلعة, beach بحر, desert بر, camping كشتة, cinema سينما, football كورة/فوتبول, match مباراة, invite أعزم, invitation عزيمة, together سوا, alone بروحي, maybe يمكن/ممكن, definitely أكيد, sorry I can't آسف ما أقدر.

**S2-L12 · Yesterday — past tense I**
Can-do: say what you did yesterday/last weekend (3–4 sentences). Grammar: §4.14 sound + hollow verbs, 1s/2s/3s (`verb-conjugation`). Culture: Friday routine (صلاة الجمعة, family lunch). Words: went رحت, came جيت/ييت, saw شفت, ate أكلت/كليت, drank شربت, bought شريت, did سويت, said قلت, slept نمت, woke up صحيت, worked اشتغلت, studied درست, visited زرت, called اتصلت, sat قعدت, returned رجعت, yesterday أمس, last night البارحة, last week الأسبوع اللي فات, ago قبل.

**S2-L13 · Was / were / used to — كان, past II, weather**
Can-do: describe past states, weather, what things used to be like. Grammar: §4.15 كان; full past paradigm incl. 3pl ـوا *-aw*; كان عندي (`verb-conjugation`). Culture: heat talk as small talk; غبار (dust storms); winter camping season. Words: was كان/كانت, were كانوا, there was كان فيه, I had كان عندي, hot حر, cold برد, weather جو/الدنيا, dust غبار, rain مطر, wind هوا/ريح, humidity رطوبة, sunny شمس, cloudy غيم, summer صيف, winter شتا, spring ربيع, before (in the past) أول/زمان, they went راحوا, they came جوا/ياو, they ate أكلوا/كلوا.

**S2-L14 · Visiting a Gulf home — hospitality, participles, consolidation**
Can-do: handle a home visit end-to-end (arrive, greet, be served coffee, thank, leave). Grammar: active participles §4.16 (رايح/جاي/قاعد/ساكن); قاعد + verb §4.17 (`verb-conjugation`). Culture: the full gahwa ritual (§6.3), shoes, seating, bukhoor as exit cue, دعوة. Words: guest ضيف, host معزب, majlis مجلس, sitting room صالة, coffee pot دلة, cup فنجان, incense بخور/عود, dates تمر, come in تفضل, have a seat اقعد, welcome حياك, may your house prosper بيتك عامر, thank the host الله يعطيك العافية/ما قصرت, I'm going رايح, coming جاي, sitting/at قاعد, I'm off to… بروح, goodbye في أمان الله, may God keep you الله يحفظك.

Stage 2 exit ≈ 600–700 words, A2 spoken interaction on routines, shopping, directions, plans, past events; understands slow Gulf video with visual support.

### Stage 3 — The Bridge (A2 → B1), 12 lessons, authentic video with scaffolding

**S3-L1 · Telling what happened — narrative connectors**
Can-do: narrate a past event in order with 6–8 sentences. Grammar: §4.21 أول/بعدين/عقب ما/قبل لا/لين/يوم/لما; past 3pl; سالفة structure (`sentence-structure`). Culture: سوالف — storytelling in the majlis; والله as narrative intensifier. Words: first أول شي, then بعدين, after that عقب/بعد ما, before قبل لا, until لين, when يوم/لما, suddenly فجأة, finally أخيراً/بالأخير, story سالفة, tell سولف/احكي, happened صار, took time أخذ وقت, laughed ضحك, got scared خاف, got lost ضعت/ضاع, found لقيت, met قابلت/شفت, arrived وصلت.

**S3-L2 · Right now — progressive & participles**
Can-do: say what you/others are doing now, what you've just done, state (know/forgot/taken). Grammar: §4.16–4.17 قاعد/يالس + imperfect, توني, participles ماخذ/شايف/ناسي/فاهم (`verb-conjugation`). Culture: phone-call openers (وينك؟ شتسوي؟ توني…). Words: I'm doing قاعد أسوي, waiting قاعد أنطر/يالس أتريا, just now توني/توه, on my way جاي/بالطريق, busy مشغول, asleep نايم, awake صاحي, driving أسوق/سايق, standing واقف, parked واقفة, I've taken ماخذ, I know عارف, forgot ناسي, understood فاهم, remember متذكر, hungry جوعان, ready جاهز, coming back راجع.

**S3-L3 · The one who… — اللي and describing things**
Can-do: identify people/things with relative clauses; describe an object/person in detail. Grammar: §4.18 اللي; indefinite vs definite heads; resumptives (`sentence-structure`). Culture: describing a lost item at a mall desk; describing a relative. Words: the one who/which اللي, the same نفس, other ثاني, another one واحد ثاني, kind/type نوع, brand ماركة, made of من, colour لون, shape شكل, made in صنع, belongs to حق/مال, lost ضايع, found ملقي, description وصف, thing شغلة/شي, place مكان, person شخص/واحد, somebody حد/أحد.

**S3-L4 · Better, bigger, best — comparing & preferences**
Can-do: compare options and give preferences with reasons. Grammar: §4.19 أفعل من / الأفضل; أحسن لك (`sentence-structure`). Culture: brand talk (cars, phones), city rivalries (دبي vs أبوظبي, الرياض vs جدة). Words: better أحسن, worse أسوأ, bigger أكبر, smaller أصغر, cheaper أرخص, more expensive أغلى, faster أسرع, closer أقرب, easier أسهل, harder أصعب, more أكثر, less أقل, the best الأحسن/أحسن واحد, I prefer أفضّل, than من, the same زي بعض/نفس الشي, different مختلف/غير, opinion رأي, in my view برأيي, I think أظن/أعتقد.

**S3-L5 · If… — conditions and hypotheticals**
Can-do: make conditional plans and hypothetical wishes. Grammar: §4.20 إذا/لو/إن; بـ in apodosis; كان + past; يا ليت (`sentence-structure`). Culture: لو سمحت, إن شاء الله, fatalism vs planning idioms (الله كريم). Words: if إذا/لو, even if حتى لو, then (result) عيل/أجل, I wish يا ليت, hopefully عسى/إن شاء الله, unless إلا إذا, in case في حال, as long as دام, whether…or يا…يا, would have كان, lottery/dream حلم, rich غني, free time وقت فاضي, chance فرصة, plan خطة, decide قرر, change غير, regret ندم.

**S3-L6 · Because, so that — reasons, opinions, agreeing/disagreeing**
Can-do: give reasons, agree/disagree politely, express opinions on familiar topics. Grammar: عشان/لأن/عشان كذا; إن "that" after أظن/أقول; مع إن (`sentence-structure`). Culture: majlis debate etiquette (never contradict an elder directly; "معك حق بس…"). Words: because لأن, in order to عشان, that's why عشان كذا, although مع إن, but بس/لكن, I agree معك حق/أوافق, I disagree ما أوافق/مو معك, I think أظن/أحس, honestly بصراحة, in my opinion برأيي, true صح/صج, wrong غلط, important مهم, necessary ضروري, maybe يمكن, for sure أكيد, it depends على حسب, of course طبعاً, exactly بضبط.

**S3-L7 · Health & body — at the clinic/pharmacy**
Can-do: describe symptoms, understand advice, buy medicine. Grammar: عندي + symptom; لازم/ما لازم; imperatives of care; يوجعني (`verb-conjugation`). Culture: الله يشفيك→الله يسلمك; سلامات→الله يسلمك; visiting the sick (زيارة المريض). Words: sick تعبان/مريض, headache صداع, fever حرارة/سخونة, cough كحة, cold زكام, stomach بطن, pain ألم/وجع, it hurts يوجعني, head راس, back ظهر, leg رجل, tooth سن/ضرس, doctor دكتور, pharmacy صيدلية, medicine دوا, pill حبة, prescription وصفة, rest راحة, get well سلامات/الله يشفيك, appointment موعد, hospital مستشفى, emergency طوارئ.

**S3-L8 · Work & study**
Can-do: describe job/studies, hours, likes/dislikes; handle a simple work call. Grammar: verb strings (راح يجيب, بدا يشتغل); كان + imperfect for past habit; participles (`verb-conjugation`). Culture: دوام culture, ministry vs private sector, وظيفة as marriage prerequisite jokes, بشوت at ceremonies. Words: job وظيفة, work دوام/شغل, company شركة, government حكومة, boss مدير, colleague زميل, salary راتب/معاش, shift شفت, meeting اجتماع, project مشروع, deadline موعد التسليم, holiday إجازة, university جامعة, major تخصص, exam اختبار, degree شهادة, graduate يتخرج, apply يقدم, experience خبرة, retire يتقاعد.

**S3-L9 · Ramadan & Eid**
Can-do: exchange Ramadan/Eid greetings; describe fasting-day routine; accept a غبقة/فطور invitation. Grammar: time clauses with لين/قبل لا/عقب ما; بـ future for Eid plans (`sentence-structure`). Culture: §6.8 in full. Words: Ramadan رمضان, fasting صايم/صيام, iftar فطور, suhoor سحور, tarawih تراويح, cannon مدفع, Eid عيد, Eid gift عيدية, blessed مبارك, may you witness many عساكم من عواده, new clothes ملابس يديدة/جديدة, sweets حلا, visits زيارات, gargee'an قرقيعان, ghabga غبقة, prayer صلاة, mosque مسجد/جامع, family lunch غدا العيد, sacrifice ذبيحة.

**S3-L10 · Weddings, babies, condolences — social duties**
Can-do: congratulate, condole, respond correctly, understand an invitation. Grammar: fixed jussive blessings (الله يـ…); vocatives; عقبال (`sentence-structure`). Culture: §6.9–6.10; gender-segregated weddings; three days of عزا. Words: wedding عرس/زواج, contract night ملكة/ملچة, groom معرس, bride عروس, congratulations مبروك→الله يبارك فيك, your turn next عقبالك, newborn مولود, blessed baby مبروك ما ياك, condolences عظم الله أجركم→أجرنا وأجركم, passed away توفى/الله يرحمه, funeral جنازة, condolence gathering عزا, duty واجب, invitation دعوة/عزيمة, gift هدية, dinner party عشا, guests معازيم, hall صالة/قاعة.

**S3-L11 · Reading the Gulf online — chat, tweets, Arabizi**
Can-do: read and write short informal messages (WhatsApp/X) in Gulf spelling; recognise emoji/abbreviations. Grammar: written dialect conventions — ـج/چ for ch, ق for g, dropped hamza (انا, اذا), شـ prefixes, Arabizi digits (3=ع, 7=ح, 5=خ, 2=ء, 9=ص, 6=ط, g=ق) (`sentence-structure`). Culture: هههه, لول, احم, ابشر 👍, يا رجال, يا بعد چبدي, تاق/منشن. Words: message رسالة, send أرسل/طرّش, reply رد, group قروب, online أونلاين, seen شاف/سين, call كول/اتصال, later بعدين, ok اوكي, haha ههههه, lol لول, bro يا خوي/يالربع, sweet كيوت, where are you وينك, I'll tell you بقولك, seriously صج/صدق, awesome عجيب/كشخة, story ستوري, video مقطع, screenshot سكرين.

**S3-L12 · Cars, desert, national pride — B1 consolidation**
Can-do: hold a 5-minute conversation about a weekend كشتة, a car, or National Day; follow a 2–3-minute vlog with light scaffolding. Grammar: full mix; verb strings, participles, conditionals in one narrative (`verb-conjugation`, `sentence-structure`). Culture: §6.7, §6.12–6.13. Words: desert بر/صحرا, outing كشتة/طلعة, camp مخيم, tent خيمة, fire شبة, camel بعير/جمل, falcon صقر/طير, hunting مقناص, dunes طعوس/رمال, 4x4 جيب/لاندكروزر, drift تفحيط, licence رخصة, speed camera ساهر, flag علم, National Day اليوم الوطني, sword dance عرضة, parade مسيرة, pride فخر, heritage تراث, pearl diving غوص, dhow بوم.

Stage 3 exit ≈ 1,500 words; B1 spoken interaction on familiar/routine matters; gist of authentic Gulf video on familiar topics.

---

## 8. Video sourcing

General notes:
- There is no Easy-Languages Gulf edition (source 23); the closest "street interview" formats are Saudi/Kuwaiti creator man-on-the-street segments (search queries below) and Belmokhba's pan-Gulf guest mix.
- The seeded channels are tagged `dialect='Gulf'` with a `country`; the harvest scorer should prefer `khaliji-media`/`kuwaiti-hadar`/`najdi`/`dubai-sharjah` sub-variety tags for Stage 1–2 and allow `hijazi` from Stage 2 L8 on (Jana Vlogs, Fahad Sal, Saudi Food Eman are Jeddah voices — their إيش/دحين/كيفك should be surfaced as "same word, different city" cards, not hidden).
- Unseeded channels worth adding (all verified to exist by search this pass or well known **[own knowledge]** where marked): **Jana in Arabic** (Saudi, subtitled — arabicgoals names it; may be the same as the seeded "Jana Vlogs", verify), **Khalid Al Ameri** (UAE family vlogs, heavy English — mine Arabic segments only) [own knowledge], **Takki** (Saudi youth drama, Jeddah, YouTube, source 22), **Shabab Al Bomb / شباب البومب** (Saudi comedy, MBC on YouTube), **Tash ma Tash / طاش ما طاش** clips, **Masameer County** on Netflix/YouTube, **Block 13 / بلوك ١٣** (Kuwaiti animated), **Shaabiat Al Cartoon / شعبية الكرتون** (Emirati animation, source: Wikipedia listing), **Mansour** (Emirati children's animation — slow, clean Emirati, ideal Stage 1–2) [Wikipedia listing], **Al Ramsa "Emirati Arabic 1 minute"** playlist (seeded), **Amin Academy** and **GulfArabic.com** YouTube companions (instructional, Kuwaiti/Gulf), **يوميات** family-style Kuwaiti YouTube vlogs, **Sultan Al Shammari** style Najdi comedy skits [own knowledge].

Per lesson-theme hunting grounds and Arabic-script search queries (use YouTube search with the channel name added, e.g. `"عائلة مشيع" فطور`):

| Theme (lessons) | Best seeded channels | Other hunting grounds | Search queries (Arabic script) |
|---|---|---|---|
| Objects / home (S1-L1, L2) | Moshaya Family (house tours, toys named), Saud Brothers, Bjlife, Learn Arabic–Kuwaiti, AlRamsa Institute | Mansour cartoon; Emirati/Kuwaiti "جولة في بيتي" vlogs | `جولة في بيتي فلوق`, `تسوق أغراض البيت فلوق كويتي`, `تعلم اللهجة الكويتية كلمات` |
| Family (S1-L3, S2-L2) | Moshaya Family, Saud Brothers, Bjlife, Jana Vlogs | Khalid Al Ameri family segments; Takki family scenes | `يوم مع عائلتي فلوق سعودي`, `عيالي وأهلي فلوق`, `زيارة جدتي فلوق` |
| Greetings & politeness (S1-L4, L5) | AlRamsa Institute (1-minute phrases), Learn Arabic–Kuwaiti, QTips (Arabic phrase segments) | Amin Academy; Belmokhba openings (guests greeting) | `تعلم اللهجة الإماراتية تحيات`, `كيف تقول شلونك بالخليجي`, `الرمسة الإماراتية تعلم` |
| Numbers, money, shopping (S1-L6, S2-L8) | Saud Brothers (price challenges), Moshaya (mall trips), Bjlife, BanderitaX (challenges with budgets) | Souq vlogs: سوق المباركية (KW), سوق واقف (QA), البلد جدة | `تحدي بـ100 ريال`, `تسوق من سوق المباركية`, `كم سعر هذا؟ فلوق سوق شعبي`, `أرخص وأغلى تحدي` |
| Self-introduction (S1-L7) | Hitham Channel (people introducing their jobs), Sowt Afkari, Belmokhba | Takki character intros; Thamaniyeh interviews (later) | `عرف عن نفسك مقابلة سعودي`, `مقابلات الشارع الرياض`, `أسئلة للناس في الشارع الكويت` |
| Café / food & drink (S1-L8, L9) | Saudi Food Eman (verify Arabic narration), Vivian Mnafikh (verify dialect), Saud Brothers (mukbang), Moshaya (family meals), Sayood (restaurant sketches) | Kuwaiti/Emirati home-cooking channels; كرك stalls vlogs | `طريقة الكبسة السعودية`, `مجبوس دجاج كويتي`, `ريوق إماراتي بلاليط`, `فطور رمضان فلوق`, `شاي كرك فلوق` |
| This/that, colours, clothes (S1-L10) | Learn Arabic–Kuwaiti, AlRamsa, Moshaya (kids' clothes shopping) | Emirati كندورة/عباية shopping vlogs | `تسوق ملابس العيد فلوق`, `تعلم الألوان بالخليجي`, `شنو هذا تعلم كويتي` |
| Places & directions (S1-L11, S2-L9) | Fahad Sal (dialect tour / city tours), Hitham Channel, Bin Baz (Dubai scenes, screen for English) | Metro/taxi vlogs; القرية العالمية; كورنيش | `جولة في الرياض فلوق`, `مترو دبي فلوق`, `كيف أروح؟ طريق فلوق سعودي`, `تكسي الكويت` |
| Days & time, routine (S1-L12, S2-L4, S2-L10) | Jana Vlogs (day-in-the-life, slow), Bjlife, Moshaya | "يوم كامل" vlogs | `يوم كامل معي فلوق سعودية`, `روتيني اليومي فلوق كويتية`, `روتين الصباح خليجي` |
| Describing people, feelings (S2-L1) | Khambalah (subtitled sketches), Gudosbros, Ahmed Sharif, BluSkits | Takki | `أنواع الناس مقطع كوميدي سعودي`, `شخصيات خليجية كوميدي`, `خمبلة مقاطع` |
| Having / there is (S2-L3) | Moshaya, Saud Brothers, Sayood | | `شنو عندك بالشنطة`, `وش في ثلاجتي`, `عندي ولا ما عندي تحدي` |
| Negation / why (S2-L5) | Masameer, Yarob, Khambalah (dialogue-dense) | Block 13 | `ليش ما جيت؟ مقطع`, `مسامير حلقة`, `يعرب حلقة` |
| Questions (S2-L6) | Belmokhba (interview questions), Sowt Afkari, Thamaniyeh (later), Hitham | Street-interview style Saudi channels | `أسئلة محرجة للشارع سعودي`, `سؤال وجواب في الشارع الكويت`, `مقابلات الناس دبي` |
| Wants / needs / requests (S2-L7) | Sayood, BluSkits, Gudosbros (customer-service sketches) | | `مطعم كوميدي سكتش كويتي`, `طلبات الزبون مقطع`, `أبي أبغى مقطع كوميدي` |
| Plans & future (S2-L11) | Jana Vlogs, Bjlife, BanderitaX (trip plans) | | `خطتي للويكند فلوق`, `بنسافر وين؟ فلوق`, `تجهيزات السفر فلوق سعودي` |
| Past narration (S2-L12–13, S3-L1) | Fahad Sal (story vlogs), BanderitaX, Gudosbros, Ahmed Sharif | Belmokhba guests telling stories; Thamaniyeh | `قصة صارت لي فلوق`, `سالفة صارت لي`, `أسوأ يوم في حياتي مقطع سعودي` |
| Weather (S2-L13) | Moshaya (rain/dust days), Jana Vlogs | Weather-report clips (formal — screen) | `الجو اليوم فلوق`, `غبار الرياض فلوق`, `أمطار الكويت اليوم مقطع` |
| Hospitality / majlis (S2-L14, S3-L10) | Qalby Etmaan (host visits, dual subs), Moshaya (family gatherings), QTips culture segments, AlRamsa | Emirati/Saudi heritage channels; مجلس/ديوانية vlogs | `قهوة عربية طريقة التقديم`, `عادات المجلس الخليجي`, `ديوانية كويتية فلوق`, `عزيمة عشا فلوق` |
| Progressive / phone talk (S3-L2) | Sayood, BluSkits, Gudosbros (phone-call sketches) | | `مكالمة كوميدي كويتي`, `وينك؟ مقطع`, `شتسوي الحين مقطع` |
| Describing/lost & found (S3-L3) | Khambalah, Ahmed Sharif | | `ضيعت جوالي مقطع`, `وصف شخص كوميدي سعودي` |
| Comparisons / preferences (S3-L4) | Saud Brothers (X vs Y challenges), BanderitaX, Bin Baz (Dubai vs…) | Car review channels (Saudi) | `أيهم أفضل تحدي`, `الرياض ولا جدة`, `مقارنة سيارات سعودي` |
| Conditionals / opinions (S3-L5–6) | Thamaniyeh, Belmokhba, Sowt Afkari, Masameer | Podcasts: فنجان (Thamaniyeh) | `لو كنت غني وش بتسوي`, `رأيك في؟ مقابلة`, `بودكاست فنجان حلقة قصيرة` |
| Health (S3-L7) | Khambalah, Masameer (clinic sketches) | | `عند الدكتور كوميدي سعودي`, `الصيدلية مقطع كوميدي`, `تعبان مقطع كويتي` |
| Work & study (S3-L8) | Hitham Channel (professions series — the best fit), Thamaniyeh, Sowt Afkari | | `يوم في حياة موظف فلوق`, `مهنتي فلوق سعودي`, `الجامعة يوم كامل فلوق` |
| Ramadan & Eid (S3-L9) | Qalby Etmaan (Ramadan series), Moshaya, Saud Brothers (Eid vlogs), Bjlife | قرقيعان/حق الليلة vlogs | `فلوق أول يوم رمضان`, `قرقيعان الكويت`, `يوم العيد فلوق`, `عيدكم مبارك مقطع` |
| Weddings / condolences (S3-L10) | Jana Vlogs (wedding prep), Bjlife | Wedding vlogs (women's side often private — prefer men's ملكة) | `تجهيزات ملكة أخوي فلوق`, `عرس سعودي فلوق`, `عادات العزاء في الخليج` |
| Reading online Gulf (S3-L11) | Sayood podcast clips with on-screen chat; Bin Baz | X/Twitter Gulf trending; WhatsApp-style sketches | `تغريدات مضحكة خليجي`, `رسائل واتساب كوميدي سعودي` |
| Cars, desert, national day (S3-L12) | BanderitaX, Fahad Sal, Moshaya (camping), QTips (falconry/heritage), Qalby Etmaan | مزاين الإبل coverage; drift/car channels; national-day parades | `كشتة في البر فلوق`, `مقناص صقور مقطع`, `اليوم الوطني السعودي فلوق`, `تخييم الكويت فلوق` |

Screening rules for the harvest pass (mirrors the seed notes): drop segments with MSA narration (Qalby Etmaan voice-over, Thamaniyeh intros), heavy English (Bin Baz, QTips, Khalid Al Ameri), and non-Gulf hosts (verify Vivian Mnafikh, Um Anwar). For Stage 1–2 prefer clips where the object/action is on screen when named (Moshaya, Saud Brothers, cooking channels, AlRamsa), ≤90 s, one speaker, no music bed.
