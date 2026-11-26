import {
  Body,
  Controller,
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
  AcceptTransferResult,
  ADMIN_SECTIONS,
  AdjustPayoutBody,
  AdminDisputeList,
  AdminDisputeQuery,
  AdminHeldPayoutList,
  CheckoutBody,
  CheckoutResult,
  CreateDisputeBody,
  CreateTicketTransferBody,
  DepositSettings,
  PaymentDispute,
  PaymentDisputeState,
  PlusOneCheckout,
  PlusOneLink,
  PlusOneTicket,
  ReleasePayoutBody,
  ResolveDisputeBody,
  TicketTransfer,
  TicketTransferList,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DisputesService } from './disputes.service.js';
import { PaidSeatsService } from './paid-seats.service.js';
import { PayoutsService } from './payouts.service.js';
import { TransfersService } from './transfers.service.js';

const ReceiptEmailOnly = z.object({ receiptEmail: z.email().max(254).nullable().default(null) });

/** Paid seats on a plan (D-229): offering a ticket, buying a +1, deposits. */
@ApiTags('payments')
@ApiBearerAuth()
@Controller({ path: 'events', version: '1' })
export class EventTicketsController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly paidSeats: PaidSeatsService,
  ) {}

  @Post(':id/ticket-transfers')
  @Idempotent()
  @RateLimit({ name: 'ticket-transfer', limit: 20, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(CreateTicketTransferBody)
  @ApiZodResponse(201, TicketTransfer)
  offer(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CreateTicketTransferBody)) body: Dto.CreateTicketTransferBody,
  ): Promise<Dto.TicketTransfer> {
    return this.transfers.offer(user.userId, id, body);
  }

  @Post(':id/plus-one-checkout')
  @Idempotent()
  @RateLimit({ name: 'checkout', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(ReceiptEmailOnly)
  @ApiZodResponse(201, PlusOneCheckout)
  plusOneCheckout(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReceiptEmailOnly)) body: z.infer<typeof ReceiptEmailOnly>,
  ): Promise<Dto.PlusOneCheckout> {
    return this.paidSeats.plusOneCheckout(user.userId, id, body.receiptEmail);
  }

  @Get(':id/plus-one-ticket')
  @ApiZodResponse(200, PlusOneTicket)
  plusOneTicket(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.PlusOneTicket> {
    return this.paidSeats.plusOneTicket(user.userId, id);
  }

  @Post(':id/plus-one-ticket/link')
  @RateLimit({ name: 'plus-one-link', limit: 10, windowSeconds: 3600, by: 'user' })
  @ApiZodResponse(201, PlusOneLink)
  plusOneLink(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.PlusOneLink> {
    return this.paidSeats.newPlusOneLink(user.userId, id);
  }

  @Get(':id/deposit')
  @ApiZodResponse(200, DepositSettings)
  deposit(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.DepositSettings> {
    return this.paidSeats.deposit(user.userId, id);
  }

  @Put(':id/deposit')
  @ApiZodBody(DepositSettings)
  @ApiZodResponse(200, DepositSettings)
  setDeposit(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(DepositSettings)) body: Dto.DepositSettings,
  ): Promise<Dto.DepositSettings> {
    return this.paidSeats.setDeposit(user.userId, id, body);
  }

  @Post(':id/deposit-checkout')
  @Idempotent()
  @RateLimit({ name: 'checkout', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(CheckoutBody)
  @ApiZodResponse(201, CheckoutResult)
  depositCheckout(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CheckoutBody)) body: Dto.CheckoutBody,
  ): Promise<Dto.CheckoutResult> {
    return this.paidSeats.depositCheckout(user.userId, id, body);
  }
}

/** Ticket offers between members (D-229). */
@ApiTags('payments')
@ApiBearerAuth()
@Controller({ path: 'ticket-transfers', version: '1' })
export class TicketTransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @ApiZodResponse(200, TicketTransferList)
  list(@CurrentUser() user: AuthPrincipal): Promise<Dto.TicketTransferList> {
    return this.transfers.list(user.userId);
  }

  @Get(':id')
  @ApiZodResponse(200, TicketTransfer)
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.TicketTransfer> {
    return this.transfers.get(user.userId, id);
  }

  @Post(':id/accept')
  @Idempotent()
  @RateLimit({ name: 'checkout', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodResponse(201, AcceptTransferResult)
  accept(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.AcceptTransferResult> {
    return this.transfers.accept(user.userId, id);
  }

  @Post(':id/decline')
  @HttpCode(204)
  async decline(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.transfers.decline(user.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.transfers.cancel(user.userId, id);
  }
}

/** A buyer reports a problem with a payment (D-229). */
@ApiTags('payments')
@ApiBearerAuth()
@Controller({ path: 'payments', version: '1' })
export class PaymentDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post(':id/disputes')
  @Idempotent()
  @RateLimit({ name: 'payment-dispute', limit: 5, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CreateDisputeBody)
  @ApiZodResponse(201, PaymentDispute)
  open(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CreateDisputeBody)) body: Dto.CreateDisputeBody,
  ): Promise<Dto.PaymentDispute> {
    return this.disputes.open(user.userId, id, body);
  }

  @Get(':id/dispute')
  @ApiZodResponse(200, PaymentDisputeState)
  async latest(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.PaymentDisputeState> {
    return { dispute: await this.disputes.latest(user.userId, id) };
  }
}

/**
 * Escrow review (D-229): held payouts with their evidence, disputes with check-in times. Reading follows the
 * payments section; releasing, adjusting and answering move money, so they need `payoutReview`.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminTicketsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly disputes: DisputesService,
  ) {}

  @Get('payouts/held')
  @Roles(...ADMIN_SECTIONS.payments)
  @ApiZodResponse(200, AdminHeldPayoutList)
  held(@CurrentUser() user: AuthPrincipal): Promise<Dto.AdminHeldPayoutList> {
    return this.payouts.held(user.userId);
  }

  @Post('payouts/:id/release')
  @Roles(...ADMIN_SECTIONS.payoutReview)
  @HttpCode(204)
  @ApiZodBody(ReleasePayoutBody)
  async release(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReleasePayoutBody)) body: Dto.ReleasePayoutBody,
  ): Promise<void> {
    await this.payouts.release(user.userId, id, body.note);
  }

  @Post('payouts/:id/adjust')
  @Roles(...ADMIN_SECTIONS.payoutReview)
  @HttpCode(204)
  @ApiZodBody(AdjustPayoutBody)
  async adjust(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AdjustPayoutBody)) body: Dto.AdjustPayoutBody,
  ): Promise<void> {
    await this.payouts.adjust(user.userId, id, body.netPaise, body.note);
  }

  @Get('payment-disputes')
  @Roles(...ADMIN_SECTIONS.payments)
  @ApiZodQuery(AdminDisputeQuery)
  @ApiZodResponse(200, AdminDisputeList)
  disputesList(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(AdminDisputeQuery)) q: Dto.AdminDisputeQuery,
  ): Promise<Dto.AdminDisputeList> {
    return this.disputes.list(user.userId, q.status);
  }

  @Post('payment-disputes/:id/resolve')
  @Roles(...ADMIN_SECTIONS.payoutReview)
  @HttpCode(204)
  @ApiZodBody(ResolveDisputeBody)
  async resolve(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ResolveDisputeBody)) body: Dto.ResolveDisputeBody,
  ): Promise<void> {
    await this.disputes.resolve(user.userId, id, body);
  }
}
