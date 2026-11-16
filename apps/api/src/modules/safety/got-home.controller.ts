import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  GotHomeRequestBody,
  GotHomeStatus,
  SafetySettings,
  UpdateSafetySettingsBody,
} from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { GotHomeService } from './got-home.service.js';

/** Safety settings and "Got home safe?" (D-212). */
@ApiTags('safety')
@ApiBearerAuth()
@Controller({ path: 'safety', version: '1' })
export class GotHomeController {
  constructor(private readonly gotHome: GotHomeService) {}

  @Get('settings')
  @ApiZodResponse(200, SafetySettings)
  settings(@CurrentUser() user: AuthPrincipal): Promise<Dto.SafetySettings> {
    return this.gotHome.settings(user.userId);
  }

  @Patch('settings')
  @ApiZodBody(UpdateSafetySettingsBody)
  @ApiZodResponse(200, SafetySettings)
  updateSettings(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpdateSafetySettingsBody)) body: Dto.UpdateSafetySettingsBody,
  ): Promise<Dto.SafetySettings> {
    return this.gotHome.updateSettings(user.userId, body);
  }

  @Get('got-home/:eventId')
  @ApiZodResponse(200, GotHomeStatus)
  status(
    @CurrentUser() user: AuthPrincipal,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
  ): Promise<Dto.GotHomeStatus> {
    return this.gotHome.status(user.userId, eventId);
  }

  @Post('got-home/:eventId/request')
  @HttpCode(200)
  @ApiZodBody(GotHomeRequestBody)
  @ApiZodResponse(200, GotHomeStatus)
  request(
    @CurrentUser() user: AuthPrincipal,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Body(new ZodPipe(GotHomeRequestBody)) body: Dto.GotHomeRequestBody,
  ): Promise<Dto.GotHomeStatus> {
    return this.gotHome.request(user.userId, eventId, body.ask);
  }

  @Post('got-home/:eventId/home')
  @HttpCode(200)
  @Idempotent()
  @ApiZodResponse(200, GotHomeStatus)
  home(
    @CurrentUser() user: AuthPrincipal,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
  ): Promise<Dto.GotHomeStatus> {
    return this.gotHome.markHome(user.userId, eventId);
  }

  @Post('got-home/:eventId/snooze')
  @HttpCode(200)
  @Idempotent()
  @RateLimit({ name: 'got-home-snooze', limit: 20, windowSeconds: 3600, by: 'user' })
  @ApiZodResponse(200, GotHomeStatus)
  snooze(
    @CurrentUser() user: AuthPrincipal,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
  ): Promise<Dto.GotHomeStatus> {
    return this.gotHome.snooze(user.userId, eventId);
  }
}
