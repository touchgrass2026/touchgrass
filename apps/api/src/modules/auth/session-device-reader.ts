import { Inject, Injectable, Module } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { pepperedHash } from '../../common/auth/hashing.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { userSessions } from '../../infra/database/schema/index.js';

/**
 * Read side of sessions with no module dependencies (D-227): a peppered hash of the app install behind a
 * session, so check-ins can spot several accounts used from one phone without ever storing the device id.
 */
@Injectable()
export class SessionDeviceReader {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async deviceHash(sessionId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ deviceId: userSessions.deviceId })
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);
    return row ? pepperedHash(this.env.TOKEN_HASH_PEPPER, `device:${row.deviceId}`) : null;
  }
}

@Module({ providers: [SessionDeviceReader], exports: [SessionDeviceReader] })
export class SessionDeviceReaderModule {}
