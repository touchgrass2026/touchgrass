import { Anek_Devanagari, Anek_Telugu, Hepta_Slab, Inter } from 'next/font/google';

/**
 * Landing page faces (D-225), self-hosted by next/font so the strict CSP (`font-src 'self'`) holds.
 * Hepta Slab carries the headings, Inter (the app's face) the text; Anek Telugu and Anek Devanagari
 * cover the te/hi scripts and only download when a page uses those glyphs.
 */
export const display = Hepta_Slab({
  subsets: ['latin'],
  weight: '800',
  display: 'swap',
  variable: '--font-lp-display',
});

export const body = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--font-lp-body',
});

export const telugu = Anek_Telugu({
  subsets: ['telugu'],
  display: 'swap',
  preload: false,
  variable: '--font-lp-telugu',
});

export const devanagari = Anek_Devanagari({
  subsets: ['devanagari'],
  display: 'swap',
  preload: false,
  variable: '--font-lp-devanagari',
});

export const landingFontVariables = [display, body, telugu, devanagari]
  .map((f) => f.variable)
  .join(' ');
