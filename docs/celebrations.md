# Milestone celebrations

When a learner hits a milestone, a few seconds of a traditional dance from their
dialect plays over the screen. It is drawn as a cut-paper collage in the Ink
brand.

The first dance is the Saudi **Ardah** (العرضة). It plays for Gulf learners the
first time they finish a curriculum lesson. Dialects without a dance yet keep
the plain lesson-complete screen.

## Status: the Ardah poses are provisional

The current stills were **not** based on footage of a real Ardah. They were
generated from written descriptions, and the tempo is a guess.

What is probably right:
- The costume: thobe, shemagh and agal, and the crossed bandolier.
- A sword raised overhead, and swaying.
- A drummer.

What is probably wrong:
- **The dip, the stamp and the leap.** The Najdi Ardah is a slow, stately
  dance of men in rows, swaying and lifting their swords together to the
  drums and a poet's verses. It doesn't have leaps.
- **A solo dancer.** The Ardah is danced in rows.

Before this ships to learners:
1. Get 10–20 seconds of clear reference footage.
2. Mark the key poses with timestamps.
3. Regenerate the stills to match them, and time `beatMs` against the drums.
4. Show a row rather than a solo.
5. Have a Saudi reviewer sign it off.

## The look

The owner picked this direction from two style rounds. Its references are
Telfaz11's *Folklore 101* series and Vox's explainers. Its elements:

- **Dancers:** grayscale photo cutouts with a rough paper edge.
- **Ground:** flat mustard paper with faint Arabic print showing through.
- **Title:** the dance's name in Rakkas, inside a frame drawn from the dialect's
  own architecture. The Ardah uses a Najdi parapet and door triangles. The
  planned frames are a mashrabiya for Egyptian and a qamariya window for
  Yemeni.
- **Vox touches:** an oxblood circle behind the dancer, a grid-paper scrap,
  paper tape, and ink label boxes for the praise and the milestone.

Only the dancers are pictures. The paper, frame, title, labels and tape are
drawn in code, so they follow the brand and can carry live text.

## How the dancers move: pose swap

A dance is a handful of stills of one performer. The scene snaps from one still
to the next on the beat. Each swap lands with a small jolt, a slight tilt and a
small sideways shift, so every frame looks hand-placed.

This was chosen over cut-out video footage and hinged photo puppets for these
reasons:

- It matches the reference rhythm.
- Every frame is a still a native reviewer can approve.
- The full Ardah set is about 200 KB.

The other two methods, and a test of each, are on the "Hikaya Collage Dances"
board linked from the PR that introduced this.

| Tier   | Length | Used for (today)              | Contents          |
|--------|--------|-------------------------------|-------------------|
| small  | 1.5 s  | nothing yet                   | dancer            |
| medium | 3 s    | first finish of a lesson      | dancer + drummer  |
| large  | 6 s    | nothing yet (stage complete?) | dancer + drummer  |

The celebration closes itself when its tier ends. Continue, Escape, or a tap
outside the stage ends it sooner. Under reduced motion it holds the first pose.

## Where the code is

| Piece | Purpose |
|---|---|
| `src/lib/celebrations.ts` | The catalogue (`ARDAH`), tier lengths, `danceForDialect`, `poseAt` (what is on stage at a given moment; pure and tested), and the preview parameter. |
| `src/components/celebrations/CelebrationScene.tsx` | The collage stage. |
| `src/components/celebrations/CelebrationOverlay.tsx` | The full-screen dialog and the auto-dismiss. |
| `src/components/celebrations/CelebrationPreview.tsx` | Mounted in `App.tsx`. Plays `?celebrate=`. |
| `src/components/celebrations/danceArt.ts` | Maps each dance to its stills. |
| `src/assets/celebrations/<dance>/` | The stills. |
| `src/pages/Learn.tsx` | The trigger. `handleProduceFinish` celebrates when the dialect has a dance and `savedProgress` (the state before this finish) is not completed. |

**Preview without finishing a lesson:** add `?celebrate=ardah` to any address.
You can also choose the tier with `?celebrate=ardah-small` or
`?celebrate=ardah-large`. The parameter is removed from the address once read,
so a reload doesn't replay it.

## Making a new dance

1. **Choose the poses from reference footage, not from memory.** Pick 5–6
   poses from real performances, with timestamps, including one "home" pose
   to return to between moves. Add a musician in two positions if the dance
   has one. Time the beat against the footage's drums.
2. **Generate the photos** on Higgsfield with `gpt_image_2_5` at high quality,
   portrait 2:3, at 1.5 credits each.
   - Generate the first pose alone.
   - Pass its job id as an `image_references` input for every other pose of
     the same performer, which keeps the same face and costume.
   - Describe the costume precisely.
   - Ask for the whole body in frame with empty space around it, on a plain
     flat **mid-grey** seamless backdrop with no floor shadow. A white thobe
     on a pale backdrop defeats the background removal.
3. **Cut them out:**

   ```sh
   pip install "rembg[cpu]" pillow numpy
   python scripts/celebrations/make_cutouts.py dancer src/assets/celebrations/<dance> pose1.png …
   python scripts/celebrations/make_cutouts.py drummer src/assets/celebrations/<dance> drum1.png drum2.png
   ```

   Check that the performer is the same size in every still. Generation
   sometimes frames one pose closer. If it does, scale that still down and
   anchor it at the bottom centre, as was done for Ardah poses 5 and 6.
4. **Add the dance** to `DANCES` in `src/lib/celebrations.ts` (title, gloss,
   region, praise in the dialect, beat, sequence) and its stills to
   `danceArt.ts`. If the dance belongs to another dialect, draw that dialect's
   frame.
5. **Review.** A native speaker of the dialect checks the costume, the props
   and the praise word before the dance ships.

## Open decisions

- **Ta'sheer:** the dance in the Telfaz11 reference is danced with rifles. The
  Ardah, with swords, was chosen for Saudi.
- **Women's dances:** for example the Gulf hair dance or the Saidi cane dance.
  Not decided. If included, they should be drawn or silhouetted inside the
  same collage rather than photographic.
- **Sound:** drum loops per dance could be generated on Higgsfield. The
  celebration is silent for now.
- **Other milestones:** streaks, stage completion and weekly goals have no
  "crossing moment" on the client yet. See the PR for the survey of where
  wins are detected today.
