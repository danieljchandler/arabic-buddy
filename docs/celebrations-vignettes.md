# Milestone vignettes

Ten dances leave a dialect with only two to five scenes (Gulf five, Egyptian
three, Yemeni two), and a streak milestone used to play whichever dance was
next. The vignettes add fourteen more scenes in the same collage style, built
around a meal, a ritual or a landmark, and give the streak its own picture: a
grill whose fire grows with the days.

They are drawn exactly like the dances (grayscale photo cutouts with a paper
edge, on mustard paper, under a framed Arabic title; see "The look" in
[`celebrations.md`](celebrations.md)) and played by the same stage
(`CelebrationScene`) through the same `poseAt`. A vignette *is* a
`DanceDefinition` that also sets the optional scene fields (`about`,
`effects`, `heat`, `fxAnchor`, `cheers`), so nothing downstream had to learn a
new kind of thing. The catalogue is `src/lib/vignettes.ts`.

## What is and is not measured

**Nothing here is timed from footage.** The dances' timing comes from
reference videos (`docs/reference/<dance>/`); there is no reference video of a
grill being turned, so every beat is a chosen number, named in
`vignettes.ts` and explained there (`VIGNETTE_BEAT_MS` 600, `LADDER_BEAT_MS`
500, `FAN_STROKE_MS` 250, the zaffa 400 and the goal 500). The poses were
described to the image model in words, from general knowledge of each thing.
The costume, the cookware and the food have not been checked by anyone from
the region. The "To check" lists below are the first job of the reviewer.

## When each scene plays

| Moment | What plays |
|---|---|
| A streak milestone (3, 7, 14, 30, 50, 100, 150, 200, 365, 500, 1000) | The dialect's **ladder**, at the rung its length has reached. Never a dance. |
| Lesson, letter, deck, daily goal, badge | The dance rotation and the vignettes that suit that moment take turns, **a dance first**: dance, vignette, dance, vignette… |
| A moment no vignette suits (a Yemeni lesson, an Egyptian deck) | Only ever a dance. |

`takeScene` in `celebrations.ts` is the rule. The count of turns lives in
`localStorage` per dialect and per kind (`hikaya:celebration-scenes:v1`), so
a badge's turn for a pearl does not move the lesson's. A dance first means a
learner's first lesson, badge or letter is still the dance they were
promised, and the e2e specs that expect a dance on a first finish still hold.
Where a moment has several vignettes (the Gulf's daily goal has the coffee
and the football goal) they are walked in turn.

| Moment | Gulf | Egyptian | Yemeni |
|---|---|---|---|
| Streak | Mishkak ladder | Kababgi ladder | Madhbi ladder |
| Daily goal | Dallah, Football | Football | Bunn |
| Badge | Lulu | Fanous | Shibam |
| Cleared deck | Luqaimat | none | Honey |
| Lesson | Bakhoor | Zaffa | none |
| Mastered letter | Qalam | Qalam | Qalam |

## The streak ladders

One story, told in each dialect's food. The figure's six stills are, in
order: the empty grill with its coals, raw meat on it, the meat seared (a few
pieces lifted, as if mid-turn), a platter, the family table, and a whole roast
lamb. A cook stands at the left with a fan in his hand and swings it (two
helper stills, a quarter-second apiece).

| From | Stills | Heat | Drawn in code | The picture says |
|---|---|---|---|---|
| 3 days | coals | 1 | flames, embers | The coals catch. |
| 7 | raw | 2 | flames, embers, smoke | The first meat goes on. |
| 14 | raw, raw, seared, seared | 3 | flames, embers, smoke | Sizzle and smoke. |
| 30 | seared | 3 | flames, embers, smoke | Seared, and turned. |
| 100 | platter, table, table | 4 | steam, sparkle | Off the fire: the platter, then the table. |
| 365 | table, lamb, lamb | 5 | steam, sparkle | A feast for a whole year. |
| 1000 | lamb, lamb, table | 5 | steam, sparkle | The whole street is fed. |

The milestones that fall between rungs (50, 150, 200, 500) play the rung below
with one more heat, up to 5, so a longer run is always a bigger fire. **The
fire is only lit while there is a grill**: a first version kept the flames
over the table and they hung in mid-air above the food, so from the feast on
the steam rises from the dishes and the sparkle is the party.

| | Mishkak (Gulf) | Al-Kababgi (Egyptian) | Al-Madhbi (Yemeni) |
|---|---|---|---|
| Title | المشاكيك | الكبابجي | المضبي |
| Where | Saudi Arabia and the Gulf | Cairo, Egypt | Yemen |
| The fire | A rectangular steel charcoal grill on legs, lamb-cube skewers | A long narrow trough grill, flat kebab and kofta on skewers | Hot flat stones in an arched stone hearth, lamb laid straight on them |
| The cook | White thobe, ghutra and agal, a woven palm fan | White shirt, apron and skullcap, a straw fan | Striped futa, white shirt, dark jacket, patterned turban-scarf, bare feet |
| Lines (drafts) | 3 days «شبّت النار!»; 30 «تسلم الأيادي!»; 100 «ألف عافية!» | 3 «النار ولّعت!»; 30 «تسلم الأيادي!»; 100 «بالهنا والشفا!» | 100 «بالعافية!» |

Other rungs take one of the dialect's ordinary cheers. Preview a rung with
`?celebrate=mishkak&celebratedays=100` (a hundred when `celebratedays` is
left off).

## The one-offs

| Id | Title | Moment | Dialects | Stills / helper | Drawn in code | Line (draft) |
|---|---|---|---|---|---|---|
| `dallah` | الدلة | daily goal | Gulf | host pours (3) + guest's cup (2) | steam | «هلا والله!», «ألف عافية!» |
| `lulu` | اللولو | badge | Gulf | oyster closed, half, open with pearl (3) | sparkle | «طلع اللولو!» |
| `luqaimat` | لقيمات | cleared deck | Gulf | frying, heaped, syrup (3) | steam, sparkle | «ألف عافية!» |
| `bakhoor` | البخور | lesson | Gulf | host with the burner (3) | smoke | «هلا والله!» |
| `zaffa` | الزفة | lesson | Egyptian | three drummers (3) + woman trilling (2) | sparkle | «زغروطة!», «ألف مبروك!» |
| `fanous` | الفانوس | badge | Egyptian | lantern unlit, lit, three (3) | sparkle | «الله ينور!» |
| `honey` | عسل دوعني | cleared deck | Yemeni | comb, dipper, jar (3) | sparkle | «والله حالي!» |
| `bunn` | البن | daily goal | Yemeni | green, roasted, the jabana (3) | steam | «بالعافية!» |
| `shibam` | شبام | badge | Yemeni | house, tower, cluster (3) | sparkle | (the dialect's cheers) |
| `football` | القول / الجون | daily goal | Gulf, Egyptian | kick, ball in the net, celebration (3) | sparkle | Gulf «قوووول!», Egyptian «جوووون!» |
| `qalam` | القلم | mastered letter | all three | pen in its well, lifted, laid on paper (3) | an ink stroke | (the dialect's cheers) |

The daily goal is a goal, so it is also a football goal; one vignette serves
the Gulf and Egypt, and takes the learner's dialect (its frame, and where the
name differs, its name: the Gulf says «قول», Cairo says «جون»). `qalam` serves
all three and draws its stroke in code across the oxblood circle; the only
text on any stage is the title, the cheer and the milestone.

All the cheers are exclamations, not addresses, so none has to guess whether
the learner is a man or a woman; they are checked against `detectMsaLeaks` for
the dialect they are shouted in (`vignettes.test.ts`), which can clear a line
of فصحى but cannot say it sounds natural.

## A badge on the screen

A badge moment (the pearl, the lantern, Shibam, or a dance) carries the badge
itself: `celebrate({ kind: "achievement", badge })`, set by
`useCheckAchievements`. The stage sticks its emblem on (`BadgeSticker`: the
achievements grid's own artwork, an emoji disc when a badge has none), its
Arabic name goes on an ink label under the cheer, and the cheer goes a size
smaller so the longest of them stops short of the sticker. The host also asks
for a song about the badge, once per screen and never over a song already
playing (see "Celebration songs" in the README). The scenes are only the
picture behind it: the pearl is not a badge, and no badge is tied to a scene.

## Code-drawn effects (`StageEffects`)

Flames, embers, smoke, steam, sparkle and the ink stroke are cut-paper shapes
in the stage's colours, not photographs; flames add one colour to the stage
(`--cel-flame`). A scene sets `effects`, a `heat` from 1 to 5 and where they
rise from (`fxAnchor`, a percentage of the figure's box). Flames and smoke are
drawn **behind** the figure so they rise from behind the grill's rim and
skewers; embers, steam, sparkle and ink are in front. Every position is
`jitter` of the shape's index, so a scene looks the same each time it plays.
Under reduced motion the shapes sit in place.

## Stills

Each vignette's folder, `src/assets/celebrations/<id>/`, holds `still-N.webp`
(the figure, in the order its `sequence` indexes them) and `helper-N.webp`
(the second figure). `vignetteArt.ts` finds them by name, and
`vignetteArt.test.ts` holds every `sequence` to the stills that exist. The
stage only renders the stills a rung uses, so a 3-day streak fetches one of
the six.

Made the way the dances' are (see "Making a new dance" in `celebrations.md`):
generated on Higgsfield with `gpt_image_2_5` at high quality, 2:3, 1.5
credits each, the first still of a scene alone and the rest referencing it,
on a flat mid-grey backdrop; then cut out with
`scripts/celebrations/make_cutouts.py still|helper`. About 111 credits for
61 stills kept out of 74 generations (the rest were re-rolls: a pose that came out
wrong, a dress that read as another country's, a lamb that read as poultry). Three flags were added to the script for these
scenes, because flat props behave differently from figures:

- `--key-low`: the brightness key also runs below the knees (paper lying low
  in the frame). The qalam.
- `--grey-tol=N --grey-min=N`: how near the backdrop grey, and how large a
  boxed-in patch, is taken out. The football goal's net used `30` and `120`.
  A small enclosed hole (a lantern's hanging ring was 1,485 px against the
  default 1,500) wants `--grey-min=1000`.
- `--fill-holes=N`: fill enclosed holes smaller than N px. The qalam used
  `2500`.

Several stills drifted in scale or off the floor line and were registered
(shifted or scaled about the feet, the gap filled with the backdrop's grey)
before cutting rather than re-rolled. The football's players are airborne, so
their floor line is only the lowest boot.

## To check (a native reviewer, before this ships)

Everything below was written from general knowledge and flagged by the people
who made it.

**Arabic**
- Every line above, and the two football words «قول» / «جون», the Gulf's
  `اللولو` for pearls, and «طلع اللولو!». The Yemeni lines are the least
  certain; the Yemeni lexicon in `docs/yemeni/` is the place to look for
  better ones.
- The spelling of المضبي (also written المظبي).

**Costume and props**
- The whole-lamb stills disagree: the Gulf one has its head with the eyes
  closed, the Egyptian one has its head with the eye visible (stark), and the
  Yemeni one is headless. Pick one. Whether a whole lamb is right for haneeth
  at all is unconfirmed.
- Every cook's fan (a round woven palm or straw paddle) and the Gulf cook's
  white thobe with a stand collar and placket.
- The dallah's style (Najdi, Hejazi or Emirati), the bisht (it came out dark
  brown with wide gold braid, heavier than the brief), the guest's headwear,
  and brown sandals on all the men.
- The mubkhara is a small footed brass bowl; real ones vary widely.
- The Egyptian zaffa drums (do they read as a tabl baladi?) and the woman's
  dress: a turquoise satin with beaded trim, chosen after a blue
  cross-stitch dress read as Palestinian and a fuchsia one went black.
- The fanous is a hexagonal brass lantern with a pierced dome and keyhole
  panes; it looks somewhat Moroccan.
- The Yemeni hearth (an above-ground stone hearth with an arched firebox under
  basalt slabs) is invented from "hot flat stones over a wood fire". The
  malooj bread, the green chilli sauce, the saltah (shown as a pale mound with
  no visible bubbling) and the rice colouring are unconfirmed. The roasting
  pan and the jabana (a slender ewer-like pot with a flat base) may not be
  the traditional shapes, and the cups hold an amber drink chosen without
  knowing what is served.
- Shibam's towers are flat frontal elevations with plain window grids; the
  real ones carry more white banding on the upper storeys. The cluster's
  storey scale is 85% of the single tower's.
- The goal's player is a generic young man in a plain red kit with no
  numbers, badge or text; he looks European and is not tuned to either region.

**Weaker stills**
- `qalam` is the weakest scene: the reed reads as a plain cane, the inkwell is
  a heavy black blob next to the paper, and the inkwell jumps 215 px between
  stills 2 and 3.
- The seared stills (`mishkak`, `kababgi`, `madhbi`) show "lifted pieces" only
  modestly, and on the dark stone of the madhbi the raw and seared stills read
  alike in grayscale.
- The lulu's shell looks like an edible oyster rather than a flat Pinctada
  pearl oyster, and the three stills' bounding boxes grow across the pose.
- The honey dipper floats with no hand, and the honey over the jar's rim reads
  as a glossy lid.

## Open decisions

- **Dance first, then take turns.** For a moment that has a vignette, half the
  scenes are vignettes and half are dances; a streak is always a ladder, and a
  moment with no vignette is always a dance. A different ratio is one line in
  `takeScene`.
- **No music.** A vignette has none. The dances' loops are test audio whose
  rights are not cleared; nothing here has a recording.
- **Two moments have no crossing.** Welcome back after a break (the bakhoor
  and the dallah's «هلا والله!» would suit it) and stage completion have no
  moment on the client yet. See "Other milestones" in `celebrations.md`.
- **Frames.** The Gulf frame is Najdi for every Gulf scene, as for the dances.
- **Fire is the one new colour.** `--cel-flame` and `--cel-flame-hot` are not
  Ink brand colours. They are fixed in the stage as the dances' paper is.

## Making a new vignette

1. Add a `VignetteDefinition` to `vignettes.ts`: an id of letters only (no
   dash, which `?celebrate=` reads as the tier), `dialects`, `moments`, the
   title and gloss, `about` (the screen-reader label), the sequence, the
   effects and a cheer. Add it to `VIGNETTES`.
2. Make the stills as above into `src/assets/celebrations/<id>/` and, if the
   figure is not an object at the middle of the stage, a box for it in
   `vignetteArt.ts`.
3. `npx vitest run src/lib/vignettes.test.ts src/components/celebrations`
   checks the catalogue and that every pose in the sequence has a still. Look
   at it on the stage with `?celebrate=<id>-large`.
4. A native speaker of the dialect checks the Arabic, the costume and the food
   before it ships.
