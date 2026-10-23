import { ActionLink } from "@/site/components/Shell";
import { describeFrame, RulerMarks, StaticTree } from "@/site/components/Tree";
import { APP_PATH, hero, site } from "@/site/content";
import { FINAL } from "@/site/data";

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__top">
        <h1 id="hero-title" className="display hero__title">
          {hero.titleLines.map((line, i) => (
            <span key={line} className="hero__line" style={{ "--i": i } as React.CSSProperties}>
              {line}
              {i < hero.titleLines.length - 1 ? " " : ""}
            </span>
          ))}
        </h1>
        <div className="hero__aside">
          <p className="lede">{hero.lede}</p>
          <div className="hero__actions">
            <ActionLink href={APP_PATH}>{site.cta}</ActionLink>
            <a className="text-link" href="#chapters">
              {hero.secondary}
            </a>
          </div>
          <ul className="facts" aria-label="At a glance">
            {hero.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      </div>
      <figure className="hero__figure" data-hero-tree>
        <div className="register hero__register">
          <RulerMarks frame={FINAL} />
          <div className="hero__tree">
            <StaticTree frame={FINAL} stagger className="tree--hero" />
          </div>
        </div>
        <figcaption className="sr-only">
          {hero.treeLabel}. {describeFrame(FINAL)}
        </figcaption>
      </figure>
    </section>
  );
}
