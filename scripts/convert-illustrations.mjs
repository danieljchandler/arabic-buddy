// Resizes/crops the generated PNGs in scripts/art/ into WebP under
// src/assets/illustrations/, using Chromium's canvas (no native image deps).
// Usage: node scripts/convert-illustrations.mjs
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ART = new URL("./art/", import.meta.url).pathname;
const OUT = new URL("../src/assets/illustrations/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// crop = fraction of the source kept (center crop); 1 = full frame.
const JOBS = [
  { name: "dialect-gulf", w: 1200, crop: 1, q: 0.8 },
  { name: "dialect-egyptian", w: 1200, crop: 1, q: 0.8 },
  { name: "dialect-yemeni", w: 1200, crop: 1, q: 0.8 },
  { name: "empty-caught-up", w: 640, crop: 0.82, q: 0.8 },
  { name: "empty-nothing", w: 640, crop: 0.82, q: 0.8 },
  { name: "value-voices", w: 480, crop: 0.84, q: 0.8 },
  { name: "value-memory", w: 480, crop: 0.84, q: 0.8 },
  { name: "value-media", w: 480, crop: 0.8, q: 0.8 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const job of JOBS) {
  const b64 = readFileSync(`${ART}${job.name}.png`).toString("base64");
  const dataUrl = await page.evaluate(
    async ({ b64, w, crop, q }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = `data:image/png;base64,${b64}`;
      });
      const sw = img.width * crop;
      const sh = img.height * crop;
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) / 2;
      const h = Math.round((w * sh) / sw);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      return canvas.toDataURL("image/webp", q);
    },
    { b64, w: job.w, crop: job.crop, q: job.q },
  );
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  writeFileSync(`${OUT}${job.name}.webp`, bytes);
  console.log(`${job.name}.webp ${Math.round(bytes.length / 1024)} KB`);
}
await browser.close();
