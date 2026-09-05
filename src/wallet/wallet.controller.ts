import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { clampLimit, clampOffset } from '../common/utils/pagination.util';
import { WalletService } from './wallet.service';
import { RequestFuelSupportDto, RequestPayoutDto } from './dto/wallet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { Principal } from '../common/utils/ownership.util';

/**
 * Wallet Controller
 *
 * Driver-facing money endpoints: earnings, MFB fuel support, LinkPay payouts.
 *
 * The driver id always comes from the JWT, never from the request body — the
 * same rule the rest of the driver endpoints follow, so one driver can never
 * act on another's wallet.
 */
@ApiTags('Wallet')
@Controller('api/v1/wallet')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.DRIVER)
@ApiBearerAuth('bearer')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * GET /api/v1/wallet/balance
   */
  @Get('balance')
  @ApiOperation({ summary: 'Get my wallet balance and fuel allowance' })
  @ApiOkResponse({ description: 'Current wallet position.' })
  async getBalance(@CurrentUser() principal: Principal) {
    return await this.walletService.getBalance(principal.id);
  }

  /**
   * GET /api/v1/wallet/fuel-support/limit
   */
  @Get('fuel-support/limit')
  @ApiOperation({ summary: "Get today's remaining MFB fuel support allowance" })
  async getFuelSupportLimit(@CurrentUser() principal: Principal) {
    return await this.walletService.getFuelSupportLimit(principal.id);
  }

  /**
   * POST /api/v1/wallet/fuel-support/request
   */
  @Post('fuel-support/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request daily fuel support from the microfinance bank',
  })
  @ApiBody({ type: RequestFuelSupportDto })
  async requestFuelSupport(
    @CurrentUser() principal: Principal,
    @Body() dto: RequestFuelSupportDto,
  ) {
    return await this.walletService.requestFuelSupport(principal.id, dto);
  }

  /**
   * POST /api/v1/wallet/payout
   */
  @Post('payout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw earnings through LinkPay' })
  @ApiBody({ type: RequestPayoutDto })
  async requestPayout(
    @CurrentUser() principal: Principal,
    @Body() dto: RequestPayoutDto,
  ) {
    return await this.walletService.requestPayout(principal.id, dto);
  }

  /**
   * GET /api/v1/wallet/transactions
   */
  @Get('transactions')
  @ApiOperation({ summary: 'My wallet transaction history' })
  async getTransactions(
    @CurrentUser() principal: Principal,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return await this.walletService.getTransactions(
      principal.id,
      clampLimit(limit),
      clampOffset(offset),
    );
  }
}
