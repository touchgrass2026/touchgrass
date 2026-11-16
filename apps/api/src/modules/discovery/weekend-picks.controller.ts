import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import { WeekendPicks, WeekendPicksQuery } from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { WeekendPicksService } from './weekend-picks.service.js';

/** The "This weekend" digest screen (D-211). */
@ApiTags('discovery')
@ApiBearerAuth()
@Controller({ path: 'discover', version: '1' })
export class WeekendPicksController {
  constructor(private readonly weekend: WeekendPicksService) {}

  @Get('weekend')
  @RateLimit({ name: 'weekend-picks', limit: 60, windowSeconds: 60, by: 'user' })
  @ApiZodQuery(WeekendPicksQuery)
  @ApiZodResponse(200, WeekendPicks)
  picks(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(WeekendPicksQuery)) q: Dto.WeekendPicksQuery,
  ): Promise<Dto.WeekendPicks> {
    return this.weekend.forViewer(user.userId, q.ids);
  }
}
