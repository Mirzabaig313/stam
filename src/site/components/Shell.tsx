import type { ReactNode } from "react";

import { APP_PATH, footer, site } from "@/site/content";

export type PageName = "home" | "privacy" | "notFound";

/**
 * Primary action. The hover slides the label out sideways and its copy in from the other side,
 * where it locks: "settle into rows" at button size.
 */
export function ActionLink({
  href,
  children,
  variant = "solid",
  arrow = true,
}: {
  href: string;
  children: string;
  variant?: "solid" | "ghost" | "small";
  arrow?: boolean;
}) {
  return (
    <a className={`btn btn--${variant}`} href={href}>
      <span className="btn__fill" aria-hidden="true" />
      {/* The sliding copy of the label is CSS generated content with empty alt text, so the
          link is announced once and innerText holds the label once. */}
      <span className="btn__label" data-text={children}>
        <span className="btn__text">{children}</span>
      </span>
      {arrow && (
        <svg className="btn__arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M1 8h13M9 3l5 5-5 5" />
        </svg>
      )}
    </a>
  );
}

function Header({ page }: { page: PageName }) {
  return (
    <header className="site-header" data-header>
      <a className="wordmark" href="/" aria-label={site.homeLabel}>
        {site.name}
      </a>
      <nav className="site-nav" aria-label="Main">
        <ul>
          {site.nav.map((link) => {
            const current = page === "privacy" && link.href === "/privacy";
            return (
              <li key={link.href}>
                <a
                  className="nav-link"
                  href={link.href}
                  {...(current ? { "aria-current": "page" as const } : {})}
                >
                  {link.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <ActionLink href={APP_PATH} variant="small">
        {site.cta}
      </ActionLink>
    </header>
  );
}

function Footer({ page }: { page: PageName }) {
  return (
    <footer className="site-footer">
      <div className="footer__grid">
        <ul className="footer__links">
          {footer.links.map((link) => (
            <li key={link.href}>
              <a className="nav-link" href={link.href}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="footer__notes">
          <p>{footer.etymology}</p>
          <p>{footer.languages}</p>
          <p className="footer__colophon">
            {page === "home" ? footer.colophon : footer.colophonPlain}
          </p>
        </div>
      </div>
      <div className="footer__ruled" aria-hidden="true">
        <span className="footer__numeral">I</span>
        <span className="footer__mark">{footer.wordmark}</span>
      </div>
    </footer>
  );
}

export function Shell({ page, children }: { page: PageName; children: ReactNode }) {
  return (
    <>
      {/* The register margin: one hairline down every page; it stays put across page changes. */}
      <div className="rail" aria-hidden="true" />
      <a className="skip-link" href="#main">
        {site.skip}
      </a>
      <Header page={page} />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <Footer page={page} />
    </>
  );
}
