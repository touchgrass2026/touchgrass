import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { PAYMENT_STRIKE_RECORDED_EVENT } from '../moderation/sanctions-reader.js';
import { HostConductService } from './host-conduct.service.js';

/** Worker: confirmed payment strikes warn the host, and remove hosting at the limit (D-228). */
@Injectable()
export class HostingHandlers {
  constructor(private readonly conduct: HostConductService) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(PAYMENT_STRIKE_RECORDED_EVENT, 'hosting.payment-strike', async (e) => {
      await this.conduct.onStrike(String(e.payload.userId), new Date(e.occurredAt));
    });
  }
}
