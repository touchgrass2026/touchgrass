import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  DoorCheckInBody,
  DoorCheckInResult,
  DoorList,
  DoorSession,
  DoorSessionBody,
} from '@touchgrass/shared';
import { Public } from '../../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DoorService } from './door.service.js';

/** The header carrying a venue door session (D-227). */
export const DOOR_TOKEN_HEADER = 'x-door-token';

/**
 * Venue staff at the door (D-227). Staff have no TouchGrass account: they sign in with the venue's staff PIN and
 * send the signed door session on every call.
 */
@ApiTags('door')
@Controller({ path: 'door', version: '1' })
export class DoorController {
  constructor(private readonly door: DoorService) {}

  @Post('sessions')
  @Public()
  @HttpCode(201)
  @RateLimit({ name: 'door-sign-in', limit: 20, windowSeconds: 3600, by: 'ip' })
  @ApiZodBody(DoorSessionBody)
  @ApiZodResponse(201, DoorSession)
  signIn(@Body(new ZodPipe(DoorSessionBody)) body: Dto.DoorSessionBody): Promise<Dto.DoorSession> {
    return this.door.signIn(body);
  }

  @Get('list')
  @Public()
  @RateLimit({ name: 'door-list', limit: 600, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, DoorList)
  list(@Headers(DOOR_TOKEN_HEADER) token: string | undefined): Promise<Dto.DoorList> {
    return this.door.list(this.door.venueOf(token));
  }

  @Post('check-in')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'door-check-in', limit: 600, windowSeconds: 3600, by: 'ip' })
  @ApiZodBody(DoorCheckInBody)
  @ApiZodResponse(200, DoorCheckInResult)
  checkIn(
    @Headers(DOOR_TOKEN_HEADER) token: string | undefined,
    @Body(new ZodPipe(DoorCheckInBody)) body: Dto.DoorCheckInBody,
  ): Promise<Dto.DoorCheckInResult> {
    return this.door.checkIn(this.door.venueOf(token), body.ticket);
  }
}
