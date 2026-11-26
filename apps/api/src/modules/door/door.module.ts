import { Module } from '@nestjs/common';
import { CitiesModule } from '../cities/cities.module.js';
import { EventsModule } from '../events/events.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { VenuesModule } from '../venues/venues.module.js';
import { DoorController } from './door.controller.js';
import { DoorService } from './door.service.js';

/** The venue door list for partner-venue staff (D-227). */
@Module({
  imports: [CitiesModule, EventsModule, ProfilesModule, VenuesModule],
  controllers: [DoorController],
  providers: [DoorService],
})
export class DoorModule {}
