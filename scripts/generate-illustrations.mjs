// Generates the Hakiya brand illustrations with the Gemini image API.
// The committed WebP assets in src/assets/illustrations/ were produced by this
// script; rerun it to regenerate or extend the set (add a spec below), then run
// scripts/convert-illustrations.mjs to resize/convert into src/assets.
//
// Usage: GEMINI_API_KEY=<key> node scripts/generate-illustrations.mjs [name ...]
//        (no args = all; PNGs land in scripts/art/, which is git-ignored)
import { writeFileSync, mkdirSync } from "node:fs";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY not set");
const MODEL = process.env.MODEL || "gemini-3.1-flash-image";
const OUT = new URL("./art/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Shared style anchor — matches the campfire hero: warm storybook watercolor.
const STYLE = `Warm storybook watercolor illustration, hand-painted feel with soft
watercolor washes and gentle paper grain. Palette anchored to: warm sand beige
#E2C5A6, terracotta desert red #8C4135, deep desert green #44663D, charcoal
#323A36, cream #F9F4EA, with deep indigo-blue night skies where relevant.
Soft warm light, cozy and inviting mood. Clean composition with breathing room.
Absolutely no text, no lettering, no captions, no watermark, no borders or frames.`;


// Badge emblems match public/avatars — flat woven sadu iconography, not the
// watercolor style — so achievements read as part of that same family.
const BADGE_STYLE = `Flat geometric folk-art emblem in the style of Bedouin Sadu
weaving. A symmetrical, pixel-weave woven motif rendered in deep desert green
#44663D, terracotta red #8C4135, warm gold #C8963E and cream #F4EEDF, centered
inside a circular deep-green ring border decorated with a repeating pattern of
small woven gold diamonds, on a plain cream #F4EEDF background. Crisp flat
shapes with a subtle woven-thread texture, no gradients, no outlines beyond the
weave, absolutely no text or letters.`;

const SPECS = {
  "dialect-gulf": {
    aspect: "3:2",
    prompt: `${STYLE}
Scene: A Gulf Arabian coastal majlis at dusk. Two or three men in white
kanduras and red-checkered or white ghutras sit on patterned floor cushions
around a brass dallah coffee pot and small finjan cups, mid-conversation,
one gesturing warmly as he tells a story. Behind them, a calm turquoise Gulf
sea with a traditional wooden dhow sailboat, a few palm trees, and modern
skyline silhouettes far on the horizon. Sadu-weave textiles with geometric
diamond patterns on the cushions.`,
  },
  "dialect-egyptian": {
    aspect: "3:2",
    prompt: `${STYLE}
Scene: A lively Cairo street café ("ahwa") in warm evening light. Two friends
laugh over small glasses of tea at a round brass table, one mid-story with an
expressive hand gesture, a backgammon board between them. Full-bleed composition, painted edge to edge with no white paper border and no vignette margin. Behind them, a
bustling old-Cairo street: mashrabiya wooden balconies, hanging lanterns,
a minaret and the Nile glinting in the distance.`,
  },
  "dialect-yemeni": {
    aspect: "3:2",
    prompt: `${STYLE}
Scene: Old Sana'a, Yemen, in golden late-afternoon light. Iconic Yemeni
tower houses of brown brick with white gypsum trim and colorful qamariya
stained-glass half-moon windows. In the foreground, two men in traditional
Yemeni dress (futa skirts, one with a jambiya belt) sit on a rooftop mafraj
with a thermos of tea, one telling an animated story. Terraced mountains
in the hazy distance.`,
  },
  "empty-caught-up": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A celebratory, restful vignette on a plain warm cream background
(#F9F4EA): a shining brass dallah coffee pot pouring a graceful arc of
coffee into a small finjan cup, surrounded by a few floating gold sparkles
and one crescent moon above, a folded sadu-weave cushion beside it.
Centered single subject, generous empty margin around it, soft ground
shadow only — no full background scene.`,
  },
  "empty-nothing": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A quiet, inviting vignette on a plain warm cream background
(#F9F4EA): an open blank notebook resting on a sadu-weave floor cushion,
a single finjan coffee cup with gentle steam beside it, waiting for someone
to sit down and begin. Centered single subject, generous empty margin,
soft ground shadow only — no full background scene.`,
  },
  "value-voices": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A small square vignette on a plain warm cream background (#F9F4EA):
a warm close illustration of an older Arab storyteller's face in a white
ghutra, eyes crinkled mid-story, with a speech bubble filled with a woven
sadu geometric diamond pattern floating beside him. Centered, generous
margin, no background scene.`,
  },
  "value-memory": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A small square vignette on a plain warm cream background (#F9F4EA):
a glowing brass Arabian lantern casting warm light on a small fan of
learning cards, one card lifting into the air with a soft trail of gold
sparkles, suggesting a memory that stays. Centered, generous margin,
no background scene.`,
  },
  "value-media": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A small square vignette on a plain warm cream background (#F9F4EA):
one person's single pair of hands, anatomically natural (one left hand and
one right hand), warmly holding a phone whose screen glows with a tiny desert
campfire scene, a finjan coffee cup on the table beside them. Centered, generous margin, no background scene.`,
  },

  // ── Curriculum stage banners (21:9) — one traveler's journey across five
  // stages, same protagonist and camel throughout for continuity. ──
  "stage-foundations": {
    aspect: "21:9",
    prompt: `${STYLE}
Scene: Very wide cinematic banner. First light of dawn in the desert. A young
traveler in simple robes kneels beside a small campfire at a palm oasis,
carefully packing a woven sadu saddlebag onto a kneeling camel, preparing to
set out. The horizon glows soft gold; the journey has not started yet.
Wide negative space in the sky.`,
  },
  "stage-building-blocks": {
    aspect: "21:9",
    prompt: `${STYLE}
Scene: Very wide cinematic banner. Mid-morning. The same young traveler in
simple robes leads his camel past low mud-brick houses, stacking and loading
woven bundles and clay bricks onto the saddle with help from a villager —
building up his load for the road. Warm sunlight, wide sky.`,
  },
  "stage-bridge": {
    aspect: "21:9",
    prompt: `${STYLE}
Scene: Very wide cinematic banner. Midday. The same young traveler leads his
camel across an ancient stone arch bridge spanning a dry wadi, halfway
across, hills with terraced fields on the far side. A moment of crossing
over. Wide composition, generous sky.`,
  },
  "stage-immersion": {
    aspect: "21:9",
    prompt: `${STYLE}
Scene: Very wide cinematic banner. Golden late afternoon. The same young
traveler, camel behind him, walks into a bustling covered souq street —
hanging lanterns, bolts of woven fabric, spice sacks, merchants mid-banter —
fully surrounded by the life of the town. Warm glowing light.`,
  },
  "stage-fluency": {
    aspect: "21:9",
    prompt: `${STYLE}
Scene: Very wide cinematic banner. Evening under an indigo sky. The same
traveler, now at ease, sits among friends on a rooftop majlis overlooking
the lit old city, gesturing warmly as HE tells the story now, a dallah and
finjan cups between them, a crescent moon above. The journey's arrival.`,
  },

  // ── Onboarding level & goal chips (1:1 vignettes on cream) ──
  "level-beginner": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
a single small green sprout with two leaves emerging from warm golden sand,
one small water droplet glistening on a leaf. Centered, very generous
margin, soft ground shadow only.`,
  },
  "level-basic": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
three flat stepping stones laid in a short path across golden sand, the
first stone slightly larger and worn as if just stepped on. Centered, very
generous margin, soft ground shadow only.`,
  },
  "level-elementary": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
a small brass oil lamp with a warm steady flame, sitting on a folded piece
of sadu-weave cloth. Centered, very generous margin, soft glow and ground
shadow only.`,
  },
  "level-intermediate": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
two rounded speech bubbles meeting in the middle, one filled with a
terracotta sadu diamond weave, the other with a deep green sadu weave,
overlapping slightly as a conversation. Centered, very generous margin.`,
  },
  "level-advanced": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
a falcon in graceful gliding flight above two small dunes, wings spread
wide, a few motion lines of warm air beneath. Centered, very generous
margin.`,
  },
  "goal-casual": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
a single small finjan coffee cup with gentle steam rising, resting on a
small woven coaster. Centered, very generous margin, soft ground shadow.`,
  },
  "goal-regular": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
a brass dallah coffee pot with two finjan cups beside it on a woven mat —
a steady daily ritual. Centered, very generous margin, soft ground shadow.`,
  },
  "goal-serious": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
a small steady campfire of neat logs with a strong warm flame, ringed by
a few stones. Centered, very generous margin, soft glow and ground shadow.`,
  },
  "goal-intensive": {
    aspect: "1:1",
    prompt: `${STYLE}
Scene: A tiny square vignette on a plain warm cream background (#F9F4EA):
a small caravan of two camels with a rider striding at full pace across a
dune crest at dawn, kicking up a little sand. Centered, very generous
margin.`,
  },
  "badge-trophy": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a trophy cup with two handles.`,
  },
  "badge-flame": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a rising flame.`,
  },
  "badge-star": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: an eight-pointed star.`,
  },
  "badge-books": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a stack of three books.`,
  },
  "badge-target": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a circular archery target with a centered arrow.`,
  },
  "badge-speech": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a rounded speech bubble.`,
  },
  "badge-scroll": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: an unrolled scroll with a ribbon.`,
  },
  "badge-qalam": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a reed pen (qalam) crossing an inkwell.`,
  },
  "badge-headphones": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a pair of headphones.`,
  },
  "badge-crown": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a five-pointed crown.`,
  },
  "badge-medal": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a round medal on a short ribbon.`,
  },
  "badge-lightning": {
    aspect: "1:1",
    prompt: `${BADGE_STYLE}
Motif: a bold lightning bolt.`,
  },
};

async function generate(name, spec, attempt = 1) {
  const body = {
    contents: [{ parts: [{ text: spec.prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: spec.aspect },
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = attempt * 15000;
      console.log(`  ${name}: HTTP ${res.status}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      return generate(name, spec, attempt + 1);
    }
    throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`${name}: no image in response: ${JSON.stringify(json).slice(0, 300)}`);
  const bytes = Buffer.from(part.inlineData.data, "base64");
  writeFileSync(`${OUT}${name}.png`, bytes);
  console.log(`  ${name}.png written (${Math.round(bytes.length / 1024)} KB)`);
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SPECS);
for (const name of names) {
  if (!SPECS[name]) { console.error(`unknown spec: ${name}`); continue; }
  console.log(`generating ${name}...`);
  try {
    await generate(name, SPECS[name]);
  } catch (e) {
    console.error(String(e));
  }
}
