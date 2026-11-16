import { describe, expect, it } from 'vitest';
import {
  canSnoozeGotHome,
  type GotHomeFacts,
  gotHomeDue,
  gotHomeLogKind,
  gotHomePushDue,
  wantsGotHomeAsk,
} from './got-home.policy.js';

const MIN = 60_000;
// 22:00 IST.
const LATE_END = new Date('2026-11-14T16:30:00Z');
// 18:00 IST.
const EARLY_END = new Date('2026-11-14T12:30:00Z');

const facts = (over: Partial<GotHomeFacts> = {}): GotHomeFacts => ({
  endsAt: LATE_END,
  timezone: 'Asia/Kolkata',
  checkedIn: true,
  settingOn: true,
  row: null,
  now: new Date(LATE_END.getTime() + 31 * MIN),
  ...over,
});
const row = (over: Partial<NonNullable<GotHomeFacts['row']>> = {}) => ({
  requestedAt: null,
  snoozes: 0,
  askAfter: null,
  homeAt: null,
  ...over,
});

describe('"Got home safe?" policy (D-212)', () => {
  it('late plans are asked about in the plan zone; earlier ones only when the member asked', () => {
    expect(wantsGotHomeAsk(facts())).toBe(true);
    expect(wantsGotHomeAsk(facts({ endsAt: EARLY_END }))).toBe(false);
    // 18:00 IST is 01:30 in Auckland: the plan's zone, not IST, decides.
    expect(wantsGotHomeAsk(facts({ endsAt: EARLY_END, timezone: 'Pacific/Auckland' }))).toBe(true);
    expect(
      wantsGotHomeAsk(facts({ endsAt: EARLY_END, row: row({ requestedAt: EARLY_END }) })),
    ).toBe(true);
  });

  it('the setting switches the late-plan ask off, but not a plan the member marked', () => {
    expect(wantsGotHomeAsk(facts({ settingOn: false }))).toBe(false);
    expect(wantsGotHomeAsk(facts({ settingOn: false, row: row({ requestedAt: LATE_END }) }))).toBe(
      true,
    );
  });

  it('the push waits 30 minutes after the end; the app asks as soon as it ends; both stop after 6 hours', () => {
    const at = (m: number) => new Date(LATE_END.getTime() + m * MIN);
    expect(gotHomePushDue(facts({ now: at(29) }))).toBe(false);
    expect(gotHomePushDue(facts({ now: at(30) }))).toBe(true);
    expect(gotHomeDue(facts({ now: at(-1) }))).toBe(false);
    expect(gotHomeDue(facts({ now: at(0) }))).toBe(true);
    expect(gotHomeDue(facts({ now: at(6 * 60) }))).toBe(false);
  });

  it('only checked-in members, and never again once they got home', () => {
    expect(gotHomeDue(facts({ checkedIn: false }))).toBe(false);
    expect(gotHomeDue(facts({ row: row({ homeAt: LATE_END }) }))).toBe(false);
  });

  it('"Not yet" holds the question until its time, three times at most', () => {
    const now = facts().now;
    const later = new Date(now.getTime() + 30 * MIN);
    expect(gotHomeDue(facts({ row: row({ snoozes: 1, askAfter: later }) }))).toBe(false);
    expect(gotHomeDue(facts({ now: later, row: row({ snoozes: 1, askAfter: later }) }))).toBe(true);
    expect(canSnoozeGotHome(facts({ row: row({ snoozes: 2 }) }))).toBe(true);
    expect(canSnoozeGotHome(facts({ row: row({ snoozes: 3 }) }))).toBe(false);
    expect(canSnoozeGotHome(facts({ checkedIn: false }))).toBe(false);
  });

  it('each ask has its own reminder_log kind, so a snooze can ask again exactly once', () => {
    expect(gotHomeLogKind(0)).toBe('got_home_ask:0');
    expect(gotHomeLogKind(2)).not.toBe(gotHomeLogKind(1));
  });
});
