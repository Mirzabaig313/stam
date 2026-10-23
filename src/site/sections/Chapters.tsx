import { LiveTree } from "@/site/components/LiveTree";
import { describeFrame, RulerMarks, StaticTree } from "@/site/components/Tree";
import { chapters, chaptersIntro } from "@/site/content";
import { FINAL, FRAMES } from "@/site/data";
import { frameAt } from "@/site/sample/frames";

/**
 * Pinned chapters. With motion, a sticky stage runs the engine as you scroll and the chapter
 * texts scroll past it. Without motion (reduced motion, no JavaScript) each chapter shows its
 * own finished frame, so the story reads as five stacked pictures.
 */
export function Chapters() {
  return (
    <section id="chapters" className="chapters" aria-labelledby="chapters-title" data-chapters>
      <header className="chapters__intro">
        <h2 id="chapters-title" className="heading">
          {chaptersIntro.heading}
        </h2>
        <p className="chapters__text">{chaptersIntro.text}</p>
        <p className="chapters__note">{chaptersIntro.sampleNote}</p>
      </header>
      <div className="chapters__body">
        <ol className="chapters__list">
          {chapters.map((chapter, i) => (
            <li key={chapter.title} className="chapter" data-chapter={i}>
              <div className="chapter__copy">
                <p className="chapter__count">
                  <span className="sr-only">Step </span>
                  {i + 1}
                  <span className="chapter__of"> of {chapters.length}</span>
                </p>
                <h3 className="chapter__title">{chapter.title}</h3>
                <p className="chapter__text">{chapter.text}</p>
              </div>
              <figure className="chapter__frame register">
                <RulerMarks frame={FRAMES[i]!} />
                <div className="chapter__tree">
                  <StaticTree frame={FRAMES[i]!} />
                </div>
                <figcaption className="sr-only">
                  {describeFrame(FRAMES[i]!, i > 0 ? FRAMES[i - 1] : undefined)}
                </figcaption>
              </figure>
            </li>
          ))}
        </ol>
        <div className="stage" data-stage aria-hidden="true">
          <LiveTree
            all={FINAL}
            initial={frameAt(FRAMES, 0)}
            rows={FINAL.rows}
            className="live--stage"
          />
          {/* The pinned frame's caption: the current chapter's numeral set large, its title and
              text, and a register of all five steps. The list beside it keeps the text for
              screen readers; this copy is decorative (the stage is aria-hidden). */}
          <div className="stage__caption" data-stage-caption>
            <p className="stage__numeral">
              <span className="stage__digits" data-caption-count>
                1
              </span>
              <span className="stage__of">of {chapters.length}</span>
            </p>
            <div className="stage__words">
              <p className="chapter__title" data-caption-title>
                {chapters[0]!.title}
              </p>
              <p className="chapter__text" data-caption-text>
                {chapters[0]!.text}
              </p>
            </div>
            <ol className="stage__steps">
              {chapters.map((chapter, i) => (
                <li
                  key={chapter.title}
                  className={i === 0 ? "stage__step is-current" : "stage__step"}
                  data-caption-step={i}
                >
                  <span className="stage__step-num">{i + 1}</span>
                  <span className="stage__step-name">{chapter.title}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
