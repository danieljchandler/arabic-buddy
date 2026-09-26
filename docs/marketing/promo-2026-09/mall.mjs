import { writeFileSync } from "node:fs";
const H = { Authorization: "Key " + process.env.HF_CREDENTIALS, "Content-Type": "application/json" };
const prompt = `Vertical cinematic comedy shot inside a bright modern shopping mall in the Gulf: polished marble floor, glass shopfronts, shoppers passing in the background. A group of four friends in their early twenties walk toward the camera chatting: young Arab men and women, one man in a white thobe, one woman in a black abaya, the others in casual modern clothes. Suddenly a young Western man in full Shakespearean costume (burgundy velvet doublet, white ruff collar, puffed breeches, tights, a feathered cap) leaps in front of them with a theatrical flourish, one hand raised to the sky, and declaims loudly in a grand British stage voice: "Hark! Toilet, toilet, wherefore art thou toilet?" The friends stop, exchange baffled looks, one raises an eyebrow, and they step around him and keep walking without a word. He is left standing alone in the middle of the mall. He turns slightly away, presses a hand to his chest, and says to himself with tragic gravity: "To pee, or not to pee: that is the question." Handheld camera, natural mall lighting, deadpan comedic timing, photorealistic. Audio: mall ambience and footsteps, his two lines clearly audible in English. No text, no subtitles, no logos.`;
const jobs = [
  ["M1-mall-seedance", "bytedance/seedance-2.5/text-to-video", { prompt, duration: 12, resolution: "1080p", aspect_ratio: "9:16" }],
  ["M2-mall-kling4k", "kling-video/v3.0/4k/text-to-video", { prompt, duration: 12, aspect_ratio: "9:16" }],
];
await Promise.all(jobs.map(async ([name, slug, body]) => {
  const r = await fetch("https://api.higgsfield.ai/" + slug, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json(); console.log(name, "submit", r.status, j.status ?? JSON.stringify(j).slice(0, 200));
  if (!j.status_url) return;
  let st; for (let i = 0; i < 240; i++) { await new Promise(r => setTimeout(r, 10000)); st = await (await fetch(j.status_url, { headers: H })).json(); if (["completed","failed","nsfw","canceled"].includes(st.status)) break; }
  const url = st?.video?.url ?? st?.videos?.[0]?.url;
  console.log(name, st?.status, url ? "" : JSON.stringify(st).slice(0, 300));
  if (url) writeFileSync(`${name}.mp4`, Buffer.from(await (await fetch(url)).arrayBuffer()));
}));
