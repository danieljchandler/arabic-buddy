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
