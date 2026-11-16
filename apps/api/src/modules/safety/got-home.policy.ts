import { isLatePlan, LIMITS } from '@touchgrass/shared';

const G = LIMITS.safety.gotHome;

/** What we keep per member and plan (D-212). No row means nothing asked for, snoozed or answered yet. */
export interface GotHomeRow {
  requestedAt: Date | null;
  snoozes: number;
  askAfter: Date | null;
  homeAt: Date | null;
}

export interface GotHomeFacts {
  endsAt: Date;
  timezone: string;
  checkedIn: boolean;
  /** The member's "Ask me if I got home after late plans" setting. */
  settingOn: boolean;
  row: GotHomeRow | null;
  now: Date;
}

/** Late plans are asked about while the setting is on; a plan the member marked is asked about regardless. */
export function wantsGotHomeAsk(
  f: Pick<GotHomeFacts, 'endsAt' | 'timezone' | 'settingOn' | 'row'>,
): boolean {
  if (f.row?.requestedAt) return true;
  return f.settingOn && isLatePlan(f.endsAt, f.timezone);
}

/** Not answered, not waiting out a snooze, and the plan is over but not long over. */
function open(f: GotHomeFacts, from: number): boolean {
  if (!f.checkedIn || f.row?.homeAt) return false;
  if (!wantsGotHomeAsk(f)) return false;
  if (f.row?.askAfter && f.row.askAfter.getTime() > f.now.getTime()) return false;
  const t = f.now.getTime();
  return t >= from && t < f.endsAt.getTime() + G.windowMs;
}

/** The app shows "Got home safe?" as soon as the plan has ended. */
export function gotHomeDue(f: GotHomeFacts): boolean {
  return open(f, f.endsAt.getTime());
}

/** The push goes out a little after the end (the ride home), and again after each snooze. */
export function gotHomePushDue(f: GotHomeFacts): boolean {
  return open(f, f.endsAt.getTime() + G.delayMs);
}

/** "Not yet" works a few times, and only while the question is open. */
export function canSnoozeGotHome(f: GotHomeFacts): boolean {
  return gotHomeDue(f) && (f.row?.snoozes ?? 0) < G.maxSnoozes;
}

/** `reminder_log` kind for the nth ask (the first, then one per snooze), so each is sent once. */
export function gotHomeLogKind(snoozes: number): string {
  return `got_home_ask:${String(snoozes)}`;
}
