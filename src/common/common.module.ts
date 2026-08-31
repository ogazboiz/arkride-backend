import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './services/email.service';
import { EmailProcessor } from './processors/email.processor';

/**
 * CommonModule
 * 
 * Purpose: Shared services and background workers used by many parts of the app.
 * 
 * Why this is @Global():
 * By making it global, we don't have to import it in every single module.
 * Any module can now use the EmailService.
 */
@Global()
@Module({
  imports: [
    // Register the 'email' queue so we can add jobs to it
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService, BullModule],
})
export class CommonModule {}
