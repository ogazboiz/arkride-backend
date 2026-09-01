import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Names of the emergency webhooks Ark Rides fires outward.
 * These are the contract external safety partners integrate against.
 */
export const EMERGENCY_WEBHOOKS = {
  TRIGGER_EMERGENCY_PROTOCOL: 'triggerEmergencyProtocol',
  BROADCAST_LOCATION: 'broadcastLocation',
} as const;

/**
 * WebhookService
 *
 * Purpose: The "Waiter" (Producer), exactly like EmailService. It does not make
 * HTTP calls itself — it drops a job into Redis and returns immediately.
 *
 * Why this matters more here than for email:
 * This runs in the SOS request path. If a safety partner's endpoint is slow or
 * down, the person pressing the panic button must not wait on it, and the alert
 * must not be lost — BullMQ retries with backoff until it lands.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectQueue('emergency-webhooks') private readonly webhookQueue: Queue,
  ) {}

  /**
   * Fire the full emergency fan-out: protocol trigger plus location broadcast
   */
  async dispatchEmergency(payload: Record<string, any>): Promise<void> {
    const options = {
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 2000 },
      removeOnComplete: 100,
    };

    await Promise.all([
      this.webhookQueue.add(
        EMERGENCY_WEBHOOKS.TRIGGER_EMERGENCY_PROTOCOL,
        payload,
        options,
      ),
      this.webhookQueue.add(
        EMERGENCY_WEBHOOKS.BROADCAST_LOCATION,
        payload,
        options,
      ),
    ]);

    this.logger.log(
      `📡 Queued emergency webhooks for incident ${payload.incidentId}`,
    );
  }
}
