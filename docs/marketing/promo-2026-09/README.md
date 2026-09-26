# Promo rough cut, September 2026

How the rough cut of the 60-second video (`../2026-09-26-one-minute-video.md`) was made. The mp4s are not committed; regenerate them with these files.

- `final.mjs` generates the three live-action shots through the Higgsfield HTTP API.
  - It needs `HF_CREDENTIALS=id:secret` in the environment and the two approved stills beside it: `01h-airport-cairo.png` and `02b-friends-msa-book.png`.
  - Each shot runs on both Seedance 2.5 at 1080p and Kling 3.0 at 4K.
  - Chosen: airport from Seedance; dinner and campfire from Kling.
- `assemble.sh AIRPORT.mp4 DINNER.mp4 CAMPFIRE.mp4 OUT.mp4` builds the 60 s cut at 1080x1920, 24 fps.
  - The middle 42 s are sand placeholder cards where the app screen recordings go.
  - `cut.ass` supplies the captions, the on-screen text and the end card.
  - The end card overlays `src/assets/hakiya-lockup.webp` (convert it to `lockup.png` first).
  - It needs Montserrat and Noto Naskh Arabic TTFs in `fonts/`, from Google Fonts.
  - ffmpeg must be built with libass.
- The generated clips have their own AI audio, mixed at 60%. There is no voiceover yet.
