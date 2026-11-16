import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import { UsersModule } from '../users/users.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { RemindersHandlers } from './reminders.handlers.js';
import { RemindersService } from './reminders.service.js';
import { SquadSignalsService } from './squad-signals.service.js';
import { WeekendDigestService } from './weekend-digest.service.js';

/** Reminders and activity notifications (Phase 10, F-NOT-02). */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    NotificationsModule,
    ProfilesModule,
    CitiesModule,
    SocialGraphModule,
    DiscoveryModule,
    UsersModule,
  ],
  providers: [RemindersService, RemindersHandlers, SquadSignalsService, WeekendDigestService],
  exports: [RemindersService, RemindersHandlers, SquadSignalsService, WeekendDigestService],
})
export class RemindersModule {}
