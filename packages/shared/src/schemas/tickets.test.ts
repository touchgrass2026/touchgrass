import { describe, expect, it } from 'vitest';
import { LIMITS } from '../constants';
import {
  AdjustPayoutBody,
  CreateDisputeBody,
  CreateTicketTransferBody,
  DepositSettings,
  ResolveDisputeBody,
  resalePriceAllowed,
  transferClosesAt,
} from './tickets';

describe('ticket rules (D-229)', () => {
  it('transfers close when check-in opens', () => {
    const start = new Date('2026-12-01T13:30:00.000Z');
    expect(transferClosesAt(start).getTime()).toBe(start.getTime() - LIMITS.checkIn.windowBeforeMs);
  });

  it('caps a resale at the original price, never below zero', () => {
    expect(resalePriceAllowed(0, 50_000)).toBe(true);
    expect(resalePriceAllowed(50_000, 50_000)).toBe(true);
    expect(resalePriceAllowed(50_001, 50_000)).toBe(false);
    expect(resalePriceAllowed(-1, 50_000)).toBe(false);
    expect(resalePriceAllowed(10.5, 50_000)).toBe(false);
  });
});

describe('ticket schemas', () => {
  it('a transfer is free unless priced', () => {
    const id = '0190d0c8-7a1e-7000-8000-000000000001';
    expect(CreateTicketTransferBody.parse({ toUserId: id })).toEqual({
      toUserId: id,
      pricePaise: 0,
    });
    expect(CreateTicketTransferBody.safeParse({ toUserId: id, pricePaise: -5 }).success).toBe(
      false,
    );
  });

  it('deposits stay inside the platform limits', () => {
    expect(DepositSettings.parse({ amountPaise: null }).amountPaise).toBeNull();
    expect(
      DepositSettings.safeParse({ amountPaise: LIMITS.payments.depositMinPaise - 1 }).success,
    ).toBe(false);
    expect(
      DepositSettings.safeParse({ amountPaise: LIMITS.payments.depositMaxPaise + 1 }).success,
    ).toBe(false);
  });

  it('admin decisions carry a note for the audit log', () => {
    expect(ResolveDisputeBody.safeParse({ decision: 'reject', note: '' }).success).toBe(false);
    expect(ResolveDisputeBody.parse({ decision: 'refund', note: 'Not admitted' }).amountPaise).toBe(
      undefined,
    );
    expect(AdjustPayoutBody.safeParse({ netPaise: 100, note: 'ok' }).success).toBe(false);
    expect(CreateDisputeBody.parse({ reason: 'OTHER' }).note).toBe('');
  });
});
