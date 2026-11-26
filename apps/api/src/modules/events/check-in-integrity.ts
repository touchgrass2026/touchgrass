import { type CheckInFlagKind, type GeoPoint, LIMITS } from '@touchgrass/shared';
import { createHmac } from 'node:crypto';
import { safeEqualHex } from '../../common/auth/hashing.js';

/**
 * Check-in integrity rules (D-227), pure so each rule is unit-tested on its own.
 *
 * Tickets rotate: the QR payload and the six-digit code are signed for one person, one plan and one 30-second
 * step, so a screenshot stops working within a minute. A code from the step just before still scans, so a
 * code shown as it rotates is not refused.
 */

const C = LIMITS.checkIn;
const PREFIX = 'tg2';
const LEGACY_PREFIX = 'tg1.';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN_RE = new RegExp(`^${PREFIX}\\.(${UUID})\\.(${UUID})\\.(\\d{1,12})\\.([0-9a-f]{32})$`);

export type TicketProblem = 'INVALID_TICKET' | 'TICKET_EXPIRED';
export type TicketCheck =
  | { ok: true; eventId: string; userId: string; step: number }
  | { ok: false; reason: TicketProblem };

export function ticketStep(now: Date): number {
  return Math.floor(now.getTime() / C.ticketStepMs);
}

/** When the code for `step` stops being the current one. */
export function stepEndsAt(step: number): Date {
  return new Date((step + 1) * C.ticketStepMs);
}

function mac(secret: string, message: string): Buffer {
  return createHmac('sha256', secret).update(message).digest();
}

function signature(secret: string, eventId: string, userId: string, step: number): string {
  return mac(secret, `ticket:v2:${eventId}:${userId}:${step}`).toString('hex').slice(0, 32);
}

/** The QR payload for one person at one plan during one step. */
export function ticketToken(secret: string, eventId: string, userId: string, step: number): string {
  return `${PREFIX}.${eventId}.${userId}.${step}.${signature(secret, eventId, userId, step)}`;
}

/** The short code that rotates with the QR (HOTP-style dynamic truncation, zero-padded). */
export function ticketShortCode(
  secret: string,
  eventId: string,
  userId: string,
  step: number,
): string {
  const d = mac(secret, `code:v2:${eventId}:${userId}:${step}`);
  const offset = (d[d.length - 1] ?? 0) & 0x0f;
  const bin = d.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** C.ticketCodeDigits).padStart(C.ticketCodeDigits, '0');
}

/** Steps whose codes are accepted at `nowStep`: the current one and the grace steps before it. */
export function acceptedSteps(nowStep: number): number[] {
  const out: number[] = [];
  for (let s = nowStep; s >= nowStep - C.ticketGraceSteps; s -= 1) out.push(s);
  return out;
}

/**
 * Verifies a scanned QR payload. Forged or garbled payloads are invalid; a validly signed one from an older
 * step (or a static ticket from before D-227) has expired, so the person is asked for the current code.
 */
export function verifyTicket(secret: string, raw: string, nowStep: number): TicketCheck {
  const qr = raw.trim().toLowerCase();
  if (qr.startsWith(LEGACY_PREFIX)) return { ok: false, reason: 'TICKET_EXPIRED' };
  const m = TOKEN_RE.exec(qr);
  if (!m?.[1] || !m[2] || !m[3] || !m[4]) return { ok: false, reason: 'INVALID_TICKET' };
  const step = Number(m[3]);
  if (!safeEqualHex(m[4], signature(secret, m[1], m[2], step)))
    return { ok: false, reason: 'INVALID_TICKET' };
  // One step of slack ahead covers clocks a little apart across API processes.
  if (step > nowStep + 1 || step < nowStep - C.ticketGraceSteps)
    return { ok: false, reason: 'TICKET_EXPIRED' };
  return { ok: true, eventId: m[1], userId: m[2], step };
}

export type CodeMatch =
  { ok: true; eventId: string; userId: string } | { ok: false; reason: 'CODE_UNKNOWN' };

/**
 * Finds whose short code this is among the people holding a seat at the candidate plans. No match, or more than
 * one (two codes can collide), is refused; the next code a few seconds later settles it.
 */
export function matchShortCode(
  secret: string,
  code: string,
  candidates: { eventId: string; userIds: string[] }[],
  nowStep: number,
): CodeMatch {
  const found = new Map<string, { eventId: string; userId: string }>();
  for (const step of acceptedSteps(nowStep))
    for (const { eventId, userIds } of candidates)
      for (const userId of userIds)
        if (ticketShortCode(secret, eventId, userId, step) === code)
          found.set(`${eventId}:${userId}`, { eventId, userId });
  const [only, ...rest] = [...found.values()];
  return only && rest.length === 0 ? { ok: true, ...only } : { ok: false, reason: 'CODE_UNKNOWN' };
}

/** Rounds a point to about 110 m, so no precise location is ever stored for a check-in. */
export function coarsen(point: GeoPoint): GeoPoint {
  const f = 10 ** C.coarseDecimals;
  return { lat: Math.round(point.lat * f) / f, lng: Math.round(point.lng * f) / f };
}

export interface CheckInSignal {
  userId: string;
  deviceHash: string | null;
  /** Metres from the true spot, when a location was known. */
  distanceM: number | null;
}

/**
 * Fake-headcount rules (D-227). `shared_device`: several different people checked in from one phone (people
 * signing in and out of accounts to inflate a count). `far_from_spot`: several check-ins far from the spot (a
 * host scanning codes sent from elsewhere). Each flag carries its count, so a reviewer sees how far off it is.
 */
export function headcountFlags(
  signals: CheckInSignal[],
): { kind: CheckInFlagKind; count: number }[] {
  const flags: { kind: CheckInFlagKind; count: number }[] = [];
  const byDevice = new Map<string, Set<string>>();
  for (const s of signals) {
    if (!s.deviceHash) continue;
    const people = byDevice.get(s.deviceHash) ?? new Set<string>();
    people.add(s.userId);
    byDevice.set(s.deviceHash, people);
  }
  const shared = Math.max(0, ...[...byDevice.values()].map((p) => p.size));
  if (shared >= C.sharedDeviceFlagAt) flags.push({ kind: 'shared_device', count: shared });
  const far = new Set(
    signals
      .filter((s) => s.distanceM !== null && s.distanceM > C.farFromSpotMeters)
      .map((s) => s.userId),
  ).size;
  if (far >= C.farFromSpotFlagAt) flags.push({ kind: 'far_from_spot', count: far });
  return flags;
}
