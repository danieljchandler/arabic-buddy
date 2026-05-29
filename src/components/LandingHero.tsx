import { useNavigate } from "react-router-dom";
import { ArrowRight, Headphones, Brain, PlayCircle, Globe2 } from "lucide-react";
import { Button } from "@/components/design-system";
import lahjaLogo from "@/assets/lahja-logo.png";

/**
 * Logged-out landing hero shown on `/` when the visitor isn't authenticated.
 * Goal: explain Lahja in one screen and push to /auth or /placement.
 */
export function LandingHero() {
  const navigate = useNavigate();

  return (
    <section className="py-6">
      {/* Logo */}
      <div className="flex justify-center mb-6">
        <img src={lahjaLogo} alt="Lahja" className="h-20" />
      </div>

      {/* Hero copy */}
      <div className="text-center max-w-xl mx-auto mb-8">
        <h1
          className="text-3xl sm:text-4xl font-bold text-[#5C3A46] mb-3 leading-tight"
          style={{ fontFamily: "'Montserrat', sans-serif" }}
        >
          Learn real spoken Arabic.
          <br />
          <span className="text-[#5C3A46]/70">Gulf · Egyptian · Yemeni.</span>
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          Not the textbook stuff. Dialect-first lessons, native audio, and
          spaced-repetition flashcards built around what people actually say.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-10">
        <Button
          className="flex-1 h-12 text-base"
          onClick={() => navigate("/auth")}
        >
          Get started — it's free
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

      {/* Value props */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto mb-6">
        <ValueCard
          icon={<Headphones className="h-5 w-5" />}
          title="Native dialect audio"
          body="Every word and sentence recorded by native speakers from the Gulf, Egypt and Yemen."
        />
        <ValueCard
          icon={<Brain className="h-5 w-5" />}
          title="Smart spaced repetition"
          body="Words come back exactly when you're about to forget them. Built on the SM-2 algorithm."
        />
        <ValueCard
          icon={<PlayCircle className="h-5 w-5" />}
          title="Real media, not phrasebooks"
          body="TikToks, news clips, stories and conversations — tap any word to learn and save it."
        />
      </div>

      {/* Secondary nudges */}
      <div className="text-center max-w-md mx-auto">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Globe2 className="h-3.5 w-3.5" />
          Coming from MSA? We bridge فصحى into spoken dialect for you.
        </p>
      </div>
    </section>
  );
}

function ValueCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="p-4 rounded-2xl bg-card border border-[#5C3A46]/15">
      <div className="h-9 w-9 rounded-xl bg-[#5C3A46]/10 flex items-center justify-center text-[#5C3A46] mb-2.5">
        {icon}
      </div>
      <h3 className="font-semibold text-foreground text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
