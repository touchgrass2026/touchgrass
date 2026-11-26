import { describe, expect, it } from 'vitest';
import {
  detectOffPlatformPayment,
  isPaymentQrPayload,
  PAYMENT_QR_LABEL,
  primaryHoldReason,
  screenPlanChat,
  screenPlanTexts,
  withPaymentImage,
} from './payment-screen';

const FREE_PLAN = { phones: true, paid: false };
const PAID_PLAN = { phones: true, paid: true };
const CHAT = { phones: false, paid: false };

const signals = (text: string, opts = FREE_PLAN) => detectOffPlatformPayment(text, opts).signals;

describe('off-platform payment detector (D-228)', () => {
  describe('UPI IDs', () => {
    it.each([
      'Pay 200 to rahul.k@okaxis',
      'priya@ybl',
      '9876543210@paytm for the entry',
      'my id: sam_99@upi',
      'kiran@ibl',
      'deepa-r@axl',
      'RAVI@OKHDFCBANK',
      'ananya@oksbi.',
    ])('catches %s', (text) => {
      expect(signals(text, CHAT)).toContain('upi_id');
    });

    it('catches an unfamiliar handle only when money is mentioned', () => {
      expect(signals('send the fee to arjun@newbank', CHAT)).toContain('upi_id');
      expect(signals('₹150 to arjun@newbank', CHAT)).toContain('upi_id');
      expect(signals('see you, arjun@newbank', CHAT)).toEqual([]);
    });

    it.each([
      'Questions? Mail hello@touchgrass.in',
      'write to sam@gmail.com',
      'priya.k@company.co.in has the list',
      'Follow @kbr_runners on Instagram',
      'Meet @ KBR gate 2',
      'meet @7pm',
    ])('leaves emails and @mentions alone: %s', (text) => {
      expect(detectOffPlatformPayment(text, CHAT).flagged).toBe(false);
    });
  });

  it('catches UPI deep links', () => {
    expect(signals('upi://pay?pa=sam@ybl&am=200', CHAT)).toContain('upi_link');
    expect(signals('UPI://PAY?pa=x', CHAT)).toContain('upi_link');
  });

  describe('bank details', () => {
    it('catches IFSC codes and account numbers', () => {
      expect(signals('IFSC HDFC0001234', CHAT)).toContain('bank_details');
      expect(signals('ifsc sbin0004567', CHAT)).toContain('bank_details');
      expect(signals('A/c no 123456789012', CHAT)).toContain('bank_details');
      expect(signals('Account number: 0012 3456 7890', CHAT)).toContain('bank_details');
      expect(signals('acc 50100234567890', CHAT)).toContain('bank_details');
      expect(signals('खाता 123456789012', CHAT)).toContain('bank_details');
    });

    it('does not mistake ordinary words or short numbers for bank details', () => {
      expect(signals('Account for 12 people', CHAT)).toEqual([]);
      expect(signals('ABCDEFGHIJK games night', CHAT)).toEqual([]);
      expect(signals('Room KBRP0ARKING', CHAT)).toEqual([]);
    });
  });

  describe('payment asks', () => {
    it.each([
      'Pay me before Sunday',
      'Please send money to confirm your spot',
      'Entry ₹100, cash at the door',
      'Pay at the door',
      'GPay me after the game',
      'pay via GPay',
      'Transfer the amount by Friday',
      'transfer to my account',
      'DM for payment',
      'Scan to pay',
      // Hinglish
      'Bhai paise bhej do',
      'gpay kar do yaar',
      'paytm karo 200',
      'cash dena hoga entry pe',
      // Devanagari
      'पैसे भेजो',
      'पेमेंट कर दो',
      // Tenglish
      'dabbulu pampandi',
      'gpay cheyyi anna',
      'phonepe cheyandi',
      // Telugu
      'డబ్బులు పంపండి',
      'ఫోన్‌పే చేయండి',
    ])('catches %s', (text) => {
      expect(detectOffPlatformPayment(text, CHAT).flagged).toBe(true);
    });

    it('ignores negated asks', () => {
      expect(signals('No cash at the door, everything is in the app', FREE_PLAN)).toEqual([]);
      expect(signals('Never pay the host directly', FREE_PLAN)).toEqual([]);
      expect(signals('Dont send money to anyone', FREE_PLAN)).toEqual([]);
    });

    it('names payment apps as a signal in free plans and chats, not in paid plans', () => {
      expect(signals('Chai is on me, GPay later', FREE_PLAN)).toContain('payment_app');
      expect(signals('PhonePe works too', CHAT)).toContain('payment_app');
      expect(signals('పేటీఎం', CHAT)).toContain('payment_app');
      expect(signals('Pay in the app with UPI', PAID_PLAN)).toEqual([]);
      // An ask is still an ask in a paid plan.
      expect(signals('Or pay via GPay to skip the fee', PAID_PLAN)).toContain('payment_ask');
    });
  });

  describe('phone numbers', () => {
    it.each([
      'Call 9876543210',
      'WhatsApp +91 98765 43210',
      '+91-9876543210',
      '098765 43210',
      '987-654-3210',
      'reach me on +1 415 555 0100',
      'call ౯౮౭౬౫౪౩౨౧౦',
    ])('catches %s in plan descriptions', (text) => {
      expect(signals(text, FREE_PLAN)).toContain('phone_number');
    });

    it('allows phone numbers in chats', () => {
      expect(detectOffPlatformPayment('call me on 9876543210', CHAT).flagged).toBe(false);
    });
  });

  describe('things that must not be flagged', () => {
    it.each([
      ['a price in a paid plan', '₹200 per person, includes chai', PAID_PLAN],
      ['a range of prices', 'Tickets ₹1,500 to ₹2,000', PAID_PLAN],
      ['times', 'Starts 7:30 pm, ends 21:45', FREE_PLAN],
      ['a pincode', 'KBR Park, Jubilee Hills, Hyderabad 500033', FREE_PLAN],
      ['a date', 'See you on 23/11/2026 or 2026-11-30', FREE_PLAN],
      ['a year and counts', 'Since 2019, 40 runners, 5 km', FREE_PLAN],
      [
        'going dutch at a cafe',
        'We split the bill at the cafe, everyone orders their own',
        FREE_PLAN,
      ],
      ['the app checkout', 'Payments go through TouchGrass only', PAID_PLAN],
      ['ordinary words', 'Upbeat music, pay attention to the warmup', FREE_PLAN],
      ['a flat number', 'Flat 302, Road 12', FREE_PLAN],
      ['Hindi chat', 'चलो पार्क चलते हैं', CHAT],
      ['Telugu chat', 'బిర్యానీ తిందాం', CHAT],
      ['an empty text', '', FREE_PLAN],
    ] as const)('%s', (_label, text, opts) => {
      expect(detectOffPlatformPayment(text, opts)).toEqual({
        flagged: false,
        signals: [],
        matches: [],
      });
    });
  });
});

describe('plan and plan chat screens', () => {
  it('combine abuse with payment diversion and say why', () => {
    const plan = screenPlanTexts(['Sunday cricket', 'Entry 100, GPay rahul@okaxis'], {
      paid: false,
    });
    expect(plan).toMatchObject({ flagged: true, severity: 'medium', reasons: ['payment'] });
    expect(plan.matches).toContain('rahul@okaxis');

    const contact = screenPlanTexts(['Board games', 'Call 9876543210 if lost'], { paid: false });
    expect(contact.reasons).toEqual(['contact']);

    const both = screenPlanTexts(['shit', 'pay me'], { paid: false });
    expect(both).toMatchObject({ severity: 'medium', reasons: ['payment', 'content'] });

    expect(screenPlanTexts(['Sunday run', 'Chai after'], { paid: false })).toEqual({
      flagged: false,
      severity: null,
      matches: [],
      reasons: [],
    });
  });

  it('keep the abuse severity when it is higher', () => {
    expect(screenPlanTexts(['lanja', 'pay me'], { paid: false }).severity).toBe('high');
  });

  it('chats allow phone numbers but not payment asks', () => {
    expect(screenPlanChat('my number is 9876543210').flagged).toBe(false);
    expect(screenPlanChat('paise bhejo 9876543210@ybl').reasons).toEqual(['payment']);
    expect(screenPlanChat(null).flagged).toBe(false);
  });

  it('recognises payment QR codes and adds them as a payment hold', () => {
    expect(isPaymentQrPayload('upi://pay?pa=sam@ybl&pn=Sam&am=200')).toBe(true);
    expect(isPaymentQrPayload('sam@okaxis')).toBe(true);
    expect(isPaymentQrPayload('https://touchgrass.app/e/abc123')).toBe(false);
    expect(isPaymentQrPayload('tg1.check-in-ticket')).toBe(false);
    const clean = screenPlanChat('see you there');
    expect(withPaymentImage(clean)).toEqual({
      flagged: true,
      severity: 'medium',
      matches: [PAYMENT_QR_LABEL],
      reasons: ['payment'],
    });
    const abusive = withPaymentImage(screenPlanChat('lanja'));
    expect(abusive).toMatchObject({ severity: 'high', reasons: ['payment', 'content'] });
    expect(withPaymentImage(withPaymentImage(clean)).reasons).toEqual(['payment']);
  });

  it('tells the author about money first, then contact details', () => {
    expect(primaryHoldReason(['content', 'payment'])).toBe('payment');
    expect(primaryHoldReason(['content', 'contact'])).toBe('contact');
    expect(primaryHoldReason(['content'])).toBe('content');
    expect(primaryHoldReason([])).toBe('content');
  });
});
