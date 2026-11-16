import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventHooks } from '../events/event-hooks.js';
import { EventsModule } from '../events/events.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { ReportTargetRegistry } from '../social/reports/report-targets.registry.js';
import { SocialModule } from '../social/social.module.js';
import { LoreController } from './lore.controller.js';
import { LoreHandlers } from './lore.handlers.js';
import { LoreRetentionService } from './lore-retention.service.js';
import { LoreService } from './lore.service.js';

/** Lore albums (Phase 7, F-AFT-04; 7-day window D-218). */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    MediaModule,
    ModerationModule,
    NotificationsModule,
    ProfilesModule,
    RemindersModule,
    SocialGraphModule,
    SocialModule,
  ],
  controllers: [LoreController],
  providers: [LoreService, LoreHandlers, LoreRetentionService],
  exports: [LoreService, LoreHandlers, LoreRetentionService],
})
export class LoreModule implements OnModuleInit {
  constructor(
    private readonly lore: LoreService,
    private readonly hooks: EventHooks,
    private readonly targets: ReportTargetRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.hooks.register({
      lore: async (userId, core, facts) => {
        const s = await this.lore.summaryFor(userId, core, facts);
        return s ? { count: s.count, canAdd: s.canAdd, closesAt: s.closesAt } : null;
      },
    });
    this.targets.register({
      type: 'lore_media',
      resolve: (reporterId, id) => this.lore.reportTarget(reporterId, id),
    });
    this.moderationTargets.register({
      type: 'lore_media',
      preview: (id) => this.lore.moderationPreview(id),
      release: (id, tx) => this.lore.releaseCaption(id, tx),
      remove: (id, tx) => this.lore.removeForModeration(id, tx),
    });
    this.accountData.register({
      name: 'lore',
      export: (userId) => this.lore.exportFor(userId),
      erase: async (userId, tx) => {
        await this.lore.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
