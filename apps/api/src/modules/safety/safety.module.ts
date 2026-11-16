import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { UsersModule } from '../users/users.module.js';
import { GotHomeController } from './got-home.controller.js';
import { GotHomeService } from './got-home.service.js';
import { PublicLiveController, SafetyController } from './safety.controller.js';
import { SafetyService } from './safety.service.js';

/** Trusted contacts, live location sharing and SOS (Phase 9, F-SAF-04, F-WEB-02), and "Got home safe?" (D-212). */
@Module({
  imports: [
    AccountModule,
    CitiesModule,
    EventsModule,
    NotificationsModule,
    PlatformModule,
    ProfilesModule,
    RemindersModule,
    UsersModule,
  ],
  controllers: [SafetyController, PublicLiveController, GotHomeController],
  providers: [SafetyService, GotHomeService],
  exports: [SafetyService, GotHomeService],
})
export class SafetyModule implements OnModuleInit {
  constructor(
    private readonly safety: SafetyService,
    private readonly gotHome: GotHomeService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'safety',
      export: (userId) => this.safety.exportFor(userId),
      erase: async (userId, tx) => {
        await this.safety.eraseFor(userId, tx);
        return undefined;
      },
    });
    // "Got home safe?" settings and answers (D-212).
    this.accountData.register({
      name: 'safety-got-home',
      export: (userId) => this.gotHome.exportFor(userId),
      erase: async (userId, tx) => {
        await this.gotHome.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
