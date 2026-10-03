# Celebration screens

The full-screen "you did it" moment, our version of Duolingo's lesson-complete
owl. Where Duolingo shows its mascot, Hikaya shows a few seconds of
traditional dance from the region of the dialect the learner is studying. The
dancer plays once and holds the final pose. Under it are a cheer in that
dialect, what the learner just did, and one line about the dance. The dances
rotate, so a learner working through Gulf Arabic meets the Ardah, the Ayyala,
the Razha and the rest one celebration at a time.

## When it fires

| Moment | Where it is detected | Rule |
| --- | --- | --- |
| Lesson complete | `Learn.tsx` `handleProduceFinish` | Every finish, including practice-again runs. |
| Alphabet letter mastered | `AlphabetLetter.tsx` `handleStepDone` | Only when `completeStep` reports `mastered`, which happens once per letter. |
| Review deck cleared | `SessionHandoff` | No deck has cards left, the session counts have loaded, and the learner rated at least one card this visit. Arriving to an empty queue is not a celebration. |
| Daily goal | `Index.tsx` (Today) | Every visible task is done. Once per local day (`claimDailyGoalCelebration`); later visits show only the inline "Daily goal complete" card. |
| Streak milestone | `useStreakMilestoneCelebration`, mounted in the host | The streak lands on 3, 7, 14, 30, 50, 100, 150, 200, 365, 500 or 1000 days. The rule is per learner and per run (`shouldCelebrateStreak`), so the row still reading 7 the next morning doesn't fire it again. |
| Badge earned | `useCheckAchievements` `onSuccess` | Every `grant_achievement` that returns `granted`. This replaced the old toast. |

Several moments can land together, for example two badges from one card, or a
lesson that also finishes the day. The second and later ones become lines on
the screen that is already open rather than queueing another dance.

`useCheckAchievements` also writes the streak row it already fetches into the
shared `["review-streak", uid]` cache. That way, the moment a review moves the
streak, the milestone watcher (and the header pill) sees it without another
request.

## Pieces

- `src/lib/celebrations.ts` holds everything pure:
  - the dance catalogue (`DANCE_SCENES`);
  - the per-dialect rotation, persisted under `hakiya:celebration-rotation:v1`;
  - the cheers;
  - each moment's copy;
  - the once-a-day and per-run streak rules;
  - the `celebrate()` / `subscribeCelebrations()` bus.
- `src/components/celebration/CelebrationHost.tsx` is the overlay. It is
  mounted once in `App.tsx`.
- `src/components/celebration/DanceClip.tsx` plays a clip once and slows into
  its last pose over the final 0.6s (`SETTLE_SECONDS`). Once the clip ends it
  offers a replay button. Under reduced motion it shows the still and never
  downloads the clip.
- `public/assets/celebrations/<id>.{mp4,webm}` and `<id>-poster.webp` are the
  assets:
  - 480×480, silent;
  - the poster is the first frame;
  - about 0.6 MB per dance for both formats together, of which a browser
    downloads one, and only when it shows that dance.

The cheers are exclamations rather than forms of address, so none has to
guess the learner's gender. They are all checked by `detectMsaLeaks` for their
dialect in `celebrations.test.ts`.

## The dances

Women's scenes show hair covered. That was a product decision, taken instead
of the Khaleeji hair-toss (*na'ashat*) as it is danced at women-only weddings.

| Asset id | Dance | Region | Reference |
| --- | --- | --- | --- |
| `gulf-ardah` | العرضة · Al-Ardah | Najd, Saudi Arabia | [UNESCO: Alardah Alnajdiyah](https://ich.unesco.org/en/RL/01196) |
| `gulf-khaleeji-women` | الرقص الخليجي · Khaleeji dance | Across the Gulf | [Khaleegy (dance)](https://en.wikipedia.org/wiki/Khaleegy_(dance)) |
| `gulf-ayyala` | العيالة · Al-Ayyala | UAE | [Abu Dhabi Culture: Al Ayyala](https://abudhabiculture.ae/en/unesco/intangible-cultural-heritage/al-ayyalah-unesco) |
| `gulf-razha` | الرزحة · Al-Razha | Oman | [Oman Observer: Omani national costume](https://www.omanobserver.om/article/1108560/features/fashion/understanding-an-omani-mans-national-costume), [UNESCO decision 10.COM 10.B.31 (Al-Razfa)](https://ich.unesco.org/en/decisions/10.COM/10.B.31) |
| `gulf-omani-women` | فنون عُمانية · Omani funūn | Northern Oman | [Smithsonian Folkways liner notes](https://folkways-media.si.edu/docs/folkways/artwork/UNES08305.pdf) |
| `gulf-mizmar` | المزمار · Al-Mizmar | Hejaz, Saudi Arabia | [UNESCO: Almezmar](https://ich.unesco.org/en/RL/01011) |
| `yemen-baraa` | البَرَع · Al-Bara'a | Sana'a | [Gulf News: Yemen's jambia dance](https://gulfnews.com/world/gulf/yemen/yemens-jambia-dance-1.117904) |
| `yemen-sanaani-women` | الرقص الصنعاني · Sana'ani dance | Sana'a | [Gilded Serpent: dancing in Yemen](https://gildedserpent.com/articles13/dancingyemen2jalilah.htm) |
| `yemen-baraa-haraz` | برع حراز · Bara'a of Haraz | Haraz mountains | as Al-Bara'a |
| `yemen-zafeen` | الزَّفين · Al-Zafeen | Hadhramaut | [Esplanade: Zafin](https://www.esplanade.com/whats-on/festivals-and-series/a-tapestry-of-sacred-music/2026/zafin-dance-and-devotion) |
| `egypt-tahtib` | التحطيب · Tahtib | Upper Egypt | [Egyptian Streets: understanding tahtib](https://egyptianstreets.com/2023/07/12/understanding-tahtib-the-ancient-egyptian-martial-art-turned-into-dance/) |
| `egypt-assaya` | رقص العصاية · Raqs al-Assaya | Upper Egypt | [NY Folklore: Egyptian Saidi dance](https://nyfolklore.org/egyptian-saidi-dance/) |
| `egypt-tanoura` | التنورة · Tanoura | Cairo | [Africanews: Egypt's tanoura](https://www.africanews.com/amp/2022/06/09/egypt-s-tanoura-gives-colorful-spin-on-dervish-tradition/) |
| `egypt-nubian` | الكَفّ النوبي · Nubian kaff | Aswan | [Journey Through Egypt: Nubian kaff](https://archive.journeythroughegypt.com/kaff-403/) |

The UNESCO element pages each carry an official video, and those were the
movement references. The costume details in the prompts come from the pages
above:

- Ardah: bisht and shemagh, swords up and down to the drum.
- Ayyala: thin bamboo canes, two facing rows.
- Razha: a sword tossed and caught.
- Bara'a: jambiya belt and dark jacket over a white thobe.
- Tahtib: no blow lands.
- Assaya: hooked, sequined cane and coin hip scarf.

## How the clips were made

Each dance went through the same three steps, using the Higgsfield MCP.

1. **Still.** GPT Image 2.5, quality `high`, 1:1. The style references were
   the campfire hero poster (`public/assets/campfire-hero-poster.webp`) and the
   matching dialect illustration (`src/assets/illustrations/dialect-*.webp`).
   Every prompt opens with the same style clause:

   > Hand-painted watercolor storybook illustration in the exact painting
   > style of the reference images (soft layered washes, visible paper grain,
   > fine dark ink outlines, warm earthy palette). Use the references ONLY for
   > style, palette and line quality, not for composition or characters.
   > Square composition.

   After that come the subject (costume, the dance's signature pose, full body
   with headroom), a softly painted background (musicians, a landmark of the
   region), and "No text, no letters, no watermark, no border."
2. **Motion.** Kling 3.0, mode `pro`, sound off, 5 s, with the still as
   `start_image`. The prompt describes the movement and always ends with:

   > Static camera, no zoom, no cuts. Keep the hand-painted watercolor look,
   > paper texture and ink outlines exactly as in the image; same face and
   > clothing.

   Two clips needed a second take:
   - **Mizmar.** The staff vanished mid-twirl. The fix was "keeps the staff
     gripped … never disappears", and the clip is trimmed to 3.1 s, before
     the dancer turns away.
   - **Tahtib.** The two dancers merged and swapped sides. The fix was "stays
     on the left … never swap places or overlap".
3. **Encode.**

   ```sh
   ffmpeg -i raw.mp4 -vf "scale=480:480:flags=lanczos,format=yuv420p" \
     -c:v libx264 -profile:v main -preset veryslow -crf 31 -movflags +faststart -an <id>.mp4
   ffmpeg -i raw.mp4 -vf "scale=480:480:flags=lanczos,format=yuv420p" \
     -c:v libvpx-vp9 -b:v 0 -crf 50 -row-mt 1 -deadline good -cpu-used 1 -an <id>.webm
   ffmpeg -i raw.mp4 -frames:v 1 -vf "scale=480:480:flags=lanczos" -c:v libwebp -quality 80 <id>-poster.webp
   ```

   Add `-t <seconds>` to the two video commands to trim a clip.

The full set (14 stills, 16 clips, retakes included) cost 161 Higgsfield
credits.

## Adding a dance

1. Make the still and the clip as above, and check every frame for vanishing
   props and merged figures. A strip of frames shows them quickly:
   `ffmpeg -i raw.mp4 -vf "fps=4,scale=200:200,tile=10x2" -frames:v 1 strip.jpg`.
2. Encode to `public/assets/celebrations/<dialect>-<name>.*`.
3. Add an entry to `DANCE_SCENES`. The id prefix must match its dialect;
   the tests check this, and they also check that all three files exist.

## Egypt

Egypt's four dances (Tahtib, Raqs al-Assaya, Tanoura, Nubian kaff) were
chosen to cover men's and women's dances, and Cairo as well as the south.
Swapping one for something else, such as a *baladi* wedding *zaffa*, only
needs an entry and three files.
