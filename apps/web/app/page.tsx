import {
  BRAND,
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
import { StoreLinks } from './_landing/store-links';
import { WaitlistForm } from './_landing/waitlist-form';
import './_landing/landing.css';

interface PageProps {
  searchParams: Promise<{ lang?: string; ref?: string; utm_source?: string }>;
}

/** Real Android captures from the Maestro runs (D-225), cropped to the app's own pixels, in public/landing. */
const SHOTS = {
  explore: { src: '/landing/explore.webp', width: 720, height: 1243 },
  planCard: { src: '/landing/plan-card.webp', width: 912, height: 760 },
  pullingUp: { src: '/landing/pulling-up.webp', width: 720, height: 787 },
  chats: { src: '/landing/chats.webp', width: 720, height: 707 },
  neighbourhood: { src: '/landing/neighbourhood.webp', width: 720, height: 427 },
  liveLocation: { src: '/landing/live-location.webp', width: 720, height: 933 },
} as const;

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

/** Public home page (D-169, redesigned in D-225): the app in Hyderabad, shown with real screens; the waitlist leads. */
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
  const places = [l.city.run, l.city.chai, l.city.games, l.city.mic, l.city.walk, l.city.trek];
  const tour = [
    { step: l.how.find, shot: SHOTS.planCard, alt: l.shots.planCard, size: 'wide' },
    { step: l.how.pullUp, shot: SHOTS.pullingUp, alt: l.shots.pullingUp, size: 'mid' },
    { step: l.how.meet, shot: SHOTS.chats, alt: l.shots.chats, size: 'narrow' },
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
    [l.faq.mysteryQ, l.faq.mysteryA],
  ] as const;
  const query = (code: string) =>
    `/?lang=${code}${referral ? `&ref=${referral}` : ''}${source ? `&utm_source=${source}` : ''}`;

  return (
    <main lang={language} className={`lp ${landingFontVariables}`}>
      <header className="lp-nav lp-wrap">
        <Link href={query(language)} className="lp-brand">
          <Image src="/landing/logo.png" alt="" width={40} height={40} priority />
          <span>{BRAND.name}</span>
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
        <figure className="lp-hero-shot">
          <Image
            src={SHOTS.explore.src}
            width={SHOTS.explore.width}
            height={SHOTS.explore.height}
            alt={l.shots.explore}
            sizes="(min-width: 60rem) 360px, 72vw"
            priority
            className="lp-shot"
          />
          <figcaption className="lp-sticker">{l.shots.exploreCaption}</figcaption>
        </figure>
      </section>

      <section id="hyderabad" aria-labelledby="hyderabad-title" className="lp-section lp-wrap">
        <div className="lp-city">
          <div className="lp-city-list">
            <h2 id="hyderabad-title" className="lp-h2">
              {l.city.title}
            </h2>
            <p className="lp-intro">{l.city.intro}</p>
            <ul className="lp-places">
              {places.map((p) => (
                <li key={p.what}>
                  <span className="lp-place-what">{p.what}</span>
                  <span className="lp-place-where">{p.where}</span>
                </li>
              ))}
            </ul>
          </div>
          <figure className="lp-city-shot">
            <Image
              src={SHOTS.neighbourhood.src}
              width={SHOTS.neighbourhood.width}
              height={SHOTS.neighbourhood.height}
              alt={l.shots.neighbourhood}
              sizes="(min-width: 60rem) 480px, 92vw"
              className="lp-shot"
            />
            <figcaption className="lp-sticker">{l.city.caption}</figcaption>
          </figure>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="lp-section lp-wrap">
        <h2 id="how-title" className="lp-h2">
          {l.howTitle}
        </h2>
        <ol className="lp-tour">
          {tour.map(({ step, shot, alt, size }) => (
            <li key={step.title} className={`lp-tour-${size}`}>
              <figure>
                <Image
                  src={shot.src}
                  width={shot.width}
                  height={shot.height}
                  alt={alt}
                  sizes="(min-width: 60rem) 40vw, 92vw"
                  className="lp-shot"
                />
                <figcaption>
                  <h3 className="lp-h3">{step.title}</h3>
                  <p>{step.body}</p>
                </figcaption>
              </figure>
            </li>
          ))}
        </ol>
      </section>

      <section id="after" aria-labelledby="after-title" className="lp-section lp-section-s lp-wrap">
        <div className="lp-rows">
          <h2 id="after-title" className="lp-h2">
            {l.afterTitle}
          </h2>
          <dl>
            {after.map((item) => (
              <div key={item.title} className="lp-row">
                <dt className="lp-h3">{item.title}</dt>
                <dd>{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="safety" aria-labelledby="safety-title" className="lp-band">
        <div className="lp-wrap lp-safety">
          <figure className="lp-safety-shot">
            <Image
              src={SHOTS.liveLocation.src}
              width={SHOTS.liveLocation.width}
              height={SHOTS.liveLocation.height}
              alt={l.shots.liveLocation}
              sizes="(min-width: 60rem) 420px, 92vw"
              className="lp-shot"
            />
            <figcaption className="lp-sticker">{l.shots.liveCaption}</figcaption>
          </figure>
          <div className="lp-safety-text">
            <h2 id="safety-title" className="lp-h2">
              {l.safetyTitle}
            </h2>
            <p className="lp-intro">{l.safetyIntro}</p>
            <ul className="lp-list">
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

      <div className="lp-well">
        <section id="waitlist" aria-labelledby="waitlist-title" className="lp-wrap lp-join">
          <div className="lp-join-text">
            <h2 id="waitlist-title" className="lp-h2">
              {l.waitlist.title}
            </h2>
            <p className="lp-intro">{l.waitlist.body}</p>
            <p>{l.inviteBody}</p>
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
        <section
          id="invite"
          aria-labelledby="invite-title"
          className="lp-wrap lp-join lp-join-check"
        >
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
