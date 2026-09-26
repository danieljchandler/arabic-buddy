import sys
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[1], device="cpu", compute_type="int8")
for f in sys.argv[2:]:
    segs, info = m.transcribe(f, word_timestamps=False, vad_filter=True)
    segs = list(segs)
    print(f"== {f}  lang={info.language} p={info.language_probability:.2f}")
    for s in segs: print(f"  {s.start:5.2f}-{s.end:5.2f} {s.text.strip()}")
    if not segs: print("  (no speech)")
