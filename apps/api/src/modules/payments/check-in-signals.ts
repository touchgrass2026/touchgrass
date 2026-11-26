import { Injectable } from '@nestjs/common';
import { EventSearchService } from '../events/event-search.service.js';

export interface HeadcountFlag {
  id: string;
  reason: string;
  raisedAt: Date;
}

/**
 * Where open fake-headcount flags come from (D-227's `CheckInReader`, D-229). Registered at start-up, so this
 * port does not depend on the door tools: `register({ openFlags: async (id) => (await reader.flags(id))
 * .filter((f) => f.reviewedAt === null).map((f) => ({ id: `${id}:${f.kind}`, reason: f.kind, raisedAt:
 * new Date(f.flaggedAt) })) })`. Until one registers, no plan has flags.
 */
export interface HeadcountFlagSource {
  openFlags(eventId: string): Promise<HeadcountFlag[]>;
}

/**
 * What escrow needs to know about the door (D-229): who checked in (and when, for dispute evidence) and whether
 * anyone flagged the headcount. Check-ins come from the events module's reader; flags from a registered source.
 */
@Injectable()
export class CheckInSignals {
  private flagSource: HeadcountFlagSource | null = null;

  constructor(private readonly search: EventSearchService) {}

  register(source: HeadcountFlagSource): void {
    if (this.flagSource) throw new Error('Headcount flag source already registered');
    this.flagSource = source;
  }

  checkIns(eventId: string): Promise<Map<string, { at: Date; method: string | null }>> {
    return this.search.checkIns(eventId);
  }

  openFlags(eventId: string): Promise<HeadcountFlag[]> {
    return this.flagSource ? this.flagSource.openFlags(eventId) : Promise.resolve([]);
  }
}
