import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleSentences } from "./ArticleSentences";

/**
 * The body of a Souq News article, one sentence to a card.
 *
 * News is the hardest thing a learner reads, so the article is broken up rather
 * than presented as a block: one line at a time, the English hidden behind a
 * tap so the eye cannot cheat, and every word tappable for a gloss. When the
 * generator returns per-sentence pairs the split is authored; when it does not,
 * the component falls back to splitting the Arabic on punctuation, which gives
 * the same shape with no translations to reveal.
 *
 * The three children are covered by their own files and stood in for here, so
 * what stays visible is the splitting, the reveal state, and — the part that
 * matters most — what English each line claims to mean.
 */

interface TappableProps {
  text: string;
  vocabulary: { word_arabic: string; word_english: string }[];
  source: string;
  sentenceContext: { arabic: string; english: string };
}
interface AskProps {
  arabic: string;
  english: string;
  variant: string;
}
interface PairProps {
  variant: string;
  literal?: string;
  natural: string;
}

const spies = vi.hoisted(() => ({
  tappable: [] as TappableProps[],
  ask: [] as AskProps[],
  pair: [] as PairProps[],
}));

vi.mock("@/components/shared/TappableArabicText", () => ({
  TappableArabicText: (props: TappableProps) => {
    spies.tappable.push(props);
    return <p data-testid="arabic">{props.text}</p>;
  },
}));
vi.mock("@/components/shared/AskAISentence", () => ({
  AskAISentence: (props: AskProps) => {
    spies.ask.push(props);
    return <button data-testid="ask">Ask AI</button>;
  },
}));
vi.mock("@/components/shared/TranslationPair", () => ({
  TranslationPair: (props: PairProps) => {
    spies.pair.push(props);
    return <p data-testid="pair">{props.natural}</p>;
  },
}));

beforeEach(() => {
  spies.tappable = [];
  spies.ask = [];
  spies.pair = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

const SUMMARY = "Qatar announced a new rail link on Tuesday.";
const BODY = "أعلنت قطر عن خط سكة حديد جديد. بدأ العمل أمس. ينتهي في ٢٠٣٠؟ نعم!";

interface Options {
  bodyDialect?: string;
  summaryEnglish?: string;
  sentences?: {
    arabic: string;
    transliteration?: string;
    english: string;
    literal?: string;
  }[];
  vocabulary?: { word_arabic: string; word_english: string }[];
}

function renderArticle({
  bodyDialect = BODY,
  summaryEnglish = SUMMARY,
  sentences,
  vocabulary,
}: Options = {}) {
  return render(
    <ArticleSentences
      bodyDialect={bodyDialect}
      summaryEnglish={summaryEnglish}
      sentences={sentences}
      vocabulary={vocabulary}
    />,
  );
}

const authored = [
  { arabic: "أعلنت قطر عن خط سكة حديد جديد.", english: "Qatar announced a new rail link." },
  { arabic: "بدأ العمل أمس.", english: "Work began yesterday." },
];

describe("ArticleSentences — splitting the article up", () => {
  it("uses the authored sentences when the generator supplied them", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByTestId("arabic").map((el) => el.textContent)).toEqual([
      authored[0].arabic,
      authored[1].arabic,
    ]);
  });

  it("falls back to splitting the body on sentence endings", () => {
    renderArticle();
    expect(screen.getAllByTestId("arabic")).toHaveLength(4);
  });

  it("recognises the Arabic question mark as an ending", () => {
    // ؟ is a different code point from ?, and an Arabic article uses it — a
    // splitter that only knew the Latin one would run two sentences together.
    renderArticle({ bodyDialect: "سؤال؟ جواب." });
    expect(screen.getAllByTestId("arabic").map((el) => el.textContent)).toEqual([
      "سؤال؟",
      "جواب.",
    ]);
  });

  it("splits on line breaks as well as punctuation", () => {
    renderArticle({ bodyDialect: "سطر أول\nسطر ثاني" });
    expect(screen.getAllByTestId("arabic")).toHaveLength(2);
  });

  it("keeps a body with no punctuation as one line", () => {
    renderArticle({ bodyDialect: "جملة بدون علامات" });
    expect(screen.getAllByTestId("arabic")).toHaveLength(1);
  });

  it("drops the empty pieces a trailing full stop leaves behind", () => {
    renderArticle({ bodyDialect: "جملة." });
    expect(screen.getAllByTestId("arabic")).toHaveLength(1);
  });

  it("renders nothing but the hint for an empty body", () => {
    renderArticle({ bodyDialect: "" });
    expect(screen.queryAllByTestId("arabic")).toEqual([]);
    expect(screen.getByText(/Tap any word for translation/)).toBeInTheDocument();
  });

  it("prefers even a single authored sentence over the splitter", () => {
    renderArticle({ sentences: [authored[0]] });
    expect(screen.getAllByTestId("arabic")).toHaveLength(1);
  });

  it("falls back when the generator returned an empty list", () => {
    renderArticle({ sentences: [] });
    expect(screen.getAllByTestId("arabic")).toHaveLength(4);
  });
});

describe("ArticleSentences — revealing the English", () => {
  it("starts with every translation hidden", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByText("Reveal translation")).toHaveLength(2);
  });

  it("reveals one line without revealing the rest", () => {
    // The whole point is reading line by line; revealing all of them would be
    // the article with a translation under it, which is not practice.
    renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("Reveal translation")[0]);

    expect(screen.getByText("Hide translation")).toBeInTheDocument();
    expect(screen.getAllByText("Reveal translation")).toHaveLength(1);
  });

  it("hides it again on a second tap", () => {
    renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("Reveal translation")[0]);
    fireEvent.click(screen.getByText("Hide translation"));
    expect(screen.getAllByText("Reveal translation")).toHaveLength(2);
  });

  it("offers no reveal on a line the generator could not translate", () => {
    // The fallback splitter produces lines with no English at all, and a
    // control that reveals nothing is worse than no control.
    renderArticle();
    expect(screen.queryByText("Reveal translation")).not.toBeInTheDocument();
  });

  it("passes the literal gloss to the translation pair", () => {
    renderArticle({
      sentences: [{ ...authored[0], literal: "announced Qatar about line rail iron new" }],
    });
    expect(spies.pair[0]).toMatchObject({
      variant: "compact",
      literal: "announced Qatar about line rail iron new",
      natural: authored[0].english,
    });
  });

  /**
   * FINDING — the revealed lines carry over to the next article.
   *
   * `revealed` is a set of indices with no dependency on the content, so when
   * the parent swaps `sentences` for another article the same positions stay
   * open. A reader who revealed line 2 of one story opens the next one with
   * line 2 of that story already translated — which for the sentence-by-sentence
   * exercise is exactly the thing it is trying to prevent.
   */
  it("keeps line two open when the article changes underneath it", () => {
    const { rerender } = renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("Reveal translation")[1]);
    expect(screen.getByText("Hide translation")).toBeInTheDocument();

    rerender(
      <ArticleSentences
        bodyDialect={BODY}
        summaryEnglish={SUMMARY}
        sentences={[
          { arabic: "خبر جديد أول.", english: "A different first line." },
          { arabic: "خبر جديد ثاني.", english: "A different second line." },
        ]}
      />,
    );
    expect(screen.getByText("Hide translation")).toBeInTheDocument();
  });
});

describe("ArticleSentences — the word gloss", () => {
  it("makes every line tappable", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable).toHaveLength(2);
  });

  it("tags the lookups as coming from the news reader", () => {
    // The source is what lets a saved word be traced back to where it was met,
    // which is most of the value of saving it.
    renderArticle({ sentences: authored });
    expect(spies.tappable[0].source).toBe("souq-news");
  });

  it("hands the article's own glossary down so known words resolve locally", () => {
    const vocabulary = [{ word_arabic: "قطر", word_english: "Qatar" }];
    renderArticle({ sentences: authored, vocabulary });
    expect(spies.tappable[0].vocabulary).toEqual(vocabulary);
  });

  it("copes with an article that has no glossary", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable[0].vocabulary).toEqual([]);
  });

  it("gives each word its own sentence for context", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable[1].sentenceContext).toEqual({
      arabic: authored[1].arabic,
      english: authored[1].english,
    });
  });

  it("shows the transliteration when the generator provided one", () => {
    renderArticle({
      sentences: [{ ...authored[0], transliteration: "a'lanat qatar 'an khatt sikka hadid jadid" }],
    });
    expect(screen.getByText("a'lanat qatar 'an khatt sikka hadid jadid")).toBeInTheDocument();
  });

  it("leaves it out when there is none", () => {
    const { container } = renderArticle({ sentences: authored });
    expect(container.querySelector(".italic")).toBeNull();
  });
});

describe("ArticleSentences — asking the AI about a line", () => {
  it("puts the chip on every line", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByTestId("ask")).toHaveLength(2);
  });

  it("asks about the line, in its compact form", () => {
    renderArticle({ sentences: authored });
    expect(spies.ask[0]).toMatchObject({
      arabic: authored[0].arabic,
      english: authored[0].english,
      variant: "chip",
    });
  });

  /**
   * FINDING — an untranslated line is described to the AI as the whole article.
   *
   * Both the AI chip and the word-gloss context fall back to
   * `line.english || summaryEnglish`. On the authored path that never fires;
   * on the fallback path every line has an empty English, so every one of them
   * is sent up paired with the article's entire summary. The model is told that
   * a four-word sentence means a paragraph, and so is the word-lookup that
   * produces the gloss a learner then saves — which is how a wrong definition
   * ends up in someone's deck.
   */
  it("pairs a split line with the whole article summary", () => {
    renderArticle();
    expect(spies.ask[0]).toMatchObject({
      arabic: "أعلنت قطر عن خط سكة حديد جديد.",
      english: SUMMARY,
    });
    expect(spies.tappable[0].sentenceContext.english).toBe(SUMMARY);
  });
});
