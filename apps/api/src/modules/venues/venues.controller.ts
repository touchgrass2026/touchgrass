import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  LIMITS,
  ReverseGeocodeQuery,
  ReverseGeocodeResponse,
  Venue,
  VenueFromPlaceBody,
  VenueList,
  VenueSearchQuery,
  VenueSearchResponse,
} from '@touchgrass/shared';
import { AppError } from '../../common/errors/app-error.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { VenuesService } from './venues.service.js';

@ApiTags('venues')
@ApiBearerAuth()
@Controller({ path: 'venues', version: '1' })
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  /**
   * Known venues plus Google Places suggestions for the "where" step of plotting: up to 4 known venues and up to
   * 8 map places (D-203; Google itself returns at most 5 per request).
   */
  @Get('search')
  @RateLimit({ name: 'venue-search', limit: 120, windowSeconds: 60, by: 'user' })
  @ApiZodQuery(VenueSearchQuery)
  @ApiZodResponse(200, VenueSearchResponse)
  async search(
    @Query(new ZodPipe(VenueSearchQuery)) q: Dto.VenueSearchQuery,
  ): Promise<Dto.VenueSearchResponse> {
    const near = { lat: q.lat, lng: q.lng };
    const [known, places] = await Promise.all([
      this.venues.search(q.q, near, LIMITS.placeSearch.knownVenues),
      this.venues.autocomplete(q.q, near, q.session),
    ]);
    return {
      venues: await this.venues.toDto(known),
      places: places.slice(0, LIMITS.placeSearch.mapPlaces),
    };
  }

  /** "Drop a pin" (D-203): a suggested address for the spot, and whether it is inside a city we serve. */
  @Get('reverse-geocode')
  @RateLimit({ name: 'venue-reverse-geocode', limit: 30, windowSeconds: 60, by: 'user' })
  @ApiZodQuery(ReverseGeocodeQuery)
  @ApiZodResponse(200, ReverseGeocodeResponse)
  reverseGeocode(
    @Query(new ZodPipe(ReverseGeocodeQuery)) q: Dto.ReverseGeocodeQuery,
  ): Promise<Dto.ReverseGeocodeResponse> {
    return this.venues.reverseGeocode({ lat: q.lat, lng: q.lng });
  }

  @Post('from-place')
  @HttpCode(200)
  @ApiZodBody(VenueFromPlaceBody)
  @ApiZodResponse(200, Venue)
  async fromPlace(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(VenueFromPlaceBody)) body: Dto.VenueFromPlaceBody,
  ): Promise<Dto.Venue> {
    const [dto] = await this.venues.toDto([
      await this.venues.fromPlace(body.placeId, body.sessionToken, user.userId),
    ]);
    if (!dto) throw AppError.notFound('Venue');
    return dto;
  }

  @Get('saved')
  @ApiZodResponse(200, VenueList)
  async saved(@CurrentUser() user: AuthPrincipal): Promise<Dto.VenueList> {
    return { items: await this.venues.toDto(await this.venues.saved(user.userId)) };
  }

  @Put('saved/:id')
  @HttpCode(204)
  async save(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.venues.save(user.userId, id);
  }

  @Delete('saved/:id')
  @HttpCode(204)
  async unsave(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.venues.unsave(user.userId, id);
  }
}
