"""Turn generated photos of a dance into collage stickers for a celebration scene.

    pip install "rembg[cpu]" pillow numpy scipy
    python scripts/celebrations/make_cutouts.py dancer out/ pose1.png pose2.png ...
    python scripts/celebrations/make_cutouts.py drummer out/ drum1.png drum2.png

Each photo gets a union matte (a person model for the body, a general model
for whatever is held, such as a sword or a drum), a grayscale finish, and the
rough paper edge of the collage look. All stills of one figure share one crop
and scale, so swapping poses keeps the camera still. docs/celebrations.md has
the whole recipe, including how to generate the photos.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps
from rembg import new_session, remove
from scipy import ndimage as ndi

HEIGHTS = {"dancer": 720, "drummer": 640}
_sessions = {}


def session(name):
    if name not in _sessions:
        _sessions[name] = new_session(name)
    return _sessions[name]


def matte(im):
    # A white thobe on a pale backdrop defeats either model alone: the person
    # model keeps the robe, the general one keeps the blade.
    person = remove(im, session=session("u2net_human_seg"), post_process_mask=True).getchannel("A")
    general = remove(im, session=session("isnet-general-use"), post_process_mask=True).getchannel("A")
    a = np.array(ImageChops.lighter(person, general)) > 110
    # Thin silver blades still drop out in places. They are lighter than the
    # flat grey backdrop, so key them back in, but only above the knees: the
    # floor brightens toward the bottom and would otherwise come in too. Then
    # keep only pieces big enough to be part of a figure.
    rgb = np.asarray(im).astype(float)
    border = np.concatenate([rgb[:20].reshape(-1, 3), rgb[:, :20].reshape(-1, 3), rgb[:, -20:].reshape(-1, 3)])
    key = (rgb.mean(2) - np.median(border, axis=0).mean()) > 22
    rows = np.where(a.any(1))[0]
    if len(rows):
        key[int(rows.min() + (rows.max() - rows.min()) * 0.62):] = False
    key = ndi.binary_opening(key, iterations=1)
    a = a | key
    # Backdrop the models kept because it is boxed in: between a cane and a
    # robe, or in the gap between two men standing shoulder to shoulder. It is
    # the backdrop's own flat grey, so take out any large patch of it (small
    # ones can be a grey beard or a fold).
    bg = np.median(border, axis=0)
    flat = (np.abs(rgb - bg).max(2) < 14) & (rgb.max(2) - rgb.min(2) < 10) & a
    lab, _ = ndi.label(flat)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    a &= ~(sizes[lab] >= 1500)
    lab, _ = ndi.label(a)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    return Image.fromarray(((sizes[lab] >= 2000) * 255).astype("uint8"))


def rough_edge(alpha, width, seed):
    # Keep the edge thin (about 5 px at 1,000 px tall): a wide one turns a
    # sword blade into a paddle.
    grown = alpha.filter(ImageFilter.MaxFilter(width * 2 + 1))
    w, h = alpha.size
    rng = np.random.default_rng(seed)
    noise = Image.fromarray((rng.random((h // 24 + 2, w // 24 + 2)) * 255).astype("uint8")).resize((w, h), Image.BICUBIC)
    g = np.array(grown.filter(ImageFilter.GaussianBlur(width * 0.6))).astype(float)
    n = (np.array(noise).astype(float) - 128) * 0.9
    # Calm the tear along anything thin (a cane, a blade): at full strength it
    # swells and pinches the edge until a cane reads as a string of beads.
    thick = ndi.maximum_filter(ndi.distance_transform_edt(np.array(alpha) > 0), size=width * 4 + 1)
    n *= np.clip(thick / 12, 0.2, 1)
    return Image.fromarray(np.clip((g + n - 128) * 6, 0, 255).astype("uint8"))


def grayscale(im):
    g = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=1)
    g = g.point(lambda v: int(255 * (v / 255) ** 1.15))
    return g.filter(ImageFilter.UnsharpMask(radius=2, percent=90, threshold=2)).convert("RGB")


def sticker(path, seed):
    im = Image.open(path).convert("RGB")
    alpha = matte(im)
    edge = rough_edge(alpha, 5, seed)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    paper = Image.new("RGBA", im.size, (251, 248, 240, 255))
    paper.putalpha(edge)
    out = Image.alpha_composite(out, paper)
    body = grayscale(im).convert("RGBA")
    body.putalpha(alpha)
    return Image.alpha_composite(out, body)


def main(kind, out_dir, paths):
    stickers = [sticker(p, seed=i + 1) for i, p in enumerate(paths)]
    boxes = [s.getbbox() for s in stickers]
    w, h = stickers[0].size
    box = (
        max(0, min(b[0] for b in boxes) - 6),
        max(0, min(b[1] for b in boxes) - 6),
        min(w, max(b[2] for b in boxes) + 6),
        min(h, max(b[3] for b in boxes) + 6),
    )
    height = HEIGHTS[kind]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(stickers):
        c = s.crop(box)
        c = c.resize((round(c.width * height / c.height), height), Image.LANCZOS)
        c.save(out / f"{kind}-{i + 1}.webp", quality=80, method=6)
    print(f"{len(stickers)} {kind} stills, {c.width}x{c.height}, in {out}")


if __name__ == "__main__":
    if len(sys.argv) < 4 or sys.argv[1] not in HEIGHTS:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
