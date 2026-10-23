import { ActionLink, type PageName, Shell } from "@/site/components/Shell";
import { APP_PATH, notFound, privacyPage, site } from "@/site/content";
import { roman } from "@/site/sample/frames";
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
        <p className="lede">{privacyPage.lede}</p>
        <p className="doc__updated">{privacyPage.updated}</p>
      </header>
      <div className="doc__body">
        {privacyPage.sections.map((section, i) => (
          <section key={section.heading} className="doc__section" aria-labelledby={`doc-${i}`}>
            <span className="doc__num" aria-hidden="true">
              {roman(i + 1)}
            </span>
            <h2 id={`doc-${i}`} className="doc__heading">
              {section.heading}
            </h2>
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

function NotFound() {
  return (
    <section className="missing" aria-labelledby="missing-title">
      <div className="missing__row register" aria-hidden="true">
        <ol className="ruler">
          <li className="ruler__mark" style={{ top: "50%" }}>
            {notFound.numeral}
          </li>
        </ol>
        <div className="missing__slot">
          <div className="card card--empty">
            <span className="card__text">
              <span className="card__name">{notFound.card}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="missing__copy">
        <h1 id="missing-title" className="display missing__title">
          {notFound.heading}
        </h1>
        <p className="lede">{notFound.text}</p>
        <div className="doc__actions">
          <ActionLink href="/">{notFound.home}</ActionLink>
          <a className="text-link" href={APP_PATH}>
            {site.cta}
          </a>
        </div>
      </div>
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
