// Turns a painted-on-paper illustration into a transparent-background WebP.
//
// The two shores (src/assets/illustrations/shore-*.webp) have to sit on a page
// rather than in a rectangle of their own, so the cream paper they were painted
// on has to go. Nothing here is generic background removal: these sources are flat, near-uniform paper with the subject painted
// on top, so a difference key against the paper colour is both simpler and
// kinder to watercolour than a segmentation model — a soft wash at 8% opacity
// survives as an 8%-alpha pixel instead of being decided in or out.
//
// Like scripts/convert-illustrations.mjs, it borrows Chromium's canvas rather
// than pulling in a native image dependency.
//
// Usage: node scripts/cutout-art.mjs <in.png> <out.webp> [maxWidth] [cropTop]
//
// cropTop discards that fraction of the source from the top before keying. It
// is for the thing these models do when told to leave a frame empty: they leave
// it *nearly* empty, and paint a faint mirage of the subject up in the void. A
// difference key is faithful, so the mirage survives at 20% alpha and floats
// over whatever the art is placed near. Cropping it off is the honest fix —
// raising the key threshold enough to kill it also eats the real washes.
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , inPath, outPath, maxWidthArg, cropTopArg] = process.argv;
if (!inPath || !outPath) {
  throw new Error("usage: node scripts/cutout-art.mjs <in.png> <out.webp> [maxWidth] [cropTop]");
}
const maxWidth = Number(maxWidthArg ?? 1600);
const cropTop = Number(cropTopArg ?? 0);

const browser = await chromium.launch();
const page = await browser.newPage();
const b64 = readFileSync(inPath).toString("base64");

const dataUrl = await page.evaluate(
  async ({ b64, maxWidth, cropTop }) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/png;base64,${b64}`;
    });

    const top = Math.round(img.height * cropTop);
    const src = document.createElement("canvas");
    src.width = img.width;
    src.height = img.height - top;
    const sctx = src.getContext("2d");
    sctx.drawImage(img, 0, -top);
    const data = sctx.getImageData(0, 0, src.width, src.height);
    const px = data.data;

    // The paper colour, read from the four corners rather than assumed: these
    // are generated images and the exact cream drifts from run to run.
    const corners = [
      [4, 4],
      [src.width - 5, 4],
      [4, src.height - 5],
      [src.width - 5, src.height - 5],
    ].map(([x, y]) => {
      const i = (y * src.width + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    });
    const paper = [0, 1, 2].map(
      (c) => corners.reduce((sum, p) => sum + p[c], 0) / corners.length,
    );

    // Distance below which a pixel is paper, and above which it is paint. The
    // gap between them is the feather: without one, a hard cut leaves a
    // cream-coloured fringe wherever a wash meets the paper, which reads as a
    // halo the moment the art sits on a different-coloured background.
    const NEAR = 8;
    const FAR = 30;

    let minX = src.width;
    let minY = src.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const d = Math.hypot(px[i] - paper[0], px[i + 1] - paper[1], px[i + 2] - paper[2]);
        const a = d <= NEAR ? 0 : d >= FAR ? 1 : (d - NEAR) / (FAR - NEAR);
        px[i + 3] = Math.round(a * 255);
        // Bounding box of anything that survived at all faintly. Pixels under
        // ~4% alpha are the paper's own grain, not art, and including them
        // would make the box the whole frame again.
        if (a > 0.04) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error("cutout is empty — is the source all paper?");
    sctx.putImageData(data, 0, 0);

    // Crop to the art. The component anchors these to the bottom corners of
    // the hero, so a transparent margin baked into the file would push the
    // shore off its corner by however much margin the model happened to leave.
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const w = Math.min(maxWidth, cw);
    const h = Math.round((w * ch) / cw);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(src, minX, minY, cw, ch, 0, 0, w, h);
    return out.toDataURL("image/webp", 0.86);
  },
  { b64, maxWidth, cropTop },
);

await browser.close();
mkdirSync(dirname(outPath), { recursive: true });
const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
writeFileSync(outPath, bytes);
console.log(`${outPath} — ${(bytes.length / 1024).toFixed(0)} kB`);
