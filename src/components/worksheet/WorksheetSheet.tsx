import {
  answerKeyFor,
  optionLetter,
  type WorksheetSection,
  type WorksheetSpec,
} from "../../../supabase/functions/_shared/worksheetCore";
import "./worksheet.css";

/**
 * One printable worksheet: the fixed component set from worksheetCore, laid
 * out for A4, with the answer key on its own page.
 *
 * Every Arabic block carries `dir="rtl"` and `lang="ar"` on the element that
 * holds the text, not on a wrapper, so the bidi algorithm sees a right-to-left
 * paragraph and Western digits inside it ("الساعة 11") stay in reading order.
 * Numbers that label items are boxes, not "1." list markers, because a
 * marker's full stop lands on the wrong side of a right-to-left line.
 */

const SECTION_TITLES: Record<WorksheetSection["kind"], string> = {
  matching: "Match",
  cloze: "Fill the gaps",
  dialogue: "Complete the conversation",
  spot_the_fusha: "Spot the Fusha",
  writing: "Write",
};

const ARABIC = /[\u0600-\u06FF]/;

/** Speaker labels in the dialogue: أ and ب rather than A and B inside Arabic lines. */
const SPEAKER: Record<"A" | "B", string> = { A: "أ", B: "ب" };

function Num({ n }: { n: number | string }) {
  return (
    <span className="ws-num">
      <bdi>{n}</bdi>
    </span>
  );
}

const Blank = () => <span className="ws-blank" aria-label="blank" />;

function Matching({ section }: { section: Extract<WorksheetSection, { kind: "matching" }> }) {
  return (
    <div className="ws-match" dir="rtl">
      <div className="ws-match-ar">
        {section.pairs.map((pair, i) => (
          <div key={pair.arabic} className="ws-row ws-item">
            <Num n={i + 1} />
            <span className="ws-ar" dir="rtl" lang="ar">
              {pair.arabic}
            </span>
            <span className="ws-box" aria-label="letter" />
          </div>
        ))}
      </div>
      <div className="ws-match-en" dir="ltr">
        {section.english_order.map((pairIndex, k) => (
          <div key={pairIndex} className="ws-row">
            <Num n={optionLetter(k)} />
            <span>{section.pairs[pairIndex].english}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WordBank({ words }: { words: string[] }) {
  return (
    <div className="ws-bank" dir="rtl" lang="ar" aria-label="word bank">
      {words.map((w) => (
        <span key={w} className="ws-ar">
          {w}
        </span>
      ))}
    </div>
  );
}

function Cloze({ section }: { section: Extract<WorksheetSection, { kind: "cloze" }> }) {
  return (
    <>
      <WordBank words={section.word_bank} />
      {section.items.map((item, i) => (
        <div key={i} className="ws-item">
          <div className="ws-row" dir="rtl">
            <Num n={i + 1} />
            <p className="ws-ar" dir="rtl" lang="ar" style={{ margin: 0 }}>
              {item.before}
              <Blank />
              {item.after}
            </p>
          </div>
          <div className="ws-en-hint" dir="ltr">
            {item.english}
          </div>
        </div>
      ))}
    </>
  );
}

function Dialogue({ section }: { section: Extract<WorksheetSection, { kind: "dialogue" }> }) {
  return (
    <>
      <p className="ws-instructions">{section.setting_english}</p>
      <WordBank words={section.word_bank} />
      {section.lines.map((line, i) => (
        <div key={i} className="ws-item">
          <div className="ws-row" dir="rtl">
            <span className="ws-speaker ws-ar" lang="ar">
              {SPEAKER[line.speaker]}:
            </span>
            <p className="ws-ar" dir="rtl" lang="ar" style={{ margin: 0 }}>
              {line.before}
              {line.answer !== null && <Blank />}
              {line.after}
            </p>
          </div>
          <div className="ws-en-hint" dir="ltr">
            {line.english}
          </div>
        </div>
      ))}
    </>
  );
}

function SpotTheFusha({ section }: { section: Extract<WorksheetSection, { kind: "spot_the_fusha" }> }) {
  return (
    <>
      {section.items.map((item, i) => (
        <div key={i} className="ws-item">
          <div className="ws-row" dir="rtl">
            <Num n={i + 1} />
            <p className="ws-ar" dir="rtl" lang="ar" style={{ margin: 0, flex: 1 }}>
              {item.arabic}
            </p>
            <span className="ws-box" aria-label="Fusha?" />
          </div>
          <div className="ws-en-hint" dir="ltr">
            {item.english}
          </div>
        </div>
      ))}
    </>
  );
}

function Writing({ section }: { section: Extract<WorksheetSection, { kind: "writing" }> }) {
  return (
    <>
      <p style={{ margin: "0 0 1mm" }}>{section.prompt_english}</p>
      {section.prompt_arabic && (
        <p className="ws-ar" dir="rtl" lang="ar" style={{ margin: 0 }}>
          {section.prompt_arabic}
        </p>
      )}
      <div className="ws-lines" dir="rtl" data-testid="writing-lines">
        {Array.from({ length: section.lines }, (_, i) => (
          <div key={i} className="ws-line" />
        ))}
      </div>
    </>
  );
}

function SectionBody({ section }: { section: WorksheetSection }) {
  switch (section.kind) {
    case "matching":
      return <Matching section={section} />;
    case "cloze":
      return <Cloze section={section} />;
    case "dialogue":
      return <Dialogue section={section} />;
    case "spot_the_fusha":
      return <SpotTheFusha section={section} />;
    case "writing":
      return <Writing section={section} />;
  }
}

export function WorksheetSheet({ spec }: { spec: WorksheetSpec }) {
  const keyed = spec.sections.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => answerKeyFor(s).length > 0);
  return (
    <article className="ws-sheet" data-testid="worksheet">
      <header className="ws-header">
        <div>
          {spec.title.arabic && (
            <h1 className="ws-title-ar ws-ar" dir="rtl" lang="ar">
              {spec.title.arabic}
            </h1>
          )}
          <p className="ws-title-en">{spec.title.english}</p>
        </div>
        <div className="ws-fields">
          <span>
            Name <span className="ws-field" />
          </span>
          <span>
            Date <span className="ws-field" />
          </span>
        </div>
      </header>
      <p className="ws-intro">{spec.instructions}</p>

      {spec.sections.map((section, i) => (
        <section key={section.kind} className="ws-section" data-kind={section.kind}>
          <div className="ws-section-head">
            <span className="ws-section-no">{i + 1}.</span>
            <h2 className="ws-section-title" style={{ margin: 0 }}>
              {SECTION_TITLES[section.kind]}
            </h2>
          </div>
          <p className="ws-instructions">{section.instructions}</p>
          <SectionBody section={section} />
        </section>
      ))}

      {keyed.length > 0 && (
        <section className="ws-key" data-testid="answer-key">
          <h2>Answers</h2>
          {keyed.map(({ s, n }) => (
            <div key={s.kind} className="ws-key-section">
              <strong>
                {n}. {SECTION_TITLES[s.kind]}
              </strong>
              <div className="ws-key-list" dir="rtl">
                {answerKeyFor(s).map(({ label, answer }) => {
                  // "✓ all dialect" and the matching letters are English; only Arabic gets the Naskh face.
                  const arabic = ARABIC.test(answer);
                  return (
                    <span key={label} className="ws-row">
                      <Num n={label} />
                      <bdi className={arabic ? "ws-ar" : undefined} lang={arabic ? "ar" : "en"}>
                        {answer}
                      </bdi>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

export default WorksheetSheet;
