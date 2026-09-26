import { readFileSync, writeFileSync } from "node:fs";
const H = { Authorization: "Key " + process.env.HF_CREDENTIALS, "Content-Type": "application/json" };
const api = "https://api.higgsfield.ai/";
async function upload(file) {
  const up = await (await fetch(api + "files/generate-upload-url", { method: "POST", headers: H, body: JSON.stringify({ content_type: "image/png" }) })).json();
  const put = await fetch(up.upload_url, { method: "PUT", headers: up.upload_headers, body: readFileSync(file) });
  if (!put.ok) throw new Error("upload " + file + " " + put.status);
  return up.public_url;
}
const airport = await upload("01h-airport-cairo.png");
const dinner = await upload("02b-friends-msa-book.png");
const P = {
  airport: "The taxi driver talks fast and animatedly in Egyptian Arabic, gesturing with his free hand while he rolls her suitcase toward his open taxi. She nods a little too quickly and keeps a polite smile, eyes darting between him and her phone: she clearly has not understood a word. Handheld camera, slow push-in. Ambient airport sound: traffic, car doors, distant announcements.",
  dinner: "The friends burst out laughing at a joke. The young man looks up from his open grammar book at them, then back down at the book, runs a finger along a line, then looks up again, lost, forcing a smile. Gentle handheld sway. Warm cafe ambience, laughter, clinking tea glasses.",
  campfire: "Vertical cinematic shot of a small group of Gulf Bedouin men sitting around a campfire in the desert at night, dunes behind them, a red and cream sadu-woven rug on the sand. The men wear white thobes and red-and-white checked shemagh headscarves; the older storyteller wears a brown bisht cloak over his thobe. He tells a story with expressive hands while younger listeners lean in and smile. Sparks drift up into a starry sky. Slow push-in. Warm firelight. Empty dark sky in the upper third of the frame. Sound of crackling fire and soft laughter. No text, no logos.",
};
const jobs = [
  ["A1-airport-seedance", "bytedance/seedance-2.5/image-to-video", { image_url: airport, prompt: P.airport, duration: 5, resolution: "1080p" }],
  ["A2-airport-kling4k", "kling-video/v3.0/4k/image-to-video", { image_url: airport, prompt: P.airport, duration: 5 }],
  ["B1-dinner-seedance", "bytedance/seedance-2.5/image-to-video", { image_url: dinner, prompt: P.dinner, duration: 5, resolution: "1080p" }],
  ["B2-dinner-kling4k", "kling-video/v3.0/4k/image-to-video", { image_url: dinner, prompt: P.dinner, duration: 5 }],
  ["C1-campfire-seedance", "bytedance/seedance-2.5/text-to-video", { prompt: P.campfire, duration: 8, resolution: "1080p", aspect_ratio: "9:16" }],
  ["C2-campfire-kling4k", "kling-video/v3.0/4k/text-to-video", { prompt: P.campfire, duration: 10, aspect_ratio: "9:16" }],
];
async function run([name, slug, body]) {
  const r = await fetch(api + slug, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json(); console.log(name, "submit", r.status, j.status ?? JSON.stringify(j).slice(0, 200));
  if (!j.status_url) return;
  let st; for (let i = 0; i < 180; i++) { await new Promise(r => setTimeout(r, 10000)); st = await (await fetch(j.status_url, { headers: H })).json(); if (["completed","failed","nsfw","canceled"].includes(st.status)) break; }
  const url = st?.video?.url ?? st?.videos?.[0]?.url;
  console.log(name, st?.status, url ? "" : JSON.stringify(st).slice(0, 300));
  if (url) writeFileSync(`${name}.mp4`, Buffer.from(await (await fetch(url)).arrayBuffer()));
}
// concurrency 2 (API default)
const q = [...jobs]; await Promise.all([0, 1].map(async () => { while (q.length) await run(q.shift()); }));
