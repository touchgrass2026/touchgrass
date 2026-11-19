import Image from 'next/image';

/** App screens captured whole at 390 × 844 CSS px (D-226), stored 780 px wide in public/landing/app. */
export const SCREENS = {
  explore: '/landing/app/explore.webp',
  plan: '/landing/app/plan.webp',
  plans: '/landing/app/plans.webp',
  chat: '/landing/app/chat.webp',
  liveLocation: '/landing/app/live-location.webp',
} as const;

/**
 * The one phone frame on the page: a CSS bezel around a whole app screen, never cropped. Its width comes from
 * the parent, so every screen keeps the same proportions, radius and border wherever it sits.
 */
export function Phone({
  screen,
  alt,
  sizes,
  className,
}: {
  screen: keyof typeof SCREENS;
  alt: string;
  sizes: string;
  className?: string;
}) {
  return (
    <div className={className ? `lp-phone ${className}` : 'lp-phone'}>
      <Image
        src={SCREENS[screen]}
        width={780}
        height={1688}
        alt={alt}
        sizes={sizes}
        className="lp-phone-screen"
      />
    </div>
  );
}
