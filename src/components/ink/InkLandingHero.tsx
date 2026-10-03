import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/design-system";
import { HikayaInkMark } from "@/components/brand/HikayaInkMark";
import { SaduDiamond } from "@/components/brand/SaduDiamond";
import { InkWaveform } from "./InkWaveform";

/**
 * The signed-out landing hero in the Ink direction (`?brand=ink`).
 *
 * The default hero opens on a painted campfire. Ink has no pictures, so this
 * one is set like the front of a magazine, after the Ink-Landing artboard:
 * the promise as the headline, "spoken" under a mustard highlighter, the name
 * itself — حِكَايَة, a story — breaking out of an oxblood panel, the three
 * reasons as a numbered row, and the three dialects as type on an ink band.
 *
 * Everything a visitor can *do* is the default hero's, unchanged: the same
 * two CTAs with the same words and destinations (/auth, /placement), and the
 * closing "Join the beta" — e2e and the smoke test find them by that text.
 * The copy is the default hero's too; only the setting changed.
 *
 * No audio player, though the artboard drew one: a play button that plays
 * nothing would be a lie on the page a stranger judges the product by.
 */

/**
 * The name as display type for the letter panel — the artboard's signature,
 * not the logo (the logo is HikayaInkMark's outlined artwork and is never
 * retyped). Vowelled like the mark: a kasra under ح, never a fatha.
 */
const HIKAYA_DISPLAY = "حِكَـــايَة";

const VALUES = [
  {
    title: "Told by native voices",
    body: "Every word and sentence recorded by native speakers from the Gulf, Egypt and Yemen — so what you learn is what you'll actually hear.",
  },
  {
    title: "Every story stays with you",
    body: "Words come back exactly when you're about to forget them. Built on FSRS, the modern successor to SM-2.",
  },
  {
    title: "Stories you'd actually watch",
    body: "TikToks, news clips, stories and conversations — tap any word to learn and save it.",
  },
] as const;

const DIALECTS = [
  { name: "Gulf", initial: "خ", display: "خليـــجي", line: "The unhurried cadence of the majlis." },
  { name: "Egyptian", initial: "م", display: "مصـــري", line: "Quick, warm, theatrical — the dialect of cinema." },
  { name: "Yemeni", initial: "ي", display: "يمـــني", line: "Mountain Arabic — old vowels, deep hospitality." },
] as const;

/** Each value's motif: a voice, a spacing that widens (recall), a highlighted word. */
function ValueMotif({ index }: { index: number }) {
  if (index === 0) return <InkWaveform className="h-7 w-28 text-foreground" />;
  if (index === 1) {
    // Reviews drift further apart as a word sticks — the spacing is the point.
    return (
      <span aria-hidden="true" className="pointer-events-none flex h-7 items-end">
        {[0, 3, 6, 11, 18, 28].map((gap, i) => (
          <i key={i} className="block h-6 w-[3px] bg-foreground" style={{ marginLeft: gap }} />
        ))}
        <i className="ml-[42px] block h-7 w-[3px] bg-primary" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none relative flex h-7 items-center">
      <span className="absolute inset-y-0 left-8 w-9 bg-[#E2B65C]" />
      <InkWaveform bars={[30, 55, 80, 45, 100, 70, 40, 85, 60, 35, 65, 90, 50, 30]} className="relative h-7 text-foreground" />
    </span>
  );
}

export function InkLandingHero() {
  const navigate = useNavigate();

  return (
    <section className="pb-6 pt-2" data-ink-landing="">
      {/* Masthead */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-foreground pb-3">
        <HikayaInkMark wordmark size={88} />
        <span className="ink-meta text-muted-foreground">Est 2026</span>
      </div>

      {/* Hero: the promise, and the name breaking its panel */}
      <div className="grid gap-8 pt-6 lg:grid-cols-[1.35fr_1fr] lg:gap-10">
        <div className="flex flex-col gap-6">
          <div className="ink-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span>Hikaya</span>
            <SaduDiamond size={6} solid className="text-primary" />
            <span>Dialect-first</span>
            <SaduDiamond size={6} solid className="text-primary" />
            <span>Native audio</span>
          </div>
          <div>
            {/* The spaces before each <br> are load-bearing: without them the
                heading's accessible name runs "spokenArabic" together. */}
            <h1 className="font-ink-serif text-[clamp(2.75rem,8.6vw,5.25rem)] leading-[1.04] tracking-[-0.01em] text-foreground lg:text-[4.25rem]">
              Real{" "}
              <span className="box-decoration-clone bg-[#E2B65C] px-[0.08em] text-[#1A1C17]">spoken</span>{" "}
              <br className="hidden sm:block" />
              Arabic, one <br className="hidden sm:block" />
              story at a time.
            </h1>
            <p className="font-ink-serif mt-4 text-2xl leading-tight text-muted-foreground">
              Gulf · Egyptian · Yemeni.
            </p>
            <p className="mt-3 max-w-[33rem] text-base leading-relaxed text-foreground">
              Hikaya means{" "}
              <span lang="ar" dir="rtl" className="font-ink-display text-[1.3em] leading-none text-primary">
                حكاية
              </span>{" "}
              — a story. Dialect-first lessons, native audio, and spaced-repetition flashcards built from
              the stories people actually tell.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="h-12 rounded-[4px] px-6 text-base" onClick={() => navigate("/auth")}>
              Join the beta — it&rsquo;s free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-12 rounded-[4px] border-foreground px-6 text-base"
              onClick={() => navigate("/placement")}
            >
              Try the placement quiz
            </Button>
          </div>
        </div>

        <div className="flex flex-col">
          <div
            data-ink-sadu=""
            className="relative h-[220px] rounded-t-[4px] bg-[#6B1F1F] text-[#EFE6CF] sm:h-[300px]"
          >
            <div className="ink-meta absolute inset-x-5 top-4 flex justify-between text-[#D5BEAC]">
              <span>Episode 01 · Gulf</span>
              <span>Est 2026</span>
            </div>
            <span
              aria-hidden="true"
              lang="ar"
              dir="rtl"
              className="font-ink-display pointer-events-none absolute right-5 top-[calc(100%-0.95em)] z-10 whitespace-nowrap text-[clamp(4.5rem,20vw,7.5rem)] text-[#E2B65C]"
            >
              {HIKAYA_DISPLAY}
            </span>
          </div>
          <div className="flex flex-col gap-3 rounded-b-[4px] bg-[#1A1C17] px-5 pb-5 pt-16 text-[#EFE6CF]">
            <div className="ink-meta flex justify-between text-[#B3A99C]">
              <span>Spoken, never MSA</span>
              <span>Native voice</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-ink-serif text-[34px] leading-none text-[#E2B65C]">01</span>
              <span lang="ar" dir="rtl" className="font-cairo text-[28px] font-bold leading-snug">
                شلونك؟
              </span>
              <span className="text-[15px] text-[#B3A99C]">shlōnak? — how are you? · Gulf</span>
            </div>
            <InkWaveform className="h-10 w-full justify-between text-[#EFE6CF]" barWidth={2} gap={0} />
          </div>
        </div>
      </div>

      {/* Why: the three value points as a numbered editorial row */}
      <div className="pt-14">
        <div className="ink-meta flex justify-between text-muted-foreground">
          <span>02 — Why Hikaya</span>
          <span>Hikaya · Est 2026</span>
        </div>
        <ol className="mt-6 grid gap-8 sm:grid-cols-3 sm:gap-10">
          {VALUES.map((v, i) => (
            <li key={v.title} className="border-t border-foreground pt-4">
              <div className="flex items-end justify-between gap-3">
                <span aria-hidden="true" className="font-ink-serif text-[56px] leading-none text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <ValueMotif index={i} />
              </div>
              <h2 className="font-ink-serif mt-4 text-[26px] leading-[1.15] text-foreground">{v.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{v.body}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* The three dialects, as type on an ink band */}
      <div data-ink-sadu="" className="mt-14 rounded-[4px] bg-[#1A1C17] px-5 pb-8 pt-6 text-[#EFE6CF] sm:px-8">
        <div className="ink-meta flex flex-wrap justify-between gap-2 text-[#B3A99C]">
          <span>03 — Dialects · spoken, never MSA</span>
          <span>Gulf · Egyptian · Yemeni</span>
        </div>
        <h2 className="font-ink-serif mt-4 text-[28px] leading-tight text-[#EFE6CF]">
          Three dialects, three worlds
        </h2>
        <ul className="mt-5 grid gap-6 sm:grid-cols-3 sm:gap-8">
          {DIALECTS.map((d, i) => (
            <li key={d.name} className="flex flex-col border-t border-[#EFE6CF]/20 pt-4">
              <div className="flex items-center justify-between">
                <span
                  aria-hidden="true"
                  lang="ar"
                  className={
                    i === 0
                      ? "grid h-11 w-11 place-items-center rounded-full bg-[#E2B65C] text-xl font-bold text-[#1A1C17]"
                      : "grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-[#EFE6CF] text-xl font-bold"
                  }
                >
                  {d.initial}
                </span>
                <span className="ink-meta text-[#B3A99C]">0{i + 1} / 03</span>
              </div>
              <span
                aria-hidden="true"
                lang="ar"
                dir="rtl"
                className="font-ink-display mt-8 whitespace-nowrap text-right text-[clamp(3rem,13vw,4rem)] leading-[1.25]"
              >
                {d.display}
              </span>
              <span className="font-ink-serif text-[26px] leading-tight">{d.name}</span>
              <p className="mt-1 text-sm leading-relaxed text-[#B3A99C]">{d.line}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-[#B3A99C]">
          Real spoken Arabic, never textbook{" "}
          <span lang="ar" dir="rtl" className="font-cairo">
            فصحى
          </span>
          . Coming from MSA? We bridge it into spoken dialect for you.
        </p>
      </div>

      {/* Closing CTA */}
      <div className="mx-auto max-w-md pt-14 text-center">
        <SaduDiamond size={12} className="mx-auto text-primary" />
        <p lang="ar" dir="rtl" className="font-ink-display mt-2 text-[40px] text-foreground">
          كل حكاية تبدأ بكلمة
        </p>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          Every story starts with one word. Start yours today.
        </p>
        <Button size="lg" onClick={() => navigate("/auth")} className="rounded-[4px] px-8">
          Join the beta — it&rsquo;s free
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
