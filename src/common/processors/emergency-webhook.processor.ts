import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EMERGENCY_WEBHOOKS } from '../services/webhook.service';

/**
 * EmergencyWebhookProcessor
 *
 * Purpose: The "Chef" (Consumer), same shape as EmailProcessor. It POSTs
 * emergency payloads to whatever external safety endpoints are configured.
 *
 * Targets come from EMERGENCY_WEBHOOK_URLS (comma separated). With none set,
 * this logs and no-ops — the incident record and the realtime broadcast to the
 * ops room still happened, so SOS is never blocked on integration config.
 *
 * A throw here is intentional: it tells BullMQ to retry with backoff.
 */
@Processor('emergency-webhooks')
export class EmergencyWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(EmergencyWebhookProcessor.name);

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case EMERGENCY_WEBHOOKS.TRIGGER_EMERGENCY_PROTOCOL:
      case EMERGENCY_WEBHOOKS.BROADCAST_LOCATION:
        return await this.postToTargets(job.name, job.data);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  private get targets(): string[] {
    return (process.env.EMERGENCY_WEBHOOK_URLS || '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  }

  private async postToTargets(event: string, data: Record<string, any>) {
    const targets = this.targets;

    if (targets.length === 0) {
      this.logger.warn(
        `🚨 ${event} fired for incident ${data.incidentId} but EMERGENCY_WEBHOOK_URLS is empty — nothing to notify.`,
      );
      return { delivered: 0, skipped: true };
    }

    const body = JSON.stringify({
      event,
      firedAt: new Date().toISOString(),
      data,
    });

    // Deliver to every target. If any fail, throw so BullMQ retries the job —
    // duplicate deliveries to the survivors are far better than a missed alert.
    const results = await Promise.allSettled(
      targets.map(async (url) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new Error(`${url} responded ${response.status}`);
        }

        return url;
      }),
    );

    const failures = results.filter((r) => r.status === 'rejected');

    if (failures.length > 0) {
      const reasons = failures.map((f) => f.reason?.message).join('; ');
      throw new Error(
        `${failures.length}/${targets.length} target(s) failed: ${reasons}`,
      );
    }

    this.logger.log(`🚨 ${event} delivered to ${targets.length} target(s)`);
    return { delivered: targets.length };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `❌ Emergency webhook job ${job.id} (${job.name}) failed, attempt ${job.attemptsMade}: ${error.message}`,
    );
  }
}
