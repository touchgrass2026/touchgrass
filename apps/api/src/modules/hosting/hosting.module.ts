import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventHooks } from '../events/event-hooks.js';
import { EventsModule } from '../events/events.module.js';
import { EventStatsModule } from '../events/stats/event-stats.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { FeedbackReader } from './feedback-reader.js';
import { HostAnalyticsService } from './host-analytics.service.js';
import { HostConductService } from './host-conduct.service.js';
import {
  HostApplicationsAdminController,
  HostingAdminController,
  HostingController,
} from './hosting.controller.js';
import { HostingHandlers } from './hosting.handlers.js';
import { HostingService } from './hosting.service.js';

/** Hosting (Phase 6): who may sell tickets (F-HST-01) and host insights (F-HST-02). */
@Module({
  imports: [
    AccountModule,

    EventsModule,
    EventStatsModule,
    ModerationModule,
    NotificationsModule,
    PaymentsModule,
    PlatformModule,
    ProfilesModule,
    UsersModule,
  ],
  controllers: [HostingController, HostApplicationsAdminController, HostingAdminController],
  providers: [
    HostingService,
    HostAnalyticsService,
    FeedbackReader,
    HostConductService,
    HostingHandlers,
  ],
  exports: [HostingService, FeedbackReader, HostConductService, HostingHandlers],
})
export class HostingModule implements OnModuleInit {
  constructor(
    private readonly hosting: HostingService,
    private readonly conduct: HostConductService,
    private readonly hooks: EventHooks,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.hooks.register({
      canHostPaid: (userId) => this.hosting.canHostPaid(userId),
      assertCanHost: (userId) => this.conduct.assertCanHost(userId),
    });
    this.accountData.register({
      name: 'hosting',
      export: (userId) => this.hosting.exportFor(userId),
      erase: async (userId, tx) => {
        await this.hosting.eraseFor(userId, tx);
        return undefined;
      },
    });
    this.accountData.register({
      name: 'host-standing',
      export: (userId) => this.conduct.exportFor(userId),
      erase: async (userId, tx) => {
        await this.conduct.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
