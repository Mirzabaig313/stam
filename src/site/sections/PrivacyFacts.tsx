import { ActionLink } from "@/site/components/Shell";
import { APP_PATH, privacySection, site } from "@/site/content";

export function PrivacyFacts() {
  return (
    <section className="privacy" aria-labelledby="privacy-title">
      <h2 id="privacy-title" className="display privacy__title">
        {privacySection.heading}
      </h2>
      <dl className="privacy__facts">
        {privacySection.facts.map((fact) => (
          <div key={fact.term} className="privacy__fact">
            <dt>{fact.term}</dt>
            <dd>{fact.text}</dd>
          </div>
        ))}
      </dl>
      <div className="privacy__actions">
        <ActionLink href={APP_PATH} variant="ghost">
          {site.cta}
        </ActionLink>
        <a className="text-link" href="/privacy">
          {privacySection.more}
        </a>
      </div>
    </section>
  );
}
