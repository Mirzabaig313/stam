import { ActionLink, type PageName, Shell } from "@/site/components/Shell";
import { CardBody, cardClass, RulerMarks, StaticTree } from "@/site/components/Tree";
import { APP_PATH, notFound, privacyPage, site } from "@/site/content";
import { FRAMES } from "@/site/data";
import { padded, roman } from "@/site/sample/frames";
import { Calculator } from "@/site/sections/Calculator";
import { Chapters } from "@/site/sections/Chapters";
import { DragDrop } from "@/site/sections/DragDrop";
import { Exports } from "@/site/sections/Exports";
import { Hero } from "@/site/sections/Hero";
import { PrivacyFacts } from "@/site/sections/PrivacyFacts";

function Home() {
  return (
    <>
      <Hero />
      <Chapters />
      <DragDrop />
      <Exports />
      <Calculator />
      <PrivacyFacts />
    </>
  );
}

function Privacy() {
  return (
    <article className="doc" aria-labelledby="doc-title">
      <header className="doc__head">
        <h1 id="doc-title" className="display doc__title">
          {privacyPage.title}
        </h1>
        <div className="doc__aside">
          <p className="lede">{privacyPage.lede}</p>
          <p className="doc__updated">{privacyPage.updated}</p>
        </div>
      </header>
      {/* The policy as a register: one ruled row per question, its numeral in the margin, the
          short answer set large and the details beside it. */}
      <div className="doc__body">
        <p className="doc__columns" aria-hidden="true">
          <span>{privacyPage.columns[0]}</span>
          <span>{privacyPage.columns[1]}</span>
          <span>{privacyPage.columns[2]}</span>
        </p>
        {privacyPage.sections.map((section, i) => (
          <section key={section.heading} className="doc__section" aria-labelledby={`doc-${i}`}>
            <span className="doc__num" aria-hidden="true">
              {roman(i + 1)}
            </span>
            <h2 id={`doc-${i}`} className="doc__heading">
              {section.heading}
            </h2>
            <p className="doc__answer">{section.answer}</p>
            <div className="doc__text">
              {section.body.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </div>
          </section>
        ))}
        <div className="doc__actions">
          <ActionLink href={APP_PATH}>{site.cta}</ActionLink>
          <a className="text-link" href="/">
            {privacyPage.back}
          </a>
        </div>
      </div>
    </article>
  );
}

/** The 404 figure: Ada and Tomas's children, with one child's card left blank. */
const MISSING_FRAME = FRAMES[2]!;
const MISSING_KEY = "ines";

function NotFound() {
  const view = padded(MISSING_FRAME.bounds, 24);
  return (
    <section className="missing" aria-labelledby="missing-title">
      <div className="missing__top">
        <h1 id="missing-title" className="display missing__title">
          {notFound.heading}
        </h1>
        <div className="missing__aside">
          <p className="lede">{notFound.text}</p>
          <div className="hero__actions">
            <ActionLink href="/">{notFound.home}</ActionLink>
            <a className="text-link" href={APP_PATH}>
              {site.cta}
            </a>
          </div>
        </div>
      </div>
      <figure className="missing__figure" aria-hidden="true">
        <div className="register missing__register">
          <RulerMarks frame={MISSING_FRAME} />
          <div
            className="missing__tree"
            style={{ "--ratio": view.width / view.height } as React.CSSProperties}
          >
            <StaticTree
              frame={MISSING_FRAME}
              stagger
              className="tree--hero"
              renderCard={(key, style) =>
                key === MISSING_KEY ? (
                  <div key={key} className="card card--empty" style={style}>
                    <span className="card__text">
                      <span className="card__name">{notFound.card}</span>
                    </span>
                  </div>
                ) : (
                  <div
                    key={key}
                    className={cardClass(key)}
                    style={
                      {
                        ...style,
                        "--row": key === "ada" || key === "tomas" ? 0 : 1,
                        "--i": 0,
                        "--side": -1,
                      } as React.CSSProperties
                    }
                  >
                    <CardBody personKey={key} />
                  </div>
                )
              }
            />
          </div>
        </div>
      </figure>
    </section>
  );
}

export function SitePage({ page }: { page: PageName }) {
  return (
    <Shell page={page}>
      {page === "home" ? <Home /> : page === "privacy" ? <Privacy /> : <NotFound />}
    </Shell>
  );
}

export type { PageName };
