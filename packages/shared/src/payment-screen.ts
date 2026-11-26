/**
 * Off-platform payment screening (D-228). Plans and plan group chats must not send money around TouchGrass:
 * buyers are only protected when they pay through the app. This finds UPI IDs, UPI links, bank account and IFSC
 * details, and "pay me / send money / GPay me / cash at the door" style asks in English, Hindi and Telugu
 * (native script and the Latin "Hinglish" / "Tenglish" people actually type). Plan descriptions also hold phone
 * numbers. Anything found is held for review, never rejected or rewritten.
 *
 * Direct messages between squad members are never screened for this: friendships are the point.
 */
import { screenTexts, type TextScreenResult } from './text-filter';

/** What kind of payment diversion was found (for reviewers and the author's explanation). */
export type PaymentSignal =
  'upi_id' | 'upi_link' | 'bank_details' | 'payment_app' | 'payment_ask' | 'phone_number';

/** Why a piece of content is held: abuse (text filter), payments outside the app, or contact details. */
export type HoldReasonKind = 'content' | 'payment' | 'contact';

export interface PaymentScreenResult {
  flagged: boolean;
  signals: PaymentSignal[];
  /** What matched, for reviewers only. */
  matches: string[];
}

export interface PaymentScreenOptions {
  /** Plan titles/descriptions hold phone numbers; chats allow them. */
  phones: boolean;
  /**
   * A paid plan sells tickets in the app, so naming a payment app there ("pay in the app with UPI") is fine;
   * asks, IDs, links and bank details are still caught.
   */
  paid: boolean;
}

/** Payment service provider handles seen after the @ of a UPI ID. Unknown handles need payment words nearby. */
const PSP_HANDLES = new Set([
  'abfspay',
  'airtel',
  'apl',
  'aubank',
  'axisb',
  'axisbank',
  'axl',
  'barodampay',
  'boi',
  'cnrb',
  'dbs',
  'fam',
  'fbl',
  'federal',
  'freecharge',
  'hdfcbank',
  'hsbc',
  'ibl',
  'icici',
  'idbi',
  'idfcbank',
  'idfcfirst',
  'ikwik',
  'indus',
  'jio',
  'jupiteraxis',
  'kbl',
  'kmbl',
  'kotak',
  'mahb',
  'naviaxis',
  'okaxis',
  'okhdfcbank',
  'okicici',
  'oksbi',
  'paytm',
  'pingpay',
  'pnb',
  'postbank',
  'ptaxis',
  'pthdfc',
  'ptsbi',
  'ptyes',
  'rapl',
  'rbl',
  'sbi',
  'sc',
  'shriramhdfcbank',
  'slice',
  'superyes',
  'timecosmos',
  'ubi',
  'uco',
  'unionbank',
  'upi',
  'waaxis',
  'wahdfcbank',
  'waicici',
  'wasbi',
  'yapl',
  'ybl',
  'yesbank',
  'yesbankltd',
  'yesg',
]);

/** Payment apps and rails. Caught in free plans and chats; a paid plan may name them. */
const PAYMENT_APPS = [
  'gpay',
  'googlepay',
  'google pay',
  'g pay',
  'phonepe',
  'phone pe',
  'paytm',
  'bhim',
  'upi',
  'neft',
  'imps',
  'rtgs',
  'bank transfer',
  'net banking',
  // Hindi
  'जीपे',
  'गूगल पे',
  'फोनपे',
  'फ़ोनपे',
  'फोन पे',
  'पेटीएम',
  'यूपीआई',
  // Telugu
  'జీపే',
  'గూగుల్ పే',
  'ఫోన్పే',
  'ఫోన్ పే',
  'పేటీఎం',
  'యూపీఐ',
];

/** Asks to pay someone directly, or cash for entry. Caught everywhere, unless negated ("no cash at the door"). */
const PAYMENT_ASKS = [
  // English
  'pay me',
  'pay to me',
  'pay the host',
  'pay host directly',
  'pay at the door',
  'pay at entry',
  'pay on arrival',
  'pay in cash',
  'pay offline',
  'pay outside the app',
  'scan to pay',
  'scan and pay',
  'send money',
  'send me money',
  'send the money',
  'send me the money',
  'send the amount',
  'send payment',
  'transfer to my',
  'transfer it to',
  'transfer the amount',
  'transfer money',
  'transfer me',
  'cash at the door',
  'cash at entry',
  'cash on arrival',
  'payment link',
  'dm for payment',
  'dm to pay',
  'dm me for payment',
  'collect money',
  'collecting money',
  'advance payment',
  'pay in advance',
  // Hinglish
  'paise bhejo',
  'paise bhej do',
  'paise bhejna',
  'paisa bhejo',
  'paisa bhej do',
  'paise transfer karo',
  'paise transfer kar do',
  'paise de dena',
  'paise dena',
  'paisa dena',
  'paise dene honge',
  'paise jama karo',
  'gpay karo',
  'gpay kar do',
  'gpay kardo',
  'phonepe karo',
  'phonepe kar do',
  'paytm karo',
  'paytm kar do',
  'paytm kardo',
  'upi karo',
  'upi kar do',
  'online bhejo',
  'online bhej do',
  'cash dena',
  'cash dena hoga',
  'nakad dena',
  'account mein daal do',
  'account me daal do',
  'khate mein',
  'payment karo',
  'payment kar do',
  // Hindi (Devanagari)
  'पैसे भेजो',
  'पैसे भेज दो',
  'पैसा भेजो',
  'पैसे दे देना',
  'पैसे जमा करो',
  'पेमेंट करो',
  'पेमेंट कर दो',
  'भुगतान करें',
  'भुगतान करो',
  'नकद देना',
  'कैश देना',
  'ट्रांसफर करो',
  'ट्रांसफर कर दो',
  'खाते में',
  // Tenglish
  'dabbulu pampu',
  'dabbulu pampandi',
  'dabbulu pampinchu',
  'dabbulu veyyi',
  'dabbulu veyandi',
  'dabbulu ivvandi',
  'dabbulu ivvali',
  'dabbu pampandi',
  'money pampu',
  'money pampandi',
  'gpay cheyyi',
  'gpay cheyandi',
  'gpay chey',
  'phonepe cheyyi',
  'phonepe cheyandi',
  'paytm cheyyi',
  'paytm cheyandi',
  'transfer cheyyi',
  'transfer cheyandi',
  'cash ivvandi',
  'cash ivvali',
  // Telugu
  'డబ్బులు పంపండి',
  'డబ్బులు పంపు',
  'డబ్బు పంపండి',
  'డబ్బులు వేయండి',
  'డబ్బులు ఇవ్వండి',
  'పేమెంట్ చేయండి',
  'ట్రాన్స్ఫర్ చేయండి',
  'నగదు ఇవ్వండి',
  'క్యాష్ ఇవ్వండి',
  // "Pay with GPay" and friends: caught in paid plans too, where naming the app alone is allowed.
  ...['pay', 'send'].flatMap((verb) =>
    ['via', 'through', 'using', 'on', 'by', 'with'].flatMap((how) =>
      [
        'gpay',
        'google pay',
        'phonepe',
        'phone pe',
        'paytm',
        'bhim',
        'cash',
        'bank transfer',
        'neft',
        'imps',
      ].map((app) => `${verb} ${how} ${app}`),
    ),
  ),
];

/** Words that cancel an ask right before it: "no cash at the door", "never pay the host directly". */
const NEGATORS = new Set(['no', 'not', 'never', 'dont', 'nahi', 'nahin', 'mat', 'vaddu', 'ledu']);
/** Payment words that make an unfamiliar name@handle look like a UPI ID. */
const MONEY_CONTEXT = new Set([
  'pay',
  'paid',
  'payment',
  'send',
  'money',
  'transfer',
  'amount',
  'fee',
  'fees',
  'rs',
  'inr',
  'rupees',
  'contribution',
  'paise',
  'paisa',
  'dabbulu',
]);

const INDIC_DIGITS: Record<string, string> = {};
for (let i = 0; i < 10; i += 1) {
  INDIC_DIGITS[String.fromCharCode(0x0966 + i)] = String(i);
  INDIC_DIGITS[String.fromCharCode(0x0c66 + i)] = String(i);
}

/** Case-fold, drop zero-width joiners, ASCII digits, and Hindi/Telugu digits to ASCII. */
function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0966-\u096F\u0C66-\u0C6F]/g, (d) => INDIC_DIGITS[d] ?? d);
}

/** Words for phrase matching: letters and combining marks, apostrophes dropped ("don't" → "dont"). */
function tokens(folded: string): string[] {
  return folded
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

const phraseTokens = (p: string): string[] => tokens(fold(p));
const ASKS = PAYMENT_ASKS.map(phraseTokens);
const APPS = PAYMENT_APPS.map(phraseTokens);

/** Where `phrase` occurs in `words`, as start indexes. */
function occurrences(words: string[], phrase: string[]): number[] {
  const out: number[] = [];
  if (phrase.length === 0) return out;
  for (let i = 0; i + phrase.length <= words.length; i += 1)
    if (phrase.every((p, j) => words[i + j] === p)) out.push(i);
  return out;
}

function negated(words: string[], at: number): boolean {
  return words.slice(Math.max(0, at - 2), at).some((w) => NEGATORS.has(w));
}

// name@handle with no dot after the handle (an email address has one: sam@gmail.com).
const UPI_ID = /(?<![\w.@])([a-z0-9][a-z0-9._-]{1,255})@([a-z][a-z0-9]{1,63})(?![\w@]|\.[a-z])/g;
const UPI_LINK = /\bupi:\/\/|\bupi%3a%2f%2f/;
const IFSC = /\b[a-z]{4}0[a-z0-9]{6}\b/g;
const ACCOUNT =
  /(?:\ba\/c\b|\bacc(?:ount)?\.?(?:\s*(?:no|num|number)\b\.?)?|\bkhata\b|खाता|ఖాతా)[^\d\n]{0,20}\d(?:[\s-]?\d){8,17}(?!\d)/;
// Indian mobiles (10 digits from 6-9, optional +91/0), and international numbers written with a +.
const MOBILE = /(?<![\d₹$.,/:])(?:(?:\+|00)91[\s.-]?|0)?[6-9]\d(?:[\s.-]?\d){8}(?![\d])/;
const INTERNATIONAL = /(?<![\w])\+\d{1,3}(?:[\s.-]?\d){7,13}(?!\d)/;

/** Screens one text for payment diversion. Empty text is never flagged. */
export function detectOffPlatformPayment(
  text: string,
  opts: PaymentScreenOptions,
): PaymentScreenResult {
  const folded = fold(text);
  const words = tokens(folded);
  const signals = new Set<PaymentSignal>();
  const matches: string[] = [];
  const hit = (signal: PaymentSignal, match: string): void => {
    signals.add(signal);
    matches.push(match);
  };

  const moneyNearby =
    words.some((w) => MONEY_CONTEXT.has(w)) ||
    folded.includes('₹') ||
    APPS.some((p) => occurrences(words, p).length > 0);
  for (const m of folded.matchAll(UPI_ID)) {
    const [whole, , handle = ''] = m;
    if (PSP_HANDLES.has(handle) || moneyNearby) hit('upi_id', whole);
  }
  if (UPI_LINK.test(folded)) hit('upi_link', 'upi://');
  for (const m of folded.matchAll(IFSC)) if (/\d/.test(m[0].slice(5))) hit('bank_details', m[0]);
  const account = ACCOUNT.exec(folded);
  if (account) hit('bank_details', account[0]);

  for (const [i, phrase] of ASKS.entries())
    if (occurrences(words, phrase).some((at) => !negated(words, at)))
      hit('payment_ask', PAYMENT_ASKS[i] ?? '');
  if (!opts.paid)
    for (const [i, phrase] of APPS.entries())
      if (occurrences(words, phrase).some((at) => !negated(words, at)))
        hit('payment_app', PAYMENT_APPS[i] ?? '');

  if (opts.phones) {
    const phone = MOBILE.exec(folded) ?? INTERNATIONAL.exec(folded);
    if (phone) hit('phone_number', phone[0].trim());
  }
  return { flagged: signals.size > 0, signals: [...signals], matches: [...new Set(matches)] };
}

/** The abuse screen plus why it would be held, so the author can be told. */
export interface HoldScreenResult extends TextScreenResult {
  reasons: HoldReasonKind[];
}

function combine(
  texts: (string | null | undefined)[],
  opts: PaymentScreenOptions,
): HoldScreenResult {
  const abuse = screenTexts(...texts);
  const payment = texts.map((t) => detectOffPlatformPayment(t ?? '', opts));
  const signals = new Set(payment.flatMap((p) => p.signals));
  const reasons: HoldReasonKind[] = [];
  if ([...signals].some((s) => s !== 'phone_number')) reasons.push('payment');
  if (signals.has('phone_number')) reasons.push('contact');
  if (abuse.flagged) reasons.push('content');
  const matches = [...new Set([...abuse.matches, ...payment.flatMap((p) => p.matches)])];
  return {
    flagged: matches.length > 0,
    // Abuse keeps its own severity; payment diversion alone is reviewed at medium.
    severity: abuse.severity ?? (reasons.length > 0 ? 'medium' : null),
    matches,
    reasons,
  };
}

/** A plan's title and description: abuse, payment diversion and phone numbers. */
export function screenPlanTexts(
  texts: (string | null | undefined)[],
  opts: { paid: boolean },
): HoldScreenResult {
  return combine(texts, { phones: true, paid: opts.paid });
}

/** A message in a plan's group chat: abuse and payment diversion (phone numbers are fine there). */
export function screenPlanChat(text: string | null | undefined): HoldScreenResult {
  return combine([text], { phones: false, paid: false });
}

/** The one reason shown to the author: money first, then contact details, then everything else. */
export function primaryHoldReason(reasons: readonly HoldReasonKind[]): HoldReasonKind {
  if (reasons.includes('payment')) return 'payment';
  if (reasons.includes('contact')) return 'contact';
  return 'content';
}

/** Media moderation label for an image whose QR code pays someone directly (UPI, bank details). */
export const PAYMENT_QR_LABEL = 'payment_qr';

/** Whether a decoded QR code is a way to pay someone outside TouchGrass. */
export function isPaymentQrPayload(data: string): boolean {
  const found = detectOffPlatformPayment(data, { phones: false, paid: false });
  return found.signals.some((s) => s === 'upi_link' || s === 'upi_id' || s === 'bank_details');
}

/** Adds a payment QR image (a plan cover or a plan chat photo) to a text screen: held for review. */
export function withPaymentImage(result: HoldScreenResult): HoldScreenResult {
  return {
    flagged: true,
    severity: result.severity ?? 'medium',
    matches: [...new Set([...result.matches, PAYMENT_QR_LABEL])],
    reasons: result.reasons.includes('payment') ? result.reasons : ['payment', ...result.reasons],
  };
}
