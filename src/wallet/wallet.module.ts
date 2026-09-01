import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { Driver } from '../drivers/entities/driver.entity';
import { LedgerModule } from '../ledger/ledger.module';
import {
  FUEL_SUPPORT_PROVIDER,
  PAYOUT_PROVIDER,
} from './providers/gateway.interfaces';
import {
  SimulatedMfbProvider,
  SimulatedLinkPayProvider,
} from './providers/simulated.providers';

/**
 * Wallet Module
 *
 * Driver earnings, MFB fuel support and LinkPay payouts.
 *
 * The two gateway providers are bound by config rather than imported directly,
 * so pointing at a live vendor later means adding a class and one case here —
 * WalletService never changes, because it only knows the interfaces.
 *
 * Env:
 *   MFB_PROVIDER=simulated|live      (default: simulated)
 *   LINKPAY_PROVIDER=simulated|live  (default: simulated)
 */
@Module({
  imports: [TypeOrmModule.forFeature([Driver]), LedgerModule, ConfigModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    SimulatedMfbProvider,
    SimulatedLinkPayProvider,
    {
      provide: FUEL_SUPPORT_PROVIDER,
      inject: [ConfigService, SimulatedMfbProvider],
      useFactory: (config: ConfigService, simulated: SimulatedMfbProvider) => {
        const provider = config.get<string>('MFB_PROVIDER') ?? 'simulated';

        if (provider !== 'simulated') {
          // Deliberately loud: silently falling back to the simulator in
          // production would mean fake money movements looking real.
          throw new Error(
            `MFB_PROVIDER="${provider}" is not implemented yet. Only "simulated" is available.`,
          );
        }

        return simulated;
      },
    },
    {
      provide: PAYOUT_PROVIDER,
      inject: [ConfigService, SimulatedLinkPayProvider],
      useFactory: (
        config: ConfigService,
        simulated: SimulatedLinkPayProvider,
      ) => {
        const provider = config.get<string>('LINKPAY_PROVIDER') ?? 'simulated';

        if (provider !== 'simulated') {
          throw new Error(
            `LINKPAY_PROVIDER="${provider}" is not implemented yet. Only "simulated" is available.`,
          );
        }

        return simulated;
      },
    },
  ],
  exports: [WalletService],
})
export class WalletModule {}
