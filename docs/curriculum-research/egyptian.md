# Egyptian Arabic (Cairene) — Curriculum Research Brief for Hakiya Content Authors

Scope: Pre-A1 → B1, three stages (Stage 1 Foundations Pre-A1→A1, Stage 2 Building Blocks A1→A2, Stage 3 The Bridge A2→B1), adapting the stage structure of the existing Gulf-centric design doc (`scratchpad/docx/curriculum.txt`). Everything Arabic below is **spoken Egyptian (Cairene)**, never فصحى. Where a form is contrasted with MSA or Gulf it is marked ❌ or "replaces:" and is there only so authors know what *not* to write.

**Transliteration key used in this brief** (matches `getDialectTransliterationRules('Egyptian')` in `dialectHelpers.ts`): `'` = glottal stop (ء, and ق in its normal Cairene value), `q` = ق only where Cairene keeps [q], `3` = ع, `H` = ح, `kh` = خ, `gh` = غ, `sh` = ش, `S D T Z` = ص ض ط ظ, `g` = ج, long vowels `aa ee ii oo uu`. Stress is not marked.

**Repo alignment (read before authoring):**
- `msaLeakDetector.ts` flags these in *any* dialect: الآن، لماذا، هذا، هذه، هؤلاء، ذلك، سوف، ليس، لست، ليسوا، الذي، التي، الذين، عندما، حينما، بينما، أيضاً، كذلك. For Egyptian it additionally flags the Gulf/Yemeni tokens شلونك، هالحين، واجد، يبي، إمبي، زين، خوش، بغيت، ذحين، شخبارك، شخبارش، وين، ذلحين. Unlike Gulf/Yemeni, Egyptian keeps هذا/هذه/عندما flagged — write ده/دي and لما.
- `ALWAYS_ALLOWED.Egyptian` includes النهارده، بكره، امبارح، ازاي، فين، ليه، كده، ده، دي، عايز، عاوز، كويس، اهلا، حلو, so those never trip the detector.
- The hard-coded Egyptian identity in `dialectHelpers.ts` names these as anchor words: إزيك، فين، دلوقتي، عايز، كويس، ماشي، يلا، حاضر، بتاع، مفيش، ازاي، كده، خلاص، يعني، طيب — and the cultural anchors أهوة، كشري، فول، طعمية، نيل، خان الخليلي. This brief builds the curriculum around that same core.
- The Egyptian worked demonstrations in `dialectHelpers.ts` already model the house spelling: النهارده، إمبارح، لسه، شوية، كتير، بالليل، مكنتش، أوي، معلش، زحمة، خالص، دلوقتي، فاضي، أهوة. Follow it.
- `grammarTaxonomy.ts` has exactly six category ids: `verb-conjugation`, `pronouns`, `negation`, `possessives`, `questions`, `sentence-structure`. Every structure in §4 is mapped to one of them; structures with no natural home (numbers, comparatives, connectors) are mapped to `sentence-structure` and flagged so the coverage planner knows they will not join drill mastery.
- `dialectSubvarieties.ts` Egyptian ids: `cairene`, `alexandrian`, `delta-fallahi`, `canal-cities`, `saidi`, `sinai-bedawi`, `western-desert-bedawi`. Curriculum audio/TTS should be tagged `cairene`; the "where to mention Alexandria/Saʿīd" notes in §2 use the `alexandrian` and `saidi` hints verbatim.
- TTS needs fully vocalised Arabic (`getTashkeelMandate`). Forms in this brief are given unvocalised for readability; authors add tashkeel on the *dialect* spelling (e.g. بِيرُوح, not بِيَرُوح; مَكُنْتِش).

---

## 1. Sources consulted

| # | Source | URL | What it contributed |
|---|---|---|---|
| S1 | AUC Press — *Kallimni ʿArabi Bishweesh* (Samia Louis, Beginners' Course 1) product page | https://aucpress.com/9789774162206/ | Verified 10-module structure and topics: (1) greetings/apologies, self-introduction & nationalities; (2) classroom/personal objects; (3) numbers, telephone, passport, time & appointments; (4) money/prices, supermarket; (5–6) asking location/directions, places & services; (7) daily habits/routines; (8) jobs, visiting & invitations; (9) offering, inviting, apologising, gifts & preferences; (10) requesting services (taxi, train), restaurant ordering. Basis for Stage 1–2 topic order. |
| S2 | AUC Bookstores — *Kallimni ʿArabi* (Intermediate, book 2) | https://aucbookstores.com/products/9789774249778 | Ten lessons; prerequisite ≈30 h of colloquial class; topics from directions/shopping to future plans, hobbies, free time. Confirms A2 topic band. |
| S3 | AUC Press — *Kallimni ʿArabi Aktar* (Upper-Intermediate, book 3) | https://aucpress.com/9789774161001/ | 8 modules: personal history, family, errands, travel, jobs, childhood memories, life changes, invitations, reported speech, problem-solving, urgency, ongoing/recent actions. Used to place reported speech, narration and كان بيـ at B1. |
| S4 | AUC Press — *Kallimni ʿArabi Mazboot* (Early Advanced, book 4) | https://aucpress.com/9789774162237/ | 8 modules incl. conditionals, wishes/regrets, past conditionals (لو كنت...كنت). Confirms counterfactual conditionals belong *above* B1; only real/possible لو/إذا at B1. |
| S5 | Routledge/Amazon — *Colloquial Arabic of Egypt* (Wightwick & Gaafar) | https://www.amazon.com/Colloquial-Arabic-Egypt-Complete-Beginners/dp/0415811317 (search snippet; product pages returned 403/500) | Unit titles seen: "Hello and welcome!", "Would you like some tea?", "Does it have air conditioning?", "Anything else?"; alphabet taught progressively alongside dialogues. Full TOC not retrievable — remaining unit order is own knowledge. |
| S6 | Lingualism — *Egyptian Colloquial Arabic Vocabulary* sample PDF (Aldrich) | https://files.lingualism.com/wp-content/uploads/SAMPLE-Egyptian-Colloquial-Arabic-Vocabulary-Lingualism.pdf | 57 thematic sections, 4,500+ items; section list extracted: Life & Death, Family, Love/Marriage, Names & Addressing People, Body & Describing People, Clothing, The House, Food & Drink, Work, School, Health, Technology, Getting Around, Around Town, Buildings, Bank, Post Office, Books & Stationery, Shopping, Restaurant… Used to sanity-check theme coverage. |
| S7 | Lingualism — Egyptian Arabic Orthography | https://resources.lingualism.com/egyptian-arabic/egyptian-arabic-orthography/ | ث → s (spelled ث) or t (spelled ت); ذ → z (ذ) or d (د); ج = g; ق mostly glottal but spelled ق, some words keep q; **future marker هـ is standard in modern Cairo, حـ common in Alexandria**; ة/ه and ى/ي conventions. |
| S8 | Lisaan Masry — Negation | https://www.lisaanmasry.org/grammar/negation.html | Full negation table: معنديش، مفيش، مكنتش، مشفتش، مش عارف، مش عايز ياكل، مبحبش، مش هشتري، متمشيش. |
| S9 | Lisaan Masry — Pronouns | https://www.lisaanmasry.org/grammar/pronouns.html | Subject pronouns أنا إحنا إنت إنتي إنتو هو هي هم; suffixes -i -na -ak -ik -kum -u -ha -hum; demonstratives ده دي دول. |
| S10 | Lisaan Masry — Verbs | https://www.lisaanmasry.org/grammar/verbs.html | Perfect suffixes (katab-t/-na/-it), bare imperfect يكتب as modal complement, بـ present, هـ future, كان بيكتب past continuous, imperative اكتب with 3 forms, active participle. |
| S11 | Lisaan Masry — Numbers | https://www.lisaanmasry.org/grammar/numbers.html | Numerals 0–100; counted-noun rules (1 = singular, 2 = dual/plural, 3–10 short form + plural, 11+ singular); ordinals awwil/taani/taalit; fractions نص تلت ربع. |
| S12 | Lisaan Masry — Essentials | https://www.lisaanmasry.org/grammar/essentials.html | SVO order, definite article, adjective agreement (-a, -een), zero copula, فيه existence, عند/مع/لـ possession. |
| S13 | Wikipedia — Egyptian Arabic | https://en.wikipedia.org/wiki/Egyptian_Arabic | ~84 M native speakers; بـ present, هـ/حـ future, ما...ش; Alexandrian and Saʿīdi notes; rural Delta ج [ʒ]. |
| S14 | Wikipedia — Egyptian Arabic phonology | https://en.wikipedia.org/wiki/Egyptian_Arabic_phonology | Cairene ج = [g]; ق → [ʔ] with [q] reintroduced as marginal phoneme (religious/learned words); interdentals ث ذ ظ → t d ḍ in inherited words, s z ẕ in loans; emphasis spreading; 5 short + 5 long vowels; long vowels shorten before two consonants and in unstressed syllables; final vowel lengthens under suffix stress; stress rule (heavy syllable priority). |
| S15 | Wikipedia — CEFR (global scale) | https://en.wikipedia.org/wiki/Common_European_Framework_of_Reference_for_Languages | Verbatim A1/A2/B1 global-scale descriptors (quoted in §7 stage headers). |
| S16 | Brian North, "Towards a broader view of language education: the CEFR Companion Volume" (Helsinki 2019 deck, oph.fi PDF) | https://www.oph.fi/sites/default/files/documents/north-helsinki-cefr-companion-volume-v2.pdf | Confirms CV 2020 adds Pre-A1, fills plus-levels, replaces phonology scale, removes "native speaker". The CV's own oral-interaction descriptors were not retrievable (coe.int returned 403) — quoted from own knowledge in §7, marked. |
| S17 | Talk in Arabic — "When is Qaf actually pronounced as a Qaf?" | https://talkinarabic.com/egyptian/letter-qaf-in-egyptian-arabic/ | Word list keeping [q]: قصة، مقاومة، قرية، مثقف، ثقافة، اعتقد، عبقري، معقد، تعقيد، قوي (in the sense "strong"), قرآن، القاهرة. |
| S18 | Arab Academy — Why Egyptian sounds different / most difficult sounds | https://www.arabacademy.com/why-egyptian-arabic-sounds-so-different-learn-egyptian-arabic/ | Everyday examples of ق → glottal: باقولك، قبل كده، ما قدرش; قلب → 'alb, جديد → gidiid. |
| S19 | Cleo Lingo — Egyptian Arabic Future Tense | https://cleolingo.com/egyptian-arabic-future-tense/ | Spells the future with هـ (هروح، همشي، هيسافروا، هينام، هتاكل); 1sg drops the alif of the present. |
| S20 | Cleo Lingo — Best Egyptian Arabic YouTube Channels | https://cleolingo.com/egyptian-arabic-youtube-channels/ | Level ratings: Ali Gamal (beginner–intermediate, 3,000+ videos), Kareem Elsayed (beginner–intermediate, English subs), Easy Arabic (all levels), Sarah Hany (intermediate), AJ+ Kibreet (intermediate+), Egyptoon (advanced), Linguamid (intermediate), Al Bernameg (advanced). |
| S21 | Cleo Lingo — Ramadan in Egyptian Arabic | https://cleolingo.com/ramadan-egyptian-arabic/ | فطار، سحور، فانوس، صايم، رمضان كريم → كل سنة وانت طيب; الفطار إمتى النهارده؟ |
| S22 | Ithaca Bound — How to say "How are you?" in Egyptian | https://www.ithacaboundlanguages.com/articles/how-to-say-how-are-you-in-egyptian-arabic/ | إزيك/إزيكي/إزيكو; عامل إيه/عاملة إيه/عاملين إيه; أخبارك إيه; إيه الأخبار (not with superiors); إيه الأحوال. |
| S23 | Egyptian Explorer / Speak-Masry blog (search snippets) | https://www.egyptianexplorer.com/blog/your-first-egyptian-arabic-lesson-basic-greetings ; http://speak-masry.blogspot.com/2009/05/lesson-2-basic-phrases-greetings.html | Reply pairs: صباح الخير → صباح النور / صباح الفل; أهلاً وسهلاً → أهلاً بيك/بيكي; كويس الحمد لله. |
| S24 | Arabic for Nerds — meanings of بقى | https://arabic-for-nerds.com/dialects/egyptian-arabic/ba2a-egyptian-arabic/ (search snippet; page 403 on fetch) | بقى = became / no longer (ما بقاش) / discourse "then, well" / بقالي duration. |
| S25 | Arabic for Nerds — meanings of لسه | https://arabic-for-nerds.com/dialects/egyptian-arabic/lissa-egyptian-arabic/ (snippet) | لسه = still / just / not yet. |
| S26 | italki thread — برضه vs كمان | https://www.italki.com/en/post/question-476111 | برضه scopes over the predicate ("I also want…"), كمان over the noun ("another/more"); برضه can mean "again/anyway". |
| S27 | Lingualism — معلش | https://resources.lingualism.com/egyptian-arabic/key-egyptian-arabic-expression-ma3aliss/ | معلش = never mind / soft apology / excuse me. |
| S28 | U-Can Institute — filler words; Cairo vs Alexandria accent | https://u-caninstitute.com/our-blog/filler-words-egyptian-arabic/ ; https://u-caninstitute.com/our-blog/egyptian-accent-cairo-vs-alexandria/ | يعني، طيب، خلاص، ماشي as fillers; Alexandrian "mellower, musical" intonation. |
| S29 | Arab America — Arabic dialects within Egypt; WordReference threads | https://www.arabamerica.com/arabic-dialects-within-egypt/ ; https://forum.wordreference.com/threads/egyptian-arabic-varieties.1953706/ | Saʿīdi: ق often [g] ("galb"), ج often [dʒ] (أنا جاي "jaay" vs Cairene "gaay"); old Alexandrian n- prefix on 1sg verbs (Maghrebi-like). |
| S30 | Wikipedia — Saʿīdi Arabic | https://en.wikipedia.org/wiki/Sa%CA%BFidi_Arabic | No single unified Saʿīdi; carries little prestige nationally. |
| S31 | desert-sky.net — Conditionals in Egyptian Arabic | https://arabic.desert-sky.net/g_cond.html | لو and إذا interchangeable in Egyptian, لو commoner; possible: past/present in if-clause, future/imperative in result; counterfactual: كان/كنت in both halves (examples quoted in §4). |
| S32 | desert-sky.net — Colloquial expressions | https://arabic.desert-sky.net/colloq.html | يا سلام، ولا يهمك، مفيش مشكلة، على طول، على فكرة، على حسابي، يا خبر أبيض/أسود، مالوش دعوة. |
| S33 | UOregon open text — Egyptian Arabic: active participles with verbal force; relative اللي | https://opentext.uoregon.edu/introarabic/chapter/present-tense-with-b-prefix-to-like/ ; https://opentext.uoregon.edu/introarabic/chapter/the-relative-pronoun-illi-%D8%A7%D9%84%D9%91%D9%8A/ | Participles of motion/posture/knowledge (رايح، قاعد، عارف) replace the present; قاعد grammaticalised as progressive marker; اللي is invariable. |
| S34 | Arabic for Nerds — Comparatives & superlatives in Egyptian | https://arabic-for-nerds.com/dialects/egyptian-arabic/comparative-and-superlative-egyptian-arabic/ | أفعل + من; long adjectives take أكتر after; superlative = elative + noun (أحسن مطعم) or noun + أكبرهم. |
| S35 | inegyptian.blogspot — Addressing people; Scribd address-forms guide (snippets) | http://inegyptian.blogspot.com/2013/01/addressing-people.html | يا باشا/يا بيه (Turkish-origin, officials or flattery), يا حاج (elderly, Hajj), يا أستاذ (teacher / respectful default), يا مدام (married middle-class woman), حضرتك (stands alone, no يا). |
| S36 | Playaling — Condolences in Arabic (Egyptian section) | https://playaling.com/expressing-condolences-in-arabic/ | ربنا يعزيكم، البركة فيكم، شدوا حيلكم; Christian: ربنا ينيح روحه، في أحضان القديسين. |
| S37 | Preply / NaTakallam (snippets) | https://preply.com/en/blog/how-to-say-congratulations-in-arabic/ | مبروك → الله يبارك فيك/فيكي; كل سنة وانتم بخير used year-round. |
| S38 | Wikipedia — Egyptian cuisine | https://en.wikipedia.org/wiki/Egyptian_cuisine | فول مدمس، طعمية (fava-bean falafel), كشري (rice/lentils/macaroni), ملوخية، محشي، فطير; lunch is the main meal; Egyptians eat dinner late (10 pm+). |
| S39 | Egypt tipping guides (several) | https://egyptfuntours.com/blog/important-tips-for-egypt-travelers-guide-for-wise-tipping-in-egypt/ ; https://tutegypttours.com/tipping-in-egypt/ | بقشيش is expected in service contexts; taxi: round up to nearest 5–10 EGP; microbus drivers are not tipped; bargaining is expected in markets, not tipping. |
| S40 | Identity Magazine / Scoop Empire — Egyptian hand gestures | https://identity-mag.com/top-egyptian-hand-gestures/ ; https://scoopempire.com/dictionary-of-arab-hand-gestures/ | Pinched fingers bobbing = اصبر شوية "hold on/be patient". |
| S41 | Live Lingua / Internet Archive — DLI Egyptian Arabic Language Course | https://www.livelingua.com/project/dli/arabic/egyptian ; https://archive.org/details/dli-egyptian-arabic-course | 12 modules × 4 lessons = 48; Module 1: greeting, meeting, inviting/visiting, office visit; Module 3: directions, public transport, phone calls, health; Module 10: religion, customs, family structure, income. (FSI never published an Egyptian basic course — only Written, Levantine, Saudi/Hijazi and Comparative: https://www.fsi-language-courses.org/fsi-arabic-language-courses/.) |
| S42 | Georgetown UP — *A Reference Grammar of Egyptian Arabic* (Abdel-Massih, Abdel-Malek, Badawi, McCarus) | https://press.georgetown.edu/Book/A-Reference-Grammar-of-Egyptian-Arabic | Confirms authorship and alphabetical glossary format (the user's "Gary Gamal-Eldin" is *Cairene Egyptian Arabic* readers/Gary's other Georgetown titles; this is the standard reference). Content used from own knowledge. |
| S43 | Kalimah Center — Egyptian vocabulary; Areeb Academy — must-know words | https://kalimah-center.com/egyptian-arabic-vocabulary/ ; https://areeb-academy.com/egyptian-colloquial-vocabulary-guide/ | Cross-check of the identity-vocabulary list (§5). |

Not verifiable online in this pass and therefore **own knowledge** (marked "OK" in the text): the internal order of Colloquial Arabic of Egypt units beyond the four seen; the CEFR Companion Volume oral-interaction wording; the Kallimni Bishweesh grammar-per-module mapping; most example sentences; the counted-noun تـ insertion (تلات تيام); Egyptian time-telling forms; wedding/condolence reply pairs beyond S36–S37.

---

## 2. Variety to teach and why: Cairene

**Teach Cairene (مصري قاهري, `cairene`).** Reasons:
1. It is what every source above teaches. Kallimni ʿArabi (AUC, Cairo), Colloquial Arabic of Egypt, Lingualism, DLI and Lisaan Masry are all Cairene without saying so — it is "the default sense of Egyptian Arabic" (`dialectSubvarieties.ts` hint) and the register of Egyptian film and TV (S13: the most widely understood Arabic variety, ~84 M native speakers plus ~35 M L2).
2. The seeded video channels (§8) are overwhelmingly Cairo/Giza-based creators, so the learner's input will *be* Cairene; teaching another sub-variety would teach two systems.
3. TTS and pronunciation scoring pick a voice off the dialect label; one consistent phonology (ج = g, ق = ʔ, هـ future) keeps `azure-pronunciation` and the shadowing path honest.

**Where to mention other sub-varieties (and only mention — never teach):**

| Sub-variety (`id`) | When it comes up | What to say (one culture-note box, not a grammar target) |
|---|---|---|
| Alexandrian (`alexandrian`) | Stage 2, lesson on the sea/holidays (Alexandria is *the* summer destination); Stage 3 comprehension of an Alexandrian speaker | Same grammar; you will hear future with **حـ** (حروح) rather than هـ (S7); "mellower, more musical" intonation (S28); some Mediterranean loanwords; older speakers: 1sg verb with نـ (نروح = "I go", Maghrebi-like — S13, S29). بتاع can surface as تاع (`dialectSubvarieties` hint). Tell learners: understand it, don't switch to it. |
| Saʿīdi (`saidi`) | Stage 3, when a video shows an Upper-Egyptian speaker or a Saʿīdi joke (see §6, humor) | ق is [g] and ج is [dʒ] — the *reverse* of Cairo: قلب "galb", أنا جاي "ana jaay" (S29). Stress and some pronouns differ; little national prestige (S30), and it is the butt of a whole joke genre — flag the stereotype as something to recognise, not repeat. |
| Delta/Fallāḥi (`delta-fallahi`) | Stage 3 cooking videos filmed outside Cairo (Fatma Abu Haty's rural kitchen register may drift here) | ج may be [ʒ]/[ɟ] (S13). Otherwise near-Cairene. |
| Canal cities (`canal-cities`) | Only if a clip is tagged so by a reviewer | Sing-song intonation; no grammar change worth a note. |
| Bedouin varieties | Never in Pre-A1→B1 | Out of scope; reviewers pull such clips. |

Practical rule for authors: **one Cairene form per slot.** Where Cairo itself has two live forms (عايز/عاوز, عشان/علشان, هـ/حـ, النهارده/النهاردة, برضه/برضو, دلوقتي/دلوقت), pick the first as the *taught* form and list the second under "you will also hear". The detector's `normalizeArabic` already treats ة/ه and ى/ي as identical, so النهارده/النهاردة never conflict.

---

## 3. Script & sound notes for Pre-A1/A1

### 3.1 Letters whose Cairene value differs from MSA

| Letter | MSA value | Cairene value | Spelling rule for Hakiya content | Examples |
|---|---|---|---|---|
| ج | [dʒ] | **[g]** always | keep ج | جميل gamiil, جديد gidiid, جنيه gineeh, راجل raagil |
| ق | [q] | **[ʔ]** glottal stop in inherited/everyday words | keep ق (never write ء) — learners must learn to *read* ق as ' | قلب 'alb, قال 'aal, دلوقتي dilwa'ti, قهوة 'ahwa (→ أهوة in the app's cultural anchor spelling), بقى ba'a, قبل 'abl, قدام 'uddaam |
| ق exceptions | | **[q]** kept in learned/religious/MSA-borrowed words (S14, S17) | keep ق, transliterate q | القرآن il-qur'aan, القاهرة il-qaahira, ثقافة saqaafa, قصة qiSSa, مثقف musaqqaf, قرية qarya, اعتقد a3taqid, عبقري 3abqari, معقد mu3aqqad, مقاومة muqaawma, قوي **qawi** "strong" — but the same word as the intensifier "very" is **أوي** 'awi. Trap: قوي/أوي is the single most common learner error; teach أوي as its own word at Pre-A1. |
| ث | [θ] | **[s]** in learned words (spelled ث), **[t]** in everyday inherited words (spelled ت) (S7, S14) | spell as pronounced | تلاتة talaata "3", اتنين itneen "2", تاني taani "second/again", كتير kitiir "much" — vs ثقافة saqaafa, ثانية sanya "second (time)", مثلاً masalan |
| ذ | [ð] | **[z]** (spelled ذ, learned) or **[d]** (spelled د, everyday) | spell as pronounced | ده da, دي di, ديب diib, دهب dahab "gold", ذاكر zaakir "study", كذاب kaddaab / كداب |
| ظ | [ðˤ] | **[ẕ]** (emphatic z) in learned words, **[ḍ]** in a few inherited ones | keep ظ | ظابط ZaabiT "officer", ظرف Zarf "envelope", ظهر Duhr/Zuhr "noon"; مظبوط maZbuuT "exactly" |
| ة | -a(t) | -a; -it in construct | ة, but ـِت pronounced before a possessed noun | مدرسة madrasa → مدرسة أحمد madrasit aHmad; شنطة shanTa → شنطتي shanTiti |
| ء / أ | | glottal; often dropped medially | keep | سأل → سأل sa'al, but بير biir "well", راس raas "head" (MSA رأس) |

Vowels (S14): five short /i u e o a/, five long /ii uu ee oo aa/. **ee and oo are real Egyptian vowels** where MSA has ay/aw: بيت beet, يوم yoom, فين feen, لون loon. Transliterate them as ee/oo (never "ay/aw"), matching the app's rule.

### 3.2 Vowel shortening, elision, stress (S14)

- Long vowels **shorten** when unstressed or before two consonants: شاف shaaf → شافها **shafha**; بيقول bi'uul → بيقولها bi'ulha; كتاب kitaab → كتابين kitabeen.
- A **final short vowel lengthens** when a suffix pulls stress onto it: مشى mishi → مشيت misheet; بيدي biyiddi → بيدّيه biyiddiih.
- Vowel **elision** across words: في البيت fi-l-beet, عايز أروح 3aayiz-aruuH; the "helping vowel" -i- breaks three-consonant clusters: كنت في → kunti f-, بنت جميلة binti gamiila.
- **Stress**: rightmost heavy syllable (CVV, CVVC, CVCC) wins; otherwise a characteristic Egyptian pattern puts stress on the *penult* in words like مَدْرَسَة **madrása**, مَكْتَبَة **maktába** (MSA has mádrasa). Teach by ear with these two words; it is the most audible "Egyptian accent" feature.
- Emphasis spreading: an emphatic consonant backs neighbouring vowels — طالب Taalib sounds "Tɑɑlib". Teach as a colour of the whole word, not a letter.

### 3.3 Sounds English speakers struggle with, and the sound-spotlight plan

Minimal-pair drilling order (each spotlight = one Stage 1 lesson, see §7):

| Lesson | Spotlight | Minimal pairs / anchor words |
|---|---|---|
| 1 | ج = g; ق = ' ; the two "how are you" words as a whole | جميل gamiil, قلب 'alb, إزيك izzayyak |
| 2 | ح vs هـ (pharyngeal vs plain h) | حلو Hilw / هو huwwa; حاضر HaaDir; صباح SabaaH; الحمد لله ilHamdu lillaah |
| 3 | ع (voiced pharyngeal) vs ء | عايز 3aayiz vs أيوه aywa; عشرة 3ashara; معلش ma3lish; شارع shaari3 |
| 4 | خ vs ك vs غ | خمسة khamsa / كمان kamaan; غالي ghaali; خلاص khalaaS; شغل shughl |
| 5 | ص vs س | صباح SabaaH / سلام salaam; صحيح SaHiiH; ساعة saa3a |
| 6 | ط vs ت | طيب Tayyib / تاني taani; بطاطس baTaaTis; طعمية Ta3miyya |
| 7 | ض vs د | ضحك DiHik / دخل dakhal; بيض beeD; ده/دي |
| 8 | ظ / ز and ذ→d/z | ظابط ZaabiT; زي zayy "like"; ذاكر zaakir |
| 9 | Long vs short vowels; ee/oo | بيت beet / بت bitt; يوم yoom; كتاب kitaab / كتب kutub |
| 10 | Stress & shortening | مدرسة madrása; شافها shafha; بيقولها bi'ulha |
| 11 | Shadda/gemination | حب Habb, بص buSS, كل kull; إنتَ vs إنتِ |
| 12 | Connected speech: elision & helping vowel | في البيت fi-l-beet; كنت في kunti f-; عايز أروح |

Script sequencing (adapting the Gulf doc's phonetic-group order): teach letters in groups by shape, but introduce **ج ق ث ذ ظ with their Egyptian sounds from the first exposure** and put a one-line "in فصحى this is …" footnote only; never drill the MSA sound. Pre-A1 learners read words they have already heard, so every letter lesson's word bank draws only from lessons already done (see §7 vocabulary).

---

## 4. Grammar inventory A1 → A2 → B1

Format per entry: **Name** — level — `taxonomy id` — forms — examples (Arabic / translit / gloss) — traps. Entries are in the recommended teaching order within each level. Examples are own knowledge unless a source is cited; paradigms cross-checked against S8–S12.

### 4.1 A1 (Stage 1 → early Stage 2)

**1. Subject pronouns** — A1 — `pronouns` (S9)

| | sg | pl |
|---|---|---|
| 1 | أنا ana | إحنا iHna |
| 2m | إنتَ inta | إنتو intu |
| 2f | إنتي inti | (same) |
| 3m | هو huwwa | هم humma |
| 3f | هي hiyya | (same) |

- أنا مصري وإنتَ منين؟ — ana maSri w-inta mineen? — I'm Egyptian, and where are you from?
- هي دكتورة وهو مهندس. — hiyya duktoora w-huwwa muhandis. — She's a doctor and he's an engineer.
- إحنا من القاهرة. — iHna min il-qaahira. — We're from Cairo. (note [q] kept)

Traps: no dual pronoun, no feminine plural — إنتو/هم for everyone. Zero copula: no word for "is/am/are" in the present (S12).

**2. Demonstratives ده/دي/دول** — A1 — `pronouns`

- ده كتاب. / دي شنطة. / دول طلبة. — da kitaab / di shanTa / dool Talaba — This is a book / this is a bag / these are students.
- الكتاب ده غالي. — il-kitaab da ghaali. — This book is expensive. (demonstrative *follows* the definite noun)
- إيه ده؟ — eeh da? — What's this?

Traps: ❌ هذا/هذه/هؤلاء/ذلك are detector leaks. Egyptian has no separate "that" — ده/دي do both; "that one over there" is ده اللي هناك. Word order is *noun + ده*, the reverse of MSA. Non-human plurals take دي: الكتب دي "these books". Also أهو/أهي/أهم "here it is/there he is" (أهو جه ahuw gih "here he comes") — a Pre-A1 gem.

**3. Nominal sentence, definite article, adjective agreement** — A1 — `sentence-structure` (S12)

- البيت كبير. — il-beet kibiir. — The house is big.
- الشقة صغيرة بس حلوة. — ish-sha''a Sughayyara bass Hilwa. — The flat is small but nice.
- الناس دول كويسين. — in-naas dool kuwayyisiin. — These people are good.

Traps: إل assimilates to sun letters (الشمس ish-shams) *and*, in Egyptian, usually to ج and ك too (الجامعة ig-gam3a, الكتاب ik-kitaab) — teach as pronunciation, keep the spelling ال. No indefinite article. Feminine -a, plural adjectives -iin for people, feminine singular for things (كتب كتير / كتب قديمة).

**4. Question words** — A1 — `questions`

| Egyptian | replaces | gloss |
|---|---|---|
| إيه eeh | ❌ ما/ماذا | what |
| فين feen | ❌ أين | where |
| مين miin | من | who |
| إزاي izzaay | ❌ كيف | how |
| ليه leeh | ❌ لماذا | why |
| إمتى imta | متى | when |
| كام kaam | كم | how many / what number |
| بكام bikaam | | how much (price) |
| قد إيه 'add eeh | | how much / how long (quantity, duration) |
| منين mineen | من أين | where from |
| أنهي/أنهو anhi/anhu | أي | which (أنهي واحد؟ anhi waaHid "which one") |
| ولا walla | أم | or (in questions) |

- اسمك إيه؟ — ismak eeh? — What's your name?
- إنت ساكن فين؟ — inta saakin feen? — Where do you live?
- الساعة كام؟ — is-saa3a kaam? — What time is it?
- بتشتغل إيه؟ — bitishtaghal eeh? — What do you do?
- شاي ولا قهوة؟ — shaay walla 'ahwa? — Tea or coffee?

Traps: **question word goes where the answer goes**, usually sentence-final (اسمك إيه، ساكن فين، رايح فين), not fronted as in MSA/English. Yes/no questions are intonation only (إنت مصري؟). ❌ هل is MSA; ❌ ماذا/كيف/لماذا/أين/متى are leaks or non-Egyptian.

**5. Possessive suffixes & iḍāfa** — A1 — `possessives` (S9)

| | after consonant | after vowel (e.g. أبو abu-, معا ma3aa-) |
|---|---|---|
| my | ـي -i (كتابي kitaabi) | ـيا -ya (أبويا abuuya, معايا ma3aaya) |
| your m | ـك -ak (كتابك kitaabak) | ـك -k (أبوك abuuk, معاك ma3aak) |
| your f | ـكي -ki / ـِك -ik (كتابكِ kitaabki) | ـكي -ki (أبوكي abuuki, معاكي ma3aaki) |
| his | ـه -u (كتابه kitaabu) | ـه -h (أبوه abuuh, معاه ma3aah) |
| her | ـها -ha (كتابها kitabha) | ـها (أبوها abuuha, معاها ma3aaha) |
| our | ـنا -na (كتابنا kitabna) | (أبونا abuuna, معانا ma3aana) |
| your pl | ـكم -ku(m) (كتابكم kitabku) | (أبوكم abuuku, معاكم ma3aaku) |
| their | ـهم -hum (كتابهم kitabhum) | (أبوهم abuuhum, معاهم ma3aahum) |

- ده بيتي ودي عربيتي. — da beeti w-di 3arabiyyiti. — This is my house and this is my car.
- اسم أخوك إيه؟ — ism akhuuk eeh? — What's your brother's name?
- مفتاح الشقة — muftaaH ish-sha''a — the key of the flat (iḍāfa: first noun never takes ال)
- بيت أبويا كبير. — beet abuuya kibiir. — My father's house is big.

Traps: feminine ة becomes ـِت before a suffix (شنطتي shanTiti, مدرستنا madrasitna). Long vowel shortens: كتاب → كتابها kitabha. Kin terms أب/أخ take the أبو/أخو stem before suffixes (أبوك، أخوها) — but "my father" is أبويا / "my mother" أمي / "my brother" أخويا.

**6. بتاع** — A1 (introduce) → A2 (all forms) — `possessives`

Forms: بتاع bitaa3 (m), بتاعة bitaa3it (f), بتوع bituu3 (pl); + suffix: بتاعي، بتاعك، بتاعكي، بتاعه، بتاعها، بتاعنا، بتاعكم، بتاعهم.

- الكتاب ده بتاعي. — il-kitaab da bitaa3i. — This book is mine.
- الشنطة دي بتاعة مين؟ — ish-shanTa di bitaa3it miin? — Whose bag is this?
- الموبايل بتاع أحمد. — il-mobayl bitaa3 aHmad. — Ahmad's phone.
- المشاكل بتوع الشغل — il-mashaakil bituu3 ish-shughl — work problems (lit. the problems of work)

Traps: used for *alienable* possession and loanword nouns; never with kinship (❌ الأب بتاعي). The Alexandrian variant تاع exists (`dialectSubvarieties`); teach بتاع only. Also بتاع as a filler "thingy": هات البتاع ده haat il-bitaa3 da "pass me that thing".

**7. Existence فيه / مفيش** — A1 — `negation` (and `sentence-structure`) (S8)

- فيه أهوة قريبة من هنا؟ — fiih 'ahwa 'urayyiba min hina? — Is there a café near here?
- فيه ناس كتير في الشارع. — fiih naas kitiir fi-sh-shaari3. — There are lots of people in the street.
- مفيش مية. — mafiish mayya. — There's no water.
- مفيش مشكلة. — mafiish mushkila. — No problem.

Traps: فيه is the preposition في + ه; spell فيه (existence) vs في (in) — many Egyptians write both في; the app should write فيه for "there is" so TTS lengthens it. Negative is one word مفيش (S8), not ❌ لا يوجد/ليس هناك.

**8. "Have": عند / معا / لـ** — A1 — `possessives` (S12)

| | عند 3and (own, possess) | معا ma3a (have on you, with you) | لـ li (belong to / have relatives, rights) |
|---|---|---|---|
| I | عندي 3andi | معايا ma3aaya | ليا liyya |
| you m/f | عندك/عندكي 3andak/3andiki | معاك/معاكي | لك/ليكي lik/liiki |
| he/she | عنده/عندها 3andu/3andaha | معاه/معاها | له/لها luh/laha |
| we | عندنا 3andina | معانا | لينا liina |
| you pl | عندكم 3andukum | معاكم | ليكم liiku |
| they | عندهم 3anduhum | معاهم | ليهم liihum |

- عندي عربية بس مفيش بنزين. — 3andi 3arabiyya bass mafiish banziin. — I have a car but there's no petrol.
- معاك فكة؟ — ma3aak fakka? — Do you have change (on you)?
- ليا أخ في إسكندرية. — liyya akhkh f-iskindiriyya. — I have a brother in Alexandria.
- عندك كام سنة؟ — 3andak kaam sana? — How old are you?

Negation (S8): معنديش ma3andiish, معاييش/معايش ma3aayiish, ماليش maliish.
Traps: these are prepositions, not verbs — for past/future add كان/هيكون: كان عندي kaan 3andi "I had", هيكون معايا haykuun ma3aaya "I'll have on me". ❌ لدي/أملك are MSA.

**9. عايز / محتاج / ممكن / لازم + bare imperfect** — A1 — `sentence-structure` (and `verb-conjugation` for the following verb) (S10 for "bare imperfect after modals")

Forms: عايز/عايزة/عايزين (3aayiz/3aayza/3ayziin; also عاوز); محتاج/محتاجة/محتاجين; ممكن (invariable); لازم (invariable).

- عايز أشرب شاي. — 3aayiz ashrab shaay. — I want to drink tea.
- عايزة كيلو طماطم لو سمحت. — 3aayza kiilu TamaaTim law samaHt. — I'd like a kilo of tomatoes, please.
- ممكن أسألك سؤال؟ — mumkin as'alak su'aal? — Can I ask you a question?
- لازم نروح دلوقتي. — laazim niruuH dilwa'ti. — We have to go now.
- محتاج أنام. — miHtaag anaam. — I need to sleep.

Traps: the second verb is the **bare imperfect without بـ** (عايز أشرب, never ❌ عايز بشرب). Negation: مش عايز (never ❌ ما عايزش... which exists in some Delta speech but is not the taught form); مش لازم = "needn't"; لازم ما...ش = "must not" (لازم ما تتأخرش). ❌ أريد/يجب/يمكن are MSA; ❌ يبي/بغيت are Gulf/Yemeni leaks.

**10. Present with بـ (bi-imperfect)** — A1 — `verb-conjugation` (S10, S13)

Paradigm, كتب "write" and راح "go":

| | يكتب (bare) | بيكتب | بيروح |
|---|---|---|---|
| أنا | أكتب aktib | **بكتب** baktib | بروح baruuH |
| إنتَ | تكتب tiktib | بتكتب bitiktib | بتروح bitruuH |
| إنتي | تكتبي tiktibi | بتكتبي bitiktibi | بتروحي bitruuHi |
| هو | يكتب yiktib | بيكتب biyiktib | بيروح biyruuH |
| هي | تكتب tiktib | بتكتب bitiktib | بتروح bitruuH |
| إحنا | نكتب niktib | بنكتب biniktib | بنروح binruuH |
| إنتو | تكتبوا tiktibu | بتكتبوا bitiktibu | بتروحوا bitruuHu |
| هم | يكتبوا yiktibu | بيكتبوا biyiktibu | بيروحوا biyruuHu |

- بشرب قهوة كل يوم الصبح. — bashrab 'ahwa kull yoom iS-SubH. — I drink coffee every morning.
- بتشتغل فين؟ — bitishtaghal feen? — Where do you work?
- بيحب الكشري أوي. — biyHibb il-kushari 'awi. — He loves koshari a lot.
- إحنا بنتكلم عربي شوية. — iHna binitkallim 3arabi shwayya. — We speak a little Arabic.

Uses: habitual *and* ongoing present ("I'm drinking" and "I drink") — Egyptian does not need a separate progressive except for emphasis (see قاعد, B1). Traps: 1sg is بـ + أ → **بَ** (بكتب, not ❌ بأكتب); 3ms بي (بيكتب) and 3pl بيـ...وا; the plural ـوا is spelled with a silent alif. Bare imperfect alone is *not* a present tense — it only follows modals (عايز، لازم، ممكن، بحب) or purpose (عشان). ❌ MSA يكتب as a main-clause present is the most common leak in generated text; the app's detector will not catch it lexically, so authors must.

**11. Negation مش vs ما…ش** — A1 — `negation` (S8)

Rule: **verbs (past, بـ-present, imperative) and the pseudo-verbs عند/معا/لـ/فيه take ما…ش; everything else takes مش.**

| Pattern | Example |
|---|---|
| ما + past + ش | ما شفتش أحمد. ma shuftish aHmad. I didn't see Ahmad. (S8) |
| ما + بـ-present + ش | ما بحبش الكتاب ده. ma baHibbish il-kitaab da. I don't like this book. (S8) |
| ما + عند + ش | معنديش سجاير. ma3andiish sagaayir. I don't have cigarettes. (S8) |
| ما + كان + ش | مكنتش هناك. makuntish hinaak. I wasn't there. (S8) |
| ما + imperative + ش (prohibitive uses 2nd-person imperfect) | متمشيش! matimshiish! Don't go! (S8) |
| مش + noun/adjective | أنا مش مصري. ana mish maSri. I'm not Egyptian. |
| مش + participle | أنا مش عارف. ana mish 3aarif. I don't know. (S8) |
| مش + عايز/لازم/ممكن | مش عايز ياكل. mish 3aayiz yaakul. He doesn't want to eat. (S8) |
| مش + هـ-future | مش هشتري الكتاب. mish hashtiri il-kitaab. I won't buy the book. (S8) |
| مش + بـ-present (emphatic/contrastive variant) | أنا مش بشرب سجاير. ana mish bashrab sagaayir. I don't smoke (at all). |

Traps: (a) Spelling — the app's demonstrations write مكنتش; recommend **ما** attached with alif dropped only in the fixed words مفيش/معنديش/مكنتش/مشفتش… i.e. write مـ+verb+ش as one word: مشفتش، مبحبش، مروحتش; either is acceptable to the detector. (b) Suffix -sh triggers vowel changes: شفت shuft → مشفتش ma-shuft-**i**sh (helping vowel), بحب baHibb → مبحبش ma-baHibb-ish, راح raaH → مراحش ma-raaH-sh. (c) After an object suffix the ش goes last: ما شفتهاش ma-shuftahaash "I didn't see her", ما قالّيش ma-'alliish "he didn't tell me". (d) ❌ ليس/لا/لم/لن are MSA; ❌ مو/ما زين are Gulf.

**12. Numbers 1–10 with counted nouns** — A1 — `sentence-structure` (no drill category; mark as `numbers` slug) (S11 + OK)

| n | standalone | before a noun |
|---|---|---|
| 1 | واحد / واحدة waaHid/waHda | noun + واحد (كتاب واحد "one book", بنت واحدة) |
| 2 | اتنين itneen | dual ـين: كتابين kitabeen, يومين yomeen, ساعتين sa3teen |
| 3 | تلاتة talaata | تلات talat + plural: تلات كتب |
| 4 | أربعة arba3a | أربع arba3: أربع أيام |
| 5 | خمسة khamsa | خمس khamas: خمس ساعات |
| 6 | ستة sitta | ست sitt: ست بيوت |
| 7 | سبعة sab3a | سبع saba3: سبع دقايق |
| 8 | تمانية tamanya | تمن taman: تمن جنيه |
| 9 | تسعة tis3a | تسع tisa3: تسع سنين |
| 10 | عشرة 3ashara | عشر 3ashar: عشر كيلو |
| 11–19 | حداشر Hidaashar, اتناشر itnaashar, تلاتاشر talattaashar, أربعتاشر, خمستاشر, ستاشر, سبعتاشر, تمنتاشر, تسعتاشر | + **singular**: حداشر يوم, خمستاشر جنيه (S11) |
| 20,30… | عشرين، تلاتين، أربعين، خمسين، ستين، سبعين، تمانين، تسعين، مية miyya، ألف alf | + singular: عشرين جنيه، مية سنة; compounds units-first: خمسة وعشرين khamsa w-3ishriin |

- عندي تلات إخوات. — 3andi talat ikhwaat. — I have three siblings.
- عايز كيلوين طماطم. — 3aayiz kilween TamaaTim. — I want two kilos of tomatoes.
- ده بعشرين جنيه. — da bi-3ishriin gineeh. — This is twenty pounds.

Traps (OK): before a small set of vowel-initial plurals 3–10 insert **تـ**: تلات تيام talat tiyyaam "3 days", خمس تشهر khamas tushhur "5 months", أربع تلاف arba3 talaaf "4,000". Counting things like money uses the *singular* with the "3–10" form: تمن جنيه (not جنيهات). "Two" of anything is the dual, never اتنين + noun (❌ اتنين كتاب), except loanwords with no dual: اتنين كولا.

**13. Time-telling & days** — A1 — `sentence-structure` (OK; S11 for fractions)

- الساعة كام؟ — is-saa3a kaam? — What time is it?
- الساعة تلاتة ونص. — is-saa3a talaata w-nuSS. — 3:30.
- الساعة خمسة وربع / خمسة وتلت / ستة إلا ربع / ستة إلا خمسة. — khamsa w-rub3 / w-tilt / sitta illa rub3 / illa khamsa — 5:15 / 5:20 / 5:45 / 5:55.
- الساعة واحدة بالليل. — is-saa3a waHda bil-leel. — 1 a.m.

Traps: hours are **cardinal** (اتنين، تلاتة) except واحدة; ❌ MSA ordinals الثانية/الثالثة are wrong. Parts of day: الصبح iS-SubH, الضهر iD-Duhr, بعد الضهر, العصر il-3aSr, المغرب, بالليل bil-leel. Days: السبت، الحد il-Hadd، الاتنين، التلات it-talaat، الأربع il-arba3، الخميس، الجمعة ig-gum3a. Time adverbs: النهارده، إمبارح imbaariH، بكره bukra، بعد بكره، أول إمبارح، الأسبوع الجاي ig-gayy، الأسبوع اللي فات illi faat.

**14. Imperative (positive) & polite requests** — A1 — `verb-conjugation` (S10)

Three forms m/f/pl: اكتب iktib / اكتبي iktibi / اكتبوا iktibu.

| verb | m | f | pl |
|---|---|---|---|
| go | روح ruuH | روحي ruuHi | روحوا ruuHu |
| come | تعالى ta3aala | تعالي ta3aali | تعالوا ta3aalu |
| give | ادي iddi / هات haat (bring/give me) | ادّيني / هاتي | هاتوا |
| take | خد khud | خدي khudi | خدوا khudu |
| eat | كُل kul | كلي kuli | كلوا kulu |
| sit / stay | اقعد u'3ud | اقعدي u'3udi | اقعدوا u'3udu |
| look | بص buSS | بصي buSSi | بصوا buSSu |
| wait | استنى istanna | استني istanni | استنوا istannu |
| say/tell | قول 'uul / قولّي 'ulli | قولي / قوليلي | قولوا |
| open / close | افتح iftaH / اقفل i'fil | افتحي / اقفلي | افتحوا / اقفلوا |
| speak | اتكلم itkallim | اتكلمي | اتكلموا |
| listen | اسمع isma3 | اسمعي | اسمعوا |

- لو سمحت، هات المنيو. — law samaHt, haat il-minyu. — Please bring the menu.
- اقعد، اتفضل. — u'3ud, itfaDDal. — Sit down, please (go ahead).
- تعالي هنا يا منى. — ta3aali hina ya muna. — Come here, Mona.

Softeners: لو سمحت/لو سمحتي, من فضلك/من فضلكي, ممكن + verb, بعد إذنك ba3d iznak. Traps: تعالى is suppletive (no verb "come" imperative from جه); هات is the imperative for "bring/give me" beside جيب. Negative imperative is ما + 2nd-person imperfect + ش (see 11), not ❌ لا + verb.

**15. Basic connectors و / بس / عشان / ولا** — A1 — `sentence-structure`

- عايز شاي بس من غير سكر. — 3aayiz shaay bass min gheer sukkar. — I want tea but without sugar.
- مش هروح عشان تعبان. — mish haruuH 3ashaan ta3baan. — I'm not going because I'm tired.
- شاي ولا قهوة؟ — shaay walla 'ahwa? — Tea or coffee?
- بس! — bass! — Enough! / Only.

Note: عشان = "because" *and* "in order to" (+ bare imperfect): جيت عشان أشوفك geet 3ashaan ashuufak "I came to see you". Also علشان/لأن (لأن is fine in Egyptian, pronounced la'inn/li'ann). ❌ لكن is acceptable Egyptian (لكن laakin) but بس is the frequency default.

### 4.2 A2 (Stage 2 → early Stage 3)

**16. Past tense (perfect)** — A2 — `verb-conjugation` (S10)

Sound verb كتب, hollow راح/شاف, defective مشى, geminate حبّ, plus the suppletive جه "come":

| | كتب | راح | مشى | حبّ | جه |
|---|---|---|---|---|---|
| أنا | كتبت katabt | رحت ruHt | مشيت misheet | حبيت Habbeet | جيت geet |
| إنتَ | كتبت katabt | رحت ruHt | مشيت misheet | حبيت Habbeet | جيت geet |
| إنتي | كتبتي katabti | رحتي ruHti | مشيتي misheeti | حبيتي Habbeeti | جيتي geeti |
| هو | كتب katab | راح raaH | مشى mishi | حب Habb | جه gih |
| هي | كتبت katabit | راحت raaHit | مشيت mishyit | حبت Habbit | جت gat |
| إحنا | كتبنا katabna | رحنا ruHna | مشينا misheena | حبينا Habbeena | جينا geena |
| إنتو | كتبتوا katabtu | رحتوا ruHtu | مشيتوا misheetu | حبيتوا Habbeetu | جيتوا geetu |
| هم | كتبوا katabu | راحوا raaHu | مشيوا mishyu | حبوا Habbu | جم gum |

- رحت فين إمبارح؟ — ruHt feen imbaariH? — Where did you go yesterday? (matches the app's demonstration)
- أكلت كشري وشربت عصير قصب. — akalt kushari w-shiribt 3aSiir 'aSab. — I ate koshari and drank sugar-cane juice.
- هي اتخرجت من سنتين. — hiyya itkharragit min sinteen. — She graduated two years ago.
- جم متأخر. — gum mit'akhkhar. — They came late.

Traps: 1sg and 2msg are identical (كتبت) — context/pronoun disambiguates. Vowel patterns are lexical: كتب katab vs شرب shirib vs نزل nizil (a-a vs i-i class); with a vowel-initial suffix the i-class drops its second vowel: شربت shiribt but شربوا shirbu. Hollow verbs shorten in 1st/2nd person (راح → رحت). The plural ـوا alif is silent. ❌ MSA ذهبت/ذهب are leaks; the Egyptian verb is راح.

**17. Future with هـ** — A2 — `verb-conjugation` (S7, S13, S19)

هـ + bare imperfect: هكتب haktib, هتكتب, هتكتبي, هيكتب hayiktib, هتكتب, هنكتب, هتكتبوا, هيكتبوا.

- هروح إسكندرية بكره. — haruuH iskindiriyya bukra. — I'm going to Alexandria tomorrow. (S19 spelling)
- هتعمل إيه في الأجازة؟ — hati3mil eeh fil-agaaza? — What will you do in the holiday?
- مش هقدر أجي النهارده. — mish ha'dar aagi n-naharda. — I won't be able to come today.
- هنتقابل الساعة سبعة. — hanit'aabil is-saa3a sab3a. — We'll meet at seven.

Traps: **Spell with هـ** (house standard, Cairo — S7, S19); حـ is a legitimate variant learners will read (Alexandria, older texts, Playaling uses حَـ) — mention once, never mix within a lesson. 1sg drops the alif: هروح not ❌ هأروح (S19). Negation is مش + هـ (S8), not ❌ ما هـ…ش. ❌ سوف/سـ are detector leaks. Pronounce h-, not ḥ-, in the TTS voice tag.

**18. Object suffixes on verbs; indirect object لـ** — A2 — `pronouns`

Object: ـني -ni (me), ـك -ak, ـكي -ki, ـه -u, ـها -ha, ـنا -na, ـكم -ku, ـهم -hum. Indirect object clitic: ـلي -li, ـلك -lak, ـلكي -liki, ـله -lu, ـلها -laha, ـلنا -lina, ـلكم -luku, ـلهم -luhum.

- شفتك إمبارح في المترو. — shuftak imbaariH fil-metro. — I saw you yesterday on the metro.
- قالّي إنه تعبان. — 'alli innu ta3baan. — He told me he's tired.
- هاتلي كوباية مية. — haatli kubbaayit mayya. — Bring me a glass of water.
- ما قلتلهاش. — ma-'ultilhaash. — I didn't tell her.
- بيدّيهم فلوس كل شهر. — biyiddiihum filuus kull shahr. — He gives them money every month.

Traps: "me" is ـني on verbs but ـي/ـيا on nouns and prepositions. Both clitics can stack: قالهالي 'alhaali "he said it to me" (B1). Negative ش goes after everything (S8 pattern).

**19. Prepositions with suffixes** — A2 — `pronouns`

في fi → فيه/فيها/فيّا fiyya; على 3ala → عليه 3aleeh/عليها/عليّا 3alayya/عليك; لـ → ليا/لك/له; من → مني/منك/منه; عن → عني; مع → معايا; عند → عندي; زي zayy "like" → زيي zayyi/زيك/زيه; قدام 'uddaam "in front of", ورا wara "behind", جنب ganb "next to", فوق foo' "above", تحت taHt "under", جوه guwwa "inside", بره barra "outside", بين been, قصاد 'uSaad "opposite".

- البنك جنب الجامع، قصاد الصيدلية. — il-bank ganb ig-gaami3, 'uSaad iS-Saydaliyya. — The bank is next to the mosque, opposite the pharmacy.
- عليك جنيه. — 3aleek gineeh. — You owe a pound.
- إيه رأيك فيه؟ — eeh ra'yak fiih? — What do you think of it?

**20. Active participles رايح / عارف / قاعد / ساكن** — A2 — `verb-conjugation` (S33)

Forms: فاعل/فاعلة/فاعلين — رايح raayiH / رايحة rayHa / رايحين rayHiin.
Common set: رايح (going), جاي gayy (coming), عارف 3aarif (know), فاهم faahim (understand), ساكن saakin (living at), قاعد 'aa3id (sitting/staying), واقف waa'if (standing), نايم naayim (asleep), صاحي SaaHi (awake), شايف shaayif (see), سامع saami3 (hear), عايش 3aayish (living), ماسك maasik (holding), لابس laabis (wearing), واكل waakil (having eaten), شارب, راكب raakib (riding), ماشي maashi (walking/leaving), فاضي faaDi (free), مشغول mashghuul (busy — a passive participle but same slot).

- إنت رايح فين؟ — inta raayiH feen? — Where are you going?
- أنا مش فاهم. ممكن تعيد؟ — ana mish faahim. mumkin ti3iid? — I don't understand. Can you repeat?
- ساكنة في المعادي. — sakna fil-ma3aadi. — She lives in Maadi.
- هو نايم لسه. — huwwa naayim lissa. — He's still asleep.
- أنا واكل، شكراً. — ana waakil, shukran. — I've already eaten, thanks.

Traps: participles agree in gender/number, not person; they replace the بـ-present for states, motion and perception (❌ بعرف in "I know" is odd; say عارف). Negation is مش. Resultative meaning ("have done") with واكل/شارب/لابس.

**21. كان: past of nominal sentences, كان عند, كان بيـ, كان هـ** — A2 (كان + noun/عند) → B1 (كان بيـ / كان هـ) — `verb-conjugation` (S10)

كان conjugation: كنت kunt, كنت, كنتي kunti, كان kaan, كانت kaanit, كنا kunna, كنتوا kuntu, كانوا kaanu. Future/subjunctive: يكون yikuun / هيكون haykuun.

- كنت في الشغل إمبارح. — kunt fish-shughl imbaariH. — I was at work yesterday.
- كان عندي عربية زمان. — kaan 3andi 3arabiyya zamaan. — I used to have a car.
- كنت بشتغل في بنك. — kunt bashtaghal fi bank. — I used to work / was working in a bank. (S10: كان بيكتب = past continuous)
- كنت هكلمك. — kunt hakallimak. — I was going to call you.
- كانت الدنيا زحمة. — kaanit id-dunya zaHma. — It was crowded.

Traps: **كان بيعمل ≠ كان عمل**: كان بيعمل is habitual/progressive past ("used to / was doing"); كان + past (كان عمل / كان خلص) is pluperfect ("had done"); كان + participle (كان نايم) is a past state. Negation: مكنتش (S8), مكنش عندي, مكنتش بشتغل. ❌ لم يكن / لم أكن are MSA.

**22. Plurals and the dual** — A2 — `sentence-structure` (slug `plurals`)

Sound plurals: ـين -iin (people/adjectives: مدرسين، مصريين، تعبانين), ـات -aat (feminine and many loanwords: شنط? no — شنطة → شنط; but سيارات, بنات banaat, ساعات, أوتوبيسات, موبايلات, كافيهات). Broken plurals to learn as lexical items: بيت→بيوت buyuut, كتاب→كتب kutub, ولد→ولاد wilaad, راجل→رجالة riggaala, ست→ستات sittaat, بنت→بنات, يوم→أيام ayyaam, شهر→شهور, سنة→سنين siniin, شارع→شوارع shawaari3, مطعم→مطاعم maTaa3im, صاحب→أصحاب aSHaab, أخ→إخوات ikhwaat, أخت→إخوات (same!), عربية→عربيات, شقة→شقق shu'a', جنيه→جنيهات (only when counting vaguely), محل→محلات maHallaat, فلوس (plural only, "money").

Dual: ـين -een on the noun; feminine ة → ـتين: سنتين sinteen, ساعتين sa3teen, مرتين marrateen "twice", كوبايتين.

- عندي ولدين وبنت. — 3andi waladeen w-bint. — I have two boys and a girl.
- الشوارع زحمة النهارده. — ish-shawaari3 zaHma n-naharda. — The streets are crowded today. (non-human plural = feminine singular adjective)
- الطلبة كويسين. — iT-Talaba kuwayyisiin. — The students are good.

**23. Comparative & superlative** — A2 — `sentence-structure` (slug `comparatives`) (S34)

| adjective | comparative |
|---|---|
| كبير kibiir big | أكبر akbar |
| صغير Sughayyar small | أصغر aSghar |
| كويس kuwayyis good | **أحسن** aHsan |
| وحش wiHish bad | أوحش awHash |
| حلو Hilw nice | أحلى aHla |
| غالي ghaali expensive | أغلى aghla |
| رخيص rikhiiS cheap | أرخص arkhaS |
| قريب 'urayyib near | أقرب a'rab |
| بعيد bi3iid far | أبعد ab3ad |
| كتير kitiir much | أكتر aktar |
| قليل 'ulayyil little | أقل a'all |
| سهل sahl easy | أسهل ashal |
| صعب Sa3b hard | أصعب aS3ab |
| جديد gidiid new | أجدد agdad |
| سريع sarii3 fast | أسرع asra3 |
| مهم muhimm important | أهم ahamm |

- إسكندرية أحلى من القاهرة في الصيف. — iskindiriyya aHla min il-qaahira fiS-Seef. — Alexandria is nicer than Cairo in summer.
- ده أحسن مطعم في وسط البلد. — da aHsan maT3am fi wisT il-balad. — This is the best restaurant downtown. (superlative = elative + indefinite noun, S34)
| — المترو أسرع بكتير من التاكسي. — il-metro asra3 bi-ktiir min it-taksi. — The metro is much faster than a taxi.
- الفيلم ده ممل أكتر من التاني. — il-film da mumill aktar min it-taani. — This film is more boring than the other one. (long adjectives take أكتر, S34)
- هي الأكبر فيهم / أكبرهم. — hiyya il-akbar fiihum / akbarhum. — She's the eldest of them. (S34)

Traps: comparative is invariable (no feminine/plural). ❌ MSA أفضل is heard but أحسن is the default; ❌ أكثر → أكتر (ث→t).

**24. Relative اللي** — A2 — `sentence-structure` (S33)

- الراجل اللي بيشتغل هنا مصري. — ir-raagil illi biyishtaghal hina maSri. — The man who works here is Egyptian.
- البنت اللي شفتها إمبارح أختي. — il-bint illi shuftaha imbaariH ukhti. — The girl I saw yesterday is my sister. (resumptive pronoun ـها is obligatory)
| — ده اللي عايزه. — da illi 3ayzu. — That's what I want.
- اللي فات مات. — illi faat maat. — Let bygones be bygones (proverb: what passed, died).

Traps: invariable for gender/number (S33); used only after a **definite** head (راجل بيشتغل هنا "a man who works here" has no اللي). Resumptive pronoun required when the relativised noun is an object or possessor. ❌ الذي/التي/الذين are detector leaks.

**25. Connectors لما / لكن / وبعدين / قبل ما / بعد ما / علشان** — A2 — `sentence-structure`

- لما وصلت البيت، اتصلت بيك. — lamma wiSilt il-beet, ittaSalt biik. — When I got home I called you.
- قبل ما تنزل، اقفل النور. — 'abl ma tinzil, i'fil in-nuur. — Before you go out, turn off the light.
- بعد ما اتغدينا، نمنا شوية. — ba3d ma itghaddeena, nimna shwayya. — After we had lunch we slept a bit.
- الأول روح شمال وبعدين على طول. — il-awwil ruuH shimaal wi-ba3deen 3ala Tuul. — First go left and then straight on.
- كنت عايز أجي لكن مقدرتش. — kunt 3aayiz aagi laakin ma-'dirtish. — I wanted to come but I couldn't.

Traps: لما = "when" (past or future) and is *not* a question word (that is إمتى); ❌ عندما/حينما/بينما are leaks. قبل ما/بعد ما take a bare verb (no بـ). لحد ما liHadd ma "until", طول ما Tuul ma "as long as", أول ما awwil ma "as soon as", كل ما kull ma "whenever/the more".

**26. لسه / كمان / برضه / خالص / أوي / شوية / بس** — A2 — `sentence-structure` (S25, S26)

- لسه بيشتغل؟ — lissa biyishtaghal? — Is he still working?
- لسه ما جاش. / لسه. — lissa ma-gaash. / lissa. — He hasn't come yet. / Not yet.
- لسه واصل. — lissa waaSil. — He's just arrived. (لسه + participle = "just", S25)
- أنا كمان عايز شاي. — ana kamaan 3aayiz shaay. — I want tea too. (كمان "also/more": هات كمان واحد "bring one more")
- عايزة آيس كريم برضه. — 3aayza ays kriim barDu. — I want ice cream too (as well as what I said). (S26: برضه scopes over the predicate; also "anyway/still")
- الأكل حلو أوي، بس غالي شوية. — il-akl Hilw 'awi, bass ghaali shwayya. — The food is very good, but a bit expensive.
- ما فهمتش خالص. — ma-fhimtish khaaliS. — I didn't understand at all. (خالص = "at all" in negatives, "completely" in positives)

### 4.3 B1 (Stage 3)

**27. قاعد + بـ (progressive) and other aspect helpers** — B1 — `verb-conjugation` (S33)

- هو قاعد بيذاكر من الصبح. — huwwa 'aa3id biyzaakir miS-SubH. — He's been studying since morning.
- كانت قاعدة بتتكلم في التليفون. — kaanit 'a3da bititkallim fit-tilifoon. — She was (busy) talking on the phone.
- فضلت أستنى ساعتين. — fiDilt astanna sa3teen. — I kept waiting for two hours. (فضل + bare imperfect = keep on)
- بدأت أتعلم عربي من سنة. — bada't at3allim 3arabi min sana. — I started learning Arabic a year ago. (بدأ/ابتدى + bare imperfect)
- عمري ما رحت أسوان. — 3umri ma ruHt aswaan. — I've never been to Aswan.

Traps: قاعد is optional emphasis; plain بـ already covers "is doing". ❌ MSA still/يجلس is not the same thing. "Just about to": هـ + verb + دلوقتي, or قرّب 'arrab.

**28. بقى / بقالي** — B1 — `verb-conjugation` and discourse (S24)

- بقى دكتور. — ba'a duktoor. — He became a doctor.
- بقالي سنة في مصر. — ba'aali sana fi maSr. — I've been in Egypt a year. (بقى + لـ + suffix + duration: بقالك/بقاله/بقالها/بقالنا)
- ما بقاش يشرب سجاير. — ma-ba'aash yishrab sagaayir. — He no longer smokes. (ما بقاش + bare imperfect = "no longer")
- خلاص بقى، يلا نمشي. — khalaaS ba'a, yalla nimshi. — Right then, let's go. (discourse "then/so", sentence-final or after the topic)
- إنت بقى عايز إيه؟ — inta ba'a 3aayiz eeh? — And *you*, what do you want? (contrastive focus)

**29. Real conditionals لو / إذا; لما for time** — B1 — `sentence-structure` (S31)

- إذا ذاكرت كويس، هتجيب درجات عليا. — iza zaakirt kuwayyis, hatgiib daragaat 3alya. — If you study well you'll get high marks. (S31)
- لو شفت دينا النهارده، هعزمها على العشا. — law shuft diina n-naharda, ha3zimha 3ala-l-3asha. — If I see Dina today I'll invite her to dinner. (S31)
- لو عندك وقت، تعالى معانا. — law 3andak wa't, ta3aala ma3aana. — If you have time, come with us.
- لو سمحت — law samaHt — please (lit. "if you permit") — the fossilised لو every learner already knows from A1.

Traps: لو and إذا are interchangeable in Egyptian, لو commoner (S31); the if-clause takes **past or present**, the result **future or imperative**. Counterfactual لو كنت ... كنت (S31: لو كنت عارف الجواب، كنت قلتلك) is *above* B1 (Kallimni 4, S4) — show it for recognition only. ❌ إن/إذا + MSA jussive is out. لما is temporal ("when"), not conditional.

**30. Reported speech basics** — B1 — `sentence-structure` (S3 places reported speech in Kallimni 3)

- قالّي إنه هيتأخر. — 'alli innu hayit'akhkhar. — He told me (that) he'd be late.
- قالت إنها مش عايزة تيجي. — 'aalit innaha mish 3aayza tiigi. — She said she doesn't want to come.
- سألني إذا كنت رايح. / سألني رايح ولا لأ. — sa'alni iza kunt raayiH / sa'alni raayiH walla la'. — He asked me whether I was going.
- قالّي أستناه. — 'alli astannaah. — He told me to wait for him. (reported command = bare imperfect)
- بيقولوا إن الجو هيبرد. — biy'uulu inn ig-gaww hayibrad. — They say the weather will get cold.

Forms of إن + suffix: إني inni, إنك innak/إنكي inniki, إنه innu, إنها innaha, إننا innina, إنكم innuku, إنهم innuhum. Traps: **no tense back-shift** — Egyptian keeps the original tense (S3-level texts model this). ❌ MSA أنّ + accusative, ❌ بأن. Common verbs of saying: قال, بيقول, سأل sa'al, رد radd "reply", حكى Haka "tell (a story)", فهّم fahhim "explain to".

**31. Ordinals & sequencing** — B1 (recognition A2) — `sentence-structure` (S11)

الأول il-awwil / الأولى il-uula, التاني it-taani, التالت it-taalit, الرابع ir-raabi3, الخامس il-khaamis, السادس is-saadis, السابع is-saabi3, التامن it-taamin, التاسع it-taasi3, العاشر il-3aashir; from 11 the cardinal doubles as ordinal (الدور الحداشر id-door il-Hidaashar, S11).

- الدور التالت، الشقة التانية على اليمين. — id-door it-taalit, ish-sha''a t-tanya 3ala l-yimiin. — Third floor, second flat on the right.
- أول مرة أجي مصر. — awwil marra aagi maSr. — First time I come to Egypt. (أول + indefinite noun)
- آخر مرة — aakhir marra — last time. تاني = "again": قول تاني 'uul taani "say it again".

**32. Passive/reflexive patterns اتـ / انـ and "one does" with بـ + 3pl** — B1 — `verb-conjugation`

- الباب اتفتح لوحده. — il-baab itfataH li-waHdu. — The door opened by itself.
- الأكل ده بيتعمل في رمضان. — il-akl da biyit3amal fi ramaDaan. — This food is made in Ramadan.
- بيقولوا عليه دمه خفيف. — biy'uulu 3aleeh dammu khafiif. — People say he's funny (lit. his blood is light).

**33. Adverbs of manner and degree; كده** — B1 (many at A1 as vocabulary) — `sentence-structure`

كده kida "like this/so" (اعمل كده i3mil kida; مش كده؟ mish kida? "isn't it?"; كده كده kida kida "either way"), بسرعة bi-sur3a, بالراحة bir-raaHa "slowly/gently", على طول 3ala Tuul "straight ahead / right away / always" (S32), طوالي, قوام 'awaam "quickly", بالظبط biZ-ZabT "exactly", تقريباً ta'riiban, غالباً, أكيد akiid "sure", يمكن yimkin "maybe", جايز gaayiz "possibly", طبعاً Tab3an, للأسف lil-asaf.

### 4.4 Mapping summary for `record-grammar-outcome`

| taxonomy id | structures above |
|---|---|
| `pronouns` | 1, 2, 18, 19 |
| `possessives` | 5, 6, 8 |
| `negation` | 7, 11 (and the negative halves of 8, 17, 20, 21) |
| `questions` | 4, (13 الساعة كام) |
| `verb-conjugation` | 10, 14, 16, 17, 20, 21, 27, 28, 32 |
| `sentence-structure` | 3, 9, 12, 13, 15, 22, 23, 24, 25, 26, 29, 30, 31, 33 — of which 12/13 (`numbers`), 22 (`plurals`), 23 (`comparatives`) will fall through `canonicalGrammarKey` to a slug and not join drill mastery; that is expected. |

---

## 5. Identity vocabulary: what makes speech *Egyptian*

~120 function words, adverbs, discourse markers and pseudo-verbs, with what they replace. "Replaces" lists MSA first, then Gulf where the Gulf word is a detector leak for Egyptian (so authors recognise it and keep it out). All items OK unless noted; cross-checked with S8–S12, S22–S28, S43.

### 5.1 Function words, adverbs, discourse markers

| Egyptian | translit | gloss | replaces (❌ never write) |
|---|---|---|---|
| إزيك / إزيكي / إزيكو | izzayyak/-ki/-ku | how are you | كيف حالك; Gulf شلونك/شخبارك |
| عامل إيه / عاملة إيه | 3aamil eeh | how are you doing | |
| إيه | eeh | what | ما/ماذا; Gulf وش/شو |
| فين | feen | where | أين; Gulf وين |
| منين | mineen | where from | من أين |
| إزاي | izzaay | how | كيف; Gulf شلون/كيف |
| ليه | leeh | why | لماذا; Gulf ليش |
| إمتى | imta | when | متى |
| كام / بكام | kaam / bikaam | how many / how much | كم / بكم |
| قد إيه | 'add eeh | how much/long | |
| مين | miin | who | من |
| أنهي / أنهو | anhi/anhu | which | أي |
| دلوقتي | dilwa'ti | now | الآن; Gulf هالحين/الحين |
| النهارده | in-naharda | today | اليوم (fine but marked) |
| إمبارح | imbaariH | yesterday | أمس |
| بكره | bukra | tomorrow | غداً |
| بعدين | ba3deen | later / then | لاحقاً / ثم |
| زمان | zamaan | long ago / a long time | قديماً |
| لسه | lissa | still / not yet / just | ما زال / لم … بعد |
| خلاص | khalaaS | done / enough / OK then | انتهى |
| كده | kida | like this / so | هكذا; Gulf چذي/كذا |
| كمان | kamaan | also / more | أيضاً; Gulf بعد |
| برضه / برضو | barDu | also / anyway | أيضاً/كذلك |
| بس | bass | but / only / enough | لكن / فقط |
| عشان / علشان | 3ashaan / 3alashaan | because / in order to | لأن / لكي |
| لما | lamma | when (clause) | عندما/حينما |
| لو / إذا | law / iza | if | إن |
| يعني | ya3ni | I mean / like / so | (same in MSA but Egyptian filler use) |
| طيب | Tayyib | OK / well then | حسناً |
| ماشي | maashi | OK / fine | حسناً / موافق; Gulf زين/تمام |
| تمام | tamaam | fine / perfect | |
| حاضر | HaaDir | yes, right away (compliance) | نعم |
| أيوه | aywa | yes | نعم; Gulf إيه/هيه |
| لأ | la' | no | لا |
| مش | mish | not | ليس; Gulf مو/مب |
| ما…ش | ma…sh | verbal negation | لم/لا |
| مفيش | mafiish | there isn't | لا يوجد; Gulf ما شي/مافي |
| فيه | fiih | there is | يوجد / هناك |
| عايز / عاوز | 3aayiz | want | يريد; Gulf يبي/أبغى |
| محتاج | miHtaag | need | يحتاج |
| ممكن | mumkin | can / possible | يمكن |
| لازم | laazim | must | يجب |
| ينفع / ما ينفعش | yinfa3 / ma-yinfa3sh | it works / that's not OK | يجوز |
| كويس / كويسة | kuwayyis | good | جيد; Gulf زين |
| حلو | Hilw | nice / sweet | جميل |
| وحش | wiHish | bad | سيء; Gulf شين |
| كتير | kitiir | much / many | كثير; Gulf واجد |
| شوية | shwayya | a little | قليلاً; Gulf شوي |
| أوي | 'awi | very | جداً; Gulf مرة/وايد |
| خالص | khaaliS | at all / completely | إطلاقاً |
| بالظبط / مظبوط | biZ-ZabT / maZbuuT | exactly / correct | تماماً / صحيح |
| زي | zayy | like (similar to) | مثل; Gulf مثل/كِنّه |
| غير | gheer | other than / except | |
| من غير | min gheer | without | بدون |
| بتاع | bitaa3 | of / belonging to | (iḍāfa); Gulf حق/مال |
| عند / معا / لـ | 3and / ma3a / li | have | لدى / يملك |
| هنا / هناك | hina / hinaak | here / there | |
| جوه / بره | guwwa / barra | inside / outside | داخل / خارج |
| فوق / تحت | foo' / taHt | up / down | أعلى / أسفل |
| قدام / ورا | 'uddaam / wara | in front / behind | أمام / خلف |
| جنب / قصاد | ganb / 'uSaad | beside / opposite | بجانب / مقابل |
| يمين / شمال | yimiin / shimaal | right / left | يسار |
| على طول | 3ala Tuul | straight / right away | مباشرة |
| بسرعة / بالراحة | bi-sur3a / bir-raaHa | quickly / slowly | |
| أكيد | akiid | sure | بالتأكيد |
| طبعاً | Tab3an | of course | |
| يمكن / جايز | yimkin / gaayiz | maybe | ربما |
| معلش | ma3lish | never mind / sorry | (S27) |
| آسف / آسفة | aasif | sorry | |
| لو سمحت | law samaHt | please / excuse me | من فضلك (also used) |
| اتفضل / اتفضلي | itfaDDal | go ahead / here you are | تفضل |
| شكراً / متشكر | shukran / mutashakkir | thanks | |
| عفواً / العفو | 3afwan / il-3afw | you're welcome | |
| يلا | yalla | let's go / come on | هيا; Gulf يالله |
| هات | haat | give / bring me | أعطني |
| خد | khud | take | خذ |
| بص | buSS | look | انظر |
| استنى | istanna | wait | انتظر |
| تعالى | ta3aala | come | تعال / هيا |
| إيه ده! / يا سلام! | eeh da! / ya salaam! | wow / what's this! | (S32) |
| يا ريت | ya reet | I wish / if only | ليت |
| إن شاء الله | in shaa' allaah | God willing | |
| ربنا | rabbina | our Lord (God, in wishes) | الله (also used) |
| صحيح | SaHiiH | by the way / true | |
| على فكرة | 3ala fikra | by the way | (S32) |
| مش كده؟ | mish kida? | right? / isn't it? | أليس كذلك |
| ولا حاجة | walla Haaga | nothing / not anything | لا شيء |
| حاجة | Haaga | thing / something | شيء; Gulf شي |
| واحد / واحدة | waaHid / waHda | one / someone | |
| كل / كله | kull / kullu | every / all of it | |
| بعض | ba3D | some | |
| شكل / شكله | shakl / shaklu | looks like / it seems | يبدو |
| مالك؟ / ماله؟ | maalak? / maalu? | what's wrong with you/him? | ماذا بك |
| فاضي / مشغول | faaDi / mashghuul | free / busy | |
| زحمة | zaHma | crowded / traffic | ازدحام |
| فلوس | filuus | money | مال / نقود |
| فكة | fakka | small change | |
| جنيه | gineeh | pound | |
| كوباية | kubbaaya | glass / cup | كوب |
| مية | mayya | water | ماء; Gulf ماي |
| أهوة (قهوة) | 'ahwa | coffee / café | |
| عربية | 3arabiyya | car | سيارة |
| موبايل | mobayl | mobile phone | هاتف / جوال |
| شقة | sha''a | flat | |
| راجل / ست | raagil / sitt | man / woman | رجل / امرأة |
| صاحب / صاحبة | SaaHib / SaHba | friend | صديق (fine but less frequent) |
| زمايل | zamaayil | colleagues | |
| بتاع الشغل | bitaa3 ish-shughl | work-related | |
| دور / أدوار | door | floor / turn | طابق |

### 5.2 The ~45 highest-frequency verbs: past 3ms / present 3ms (بـ) / imperative m.sg

| gloss | past 3ms | present 3ms | imperative | notes |
|---|---|---|---|---|
| go | راح raaH | بيروح biyruuH | روح ruuH | ❌ ذهب |
| come | جه gih | بييجي biyiigi | تعالى ta3aala | 3fs جت gat, 3pl جم gum; 1sg present أجي aagi |
| eat | كل kal / أكل akal | بياكل biyaakul | كُل kul | 1sg present باكل baakul |
| drink | شرب shirib | بيشرب biyishrab | اشرب ishrab | |
| say / tell | قال 'aal | بيقول bi'uul | قول 'uul | قالّي "he told me" |
| do / make | عمل 3amal | بيعمل biyi3mil | اعمل i3mil | عامل إيه؟ |
| see | شاف shaaf | بيشوف biyshuuf | شوف shuuf | ❌ رأى |
| know | عرف 3irif | بيعرف biyi3raf | اعرف i3raf | state → عارف |
| understand | فهم fihim | بيفهم biyifham | افهم ifham | state → فاهم |
| want (pseudo-verb) | كان عايز | عايز 3aayiz | — | no verb; ❌ أراد/يريد |
| work | اشتغل ishtaghal | بيشتغل biyishtaghal | اشتغل | |
| speak / talk | اتكلم itkallim | بيتكلم biyitkallim | اتكلم | |
| talk to / phone | كلم kallim | بيكلم biykallim | كلمني kallimni | |
| call (phone) | اتصل ittaSal | بيتصل biyittiSil | اتصل بـ | |
| hear / listen | سمع simi3 | بيسمع biyisma3 | اسمع isma3 | |
| read | قرا 'ara | بيقرا biyi'ra | اقرا i'ra | |
| write | كتب katab | بيكتب biyiktib | اكتب iktib | |
| study (school) | ذاكر zaakir | بيذاكر biyzaakir | ذاكر | ❌ درس (= teach in Egyptian) |
| learn | اتعلم it3allim | بيتعلم biyit3allim | اتعلم | |
| sleep | نام naam | بينام biynaam | نام | |
| wake up | صحي SiHi | بيصحى biyiSHa | اصحى iSHa | |
| get up / stand | قام 'aam | بيقوم biy'uum | قوم 'uum | |
| sit / stay | قعد 'a3ad | بيقعد biyu'3ud | اقعد u'3ud | |
| live (reside) | سكن sakan | بيسكن biyiskun | — | state → ساكن |
| live (be alive) | عاش 3aash | بيعيش biy3iish | — | |
| buy | اشترى ishtara | بيشتري biyishtiri | اشتري ishtiri | |
| sell | باع baa3 | بيبيع biybii3 | بيع bii3 | |
| pay | دفع dafa3 | بيدفع biyidfa3 | ادفع idfa3 | |
| give | ادى idda | بيدي biyiddi | ادي / هات | |
| take | خد khad | بياخد biyaakhud | خد khud | |
| bring | جاب gaab | بيجيب biygiib | هات haat / جيب | |
| put | حط HaTT | بيحط biyHuTT | حط HuTT | |
| carry / remove | شال shaal | بيشيل biyshiil | شيل shiil | |
| open | فتح fataH | بيفتح biyiftaH | افتح iftaH | |
| close | قفل 'afal | بيقفل biyi'fil | اقفل i'fil | |
| ride / get on | ركب rikib | بيركب biyirkab | اركب irkab | |
| get off / go down / go out | نزل nizil | بينزل biyinzil | انزل inzil | نازل = "going out" |
| go up / leave / turn out | طلع Tili3 | بيطلع biyiTla3 | اطلع iTla3 | |
| arrive | وصل wiSil | بيوصل biyiwSal | — | |
| return | رجع rigi3 | بيرجع biyirga3 | ارجع irga3 | |
| walk / leave | مشي mishi | بيمشي biyimshi | امشي imshi | |
| travel | سافر saafir | بيسافر biysaafir | سافر | |
| wait | استنى istanna | بيستنى biyistanna | استنى | |
| look | بص baSS | بيبص biybuSS | بص buSS | |
| look for | دور dawwar | بيدور biydawwar | دور على | |
| find | لقى la'a | بيلاقي biylaa'i | — | |
| like / love | حب Habb | بيحب biyHibb | — | بحب + verb "I like to" |
| help | ساعد saa3id | بيساعد biysaa3id | ساعدني | |
| cook | طبخ Tabakh | بيطبخ biyuTbukh | اطبخ | |
| try | جرب garrab | بيجرب biygarrab | جرب | |
| think | فكر fakkar | بيفكر biyfakkar | فكر | افتكر iftakar = remember/think that |
| play | لعب li3ib | بيلعب biyil3ab | العب il3ab | |
| feel | حس Hass | بيحس biyHiss | — | حاسس = feeling |
| be afraid | خاف khaaf | بيخاف biykhaaf | ما تخافش | |
| finish | خلص khallaS | بيخلص biykhallaS | خلص | خلاص! |
| begin | بدأ bada' / ابتدى ibtada | بيبدأ biyibda' | ابدأ | |
| be able | قدر 'idir | بيقدر biyi'dar | — | ما قدرش ma-'idirsh (S18) |
| happen | حصل HaSal | بيحصل biyiHSal | — | حصل إيه؟ |

---

## 6. Cultural competence thread A1 → B1

In teaching order; each row is one "culture note" slot in §7. Phrases: Arabic / translit / gloss. Verified items cite sources; the rest OK.

**C1. Greetings and their replies (A1, lesson 1–2)** (S22, S23)
- السلام عليكم → وعليكم السلام — is-salaamu 3aleekum → wi-3aleekum is-salaam — peace be upon you → and upon you.
- صباح الخير → صباح النور / صباح الفل / صباح القشطة — SabaaH il-kheer → SabaaH in-nuur / il-full / il-'ishTa — good morning → morning of light / jasmine / cream (each reply "outbids" the greeting).
- مساء الخير → مساء النور — masaa' il-kheer → masaa' in-nuur.
- إزيك؟ → كويس، الحمد لله. وإنت؟ — izzayyak? → kuwayyis, il-Hamdu lillaah. w-inta? (S22, S23)
- عامل إيه؟ / أخبارك إيه؟ / إيه الأخبار؟ (casual, not with superiors — S22) → تمام / ماشي الحال / الحمد لله / زي الفل zayy il-full "great" / مش بطال mish baTTaal "not bad".
- أهلاً وسهلاً → أهلاً بيك / بيكي / بيكم — ahlan wa-sahlan → ahlan biik (S23).
- نورت / نورتي / نورتوا → ده نورك — nawwart → da nuurak — "you've lit the place up" (welcome) → "it's your light".
- تشرفنا → الشرف ليا — tsharrafna → ish-sharaf liyya — pleased to meet you → the honour is mine.
- مع السلامة → الله يسلمك — ma3a s-salaama → allaah yisallimak — goodbye → God keep you.
- تصبح على خير → وإنت من أهله — tiSbaH 3ala kheer → w-inta min ahlu — good night → and you (are of its people).

**C2. Religious phrases in daily speech (A1, lesson 3; recycled forever)**
- الحمد لله il-Hamdu lillaah — praise God (answer to "how are you", after eating, on hearing good news).
- إن شاء الله in shaa' allaah — God willing (any future; also a soft "maybe/no").
- ما شاء الله ma shaa' allaah — said at anything admirable (a child, a house) to ward off envy — never compliment without it.
- ربنا يخليك rabbina ykhalliik — "may God keep you" = thank you (reply: وإنت / ويخليك).
- الله يسلمك allaah yisallimak — reply to مع السلامة and to a compliment on a purchase.
- بسم الله bismillaah — before eating/starting; بالهنا والشفا bil-hana wish-shifa → الله يهنيك — bon appétit → reply.
- الله أكبر / يا رب / يا ساتر — exclamations of awe / pleading / "God protect".
- الله يرحمه allaah yirHamu — "God have mercy on him" after naming the dead.
- صلى على النبي Salli 3an-nabi — "bless the Prophet" — said to calm someone down or to admire without envy.
- Christian Egyptians say the same الحمد لله/إن شاء الله; note ربنا موجود rabbina mawguud "God is there" as everybody's consolation.

**C3. Hospitality, tea and coffee (A1, lesson 6)**
- تشرب إيه؟ شاي ولا قهوة؟ — tishrab eeh? shaay walla 'ahwa? — What will you drink?
- شاي سكر زيادة / مظبوط / سكر خفيف / من غير سكر — shaay sukkar ziyaada / maZbuuT / khafiif — extra-sweet / medium / light / no sugar. Same scale for قهوة: قهوة مظبوط is the default order.
- بالنعناع bin-ni3naa3 — with mint; شاي كشري shaay kushari (loose leaf, Cairo) vs شاي كوشري? no — vs شاي بالحليب "tea with milk" (Alexandria/upper class).
- الأهوة il-'ahwa = the neighbourhood café (men, backgammon طاولة, شيشة); قهوة 'ahwa = the drink.
- Refusing is a dance: لأ، شكراً، مش عايز → لازم تشرب حاجة! → خلاص، شاي — decline once, accept the second time.
- اتفضل، البيت بيتك — itfaDDal, il-beet beetak — make yourself at home.
- Bring a small gift when invited: حلويات/جاتوه; say تسلم إيديك tislam ideek "bless your hands" to the cook.

**C4. Food culture and meal timing (A1–A2, lesson 7)** (S38)
- فول (مدمس) fuul — stewed fava beans, the breakfast staple; طعمية Ta3miyya — Egyptian falafel of fava beans (S38); بيض bee'D, جبنة gibna, عيش 3eesh (bread — literally "life"; ❌ خبز is MSA/Levant), عيش بلدي.
- كشري kushari — rice, lentils, macaroni, tomato sauce, دقة da''a (garlic-vinegar), fried onions (S38); ملوخية mulukhiyya — green soup (S38); محشي maHshi; فطير fiTiir; كفتة, حواوشي Hawawshi, شاورما, كبدة kibda, سجق sugu', طرشي Turshi (pickles), بصارة biSaara.
- Meals: فطار fiTaar (breakfast, often 9–11 or later), غدا ghada (main meal, mid-afternoon 3–5 pm — S38 "main meal at lunch"), عشا 3asha (light, late — Egyptians dine 10 pm+, S38). فطرت؟ fiTirt? "have you had breakfast?" is a greeting.
- Ordering: عايز واحد فول وواحد طعمية لو سمحت; سندوتش/ساندوتش; على قد إيه؟ how big? ; بالهنا والشفا (C2). Drinks: عصير قصب 3aSiir 'aSab (sugar cane), كركديه karkadeeh, سحلب saHlab, عرقسوس 3ir'suus, بيبسي.

**C5. Family terms and address forms (A1 lesson 5 family; A2 lesson address forms)** (S35)
- أب/أبويا abuuya, بابا; أم/أمي ummi, ماما; أخ/أخويا akhuuya, أخت/أختي ukhti, إخوات ikhwaat; جدو giddu, تيتة teeta (grandparents); عم 3amm (paternal uncle), عمة 3amma, خال khaal (maternal uncle), خالة khaala; ابن عمي ibn 3ammi (cousin); جوز gooz (husband; ❌ زوج is MSA), مرات miraat- (wife: مراتي miraati; ❌ زوجتي), عروسة/عريس; ولد walad / بنت bint; عيال 3iyaal (kids), أسرة/عيلة 3eela.
- Address forms: يا باشا ya baasha, يا بيه ya beeh — Turkish-origin honorifics, now used to any man you want to flatter or to a taxi driver/waiter jokingly ("boss") (S35: officials or buttering up); يا حاج / يا حاجة ya Hagg / ya Hagga — elderly man/woman (S35, Hajj presumption); يا أستاذ / يا أستاذة ya ustaaz — the safe respectful default to any adult stranger (S35); يا مدام ya madaam — married woman (S35); يا آنسة — young unmarried woman; يا دكتور / يا باشمهندس ya bashmuhandis — professionals (title trumps name); يا كابتن ya kabtin — sporty young men, drivers; يا معلم ya mi3allim — workshop boss / butcher / mechanic; يا ريّس ya rayyis — driver/boatman; حبيبي / حبيبتي — freely between friends, same gender; يا عم ya 3amm — casual "mate/uncle"; حضرتك HaDritak / حضرتكي — polite "you", stands alone without يا (S35): حضرتك منين؟ "Where are you from (sir)?". Names take the title: يا أستاذ محمد, يا مدام هدى, أنكل/طنط ankil/TanT for parents' friends.

**C6. Bargaining, money, taxis and microbuses (A2, lessons 3–4 of Stage 2)** (S39)
- جنيه gineeh (pound; plural in counting جنيه: خمسة جنيه/عشرين جنيه), نص جنيه, ربع جنيه, قرش 'irsh (piastre; today only in فيه قرش؟ "any small change?" and فكة). كام؟/بكام؟ bikaam? ; بكام الكيلو؟ ; ده غالي أوي! da ghaali 'awi! ; ممكن أقل؟ mumkin a'all? ; آخر كلام؟ aakhir kalaam? "final price?" ; خليها بعشرة khalliiha bi-3ashara "make it ten" ; مفيش تخفيض؟ ; خلاص، ماشي ; مش عايز، شكراً (walk away = the real bargaining move).
- Taxi: بالعداد؟ bil-3addaad? "by the meter?"; روحني/وصلني مدينة نصر — waSSalni madiinat naSr — take me to Nasr City; على اليمين/الشمال لو سمحت; هنا كويس، شكراً; خلي الباقي khalli l-baa'i "keep the change" (rounding up to 5–10 EGP is the normal tip — S39); ride-hailing (أوبر) has replaced bargaining in Cairo, but white taxis still expect a rounded-up fare.
- Microbus: shout your stop: على جنب لو سمحت 3ala ganb "pull over"; عند المحطة الجاية; passing fare forward: هات الباقي / معاك واحد "one passenger's fare here"; never tip the driver (S39).
- Money etiquette: فكة is scarce — everyone asks معاك فكة? Shop signs: خصم khaSm "discount", تخفيضات.

**C7. Ramadan and Eid (A2, lesson 9 of Stage 2)** (S21, S37)
- رمضان كريم → الله أكرم — ramaDaan kariim → allaah akram (S21 gives the reply كل سنة وانت طيب, also correct).
- كل سنة وإنت طيب / وإنتي طيبة / وإنتو طيبين → وإنت طيب — kull sana w-inta Tayyib → w-inta Tayyib — "every year and you're well" — used for *every* holiday and birthdays (S37 "used year-round").
- صايم؟ Saayim? "fasting?"; فطار fiTaar (iftar; same word as breakfast), سحور suHuur, فانوس fanuus (lantern), المدفع il-madfa3 (the cannon), الأذان il-azaan, مسحراتي misaHHaraati, ياميش yamiish (dried fruit/nuts), قطايف 'aTaayif, كنافة kunaafa, قمر الدين 'amar id-diin (S21 for the core set).
- الفطار إمتى النهارده؟ — il-fiTaar imta n-naharda? — When is iftar today? (S21) ; تحب نفطر سوا؟ (S21).
- Eid: عيد الفطر, عيد الأضحى (اللحمة, الخروف); عيدية 3idiyya (cash gift to kids); كحك kaHk (Eid biscuits); عيد سعيد / كل سنة وإنت طيب. Behaviour notes: don't eat/drink in the street in daytime Ramadan; work hours shift; TV مسلسلات season; Christians use كل سنة وإنت طيب at Christmas (7 Jan) and Easter too.

**C8. Weddings, births, condolences — set phrases (A2→B1, Stage 3 lesson 5)** (S36, S37)
- مبروك / ألف مبروك → الله يبارك فيك / فيكي — mabruuk / alf mabruuk → allaah yibaarik fiik — congratulations → God bless you (S37). عقبالك 3u'baalak → "your turn next" (to singles at a wedding; to a graduate's friends) — reply: عقبال عندك / يا رب.
- Engagement خطوبة khuTuuba, كتب كتاب katb kitaab (contract), فرح faraH (wedding party), زفة zaffa (procession), شبكة shabka (gold gift), عريس/عروسة.
- New baby: مبروك، ربنا يخليه لك / يتربى في عزك yitrabba fi 3izzak → الله يبارك فيك. سبوع subuu3 (7th-day party).
- Illness: ألف سلامة alf salaama → الله يسلمك; سلامتك salaamtak; ربنا يشفيه.
- Condolences: البقاء لله il-ba'aa' lillaah → البقية في حياتك il-ba'iyya f-Hayaatak (to the bereaved; lit. "the rest [of his life] in yours") → وحياتك الباقية — the classic pair (OK, widely used); ربنا يعزيكم rabbina y3azziikum, البركة فيكم il-baraka fiikum, شدوا حيلكم shiddu Heelkum (S36); الله يرحمه (C2); for Christians ربنا ينيح روحه, في أحضان القديسين (S36). Register: men go to the عزا 3aza (condolence gathering, three nights); black clothes; Qur'an playing.
- New purchase / haircut / return from travel: مبروك → الله يبارك فيك; نعيماً na3iiman (after haircut/shower) → الله ينعم عليك; حمد الله على السلامة Hamdilla 3as-salaama (welcome back) → الله يسلمك.

**C9. Humour and نكت (B1, Stage 3 lesson 8)**
- Egyptians self-identify as ولاد نكتة wilaad nukta "children of the joke". Words: نكتة nukta (joke; pl. نكت), هزار hizaar (joking around), بيهزر biyhazzar "he's kidding", بتهزر؟ "are you kidding?", دمه خفيف dammu khafiif "he's funny" (lit. light-blooded) vs دمه تقيل dammu ti'iil "unfunny/annoying", قفشة 'afsha (witty one-liner), يا عم بطل هزار "stop kidding", إفيه ifeeh (catch-phrase from a film — Egyptians speak in إفيهات from أفلام عادل إمام, الكيف, اللمبي).
- The stock joke targets are صعايدة Sa3aayda (Upper Egyptians — see §2: teach recognition, warn about the stereotype), mothers-in-law (حماة Hamaa), and the government. Sarcasm markers: يا سلام! ya salaam (S32), ياااه, أنا مبسوط أوي (deadpan), الله ينور 3aleek "brilliant" (often ironic). Jokes often open: مرة واحد… marra waaHid… "once a guy…".

**C10. Cairo geography basics (A2 directions lesson; B1 recycled)**
- Cairo = القاهرة il-qaahira (q kept — S17) but everyday "مصر" maSr means both Egypt *and* Cairo (رايح مصر = going to Cairo, from the provinces). Districts: وسط البلد wisT il-balad (downtown), التحرير it-taHriir, الزمالك iz-zamaalik, جاردن سيتي, المعادي il-ma3aadi, مصر الجديدة maSr ig-gidiida (Heliopolis), مدينة نصر madiinat naSr, الدقي id-du''i, المهندسين il-muhandisiin, الجيزة ig-giiza, الهرم il-haram (the Pyramids), فيصل, إمبابة imbaaba, شبرا shubra, عين شمس, حلوان Hilwaan, التجمع الخامس it-tagammu3 il-khaamis, 6 أكتوبر sitta oktoobar, الشيخ زايد; landmarks: خان الخليلي khaan il-khaliili, الحسين il-Huseen, الأزهر, القلعة il-'al3a, كورنيش النيل kurneesh in-niil, برج القاهرة, المتحف, رمسيس ramsiis (main station), العتبة il-3ataba, السيدة زينب is-sayyida zeenab.
- Transport words: المترو (3 lines; women-only cars), أوتوبيس otobiis, ميكروباص mikrubaaS, توك توك, تاكسي أبيض, أوبر, القطر il-'aTr (train; ❌ قطار MSA pronunciation), محطة maHaTTa, موقف maw'if (bus/microbus terminal), ميدان midaan (square), كوبري kubri (bridge — 6 أكتوبر, قصر النيل), الدائري id-daa'iri (ring road), زحمة zaHma (traffic — the national topic).

**C11. Tipping — بقشيش (A2, with money lesson)** (S39)
- بقشيش ba'shiish: expected from anyone who does you a small service — بواب bawwaab (doorman), عامل الجراج, the man who "helps" you park (سايس saayis), toilet attendant, the person who carries bags; 5–20 EGP typical (S39). Phrases: خد ده، شكراً; اتفضل، ده ليك; ولا يهمك walla yhimmak "don't worry about it" (S32) when they protest; مفيش فكة معايا "I've no change". In restaurants 10% on top of the "service" line (S39). Not in shops or on microbuses (S39).

**C12. Gestures (Pre-A1/A1 onward, as icons in lessons)** (S40)
- Fingers pinched, palm up, hand bobbing = استنى شوية / اصبر istanna shwayya / iSbur "hold on, patience" (S40).
- Hand on heart, slight bow = thanks/sincerity (شكراً, ربنا يخليك).
- Palm down, fingers wiggling toward self = تعالى "come here" (the opposite of the English wave-away).
- Right hand raised, quick outward flick + eyebrows = إيه؟ "what?"; palm up and rotating = إيه ده؟/ليه؟ "what is this/why?".
- Tongue-click تسك with a small chin lift = لأ "no".
- Index finger tapping temple = مخه كويس/مجنون context-dependent "clever/crazy".
- Touching below the eye = عيني/من عنيّا "at your service / gladly" (من عنيّا min 3inayya as a spoken reply to a request).
- Shaking a horizontal hand = "so-so" (نص نص nuSS nuSS).
- Pointing with the whole hand, not one finger, at people; never show the sole of a shoe to someone; the left hand is not used for handing food.

---

## 7. Suggested lesson sequence

CEFR anchors (verbatim global scale, S15): **A1** "Can understand and use familiar everyday expressions and very basic phrases aimed at the satisfaction of needs of a concrete type. Can introduce themselves to others and can ask and answer questions about personal details such as where they live, people they know and things they have. Can interact in a simple way provided the other person talks slowly and clearly and is prepared to help." **A2** "Can understand sentences and frequently used expressions related to areas of most immediate relevance (e.g. very basic personal and family information, shopping, local geography, employment). Can communicate in simple and routine tasks requiring a simple and direct exchange of information on familiar and routine matters. Can describe in simple terms aspects of their background, immediate environment and matters in areas of immediate need." **B1** "Can understand the main points of clear standard input on familiar matters regularly encountered in work, school, leisure, etc. Can deal with most situations likely to arise while travelling in an area where the language is spoken. Can produce simple connected text on topics that are familiar or of personal interest. Can describe experiences and events, dreams, hopes and ambitions and briefly give reasons and explanations for opinions and plans."

Companion Volume 2020 *Overall oral interaction* descriptors (own knowledge — coe.int refused the fetch; verify against CV 2020 p. 72 before printing in-app): **Pre-A1** "Can ask and answer questions about themselves and daily routines, using short, formulaic expressions and relying on gestures to reinforce the information." **A1** "Can interact in a simple way but communication is totally dependent on repetition at a slower rate, rephrasing and repair. Can ask and answer simple questions, initiate and respond to simple statements in areas of immediate need or on very familiar topics." **A2** "Can interact with reasonable ease in structured situations and short conversations, provided the other person helps if necessary. Can manage simple, routine exchanges without undue effort; can ask and answer questions and exchange ideas and information on familiar topics in predictable everyday situations." **B1** "Can communicate with some confidence on familiar routine and non-routine matters related to their interests and professional field. Can exchange, check and confirm information, deal with less routine situations and explain why something is a problem. Can express thoughts on more abstract, cultural topics such as films, books, music, etc."

Word lists give Egyptian – translit – English. Grammar numbers refer to §4; culture codes to §6; sound spotlights to §3.3.

### Stage 1 — Foundations (Pre-A1 → A1), 12 lessons

**S1-L1 · يلا نبدأ — Hello, Cairo** · Can-do: greet, reply, say goodbye; ask/say how someone is. · Grammar: 1 (أنا/إنت/إنتي), 4 (إزيك as a chunk). Sound spotlight 1 (ج=g, ق='). · Culture: C1 greeting/reply pairs, C12 hand-on-heart. · Words (14): أهلاً ahlan hello; السلام عليكم / وعليكم السلام; صباح الخير / صباح النور good morning; مساء الخير good evening; إزيك/إزيكي how are you; كويس/كويسة kuwayyis fine; الحمد لله; وإنت؟ w-inta and you; مع السلامة goodbye; شكراً thanks; أيوه yes; لأ no; يلا yalla let's go; باي (also used).

**S1-L2 · أنا اسمي… — Who I am** · Can-do: introduce self, ask name and origin, say nationality; count 1–5. · Grammar: 1, 3 (zero copula), 4 (اسمك إيه، منين), 5 (ـي/ـك/ـكي on اسم). Spotlight 2 (ح/هـ). · Culture: C5 حضرتك as polite "you"; تشرفنا. · Words (16): اسم ism name; اسمي/اسمك; إيه eeh what; منين mineen where from; من min from; مصر maSr Egypt/Cairo; مصري/مصرية Egyptian; أمريكي/إنجليزي/ألماني; هنا hina here; ساكن/ساكنة saakin living; في fi in; تشرفنا; واحد اتنين تلاتة أربعة خمسة 1–5; ده/دي this; مين miin who.

**S1-L3 · إن شاء الله — Please, thanks and God** · Can-do: use politeness and religious formulae appropriately; say sorry and never mind. · Grammar: 14 (اتفضل/لو سمحت as chunks), 11 (مش as one-word answer). Spotlight 3 (ع/ء). · Culture: C2 in full. · Words (14): لو سمحت please; من فضلك; اتفضل go ahead; معلش never mind; آسف/آسفة sorry; إن شاء الله; ما شاء الله; ربنا يخليك; الله يسلمك; بسم الله; طيب Tayyib ok; ماشي ok; حاضر right away; مش كده؟ right?

**S1-L4 · إيه ده؟ — Things around me** · Can-do: name and point at objects; ask what something is; say it's mine/yours. · Grammar: 2 (ده/دي/دول + أهو), 3 (article, adjective agreement), 5, 6 intro (بتاعي/بتاعك). Spotlight 4 (خ/ك/غ). · Culture: C12 pointing with the whole hand. · Words (18): كتاب kitaab book; قلم 'alam pen; شنطة shanTa bag; موبايل phone; مفتاح muftaaH key; كرسي kursi chair; ترابيزة tarabeeza table; باب baab door; شباك shibbaak window; عربية 3arabiyya car; بيت beet house; كبير/صغير big/small; جديد/قديم new/old; حلو nice; غالي/رخيص expensive/cheap; بتاعي mine; إيه ده what's this.

**S1-L5 · عيلتي — My family** · Can-do: present family members and ask about theirs; say how many siblings; ages. · Grammar: 5 (full suffix table incl. أبويا/أبوك), 8 (عندي/عندك), 12 (numbers 1–10 with إخوات/سنة). Spotlight 5 (ص/س). · Culture: C5 kin terms; ما شاء الله on children. · Words (18): عيلة family; بابا/أبويا father; ماما/أمي mother; أخ/أخويا brother; أخت/أختي sister; إخوات siblings; جوز husband; مرات(ي) wife; ابن/بنت son/daughter; ولد boy; جدو/تيتة grandpa/grandma; عم/خال uncle; عمة/خالة aunt; عندي I have; كام how many; سنة/سنين year(s); عنده كام سنة how old; ستة سبعة تمانية تسعة عشرة 6–10.

**S1-L6 · تشرب إيه؟ — Tea, coffee and the أهوة** · Can-do: offer/accept/decline a drink; order tea/coffee with sugar level; say what you want. · Grammar: 9 (عايز/عايزة + bare verb), 4 (ولا), 11 (مش عايز). Spotlight 6 (ط/ت). · Culture: C3 hospitality, sugar scale, decline-then-accept. · Words (16): شاي tea; قهوة/أهوة coffee/café; مية water; عصير juice; سكر sugar; زيادة/مظبوط/خفيف extra/medium/light; من غير without; بالنعناع with mint; كوباية glass; عايز/عايزة want; تشرب إيه what'll you drink; اشرب drink!; حلو أوي very nice; بس bass but/only; كمان more.

**S1-L7 · فول وطعمية — Breakfast Cairo-style** · Can-do: order simple food, say likes/dislikes, ask the price. · Grammar: 10 (بحب/بتحب/بيحب only), 11 (ما بحبش), 4 (بكام). Spotlight 7 (ض/د). · Culture: C4 food and meal names; بالهنا والشفا. · Words (18): فول beans; طعمية falafel; عيش bread; بيض eggs; جبنة cheese; كشري koshari; فطار/غدا/عشا breakfast/lunch/dinner; أكل food; سندوتش; بحب I like; ما بحبش I don't like; جعان hungry; عطشان thirsty; بكام how much; جنيه pound; واحد فول one fuul (portion); بالهنا والشفا bon appétit; تسلم إيديك bless your hands.

**S1-L8 · الساعة كام؟ — Numbers, time and days** · Can-do: tell the time, say days and parts of day, give a phone number. · Grammar: 12 (11–20, tens), 13 (time), 4 (إمتى). Spotlight 8 (ظ/ز/ذ). · Culture: Egyptian time flexibility (بعد نص ساعة = "soon"); the Friday weekend. · Words (18): الساعة hour/clock; كام; ونص/وربع/إلا ربع; دقيقة minute; النهارده today; إمبارح yesterday; بكره tomorrow; الصبح morning; بالليل at night; بعد الضهر afternoon; يوم day; أسبوع week; الجمعة/السبت/الحد/الاتنين/التلات/الأربع/الخميس; إمتى when; دلوقتي now; بعدين later; نمرة/رقم number; حداشر…عشرين.

**S1-L9 · فين…؟ — Where is it? Around the block** · Can-do: ask where something is; understand and give a two-step direction; say something exists or not. · Grammar: 7 (فيه/مفيش), 19 (basic place prepositions), 14 (روح/امشي/خش), 4 (فين). Spotlight 9 (long/short vowels, ee/oo). · Culture: C10 first Cairo names (وسط البلد، الهرم، النيل); asking strangers is normal, they will walk you there. · Words (18): فين where; فيه there is; مفيش there isn't; هنا/هناك here/there; قريب/بعيد near/far; يمين/شمال right/left; على طول straight; جنب next to; قصاد opposite; قدام/ورا in front/behind; شارع street; ميدان square; محطة station; جامع mosque; كنيسة church; صيدلية pharmacy; سوبر ماركت; مطعم restaurant; بنك.

**S1-L10 · بتعمل إيه؟ — Work and study** · Can-do: say what you do and where; ask others; say you speak a little Arabic. · Grammar: 10 (full بـ paradigm), 4 (بتشتغل فين/إيه), 20 preview (عارف/فاهم as chunks). Spotlight 10 (stress: مدرسة). · Culture: C5 يا أستاذ/يا دكتور/يا باشمهندس — title culture. · Words (18): شغل work; بشتغل I work; بدرس/بذاكر study; طالب/طالبة student; مدرس/مدرسة teacher; دكتور doctor; مهندس engineer; موظف employee; شركة company; جامعة university; مدرسة school; مكتب office; بتكلم عربي I speak Arabic; شوية a little; إنجليزي English; فاهم/مش فاهم I understand/don't; عارف/مش عارف know/don't know; تاني again.

**S1-L11 · في السوق — Shopping and bargaining basics** · Can-do: buy fruit/vegetables by weight; ask price; say too expensive; pay. · Grammar: 12 (counted nouns: كيلو، كيلوين، تلات كيلو), 8 (معاك فكة), 14 (هات/خد). Spotlight 11 (shadda: حب، بص). · Culture: C6 bargaining moves and فكة; C11 first mention of بقشيش. · Words (18): سوق market; محل shop; كيلو; نص كيلو; طماطم tomatoes; بطاطس potatoes; بصل onion; خيار cucumber; موز bananas; برتقان oranges; تفاح apples; مانجة mango; غالي/رخيص; فكة change; فلوس money; بكام الكيلو; هات give me; خد take; كده كفاية kida kifaaya that's enough; آخر كلام final price.

**S1-L12 · مراجعة: يوم في القاهرة — Review: a day out** · Can-do (A1 exit): hold a 6-turn exchange (greet, order, pay, ask direction, take leave) with a patient speaker. · Grammar: consolidation of 1–15; first exposure to past chunks (رحت، أكلت، شفت) as vocabulary for the Stage 2 bridge. Spotlight 12 (connected speech). · Culture: C12 full gesture set; C1 farewells (تصبح على خير). · Words (14): رحت I went; أكلت I ate; شفت I saw; اشتريت I bought; إمبارح; حلو أوي; زحمة crowded; تعبان tired; مبسوط happy; يوم جميل nice day; تاكسي; مترو; كوبري bridge; النيل.

### Stage 2 — Building Blocks (A1 → A2), 14 lessons

**S2-L1 · يومي — My daily routine** · Can-do: describe a typical day with times; ask about someone's routine. · Grammar: 10 (all persons, incl. بيصحى/بينام), 13 (times), 25 preview (وبعدين). · Culture: late Egyptian hours (شغل 9–5 or split shifts; dinner at 10). · Words (18): بصحى I wake; بقوم get up; بفطر have breakfast; بروح go; برجع return; بتغدى have lunch; بتعشى have dinner; بنام sleep; بشرب; بشتغل; بذاكر; بتفرج على التليفزيون watch TV; بعد كده then; عادةً usually; كل يوم every day; بدري early; متأخر late; ساعة hour.

**S2-L2 · إمبارح — What I did yesterday** · Can-do: narrate yesterday in 5–6 past sentences; ask "did you…?". · Grammar: 16 (sound + hollow verbs), 11 (ما…ش with past). · Culture: weekend = Friday (الجمعة); Friday prayer and family lunch. · Words (18): راح/رحت went; جه/جيت came; أكل/أكلت ate; شرب/شربت drank; شاف/شفت saw; عمل/عملت did; قال/قلت said; اشترى/اشتريت bought; نام/نمت slept; قعد/قعدت stayed; اتفرج على watched; قابل/قابلت met; خرج/خرجت went out; الأسبوع اللي فات last week; من يومين two days ago; زمان long ago; أول إمبارح day before yesterday; مرة once.

**S2-L3 · تاكسي! — Getting around Cairo** · Can-do: take a taxi/microbus/metro; give a destination; negotiate the fare politely. · Grammar: 14 (imperatives to driver: خش، وقف، على جنب), 18 intro (وصلني، روحني), 12 (fares). · Culture: C6 taxi/microbus etiquette; C10 districts. · Words (20): تاكسي; ميكروباص; مترو; أوتوبيس; محطة; موقف terminal; بالعداد by meter; وصلني take me; هنا كويس here's fine; على جنب pull over; خش يمين/شمال turn; وقف stop; كوبري bridge; ميدان; الزمالك، المعادي، مصر الجديدة، وسط البلد، الهرم; زحمة traffic; خلي الباقي keep the change.

**S2-L4 · في المطعم — Eating out and ordering** · Can-do: order a meal for two, ask about dishes, complain gently, pay and tip. · Grammar: 9 (ممكن + verb), 22 (dual and food plurals), 11 (مفيش…؟). · Culture: C4 dishes; C11 tipping 10%; splitting vs على حسابي "my treat" (S32). · Words (20): منيو; حساب bill; جرسون/كابتن waiter; طلب order; طبق dish; لحمة meat; فراخ chicken; سمك fish; رز rice; مكرونة pasta; سلطة salad; شوربة soup; محشي; ملوخية; كفتة; حلو dessert; مالح salty; حار spicy; على حسابي my treat; بقشيش tip.

**S2-L5 · شقتي — Home and neighbourhood** · Can-do: describe your flat and street; say what's in each room; compare two flats. · Grammar: 7, 19 (full preposition set), 22 (broken plurals), 23 intro (أكبر/أصغر). · Culture: بواب (doorman) and بقشيش; noise/زحمة; the balcony (بلكونة) culture. · Words (18): شقة flat; أوضة room; أوضة نوم bedroom; صالة living room; مطبخ kitchen; حمام bathroom; بلكونة balcony; دور floor; أسانسير lift; بواب doorman; سرير bed; تلاجة fridge; بوتاجاز stove; تكييف AC; مروحة fan; نور light; مية وكهربا water and electricity; إيجار rent.

**S2-L6 · هنعمل إيه بكره؟ — Plans and invitations** · Can-do: make and respond to invitations; say future plans; accept/decline with excuses. · Grammar: 17 (هـ future all persons), 11 (مش هـ), 15/25 (عشان, لكن). · Culture: C3 invitation dance; إن شاء الله as a soft no; the polite excuse معلش عندي شغل. · Words (18): هروح I'll go; هنتقابل we'll meet; هتيجي؟ will you come; عزومة invitation; بعزمك I invite you; أجازة holiday; ويك إند; حفلة party; سينما; فيلم; مشوار errand/outing; فاضي/مشغول free/busy; معاد appointment; موافق agreed; يا ريت I wish/would love to; معلش، مش هقدر sorry, can't; ممكن مرة تانية another time; هنشوف we'll see.

**S2-L7 · الجو والفصول والبحر — Weather, seasons, Alexandria** · Can-do: talk about weather and seasons; describe a trip to the coast. · Grammar: 3 (الجو حر/برد), 23 (أحلى من), 21 intro (كان الجو…). · Culture: §2 Alexandria note (حـ future, intonation); summer exodus to إسكندرية/الساحل; الخماسين dust storms. · Words (16): الجو weather; حر hot; برد cold; شمس sun; مطر rain; رطوبة humidity; تراب dust; الصيف/الشتا/الربيع/الخريف seasons; البحر sea; شط beach; إسكندرية; الساحل the North Coast; مصيف summer holiday; درجة degree.

**S2-L8 · إنت عامل إيه؟ حاسس بإيه؟ — Health and feelings** · Can-do: say how you feel, describe symptoms at a pharmacy, respond to someone ill. · Grammar: 20 (participles: تعبان، عيان، حاسس), 8 (عندي صداع), 14 (خد الدوا). · Culture: C8 ألف سلامة → الله يسلمك; the pharmacist as first doctor; ربنا يشفيك. · Words (18): تعبان tired/unwell; عيان ill; صداع headache; سخونية fever; برد a cold; كحة cough; بطني وجعاني stomach ache; دوا medicine; صيدلية; دكتور; مستشفى hospital; حاسس بـ feeling; مبسوط happy; زعلان upset; قلقان worried; خايف scared; ألف سلامة get well; كويس دلوقتي fine now.

**S2-L9 · رمضان في مصر — Ramadan and the holidays** · Can-do: exchange holiday greetings; describe what people do in Ramadan; understand an iftar invitation. · Grammar: 10/17 review in holiday contexts; 22 (holiday plurals); 24 intro (اللي بيصوم). · Culture: C7 in full. · Words (18): رمضان; صايم fasting; فطار iftar; سحور; فانوس lantern; أذان; المدفع cannon; مسلسل TV series; كحك Eid biscuits; عيدية; العيد; عيد الفطر/الأضحى; كل سنة وإنت طيب; رمضان كريم → الله أكرم; مبروك; صلاة prayer; زكاة; كنافة/قطايف.

**S2-L10 · الناس اللي أعرفهم — Describing people** · Can-do: describe people's looks, character and clothes; identify someone in a group. · Grammar: 24 (اللي with resumptive pronoun), 22 (adjective plurals), 23 (أطول من). · Culture: C5 address forms in full (يا باشا، يا حاج، يا مدام); C9 دمه خفيف. · Words (20): طويل/قصير tall/short; تخين/رفيع fat/thin; شعر hair; أسود/أشقر; عينين eyes; لابس wearing; نظارة glasses; قميص shirt; بنطلون trousers; فستان dress; حجاب; جزمة shoes; كبير في السن elderly; شاب young man; طيب kind; شاطر clever; كسلان lazy; دمه خفيف funny; عصبي hot-tempered; محترم respectable.

**S2-L11 · كنت زمان… — Then and now** · Can-do: talk about how life used to be; compare past and present. · Grammar: 21 (كان + noun/عند; كان بيـ), 26 (لسه, بقى preview), 23. · Culture: nostalgia genre (زمان كان أحسن), old Cairo vs new cities (التجمع). · Words (16): كان was; كنت I was; كان عندي I had; كنت بـ I used to; زمان in the past; دلوقتي now; لسه still; اتغير changed; بقى became; أحسن better; أصعب harder; أرخص cheaper; الحياة life; الدنيا the world/things; قرية village; مدينة city.

**S2-L12 · التليفون والإنترنت — Phone, messages, appointments** · Can-do: make a phone call, leave a message, arrange/cancel a meeting; understand voice notes. · Grammar: 18 (object + indirect object clitics: كلمني، قولّي، ابعتلي), 25 (لما توصل). · Culture: phone openers ألو/أيوه، مين معايا؟; WhatsApp culture, فويس نوت; Egyptian time (هوصل بعد عشر دقايق = 30). · Words (18): تليفون/موبايل; رقم number; اتصل بـ call; كلمني call me; رن ring; رسالة message; ابعتلي send me; واتساب; نت internet; شحن credit/charge; شبكة signal; مشغول busy (line); رد answer; قفل hang up; معاد appointment; أجّل postpone; لغى cancel; ألو hello (phone).

**S2-L13 · في الشغل ومع الجيران — Small talk and social rituals** · Can-do: keep a 3-minute small-talk exchange; congratulate, condole, welcome back; use the right title. · Grammar: 28 preview (بقالك قد إيه هنا؟), 26 (برضه/كمان), 9 (لازم). · Culture: C8 set phrases (مبروك، عقبالك، حمد الله على السلامة، البقاء لله), C11. · Words (16): مبروك; الله يبارك فيك; عقبالك; حمد الله على السلامة; نعيماً; البقاء لله; البقية في حياتك; الله يرحمه; جار/جيران neighbour(s); زميل colleague; مدير boss; اجتماع meeting; مرتب salary; ترقية promotion; فرح wedding; عزا funeral gathering.

**S2-L14 · مراجعة: أسبوع في مصر — Review: a week in Egypt (A2 exit)** · Can-do: tell a short past narrative, describe plans, handle a shop/taxi/pharmacy exchange, and understand a 60–90 s slowed authentic clip with pre-taught words. · Grammar: consolidation 16–26; diagnostic on ما…ش vs مش and كان بيـ. · Culture: C10 Cairo map quiz; C9 first نكتة (مرة واحد…). · Words: recycled + 10 connectors: الأول first; بعدين; في الآخر finally; فجأة suddenly; للأسف unfortunately; بصراحة honestly; يعني; على فكرة by the way; المهم anyway/the main thing; خلاص.

### Stage 3 — The Bridge (A2 → B1), 12 lessons

**S3-L1 · حكايتي — My story: where I grew up** · Can-do: narrate a personal history with sequence and background (كان بيـ vs past). · Grammar: 21 (كان بيـ/كان هـ/كان + participle), 25 (لما، قبل ما، بعد ما، أول ما), 28 (بقالي). · Culture: مصر = Cairo for provincials; موالد and village life; the Saʿīdi note (§2). · Words (16): اتولدت I was born; كبرت grew up; اتخرجت graduated; اتجوزت got married; انتقلت moved; اتعلمت learned; سنة كام؟ what year; طفولة childhood; ذكريات memories; حكاية story; حكى tell; افتكر remember; نسي forget; بقالي… I've been… for; من ساعة ما ever since; لحد ما until.

**S3-L2 · الشغل والمقابلة — Work, jobs and ambitions** · Can-do: describe your job and routine tasks; talk about hopes and plans; handle a simple job-interview exchange. · Grammar: 17 + 9 (هحاول أـ, لازم أـ), 27 (بدأت أـ, فضلت أـ), 23 (أفضل…). · Culture: workplace address (يا باشمهندس، حضرتك), ورد وزحمة commute talk; واسطة (connections) as a concept. · Words (18): وظيفة job; مقابلة interview; سي في CV; خبرة experience; شهادة degree; مرتب salary; دوام working hours; مدير; زميل; عميل client; مشروع project; اجتماع; إيميل; أحلام dreams; طموح ambition; هدف goal; هحاول I'll try; نفسي أـ I'd love to.

**S3-L3 · الأخبار والسوشيال — Media, opinions and agreeing/disagreeing** · Can-do: give and justify an opinion on a film/series/song; agree and disagree politely. · Grammar: 30 (بيقولوا إن…), 29 (لو…هـ), 33 (adverbs of degree). · Culture: Ramadan مسلسلات season; عادل إمام / أم كلثوم / عمرو دياب as shared references; إفيهات (C9). · Words (18): رأي opinion; في رأيي in my opinion; أنا معاك I agree; مش موافق I disagree; ممكن maybe; أكيد for sure; مسلسل series; فيلم; أغنية song; مطرب singer; ممثل actor; مشهور famous; ممل boring; ممتع enjoyable; غريب strange; حلو أوي; بيقولوا إن they say that; صحيح؟ really?

**S3-L4 · مشكلة! — Problems, complaints, and getting things fixed** · Can-do: explain a problem (landlord, phone company, shop), ask for a solution, follow up. · Grammar: 32 (اتـ passives: الباب اتكسر، الشحن اتقطع), 11 (ما…ش with clitics: ما جاليش), 25 (لحد ما). · Culture: معلش vs escalation; بكرة إن شاء الله = "not today"; the role of the بواب. · Words (18): مشكلة problem; عطل breakdown; بايظ broken; اتكسر got broken; اتسرق got stolen; اشتكى complain; صلّح repair; سباك plumber; كهربائي electrician; فاتورة bill; غلط mistake; ضمان guarantee; استرجع get back; حل solution; خلاص، اتحلت solved; استنى wait; اتأخر be late; مش معقول unbelievable.

**S3-L5 · الفرح والعزا — Weddings, births and condolences** · Can-do: attend a wedding or condolence gathering and say the right things; describe the customs. · Grammar: 30 (reported wishes: قالتلي مبروك), 24, 22 (occasion plurals). · Culture: C8 in full. · Words (18): فرح wedding; خطوبة engagement; كتب كتاب; عريس/عروسة; زفة; شبكة; سبوع; عزا; مقابر cemetery; ألف مبروك; الله يبارك فيك; عقبالك; يتربى في عزك; البقاء لله → البقية في حياتك; ربنا يعزيكم; شدوا حيلكم; الله يرحمه.

**S3-L6 · خان الخليلي — Shopping for real: bargaining at B1** · Can-do: sustain a multi-turn haggle, describe what you want in detail, refuse and close. · Grammar: 23 (superlative: أحسن سعر، أغلى محل), 29 (لو خليتها بـ… هاخد اتنين), 26 (خالص). · Culture: C6 advanced; C10 خان الخليلي, الحسين, وكالة; tourist-price vs local-price talk. · Words (18): سعر price; خصم discount; آخر سعر; غالي أوي; مش معقول; ممكن أقل؟; هاخد I'll take; هفكر I'll think; بضاعة goods; أصلي/تقليد genuine/fake; نحاس copper; فضة silver; دهب gold; قطن cotton; هدية gift; سوفينير; تحفة antique/lovely thing; خليها بـ make it.

**S3-L7 · سفر داخل مصر — Travelling: train to Aswan, bus to Sinai** · Can-do: book tickets, ask about departures/delays, describe a trip and its problems. · Grammar: 30 (سألته إذا…/الموظف قال إن القطر هيتأخر), 31 (ordinals: الدرجة الأولى، العربية التانية), 17. · Culture: C10 القطر from رمسيس; Upper Egypt (الصعيد) and the `saidi` note; سيناء/دهب/شرم; the East vs West bank of Luxor. · Words (18): قطر train; تذكرة ticket; ذهاب/عودة single/return; درجة أولى/تانية; عربية carriage; رصيف platform; اتأخر delayed; اتحرك departed; محطة; أوتوبيس سفر coach; مطار airport; فندق hotel; حجز booking; أسوان، الأقصر، دهب، شرم الشيخ; منظر view; رحلة trip.

**S3-L8 · ولاد نكتة — Humour and how Egyptians tease** · Can-do: understand a simple joke or sketch, recognise irony and teasing, respond in kind. · Grammar: 28 (بقى discourse), 33 (كده, يا سلام), 29. · Culture: C9 in full; C12 gestures for sarcasm. · Words (18): نكتة joke; هزار kidding; بيهزر he's joking; بتهزر؟; دمه خفيف/تقيل; قفشة; إفيه; ضحك laugh; مات من الضحك died laughing; بيتريق على mocks; بجد seriously; صعيدي (as joke figure); مرة واحد… once a guy; يا سلام wow (ironic); الله ينور; إيه ده!; مش ضاحك not funny.

**S3-L9 · صحة ورياضة وعادات — Health, sport and habits** · Can-do: describe habits and changes (quit smoking, started the gym), give advice. · Grammar: 28 (ما بقاش يـ), 27 (بدأ/بطّل + verb), 14 (advice imperatives, لازم/ما تـ…ش). · Culture: كورة (football) as national religion (الأهلي vs الزمالك); شيشة; walking on the Corniche. · Words (18): رياضة sport; كورة football; الأهلي/الزمالك; ماتش; جيم; بيجري runs; بطّل quit; ما بقاش no longer; سجاير; شيشة; رجيم diet; وزن weight; صحة health; نصيحة advice; أنصحك I advise you; عادة habit; بانتظام regularly; نايم بدري sleeping early.

**S3-L10 · التكنولوجيا والحياة اليومية — Tech, apps and money** · Can-do: explain how to use an app/ATM to someone; talk about online shopping and delivery. · Grammar: 14 + 25 sequencing (الأول…وبعدين…لحد ما), 32 (بيتعمل), 18. · Culture: إنستاباي/فودافون كاش, دليفري culture, the delivery man's بقشيش. · Words (18): أبلكيشن; حمّل download; حساب account; باسورد; شحن top-up; دليفري; طلب order; دفع pay; كاش/فيزا; ماكينة ATM; فيه نت؟; واي فاي; صور photos; شير; بوست; كومنت; فولو; بيتعمل كده it's done like this.

**S3-L11 · مصر اللي بحبها — Places, heritage and opinions about the city** · Can-do: describe a place you like and why; compare neighbourhoods; explain a simple cultural fact. · Grammar: 24 (extended اللي clauses), 23 (superlatives), 33. · Culture: C10 full Cairo; الأهرامات، المتحف الكبير، الحسين، القلعة، مصر القديمة; Nile felucca (فلوكة) etiquette. · Words (16): منطقة area; حي quarter; أثري historic; المتحف museum; الأهرامات pyramids; فلوكة felucca; كورنيش; هدوء quiet; زحمة; شعبي popular/working-class; راقي upscale; مشهور بـ famous for; بحب أـ I like to; أحسن حاجة the best thing; المفروض supposed to; حضارة civilisation.

**S3-L12 · مراجعة: مقابلة مع مصري — Review and B1 exit** · Can-do (B1 exit): follow the gist of a 2–3 min authentic Egyptian clip on a familiar topic at 1.0× with no pre-teach; sustain a 5-minute conversation on family, work, plans and opinions; narrate, report what someone said, and give a real conditional. · Grammar: everything 1–33; recognition-only preview of counterfactual لو كنت…كنت (S31) and يا ريت + past. · Culture: register awareness — when a speaker slides toward فصحى (news openers) vs عامية, so learners notice the boundary the app enforces. · Words: none new; consolidation of the ~1,500-word target.

---

## 8. Video sourcing per theme

Seeded Egyptian channels (from `20260823090500_seed_content_channels.sql`) with their fit, then per-theme hunting grounds and Arabic-script search queries. Levels for Ali Gamal / Kareem Elsayed / Sarah Hany / Easy Arabic / Egyptoon / AJ+ Kibreet from S20; the rest from the seed notes and own knowledge.

**Channel fit overview**
- **Easy Arabic** (`@EasyArabicVideos`, street interviews, dual subs; "Super Easy" episodes are slow) — Stage 1 greetings, names, food, time, prices; Stage 2 opinions; the single best Pre-A1→A2 source.
- **Ali Gamal** (`@AliGamal`, subtitled conversation lessons, 3,000+ videos, beginner–intermediate S20) — pre-cut dialogues for almost every Stage 1–2 theme; watch for teacher-register MSA drift on explanations (line scores decide).
- **Kareem Elsayed** (`@kareemelsayedvlogs`, vlogs with English subs, beginner–intermediate S20) — errands, transport, food, travel (Stage 2 L3/L4/L7; Stage 3 L7).
- **Sarah Hany** (`@sarahhany`, household conversational speech, intermediate S20) — home, routine, shopping, tech (Stage 2 L1/L5/L12).
- **Fatma Abu Haty**, **Heba Abo Elkheir**, **Um Anwar** (cooking) — food named on camera: Stage 1 L7, Stage 2 L4/L9 (Ramadan dishes). Um Anwar: seed says VERIFY Egyptian vs Gulf before mining. Fatma Abu Haty's kitchen register may carry `delta-fallahi` colouring — good for the §2 note, tag accordingly.
- **Ola Roshdy** (`olissima`, parenting/daily-struggle comedy) — family, home objects, feelings (Stage 1 L5, Stage 2 L5/L8).
- **Shawar** (family challenges, 3M+) — food, household, kids' vocabulary (Stage 1 L4/L7; Stage 2 L5).
- **Egyptoon** (`@egyptoon`, animated comedy; S20 rates it advanced for speed) — phrase clips for Stage 2 L13 social rituals and Stage 3 L8 humour; not object clips.
- **Fatma Abd Alsalam** (comedy, relatable daily life) — Stage 2 L8 feelings, L12 phone; Stage 3 L4 problems.
- **Hesham Afifi** (`EhHowaDa`, ad-analysis comedy) — product/shopping vocabulary (Stage 2 L4/L5, Stage 3 L6/L10); fast, B1.
- **AJ+ Kibreet** (`@AJpluskibreet`, mini-docs, pan-Arab mix — line-level dialect score decides) — Stage 3 L3/L11 opinion and heritage clips.
- **Al Da7ee7** (الدحيح, edutainment; seed: NOT for A1) — Stage 3 L12 only, as the "fast authentic" exit challenge.

Additional beginner-friendly hunting grounds (verified names only; add to `content_channels` as `candidate` after the harvest scorer vets them): **Brian Wiles** (American who speaks Cairene; explains phrases in Egyptian — Stage 1–2 metalanguage clips), **Linguamid** (intermediate, word histories — Stage 3), **ArabicPod101 Egyptian playlist** (teacher register; mine only the dialogue segments), **Al Bernameg** (Bassem Youssef; advanced satire — Stage 3 L8 recognition only), **Learn Egyptian Arabic through Comprehensible Input** (playlist found in search; verify channel), classic sitcoms with clean Cairene and short scenes — يوميات ونيس, راجل وست ستات, الكبير أوي — and film إفيهات compilations (عادل إمام) for Stage 3 L3/L8. Own knowledge, unverified in this pass: Egyptian Arabic teacher channels such as "Arabic with Nadia"/"Egyptian Arabic with Hoda"-type accounts exist; run the harvest search rather than seeding names.

**Per-theme table** (queries in Arabic script; add `مصري` or `بالمصري` when results skew Levantine/MSA)

| Lesson / theme | Best seeded channels | Other sources | Arabic search queries |
|---|---|---|---|
| S1-L1 Greetings | Easy Arabic (Super Easy), Ali Gamal | Brian Wiles | `إزيك عامل إيه تحيات مصري`; `Easy Arabic Egyptian greetings`; `طريقة السلام في مصر` |
| S1-L2 Introductions, nationality | Easy Arabic, Ali Gamal | — | `اسمك إيه ومنين إنت مقابلات شارع`; `عرّف نفسك بالمصري`; `مصري بيتكلم عن نفسه` |
| S1-L3 Politeness & religious phrases | Ali Gamal, Egyptoon | Brian Wiles (phrase explainers) | `إن شاء الله ما شاء الله استخدام مصري`; `كلمات مصرية معلش`; `ربنا يخليك يعني إيه` |
| S1-L4 Objects, this/that | Shawar, Ola Roshdy, Sarah Hany | — | `جولة في شقتي`; `إيه ده؟ فلوج البيت`; `حاجات في شنطتي` |
| S1-L5 Family | Ola Roshdy, Shawar, Kareem Elsayed | — | `عيلتي فلوج مصري`; `يوم مع ماما وبابا`; `الأم المصرية كوميدي` |
| S1-L6 Tea, coffee, أهوة | Easy Arabic, Kareem Elsayed | — | `قهوة مظبوط على الأهوة`; `أهوة بلدي القاهرة`; `شاي كشري طريقة` |
| S1-L7 Breakfast fuul/ta3miyya | Fatma Abu Haty, Heba Abo Elkheir, Kareem Elsayed | — | `فول وطعمية فطار مصري`; `أحسن فول في القاهرة`; `طريقة الطعمية المصرية` |
| S1-L8 Numbers, time, days | Ali Gamal, Easy Arabic | ArabicPod101 (dialogues) | `الأرقام بالمصري`; `الساعة كام بالعامية`; `أيام الأسبوع مصري` |
| S1-L9 Where is…? directions | Easy Arabic, Kareem Elsayed | — | `ممكن أعرف فين… اتجاهات`; `ازاي أروح وسط البلد`; `مشي في شوارع القاهرة` |
| S1-L10 Work & study | Easy Arabic, Ali Gamal, AJ+ Kibreet | — | `بتشتغل إيه مقابلات`; `يوم في شغلي فلوج`; `طلبة الجامعة مصر` |
| S1-L11 Market shopping | Kareem Elsayed, Sarah Hany, Fatma Abu Haty | — | `سوق الخضار القاهرة`; `بكام الكيلو طماطم`; `فاصل في السوق مصري` |
| S1-L12 Day out review | Kareem Elsayed, Easy Arabic | — | `يوم في القاهرة فلوج`; `جولة وسط البلد`; `النيل فلوكة` |
| S2-L1 Daily routine | Sarah Hany, Kareem Elsayed, Ola Roshdy | — | `روتيني اليومي مصري`; `يومي من الصبح للليل`; `روتين الصباح مصري` |
| S2-L2 Yesterday / past | Kareem Elsayed, Sarah Hany | — | `إمبارح عملت إيه فلوج`; `قضيت الويك إند`; `حكاية حصلت لي` |
| S2-L3 Taxi, microbus, metro | Kareem Elsayed, Easy Arabic, Egyptoon | — | `ركبت الميكروباص`; `مترو القاهرة تجربة`; `سواق تاكسي حوار` |
| S2-L4 Restaurant | Kareem Elsayed, Hesham Afifi, Shawar | — | `تجربة مطعم كشري`; `أكلنا في مطعم شعبي`; `طلبنا دليفري` |
| S2-L5 Home & neighbourhood | Sarah Hany, Shawar, Ola Roshdy | — | `تور في شقتي`; `شقة إيجار القاهرة`; `الحياة في مصر الجديدة` |
| S2-L6 Plans & invitations | Egyptoon, Fatma Abd Alsalam, Ola Roshdy | — | `عزومة مصرية كوميدي`; `خطة الأجازة`; `هنعمل إيه في الويك إند` |
| S2-L7 Weather, seasons, Alexandria | Kareem Elsayed, AJ+ Kibreet | Alexandrian vloggers (tag `alexandrian`) | `الجو في مصر الصيف`; `رحلة إسكندرية فلوج`; `الساحل الشمالي` |
| S2-L8 Health & feelings | Fatma Abd Alsalam, Ola Roshdy | — | `أنا تعبان كوميدي`; `عند الدكتور مصري`; `الصيدلية حوار` |
| S2-L9 Ramadan & Eid | Fatma Abu Haty (dishes), Egyptoon, AJ+ Kibreet, Shawar | — | `رمضان في مصر أجواء`; `فطار رمضان وصفات`; `عيدية العيد` |
| S2-L10 Describing people | Egyptoon, Hesham Afifi, Ola Roshdy | — | `أنواع الناس كوميدي مصري`; `شخصيات في المواصلات`; `وصف شخص بالمصري` |
| S2-L11 Then & now | AJ+ Kibreet, Al Da7ee7 (recognition) | Documentary shorts | `زمان كان أحسن`; `القاهرة زمان ودلوقتي`; `ذكريات الطفولة مصر` |
| S2-L12 Phone & messages | Fatma Abd Alsalam, Egyptoon | — | `مكالمة تليفون كوميدي مصري`; `فويس نوت`; `الواتساب في مصر` |
| S2-L13 Small talk & rituals | Egyptoon, Ola Roshdy, Easy Arabic | — | `المجاملات المصرية`; `ألف مبروك عقبالك`; `عزا مصري تقاليد` |
| S2-L14 Week review | Kareem Elsayed, Easy Arabic | — | `أسبوع في مصر فلوج`; `أول مرة في القاهرة`; `أجانب بيتكلموا مصري` |
| S3-L1 Life story | AJ+ Kibreet, Easy Arabic | Linguamid | `حكايتي من البداية`; `اتولدت في`; `طفولتي في الصعيد` |
| S3-L2 Work & ambitions | AJ+ Kibreet, Sarah Hany | — | `مقابلة شغل بالمصري`; `أحلامي وطموحاتي`; `يوم في حياة مهندس` |
| S3-L3 Media & opinions | Hesham Afifi, AJ+ Kibreet | Al Bernameg (recognition) | `رأيي في مسلسلات رمضان`; `أفلام عادل إمام إفيهات`; `ريفيو فيلم مصري` |
| S3-L4 Problems & complaints | Fatma Abd Alsalam, Egyptoon, Ola Roshdy | — | `مشكلة مع صاحب الشقة`; `النت قطع كوميدي`; `شكوى خدمة العملاء` |
| S3-L5 Weddings & condolences | Egyptoon, Shawar, AJ+ Kibreet | — | `فرح مصري زفة`; `كتب كتاب`; `العزا في مصر عادات` |
| S3-L6 Khan el-Khalili bargaining | Kareem Elsayed, Easy Arabic | — | `خان الخليلي فصال`; `فصال في السوق كوميدي`; `أسعار خان الخليلي` |
| S3-L7 Travel within Egypt | Kareem Elsayed, AJ+ Kibreet | — | `قطر أسوان تجربة`; `رحلة دهب`; `الأقصر فلوج` |
| S3-L8 Humour | Egyptoon, Hesham Afifi, Fatma Abd Alsalam | Al Bernameg, sitcom clips | `نكت مصرية`; `إفيهات أفلام`; `مسرح مصر مقاطع` |
| S3-L9 Health, sport, habits | Shawar, Kareem Elsayed | — | `الأهلي والزمالك`; `بطلت السجاير`; `روتين الجيم مصري` |
| S3-L10 Tech & money | Hesham Afifi, Sarah Hany | — | `إنستاباي طريقة`; `دليفري في مصر`; `شرح أبلكيشن بالمصري` |
| S3-L11 Places & heritage | AJ+ Kibreet, Kareem Elsayed, Al Da7ee7 | — | `المتحف المصري الكبير`; `جولة في القاهرة القديمة`; `الحسين والأزهر` |
| S3-L12 B1 exit | Al Da7ee7, Easy Arabic (long interviews), AJ+ Kibreet | — | `الدحيح`; `Easy Arabic Egypt street interview`; `مقابلة مع مصري` |

Sourcing rules of thumb for the harvest pass: (1) prefer clips where the object/action is on screen when named (the seed's own logic); (2) run the line-level dialect scorer on every AJ+ and cooking clip — instructional and documentary registers drift to فصحى; (3) tag anything with حـ future or the n- 1sg as `alexandrian`, [g]-qaf/[dʒ]-jim as `saidi`, and keep them out of Stage 1–2 unless the lesson is the §2 note itself; (4) Stage 1 clips: 20–60 s, ≤ 1 unknown word per 8; Stage 2: 30–90 s at 0.75×; Stage 3: 1–3 min at 1.0× (adapted from the Gulf doc's scaffold ladder).
