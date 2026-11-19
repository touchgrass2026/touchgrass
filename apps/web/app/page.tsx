import {
  BRAND,
  FOUNDERS,
  isReferralCode,
  normalizeWaitlistSource,
  SUPPORTED_LANGUAGES,
} from '@touchgrass/shared';
import { headers } from 'next/headers';
import Image from 'next/image';
import Link from 'next/link';
import { resolveLanguage, strings } from '../lib/i18n';
import { LegalFooter } from '../lib/legal-page';
import { landingFontVariables } from './_landing/fonts';
import { InviteCheck } from './_landing/invite-check';
import { Phone } from './_landing/phone';
import { StoreLinks } from './_landing/store-links';
import { WaitlistForm } from './_landing/waitlist-form';
import './_landing/landing.css';

interface PageProps {
  searchParams: Promise<{ lang?: string; ref?: string; utm_source?: string }>;
}

/**
 * Stock photos (Pexels licence, D-226) standing in for the owner's own; credits in public/landing/photos/CREDITS.md.
 * Each exists at 1600 and 800 px on the longest side.
 */
const photo = (name: string, size: 1600 | 800) => `/landing/photos/${name}-${String(size)}.webp`;

/** "Log off. Pull up." keeps each sentence on its own unbroken line, so phones never split "Pull / up." */
function Tagline({ text }: { text: string }) {
  const sentences = text.split(/(?<=[.।])\s+/);
  return (
    <>
      {sentences.map((s, i) => (
        <span key={s} className="lp-h1-line">
          {s}
          {i < sentences.length - 1 ? ' ' : null}
        </span>
      ))}
    </>
  );
}

/** Public home page (D-169; D-225 brand; D-226 people and places, one phone frame, shorter). The waitlist leads. */
export default async function Home({ searchParams }: PageProps) {
  const { lang, ref, utm_source: utmSource } = await searchParams;
  // Where the visitor came from (D-191): kept with their waitlist entry.
  const source = normalizeWaitlistSource(utmSource);
  // A friend's referral link (F-GRW-01): show their code to enter at sign-up; anything else is ignored.
  const referral = ref && isReferralCode(ref) ? ref.trim().toUpperCase() : null;
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const l = t.landing;
  const playUrl = process.env.NEXT_PUBLIC_PLAY_STORE_URL || null;
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL || null;
  const errors = { RATE_LIMITED: t.errors.RATE_LIMITED, INTERNAL: t.errors.INTERNAL };
  const tiles = [
    { key: 'run', photo: 'run', plan: l.city.run, width: 1600 },
    { key: 'heritage', photo: 'charminar', plan: l.city.heritage, width: 800 },
    { key: 'chai', photo: 'chai', plan: l.city.chai, width: 800 },
    { key: 'mic', photo: 'open-mic', plan: l.city.mic, width: 800 },
    { key: 'trek', photo: 'trek', plan: l.city.trek, width: 1600 },
  ] as const;
  const steps = [
    { step: l.how.find, screen: 'plan', alt: l.shots.plan },
    { step: l.how.pullUp, screen: 'plans', alt: l.shots.plans },
    { step: l.how.meet, screen: 'chat', alt: l.shots.chat },
  ] as const;
  const after = [l.how.lore, l.features.squad, l.features.crews];
  const safety = [
    l.safety.adults,
    l.safety.selfie,
    l.safety.reliability,
    l.safety.report,
    l.safety.sos,
  ];
  const faq = [
    [l.faq.whoQ, l.faq.whoA],
    [l.faq.costQ, l.faq.costA],
    [l.faq.cityQ, l.faq.cityA],
    [l.faq.phoneQ, l.faq.phoneA],
  ] as const;
  const query = (code: string) =>
    `/?lang=${code}${referral ? `&ref=${referral}` : ''}${source ? `&utm_source=${source}` : ''}`;

  return (
    <main lang={language} className={`lp ${landingFontVariables}`}>
      <header className="lp-nav lp-wrap">
        <Link href={query(language)} className="lp-brand">
          <Image src="/landing/logo.png" alt="" width={40} height={40} />
          <span className="lp-brand-name">{BRAND.name}</span>
        </Link>
        <div className="lp-nav-links">
          <Link href={`/about?lang=${language}`} className="lp-navlink">
            {l.about.nav}
          </Link>
          <nav aria-label={t.settings.language} className="lp-langs">
            {SUPPORTED_LANGUAGES.map((code) => (
              <Link
                key={code}
                href={query(code)}
                hrefLang={code}
                aria-current={code === language ? 'true' : undefined}
                className="lp-lang"
              >
                {t.settings.languageNames[code]}
              </Link>
            ))}
          </nav>
        </div>
        <a href="#waitlist" className="lp-btn lp-nav-cta">
          {l.waitlistCta}
        </a>
      </header>

      <section aria-labelledby="hero-title" className="lp-hero lp-wrap">
        <div className="lp-hero-text">
          <h1 id="hero-title" className="lp-h1">
            <Tagline text={t.brand.tagline} />
          </h1>
          <p className="lp-lead">{l.heroLine}</p>
          {referral ? (
            <p className="lp-referral" data-testid="referral-code">
              {t.referrals.landingCode.replace('{{code}}', referral)}
            </p>
          ) : null}
          <div className="lp-actions">
            <a href="#waitlist" className="lp-btn">
              {l.waitlistCta}
            </a>
            <a href="#invite" className="lp-textlink">
              {l.inviteLink}
            </a>
          </div>
          <StoreLinks playUrl={playUrl} appStoreUrl={appStoreUrl} />
        </div>
        <figure className="lp-hero-visual">
          <div className="lp-hero-photo">
            <Image
              src={photo('board-games', 1600)}
              alt={l.heroPhotoAlt}
              fill
              priority
              sizes="(min-width: 60rem) 52vw, 100vw"
            />
          </div>
          <div className="lp-hero-phone">
            <Phone screen="explore" alt={l.shots.explore} sizes="(min-width: 60rem) 260px, 44vw" />
            <figcaption className="lp-sticker">{l.shots.exploreCaption}</figcaption>
          </div>
        </figure>
      </section>

      <section id="hyderabad" aria-labelledby="hyderabad-title" className="lp-section">
        <div className="lp-wrap lp-head">
          <h2 id="hyderabad-title" className="lp-h2">
            {l.city.title}
          </h2>
          <p className="lp-intro">{l.city.intro}</p>
        </div>
        <ul className="lp-mosaic">
          {tiles.map((tile) => (
            <li key={tile.key} className={`lp-tile lp-tile-${tile.key}`}>
              <Image
                src={photo(tile.photo, tile.width)}
                alt={tile.plan.alt}
                fill
                sizes={
                  tile.width === 1600
                    ? '(min-width: 40rem) 50vw, 100vw'
                    : '(min-width: 40rem) 25vw, 50vw'
                }
              />
              <p className="lp-tile-caption">
                <span className="lp-tile-what">{tile.plan.what}</span>
                <span className="lp-tile-where">{tile.plan.where}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" aria-labelledby="how-title" className="lp-section lp-wrap">
        <h2 id="how-title" className="lp-h2">
          {l.howTitle}
        </h2>
        {/* On phones the steps swipe sideways; keyboard users reach the row by Tab (WCAG 2.1.1). */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be focusable */}
        <ol className="lp-steps-row" tabIndex={0} aria-label={l.howTitle}>
          {steps.map(({ step, screen, alt }) => (
            <li key={step.title} className="lp-step">
              <Phone
                screen={screen}
                alt={alt}
                sizes="(min-width: 60rem) 280px, (min-width: 40rem) 30vw, 72vw"
              />
              <h3 className="lp-h3">{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <section className="lp-after" aria-labelledby="after-title">
          <h2 id="after-title" className="lp-after-title">
            {l.afterTitle}
          </h2>
          <ul className="lp-after-list">
            {after.map((item) => (
              <li key={item.title}>
                <span className="lp-after-name">{item.title}</span> {item.body}
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section id="safety" aria-labelledby="safety-title" className="lp-band">
        <div className="lp-wrap lp-safety">
          <figure className="lp-safety-shot">
            <div className="lp-phone-peek">
              <Phone
                screen="liveLocation"
                alt={l.shots.liveLocation}
                sizes="(min-width: 60rem) 280px, 64vw"
              />
            </div>
            <figcaption className="lp-sticker">{l.shots.liveCaption}</figcaption>
          </figure>
          <div className="lp-safety-text">
            <h2 id="safety-title" className="lp-h2">
              {l.safetyTitle}
            </h2>
            <p className="lp-intro">{l.safetyIntro}</p>
            <ul className="lp-checks">
              {safety.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="lp-section lp-wrap">
        <div className="lp-rows">
          <h2 id="faq-title" className="lp-h2">
            {l.faqTitle}
          </h2>
          <dl>
            {faq.map(([q, a]) => (
              <div key={q} className="lp-row">
                <dt className="lp-q">{q}</dt>
                <dd>{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section
        aria-labelledby="founders-title"
        className="lp-founders lp-wrap"
        data-testid="landing-founders"
      >
        <h2 id="founders-title" className="lp-founders-title">
          {l.founders.title}
        </h2>
        <ul className="lp-founders-list">
          {FOUNDERS.map((f) => (
            <li key={f.name}>
              <span className="lp-founder-name">{f.name}</span>
              <span className="lp-muted">{l.about.founderRole}</span>
            </li>
          ))}
        </ul>
        <p className="lp-founders-line">
          {l.about.foundersIntro}{' '}
          <Link href={`/about?lang=${language}`} className="lp-textlink">
            {l.founders.more}
          </Link>
        </p>
      </section>

      <div className="lp-well">
        <section id="waitlist" aria-labelledby="waitlist-title" className="lp-wrap lp-join">
          <div className="lp-join-text">
            <h2 id="waitlist-title" className="lp-h2">
              {l.waitlist.title}
            </h2>
            <p className="lp-intro">{l.waitlist.body}</p>
            <p className="lp-muted">{l.inviteCities}</p>
          </div>
          <WaitlistForm
            t={l.waitlist}
            errors={errors}
            language={language}
            source={source}
            referral={referral}
          />
        </section>
        <section id="invite" aria-labelledby="invite-title" className="lp-wrap lp-check-row">
          <div className="lp-join-text">
            <h2 id="invite-title" className="lp-h2 lp-h2-s">
              {l.check.title}
            </h2>
            <p>{l.check.body}</p>
          </div>
          <InviteCheck t={l.check} errors={errors} playUrl={playUrl} appStoreUrl={appStoreUrl} />
        </section>
      </div>

      <footer className="lp-footer lp-wrap">
        <p className="lp-mast">
          <Image src="/landing/logo.png" alt="" width={56} height={56} />
          <span>{BRAND.name}</span>
        </p>
        <LegalFooter />
        <p className="lp-muted">
          © {new Date().getFullYear()} {BRAND.name}, Hyderabad
        </p>
      </footer>
    </main>
  );
}
