import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
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
  async getBalance(@Request() req: any) {
    return await this.walletService.getBalance(req.user.id);
  }

  /**
   * GET /api/v1/wallet/fuel-support/limit
   */
  @Get('fuel-support/limit')
  @ApiOperation({ summary: "Get today's remaining MFB fuel support allowance" })
  async getFuelSupportLimit(@Request() req: any) {
    return await this.walletService.getFuelSupportLimit(req.user.id);
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
    @Request() req: any,
    @Body() dto: RequestFuelSupportDto,
  ) {
    return await this.walletService.requestFuelSupport(req.user.id, dto);
  }

  /**
   * POST /api/v1/wallet/payout
   */
  @Post('payout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw earnings through LinkPay' })
  @ApiBody({ type: RequestPayoutDto })
  async requestPayout(@Request() req: any, @Body() dto: RequestPayoutDto) {
    return await this.walletService.requestPayout(req.user.id, dto);
  }

  /**
   * GET /api/v1/wallet/transactions
   */
  @Get('transactions')
  @ApiOperation({ summary: 'My wallet transaction history' })
  async getTransactions(
    @Request() req: any,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return await this.walletService.getTransactions(
      req.user.id,
      clampLimit(limit),
      clampOffset(offset),
    );
  }
}
