import { Injectable } from '@nestjs/common';
import { CheckInReader } from '../events/check-in-reader.js';
import { EventSearchService } from '../events/event-search.service.js';

export interface HeadcountFlag {
  id: string;
  reason: string;
  raisedAt: Date;
}

/**
 * Where open fake-headcount flags come from. By default D-227's `CheckInReader` (unreviewed flags on the plan);
 * tests can register another source.
 */
export interface HeadcountFlagSource {
  openFlags(eventId: string): Promise<HeadcountFlag[]>;
}

/**
 * What escrow needs to know about the door (D-229): who checked in (and when, for dispute evidence) and whether
 * anyone flagged the headcount. Check-ins come from the events module's search; flags from `CheckInReader`.
 */
@Injectable()
export class CheckInSignals {
  private flagSource: HeadcountFlagSource | null = null;

  constructor(
    private readonly search: EventSearchService,
    private readonly reader: CheckInReader,
  ) {}

  register(source: HeadcountFlagSource): void {
    if (this.flagSource) throw new Error('Headcount flag source already registered');
    this.flagSource = source;
  }

  checkIns(eventId: string): Promise<Map<string, { at: Date; method: string | null }>> {
    return this.search.checkIns(eventId);
  }

  openFlags(eventId: string): Promise<HeadcountFlag[]> {
    if (this.flagSource) return this.flagSource.openFlags(eventId);
    return this.reader.flags(eventId).then((flags) =>
      flags
        .filter((f) => f.reviewedAt === null)
        .map((f) => ({
          id: `${eventId}:${f.kind}`,
          reason: f.kind,
          raisedAt: new Date(f.flaggedAt),
        })),
    );
  }
}
