import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './services/email.service';
import { EmailProcessor } from './processors/email.processor';
import { WebhookService } from './services/webhook.service';
import { EmergencyWebhookProcessor } from './processors/emergency-webhook.processor';

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

    // Outbound emergency webhooks. Same producer/consumer shape as email:
    // the SOS request path only enqueues, it never waits on a third party.
    BullModule.registerQueue({
      name: 'emergency-webhooks',
    }),
  ],
  providers: [
    EmailService,
    EmailProcessor,
    WebhookService,
    EmergencyWebhookProcessor,
  ],
  exports: [EmailService, WebhookService, BullModule],
})
export class CommonModule {}
