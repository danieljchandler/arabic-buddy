import { useNavigate } from "react-router-dom";
import { ArrowRight, Globe2 } from "lucide-react";
import { Button, CampfireMedallion } from "@/components/design-system";
import hakiyaLogoAsset from "@/assets/hakiya-logo.png";
import valueVoicesArt from "@/assets/illustrations/value-voices.webp";
import valueMemoryArt from "@/assets/illustrations/value-memory.webp";
import valueMediaArt from "@/assets/illustrations/value-media.webp";
import dialectGulfArt from "@/assets/illustrations/dialect-gulf.webp";
import dialectEgyptianArt from "@/assets/illustrations/dialect-egyptian.webp";
import dialectYemeniArt from "@/assets/illustrations/dialect-yemeni.webp";

const hakiyaLogo = hakiyaLogoAsset;

/**
 * Logged-out landing hero shown on `/` when the visitor isn't authenticated.
 * Goal: explain Hakiya in one screen and push to /auth or /placement.
 *
 * The framing is the name. Hakiya is حكاية — a story — so the page opens on
 * people telling one round a fire, and the three value cards run as a story
 * arc: who tells it, how it stays with you, what you get to hear next.
 *
 * The journey/caravan metaphor is not gone, just moved to where it earns its
 * keep: the placement quiz ("wherever you are in your journey") and the
 * Alphabet Journey's 28-stop caravan.
 */
export function LandingHero() {
  const navigate = useNavigate();

  return (
    <section className="py-6">
      {/* Logo */}
      <div className="flex justify-center mb-5">
        <img src={hakiyaLogo} alt="Hakiya" className="h-16 sm:h-20" />
      </div>

      {/* The fire: campfire clip + its one-line beat */}
      <div className="flex flex-col items-center mb-6">
        <CampfireMedallion className="max-w-[360px] sm:max-w-[480px]" />
        <p className="mt-3 text-caption text-muted-foreground text-center">
          <span className="font-arabic" dir="rtl">
            حكاية
          </span>{" "}
          — a story. Yours starts with one word.
        </p>
      </div>

      {/* Hero copy */}
      <div className="text-center max-w-xl mx-auto mb-8">
        {/*
          The line breaks are deliberate: left to wrap on its own the headline
          splits after "one", and the dialect line strands "Yemeni." on a line
          of its own at 375px. The dialect names step down a size — they qualify
          the promise above rather than share its weight.
        */}
        <h1 className="text-t-headline sm:text-t-display text-desert-red mb-3 text-balance">
          Real spoken Arabic,
          <br />
          one story at a time.
          <span className="block mt-1 text-t-subtitle sm:text-t-title text-desert-red/70">
            Gulf · Egyptian · Yemeni.
          </span>
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          Hakiya means{" "}
          <span className="font-arabic" dir="rtl">
            حكاية
          </span>{" "}
          — a story. Dialect-first lessons, native audio, and spaced-repetition
          flashcards built from the stories people actually tell.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-10">
        <Button
          className="flex-1 h-12 text-base"
          onClick={() => navigate("/auth")}
        >
          Join the beta — it&rsquo;s free
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-12 text-base"
          onClick={() => navigate("/placement")}
        >
          Try the placement quiz
        </Button>
      </div>

      {/* Value props — who tells the story, how it sticks, what you hear next */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto mb-6">
        <ValueCard
          image={valueVoicesArt}
          title="Told by native voices"
          body="Every word and sentence recorded by native speakers from the Gulf, Egypt and Yemen — so what you learn is what you'll actually hear."
        />
        <ValueCard
          image={valueMemoryArt}
          title="Every story stays with you"
          body="Words come back exactly when you're about to forget them. Built on FSRS, the modern successor to SM-2."
        />
        <ValueCard
          image={valueMediaArt}
          title="Stories you'd actually watch"
          body="TikToks, news clips, stories and conversations — tap any word to learn and save it."
        />
      </div>

      {/* Below the fold: the three worlds a learner is choosing between.
          The same painted scenes the dialect picker uses, so the promise made
          here is literally the interface they meet inside. */}
      <div className="max-w-3xl mx-auto mb-10">
        <h2 className="font-heading text-xl font-bold text-foreground text-center mb-1.5">
          Three dialects, three worlds
        </h2>
        <p className="text-sm text-muted-foreground text-center max-w-md mx-auto mb-5">
          Pick one to start — a Gulf majlis, a Cairo ahwa, or an Old Sana&rsquo;a
          rooftop. Real spoken Arabic, never textbook فصحى.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DialectCard image={dialectGulfArt} name="Gulf" nameAr="خليجي" line="The unhurried cadence of the majlis." />
          <DialectCard image={dialectEgyptianArt} name="Egyptian" nameAr="مصري" line="Quick, warm, theatrical — the dialect of cinema." />
          <DialectCard image={dialectYemeniArt} name="Yemeni" nameAr="يمني" line="Mountain Arabic — old vowels, deep hospitality." />
        </div>
      </div>

      {/* Closing CTA — the page used to just stop after the value cards. */}
      <div className="text-center max-w-md mx-auto mb-8">
        <p className="font-arabic text-lg text-foreground mb-3" dir="rtl">
          كل حكاية تبدأ بكلمة
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Every story starts with one word. Start yours today.
        </p>
        <Button size="lg" onClick={() => navigate("/auth")} className="px-8">
          Join the beta — it&rsquo;s free
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      {/* Secondary nudges */}
      <div className="text-center max-w-md mx-auto">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Globe2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            Coming from MSA? We bridge{" "}
            <span className="font-arabic" dir="rtl">
              فصحى
            </span>{" "}
            into spoken dialect for you.
          </span>
        </p>
      </div>
    </section>
  );
}

function DialectCard({
  image,
  name,
  nameAr,
  line,
}: {
  image: string;
  name: string;
  nameAr: string;
  line: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card border border-desert-red/15">
      <img
        src={image}
        alt={`${name} Arabic illustration`}
        loading="lazy"
        draggable={false}
        className="aspect-[5/3] w-full object-cover select-none"
      />
      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-foreground text-sm">{name}</span>
          <span className="font-arabic text-sm text-muted-foreground" dir="rtl">{nameAr}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{line}</p>
      </div>
    </div>
  );
}

function ValueCard({
  image,
  title,
  body,
}: {
  /** Painted vignette (see assets/illustrations) — replaces the old lucide icon. */
  image: string;
  title: string;
  body: string;
}) {
  return (
    <div className="p-4 rounded-2xl bg-card border border-desert-red/15">
      <img
        src={image}
        alt=""
        aria-hidden
        loading="lazy"
        draggable={false}
        className="h-14 w-14 rounded-xl object-cover mb-2.5 ring-1 ring-desert-red/15 select-none"
      />
      <h3 className="font-semibold text-foreground text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
